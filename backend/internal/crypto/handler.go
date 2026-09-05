package crypto

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/pkg/response"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) GetAssets(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	assets, err := h.service.GetAssets(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, assets)
}

func (h *Handler) GetTransactions(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	txs, err := h.service.GetTransactions(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, txs)
}

// errorDePrecio traduce los rechazos que vienen de poner el precio en el
// servidor. Son estados distintos a proposito: sin precio es que el sistema no
// puede cotizar ahora (503, se reintenta), precio viejo es que el ultimo dato
// del feed ya no sirve para cobrar (503, pero con causa propia: el proveedor
// lleva rato caido), y precio movido es que la persona acepto otro numero
// (409, hay que volver a mostrarlo).
func errorDePrecio(err error) (string, int, bool) {
	switch {
	case errors.Is(err, ErrPrecioViejo):
		return "PRICE_STALE", http.StatusServiceUnavailable, true
	case errors.Is(err, ErrSinPrecio):
		return "PRICE_UNAVAILABLE", http.StatusServiceUnavailable, true
	case errors.Is(err, ErrPrecioMovido):
		return "PRICE_MOVED", http.StatusConflict, true
	case errors.Is(err, ErrMonedaNoSoportada):
		return "UNSUPPORTED_CURRENCY", http.StatusBadRequest, true
	}
	return "", 0, false
}

func (h *Handler) Buy(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req BuyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	tx, err := h.service.Buy(r.Context(), userID, &req)
	if err != nil {
		// El gate de MFA vive en transaction.CreateTransaction, asi que esta
		// ruta tambien puede devolverlo. Sin este mapeo el cliente recibia el
		// codigo generico y mostraba el mensaje en ingles del servidor, sin
		// ofrecer nunca el desafio: la operacion moria ahi.
		if errors.Is(err, transaction.ErrMFARequired) {
			response.Error(w, http.StatusPreconditionRequired, "MFA_REQUIRED",
				"verified MFA challenge required for this amount")
			return
		}
		if codigo, estado, ok := errorDePrecio(err); ok {
			response.Error(w, estado, codigo, err.Error())
			return
		}
		response.Error(w, http.StatusBadRequest, "BUY_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, tx)
}

func (h *Handler) Sell(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req SellRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	tx, err := h.service.Sell(r.Context(), userID, &req)
	if err != nil {
		// El gate de MFA vive en transaction.CreateTransaction, asi que esta
		// ruta tambien puede devolverlo. Sin este mapeo el cliente recibia el
		// codigo generico y mostraba el mensaje en ingles del servidor, sin
		// ofrecer nunca el desafio: la operacion moria ahi.
		if errors.Is(err, transaction.ErrMFARequired) {
			response.Error(w, http.StatusPreconditionRequired, "MFA_REQUIRED",
				"verified MFA challenge required for this amount")
			return
		}
		if codigo, estado, ok := errorDePrecio(err); ok {
			response.Error(w, estado, codigo, err.Error())
			return
		}
		response.Error(w, http.StatusBadRequest, "SELL_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, tx)
}

func (h *Handler) Convert(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req ConvertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	tx, err := h.service.Convert(r.Context(), userID, &req)
	if err != nil {
		if codigo, estado, ok := errorDePrecio(err); ok {
			response.Error(w, estado, codigo, err.Error())
			return
		}
		response.Error(w, http.StatusBadRequest, "CONVERT_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, tx)
}

func (h *Handler) GetStakingPositions(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	positions, err := h.service.GetStakingPositions(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, positions)
}

func (h *Handler) Stake(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req StakeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	position, err := h.service.Stake(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "STAKE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, position)
}

func (h *Handler) Unstake(w http.ResponseWriter, r *http.Request) {
	positionID := chi.URLParam(r, "id")
	userID := middleware.GetUserID(r.Context())

	if err := h.service.Unstake(r.Context(), userID, positionID); err != nil {
		response.Error(w, http.StatusBadRequest, "UNSTAKE_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) GetPriceAlerts(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	alerts, err := h.service.GetPriceAlerts(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, alerts)
}

func (h *Handler) AddPriceAlert(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var alert PriceAlertRecord
	if err := json.NewDecoder(r.Body).Decode(&alert); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	result, err := h.service.AddPriceAlert(r.Context(), userID, &alert)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "ALERT_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, result)
}

func (h *Handler) RemovePriceAlert(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	alertID := chi.URLParam(r, "id")
	if err := h.service.RemovePriceAlert(r.Context(), userID, alertID); err != nil {
		response.Error(w, http.StatusBadRequest, "REMOVE_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) GetPrices(w http.ResponseWriter, r *http.Request) {
	symbolsParam := r.URL.Query().Get("symbols")
	symbols := []string{"BTC", "ETH", "SOL", "ADA", "DOT"}
	if symbolsParam != "" {
		symbols = strings.Split(symbolsParam, ",")
	}

	prices, err := h.service.GetPrices(r.Context(), symbols)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "PRICE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, prices)
}
