package mfa

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

type Handler struct {
	service *Service
}

func NewHandler(s *Service) *Handler { return &Handler{service: s} }

type issueRequest struct {
	Purpose string `json:"purpose"`
	Amount  int64  `json:"amount,omitempty"`
}

// Issue generates a fresh challenge. The plaintext code is returned to the
// caller for delivery out-of-band; production wires this to push notification.
// In development the code is logged to stdout for testing.
func (h *Handler) Issue(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	var req issueRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if req.Purpose == "" {
		req.Purpose = "high_value_tx"
	}
	code, err := h.service.IssueChallenge(r.Context(), userID, req.Purpose, "")
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "ISSUE_FAILED", "could not issue challenge")
		return
	}
	resp := map[string]string{"status": "issued"}
	// Dev-mode echo via header (never in prod).
	if r.Header.Get("X-Kiramopay-Dev") == "true" {
		resp["dev_code"] = code
	}
	response.JSON(w, http.StatusCreated, resp)
}

type verifyRequest struct {
	Purpose string `json:"purpose"`
	Code    string `json:"code"`
}

func (h *Handler) Verify(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	var req verifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if req.Purpose == "" {
		req.Purpose = "high_value_tx"
	}
	ok, err := h.service.VerifyChallenge(r.Context(), userID, req.Purpose, req.Code)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "VERIFY_FAILED", "could not verify challenge")
		return
	}
	if !ok {
		response.Error(w, http.StatusUnauthorized, "INVALID_CODE", "invalid or expired code")
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"status": "verified"})
}

// ── TOTP (authenticator app) ─────────────────────────────────────────────

// TOTPStatus reports whether the caller has an active authenticator enrollment.
func (h *Handler) TOTPStatus(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	enabled, err := h.service.TOTPEnabled(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "TOTP_STATUS_FAILED", "could not read status")
		return
	}
	response.JSON(w, http.StatusOK, map[string]bool{"enabled": enabled})
}

// TOTPEnroll starts an enrollment, returning the secret + otpauth URI for QR.
func (h *Handler) TOTPEnroll(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	secret, uri, err := h.service.EnrollTOTP(r.Context(), userID, userID)
	if err != nil {
		h.writeTOTPError(w, err)
		return
	}
	response.JSON(w, http.StatusCreated, map[string]string{
		"secret":      secret,
		"otpauth_url": uri,
	})
}

type totpCodeRequest struct {
	Code    string `json:"code"`
	Purpose string `json:"purpose,omitempty"`
}

// TOTPConfirm activates the pending enrollment and returns recovery codes once.
func (h *Handler) TOTPConfirm(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	var req totpCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	codes, err := h.service.ConfirmTOTP(r.Context(), userID, req.Code)
	if err != nil {
		h.writeTOTPError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, map[string]interface{}{
		"status":         "enabled",
		"recovery_codes": codes,
	})
}

// TOTPVerify checks a TOTP/recovery code, recording a verified MFA challenge.
func (h *Handler) TOTPVerify(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	var req totpCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	ok, err := h.service.VerifyTOTP(r.Context(), userID, req.Purpose, req.Code)
	if err != nil {
		h.writeTOTPError(w, err)
		return
	}
	if !ok {
		response.Error(w, http.StatusUnauthorized, "INVALID_CODE", "invalid code")
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"status": "verified"})
}

// TOTPDisable turns off authenticator MFA after re-verifying a current code.
func (h *Handler) TOTPDisable(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	var req totpCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if err := h.service.DisableTOTP(r.Context(), userID, req.Code); err != nil {
		h.writeTOTPError(w, err)
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"status": "disabled"})
}

func (h *Handler) writeTOTPError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrTOTPNotConfigured):
		response.Error(w, http.StatusServiceUnavailable, "TOTP_UNAVAILABLE", "TOTP is not configured on this server")
	case errors.Is(err, ErrTOTPAlreadyOn):
		response.Error(w, http.StatusConflict, "TOTP_ALREADY_ENABLED", "authenticator already enabled")
	case errors.Is(err, ErrTOTPNotEnrolled):
		response.Error(w, http.StatusBadRequest, "TOTP_NOT_ENROLLED", "no active authenticator enrollment")
	case errors.Is(err, ErrTOTPBadCode):
		response.Error(w, http.StatusUnauthorized, "INVALID_CODE", "invalid code")
	default:
		response.Error(w, http.StatusInternalServerError, "TOTP_FAILED", "operation failed")
	}
}
