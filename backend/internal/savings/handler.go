package savings

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/plans"
	"github.com/kiramopay/backend/pkg/response"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	goals, err := h.service.List(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	if goals == nil {
		goals = []Goal{}
	}
	response.JSON(w, http.StatusOK, goals)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req CreateGoalRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	g, err := h.service.Create(r.Context(), userID, &req)
	if err != nil {
		var tope *plans.TopeAlcanzadoError
		if errors.As(err, &tope) {
			response.ErrorConDetalle(w, http.StatusConflict, "SAVINGS_GOAL_LIMIT",
				"your plan does not allow more active savings goals", tope.Detalle())
			return
		}
		if codigo, mensaje, ok := rechazoAlCrear(err); ok {
			response.Error(w, http.StatusBadRequest, codigo, mensaje)
			return
		}
		// Lo que queda es una falla del servidor (la base, el tope sin poder
		// contarse): antes salia como 400 con el texto crudo del driver.
		response.Error(w, http.StatusInternalServerError, "CREATE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, g)
}

// rechazoAlCrear traduce un rechazo de entrada a su codigo. El mensaje es para
// quien integra la API; la pantalla traduce por codigo.
func rechazoAlCrear(err error) (codigo, mensaje string, ok bool) {
	switch {
	case errors.Is(err, ErrNombreRequerido):
		return "SAVINGS_NAME_REQUIRED", "the goal needs a name", true
	case errors.Is(err, ErrNombreMuyLargo):
		return "SAVINGS_NAME_TOO_LONG", "the goal name can have up to 120 characters", true
	case errors.Is(err, ErrObjetivoInvalido):
		return "SAVINGS_INVALID_TARGET", "the target must be greater than zero", true
	case errors.Is(err, ErrMonedaInvalida):
		return "SAVINGS_INVALID_CURRENCY", "the currency must be CRC or USD", true
	case errors.Is(err, ErrEstiloInvalido):
		return "SAVINGS_INVALID_STYLE", "the icon can have up to 40 characters and the color up to 20", true
	}
	return "", "", false
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	id := chi.URLParam(r, "id")
	if err := h.service.Delete(r.Context(), userID, id); err != nil {
		response.Error(w, http.StatusBadRequest, "DELETE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handler) Deposit(w http.ResponseWriter, r *http.Request)  { h.move(w, r, true) }
func (h *Handler) Withdraw(w http.ResponseWriter, r *http.Request) { h.move(w, r, false) }

func (h *Handler) move(w http.ResponseWriter, r *http.Request, deposit bool) {
	userID := middleware.GetUserID(r.Context())
	id := chi.URLParam(r, "id")
	var req AmountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	idemKey := r.Header.Get("Idempotency-Key")
	var (
		g   *Goal
		err error
	)
	if deposit {
		g, err = h.service.Deposit(r.Context(), userID, id, req.AmountMinor, idemKey)
	} else {
		g, err = h.service.Withdraw(r.Context(), userID, id, req.AmountMinor, idemKey)
	}
	if err != nil {
		response.Error(w, http.StatusBadRequest, "SAVINGS_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, g)
}
