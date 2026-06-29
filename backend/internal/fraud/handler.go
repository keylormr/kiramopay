package fraud

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// AssessTransaction assesses the AUTHENTICATED caller's own transaction. The
// subject is taken from the session, never the request body, so a user cannot
// assess, mutate the risk profile of, or probe the restricted state of another
// account (IDOR).
func (h *Handler) AssessTransaction(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	var req AssessRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	req.UserID = userID // bind to the caller; ignore any body-supplied user_id

	assessment, err := h.service.AssessTransaction(r.Context(), &req)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "ASSESS_FAILED", "could not assess transaction")
		return
	}
	response.JSON(w, http.StatusOK, assessment)
}

func (h *Handler) GetRiskProfile(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	profile, err := h.service.GetUserRiskProfile(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, profile)
}

func (h *Handler) GetUserAssessments(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	assessments, err := h.service.GetUserAssessments(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, assessments)
}

// ── Admin endpoints ──────────────────────────────────────────────────────────

func (h *Handler) GetOpenAlerts(w http.ResponseWriter, r *http.Request) {
	alerts, err := h.service.GetOpenAlerts(r.Context())
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, alerts)
}

func (h *Handler) ResolveAlert(w http.ResponseWriter, r *http.Request) {
	alertID := chi.URLParam(r, "id")
	reviewerID := middleware.GetUserID(r.Context())

	var body struct {
		Status string `json:"status"` // resolved, false_positive, investigating
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if err := h.service.ResolveAlert(r.Context(), alertID, reviewerID, body.Status); err != nil {
		response.Error(w, http.StatusBadRequest, "RESOLVE_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) RestrictUser(w http.ResponseWriter, r *http.Request) {
	targetUserID := chi.URLParam(r, "userId")
	var body struct {
		Restricted bool `json:"restricted"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	if err := h.service.RestrictUser(r.Context(), targetUserID, body.Restricted); err != nil {
		response.Error(w, http.StatusBadRequest, "RESTRICT_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}
