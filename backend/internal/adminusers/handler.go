package adminusers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// Search — GET /api/v1/admin/users/search?q=<termino>&limit=20 (admin)
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	adminID := middleware.GetUserID(r.Context())
	views, err := h.service.Search(r.Context(), r.URL.Query().Get("q"), queryLimit(r), adminID, actorContext(r))
	if err != nil {
		if errors.Is(err, ErrTermTooShort) {
			response.Error(w, http.StatusBadRequest, "SEARCH_TERM_TOO_SHORT", "search term must have at least 3 characters")
			return
		}
		response.Error(w, http.StatusInternalServerError, "SEARCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, views)
}

// ListBlocked — GET /api/v1/admin/users/blocked?limit=50 (admin)
func (h *Handler) ListBlocked(w http.ResponseWriter, r *http.Request) {
	views, err := h.service.ListBlocked(r.Context(), queryLimit(r))
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, views)
}

// Get — GET /api/v1/admin/users/{id} (admin)
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUserID(w, r)
	if !ok {
		return
	}
	v, err := h.service.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			response.Error(w, http.StatusNotFound, "USER_NOT_FOUND", "user not found")
			return
		}
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, v)
}

// Block — POST /api/v1/admin/users/{id}/block {"reason": "..."} (admin)
func (h *Handler) Block(w http.ResponseWriter, r *http.Request) {
	adminID := middleware.GetUserID(r.Context())
	id, ok := pathUserID(w, r)
	if !ok {
		return
	}
	var req struct {
		Reason string `json:"reason"`
	}
	// Un cuerpo vacio es "sin motivo" (REASON_REQUIRED), no un JSON invalido.
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	v, err := h.service.Block(r.Context(), id, adminID, req.Reason, actorContext(r))
	if err != nil {
		switch {
		case errors.Is(err, ErrReasonRequired):
			response.Error(w, http.StatusBadRequest, "REASON_REQUIRED", "a reason of at most 500 characters is required")
		case errors.Is(err, ErrSelfBlock):
			response.Error(w, http.StatusBadRequest, "CANNOT_BLOCK_SELF", "cannot block your own account")
		case errors.Is(err, ErrAdminTarget):
			response.Error(w, http.StatusBadRequest, "CANNOT_BLOCK_ADMIN", "cannot block an administrator")
		case errors.Is(err, ErrNotFound):
			response.Error(w, http.StatusNotFound, "USER_NOT_FOUND", "user not found")
		default:
			response.Error(w, http.StatusInternalServerError, "BLOCK_FAILED", err.Error())
		}
		return
	}
	response.JSON(w, http.StatusOK, v)
}

// Unblock — POST /api/v1/admin/users/{id}/unblock (admin)
func (h *Handler) Unblock(w http.ResponseWriter, r *http.Request) {
	adminID := middleware.GetUserID(r.Context())
	id, ok := pathUserID(w, r)
	if !ok {
		return
	}
	v, err := h.service.Unblock(r.Context(), id, adminID, actorContext(r))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			response.Error(w, http.StatusNotFound, "USER_NOT_FOUND", "user not found")
			return
		}
		response.Error(w, http.StatusInternalServerError, "UNBLOCK_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, v)
}

// pathUserID valida {id} como UUID antes de tocar el servicio; si no lo es,
// responde 400 INVALID_ID y devuelve ok=false.
func pathUserID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_ID", "id must be a UUID")
		return "", false
	}
	return id.String(), true
}

// queryLimit devuelve 0 (limite por defecto del servicio) si falta o es invalido.
func queryLimit(r *http.Request) int {
	n, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || n <= 0 {
		return 0
	}
	return n
}

func actorContext(r *http.Request) ActorContext {
	return ActorContext{IPAddress: middleware.RequestIP(r), UserAgent: r.UserAgent()}
}
