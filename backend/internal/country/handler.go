package country

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

func (h *Handler) GetCountries(w http.ResponseWriter, r *http.Request) {
	countries, err := h.service.GetCountries(r.Context())
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, countries)
}

func (h *Handler) GetExchangeRates(w http.ResponseWriter, r *http.Request) {
	rates, err := h.service.GetExchangeRates(r.Context())
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, rates)
}

func (h *Handler) ConvertCurrency(w http.ResponseWriter, r *http.Request) {
	var req ConvertCurrencyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	converted, rate, err := h.service.ConvertCurrency(r.Context(), &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "CONVERT_FAILED", err.Error())
		return
	}

	response.JSON(w, http.StatusOK, map[string]interface{}{
		"from_currency": req.FromCurrency,
		"to_currency":   req.ToCurrency,
		"from_amount":   req.Amount,
		"to_amount":     converted,
		"rate":          rate,
	})
}

func (h *Handler) GetUserWallets(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	wallets, err := h.service.GetUserWallets(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, wallets)
}

func (h *Handler) CreateWallet(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	countryCode := chi.URLParam(r, "code")

	wallet, err := h.service.CreateWallet(r.Context(), userID, countryCode)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "CREATE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, wallet)
}

func (h *Handler) SendCrossBorder(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req CrossBorderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	transfer, err := h.service.SendCrossBorder(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "TRANSFER_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, transfer)
}

func (h *Handler) GetTransferHistory(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	transfers, err := h.service.GetTransferHistory(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, transfers)
}

func (h *Handler) GetTransfer(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	transferID := chi.URLParam(r, "id")
	transfer, err := h.service.GetTransfer(r.Context(), transferID)
	if err != nil {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "transfer not found")
		return
	}
	// Ownership check: only the sender or receiver may read the transfer (IDOR).
	if transfer.SenderID != userID && transfer.ReceiverID != userID {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "transfer not found")
		return
	}
	response.JSON(w, http.StatusOK, transfer)
}
