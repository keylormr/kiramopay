package loyalty

import (
	"encoding/json"
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

func (h *Handler) GetAccount(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	acct, err := h.service.GetAccount(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, acct)
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

func (h *Handler) EarnPoints(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req EarnPointsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	ptx, err := h.service.EarnPoints(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "EARN_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, ptx)
}

func (h *Handler) GetRewards(w http.ResponseWriter, r *http.Request) {
	rewards, err := h.service.GetRewards(r.Context())
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, rewards)
}

func (h *Handler) RedeemReward(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req RedeemRewardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	redemption, err := h.service.RedeemReward(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "REDEEM_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, redemption)
}

func (h *Handler) GetRedemptions(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	redemptions, err := h.service.GetRedemptions(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, redemptions)
}

func (h *Handler) GetCashbackRules(w http.ResponseWriter, r *http.Request) {
	rules, err := h.service.GetCashbackRules(r.Context())
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, rules)
}
