package plans

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

// RegisterInterest — POST /api/v1/plans/interest {"plan":"negocio"|"cima"} (autenticado)
//
// Registra INTERES, no una suscripcion: no hay cobro detras. La respuesta
// devuelve la fecha para que la pantalla pueda decir desde cuando esta anotado.
func (h *Handler) RegisterInterest(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())

	var req struct {
		Plan string `json:"plan"`
	}
	// Un cuerpo vacio es "sin plan" (PLAN_INVALID), no un JSON invalido.
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	interest, err := h.service.Register(r.Context(), userID, req.Plan, actorContext(r))
	if err != nil {
		if errors.Is(err, ErrPlanInvalid) {
			response.Error(w, http.StatusBadRequest, "PLAN_INVALID", "plan must be negocio or cima")
			return
		}
		response.Error(w, http.StatusInternalServerError, "INTEREST_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, interest)
}

// List — GET /api/v1/admin/plans/interest?limit=100 (admin)
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	views, err := h.service.List(r.Context(), queryLimit(r))
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, views)
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
