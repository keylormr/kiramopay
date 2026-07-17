package auth

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
	"github.com/kiramopay/backend/pkg/validator"
)

type Handler struct {
	service *Service
	cookies CookieConfig
	devMode bool // server runs in development; gates the dev-token echo
}

func NewHandler(service *Service, cookies CookieConfig, devMode bool) *Handler {
	return &Handler{service: service, cookies: cookies, devMode: devMode}
}

// noStore marks an auth response uncacheable so tokens are never written to a
// shared or browser cache (OWASP).
func noStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
}

func loginContext(r *http.Request) LoginContext {
	ip := r.Header.Get("X-Forwarded-For")
	if ip == "" {
		// Strip trailing :port if present.
		raw := r.RemoteAddr
		if idx := strings.LastIndex(raw, ":"); idx > 0 {
			raw = raw[:idx]
		}
		ip = raw
	} else {
		ip = strings.TrimSpace(strings.SplitN(ip, ",", 2)[0])
	}
	return LoginContext{
		IPAddress: ip,
		UserAgent: r.UserAgent(),
	}
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if err := validator.ValidateCedula(req.Cedula); err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Message)
		return
	}
	// Login must NOT enforce the password-complexity policy — that belongs to
	// registration. Re-validating here locks out any account whose password
	// predates a policy change or was provisioned by the seeder. The service
	// verifies the hash and returns a constant "invalid credentials" on mismatch.

	result, err := h.service.Login(r.Context(), &req, loginContext(r))
	if err != nil {
		// Log the real cause for ops; the client always sees a constant
		// "invalid credentials" message (constant-time anti-enumeration).
		if !errors.Is(err, ErrInvalidCredentials) {
			slog.Error("login: internal error", "err", err.Error())
		}
		response.Error(w, http.StatusUnauthorized, "AUTH_FAILED", "invalid credentials")
		return
	}
	// Issue the refresh token as an HttpOnly cookie (the secure transport). The
	// body still carries the tokens for backward compatibility with clients that
	// have not migrated to the cookie yet.
	h.cookies.setRefreshCookie(w, result.Tokens.RefreshToken, result.Tokens.RefreshExpiry)
	noStore(w)
	response.JSON(w, http.StatusOK, result)
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	var errs validator.ValidationErrors
	if err := validator.ValidateCedula(req.Cedula); err != nil {
		errs = append(errs, *err)
	}
	if err := validator.ValidatePhone(req.Phone); err != nil {
		errs = append(errs, *err)
	}
	if err := validator.ValidatePassword(req.Password); err != nil {
		errs = append(errs, *err)
	}
	if err := validator.ValidateRequired("first_name", req.FirstName); err != nil {
		errs = append(errs, *err)
	}
	if err := validator.ValidateRequired("last_name", req.LastName); err != nil {
		errs = append(errs, *err)
	}
	if errs.HasErrors() {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", errs.Error())
		return
	}

	result, err := h.service.Register(r.Context(), &req, loginContext(r))
	if err != nil {
		response.Error(w, http.StatusConflict, "REGISTER_FAILED", err.Error())
		return
	}
	h.cookies.setRefreshCookie(w, result.Tokens.RefreshToken, result.Tokens.RefreshExpiry)
	noStore(w)
	response.JSON(w, http.StatusCreated, result)
}

// RegisterSendOTP issues a phone-verification code for a pending registration.
// Response is generic; in dev the code is echoed (dev_code) like ForgotPassword,
// since no SMS provider is wired yet (delivery is the licensing/partner gap).
func (h *Handler) RegisterSendOTP(w http.ResponseWriter, r *http.Request) {
	var req SendRegistrationOTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if err := validator.ValidatePhone(req.Phone); err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Message)
		return
	}
	code, err := h.service.SendRegistrationOTP(r.Context(), req.Phone)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "OTP_SEND_FAILED", "could not send verification code")
		return
	}
	resp := map[string]string{"message": "verification code sent"}
	if h.isDevMode(r) {
		resp["dev_code"] = code
	}
	noStore(w)
	response.JSON(w, http.StatusOK, resp)
}

// RegisterVerifyOTP checks the code and returns a single-use verification token
// the client passes to /auth/register as `verification_token`.
func (h *Handler) RegisterVerifyOTP(w http.ResponseWriter, r *http.Request) {
	var req VerifyRegistrationOTPRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	token, err := h.service.VerifyRegistrationOTP(r.Context(), req.Phone, req.Code)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "OTP_INVALID", "invalid or expired verification code")
		return
	}
	noStore(w)
	response.JSON(w, http.StatusOK, map[string]string{"verification_token": token})
}

func (h *Handler) RefreshToken(w http.ResponseWriter, r *http.Request) {
	// Prefer the HttpOnly cookie (the secure path); fall back to the JSON body so
	// clients that have not migrated to the cookie keep working.
	refreshRaw := h.cookies.refreshTokenFromCookie(r)
	fromCookie := refreshRaw != ""
	if !fromCookie {
		var req struct {
			RefreshToken string `json:"refresh_token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RefreshToken == "" {
			response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
			return
		}
		refreshRaw = req.RefreshToken
	}
	tokens, err := h.service.Refresh(r.Context(), refreshRaw, loginContext(r))
	if err != nil {
		// A cookie-borne token that no longer validates is stale — clear it so the
		// browser stops replaying it on every request.
		if fromCookie {
			h.cookies.clearRefreshCookie(w)
		}
		noStore(w)
		response.Error(w, http.StatusUnauthorized, "REFRESH_FAILED", "invalid refresh token")
		return
	}
	h.cookies.setRefreshCookie(w, tokens.RefreshToken, tokens.RefreshExpiry)
	noStore(w)
	response.JSON(w, http.StatusOK, tokens)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	// Clear the session cookie and ask the browser to drop cached site data,
	// regardless of the backend revocation outcome below — the client intends to
	// be logged out.
	h.cookies.clearRefreshCookie(w)
	w.Header().Set("Clear-Site-Data", `"cookies", "storage"`)
	noStore(w)

	jti := middleware.GetAccessJTI(r.Context())
	exp := middleware.GetAccessExp(r.Context())
	var ttl time.Duration
	if exp > 0 {
		ttl = time.Until(time.Unix(exp, 0))
		if ttl <= 0 {
			ttl = time.Second
		}
	} else {
		ttl = 15 * time.Minute
	}
	if err := h.service.Logout(r.Context(), jti, ttl); err != nil {
		response.Error(w, http.StatusInternalServerError, "LOGOUT_FAILED", "could not log out")
		return
	}
	response.NoContent(w)
}

func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	var req ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if err := validator.ValidatePassword(req.NewPassword); err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Message)
		return
	}
	if err := h.service.ChangePassword(r.Context(), userID, &req, loginContext(r)); err != nil {
		response.Error(w, http.StatusBadRequest, "CHANGE_PASSWORD_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "Password changed successfully"})
}

// ForgotPassword issues a reset token. Response is constant ("OK") to prevent
// enumeration; in dev mode, the token is returned for testing convenience.
func (h *Handler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req ForgotPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if err := validator.ValidateCedula(req.Cedula); err != nil {
		response.JSON(w, http.StatusAccepted, map[string]string{"message": "if the account exists, a reset link has been sent"})
		return
	}
	token, err := h.service.ForgotPassword(r.Context(), req.Cedula, loginContext(r))
	if err != nil {
		// Still return generic — never leak internal errors here.
		response.JSON(w, http.StatusAccepted, map[string]string{"message": "if the account exists, a reset link has been sent"})
		return
	}
	resp := map[string]string{"message": "if the account exists, a reset link has been sent"}
	if token != "" && h.isDevMode(r) {
		resp["dev_token"] = token
	}
	response.JSON(w, http.StatusAccepted, resp)
}

func (h *Handler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req ResetPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Token == "" {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if err := validator.ValidatePassword(req.NewPassword); err != nil {
		response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR", err.Message)
		return
	}
	if err := h.service.ResetPassword(r.Context(), &req, loginContext(r)); err != nil {
		response.Error(w, http.StatusBadRequest, "RESET_FAILED", "invalid or expired reset token")
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"message": "Password reset successful"})
}

// isDevMode reports whether the dev-only token echo is allowed. It is gated on
// the SERVER's environment (set at construction from config) — the request
// header alone is never trusted, so a client cannot turn on dev mode in
// production and exfiltrate the reset token.
func (h *Handler) isDevMode(r *http.Request) bool {
	return h.devMode && r.Header.Get("X-Kiramopay-Dev") == "true"
}
