package marketplace

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

func (h *Handler) GetPartners(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	partners, connected, err := h.service.GetPartners(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, map[string]interface{}{
		"partners":  partners,
		"connected": connected,
	})
}

func (h *Handler) ConfirmRide(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	rideID := chi.URLParam(r, "id")
	ride, err := h.service.ConfirmRide(r.Context(), userID, rideID)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "CONFIRM_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, ride)
}

func (h *Handler) ConnectPartner(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req ConnectPartnerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if err := h.service.ConnectPartner(r.Context(), userID, req.PartnerCode); err != nil {
		response.Error(w, http.StatusBadRequest, "CONNECT_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) DisconnectPartner(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	partnerCode := chi.URLParam(r, "code")
	if err := h.service.DisconnectPartner(r.Context(), userID, partnerCode); err != nil {
		response.Error(w, http.StatusBadRequest, "DISCONNECT_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

// ── Rides ────────────────────────────────────────────────────────────────────

func (h *Handler) CreateRideRequest(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req CreateRideRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	ride, err := h.service.CreateRideRequest(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "RIDE_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, ride)
}

func (h *Handler) GetRideRequest(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	rideID := chi.URLParam(r, "id")
	ride, err := h.service.GetRideRequest(r.Context(), rideID)
	if err != nil {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "ride not found")
		return
	}
	if ride.UserID != userID {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "ride not found")
		return
	}
	response.JSON(w, http.StatusOK, ride)
}

func (h *Handler) UpdateRideStatus(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	rideID := chi.URLParam(r, "id")
	// Ownership check: only the requesting user may change their own ride (IDOR).
	ride, err := h.service.GetRideRequest(r.Context(), rideID)
	if err != nil {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "ride not found")
		return
	}
	if ride.UserID != userID {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "ride not found")
		return
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if err := h.service.UpdateRideStatus(r.Context(), rideID, body.Status); err != nil {
		response.Error(w, http.StatusBadRequest, "UPDATE_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) ListRides(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	rides, err := h.service.ListUserRides(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, rides)
}

// ── Food Orders ──────────────────────────────────────────────────────────────

func (h *Handler) CreateFoodOrder(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req CreateFoodOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	order, err := h.service.CreateFoodOrder(r.Context(), userID, &req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, "ORDER_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusCreated, order)
}

func (h *Handler) GetFoodOrder(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	orderID := chi.URLParam(r, "id")
	// Scoped to the requesting user; a non-owner gets a not-found error and no
	// derive/backfill side effect runs on their order.
	order, items, err := h.service.GetFoodOrder(r.Context(), orderID, userID)
	if err != nil {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "food order not found")
		return
	}
	response.JSON(w, http.StatusOK, map[string]interface{}{
		"order": FoodOrderResponse{
			FoodOrderRecord: order,
			Courier:         h.service.CourierFor(order.ID, order.Status),
		},
		"items": items,
	})
}

func (h *Handler) UpdateFoodOrderStatus(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	orderID := chi.URLParam(r, "id")
	// Ownership check: the scoped lookup returns no rows for a non-owner (IDOR).
	if _, _, err := h.service.GetFoodOrder(r.Context(), orderID, userID); err != nil {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "food order not found")
		return
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if err := h.service.UpdateFoodOrderStatus(r.Context(), orderID, body.Status); err != nil {
		response.Error(w, http.StatusBadRequest, "UPDATE_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) ListFoodOrders(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	orders, err := h.service.ListUserFoodOrders(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, orders)
}
