package plans

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

// RegisterInterest — POST /api/v1/plans/interest {"plan":"plus"|"pro"|"analitica"} (autenticado)
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
			response.Error(w, http.StatusBadRequest, "PLAN_INVALID", "plan must be plus, pro or analitica")
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

// AsignarPlan — PATCH /api/v1/admin/users/{id}/plan {"plan":"free"|"plus"|"pro"} (admin)
//
// Validacion estricta: el cuerpo es exactamente {"plan": "..."}. Un campo de
// mas, un JSON roto o texto despues del objeto es INVALID_BODY; un plan que no
// sea uno de los tres, escrito tal cual, es PLAN_INVALID. Aqui un error de
// tipeo no se "corrige": cambia lo que una cuenta puede hacer.
func (h *Handler) AsignarPlan(w http.ResponseWriter, r *http.Request) {
	adminID := middleware.GetUserID(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_ID", "id must be a UUID")
		return
	}

	plan, ok := LeerPlanEstricto(w, r)
	if !ok {
		return
	}

	out, err := h.service.AsignarPlan(r.Context(), id.String(), adminID, plan, actorContext(r))
	if err != nil {
		switch {
		case errors.Is(err, ErrPlanInvalid):
			response.Error(w, http.StatusBadRequest, "PLAN_INVALID", "plan must be free, plus or pro")
		case errors.Is(err, ErrUsuarioNoEncontrado):
			response.Error(w, http.StatusNotFound, "USER_NOT_FOUND", "user not found")
		default:
			response.Error(w, http.StatusInternalServerError, "PLAN_UPDATE_FAILED", err.Error())
		}
		return
	}
	response.JSON(w, http.StatusOK, out)
}

// LeerPlanEstricto decodifica {"plan": "..."} sin tolerar nada mas. Responde el
// error y devuelve ok=false si el cuerpo no es exactamente eso. Lo comparten
// las dos rutas de administrador que asignan un plan (persona y comercio).
func LeerPlanEstricto(w http.ResponseWriter, r *http.Request) (string, bool) {
	var req struct {
		Plan *string `json:"plan"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		if errors.Is(err, io.EOF) {
			response.Error(w, http.StatusBadRequest, "PLAN_INVALID", "plan is required")
			return "", false
		}
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "body must be exactly {\"plan\": \"...\"}")
		return "", false
	}
	// Texto despues del objeto: {"plan":"pro"}{"plan":"free"} no es un cuerpo
	// valido, aunque el primer objeto lo sea. Un segundo Decode tiene que
	// encontrar el final del cuerpo y nada mas.
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "body must be exactly {\"plan\": \"...\"}")
		return "", false
	}
	if req.Plan == nil {
		response.Error(w, http.StatusBadRequest, "PLAN_INVALID", "plan is required")
		return "", false
	}
	return *req.Plan, true
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
