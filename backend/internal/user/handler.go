package user

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

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) GetProfile(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	profile, err := h.service.GetProfile(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "user not found")
		return
	}

	response.JSON(w, http.StatusOK, profile)
}

// SetLanguage — PUT /api/v1/users/me/language {"language": "en"}. 204 si lo
// guardo; 400 INVALID_LANGUAGE si no es uno de los siete de la app.
func (h *Handler) SetLanguage(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	var req struct {
		Language string `json:"language"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if err := h.service.SetLanguage(r.Context(), userID, req.Language); err != nil {
		if errors.Is(err, ErrIdiomaInvalido) {
			response.Error(w, http.StatusBadRequest, "INVALID_LANGUAGE",
				"language must be one of es, en, fr, pt, zh-cn, ja, hi")
			return
		}
		if errors.Is(err, ErrCuentaInexistente) {
			response.Error(w, http.StatusNotFound, "NOT_FOUND", "user not found")
			return
		}
		response.Error(w, http.StatusInternalServerError, "UPDATE_FAILED", "could not save the language")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}

	var req UpdateProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	profile, err := h.service.UpdateProfile(r.Context(), userID, &req)
	if err != nil {
		if errors.Is(err, ErrCuentaDeDemostracion) {
			response.Error(w, http.StatusForbidden, "DEMO_ACCOUNT",
				"una cuenta de demostracion no puede cambiar sus datos")
			return
		}
		if errors.Is(err, ErrContrasenaRequerida) {
			response.Error(w, http.StatusForbidden, "PASSWORD_REQUIRED",
				"se requiere la contrasena vigente para cambiar el correo")
			return
		}
		response.Error(w, http.StatusInternalServerError, "UPDATE_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, profile)
}
