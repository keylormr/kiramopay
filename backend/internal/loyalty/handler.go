package loyalty

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
		switch {
		// Cada rechazo con su propio codigo: la pantalla tiene que poder decir
		// "no hay fondos de promociones ahora" en vez de un fallo generico.
		case errors.Is(err, ErrSinFondosPromocion):
			response.Error(w, http.StatusConflict, "LOYALTY_SIN_FONDOS", err.Error())
		case errors.Is(err, ErrPremioSinEntrega):
			response.Error(w, http.StatusConflict, "LOYALTY_SIN_ENTREGA", err.Error())
		case errors.Is(err, ErrSinExistencias):
			response.Error(w, http.StatusConflict, "LOYALTY_SIN_EXISTENCIAS", err.Error())
		default:
			response.Error(w, http.StatusBadRequest, "REDEEM_FAILED", err.Error())
		}
		return
	}
	response.JSON(w, http.StatusCreated, redemption)
}

// Promociones responde GET /api/v1/admin/promociones: el saldo del fondo del
// que salen los canjes de cashback.
func (h *Handler) Promociones(w http.ResponseWriter, r *http.Request) {
	saldo, err := h.service.SaldoPromociones(r.Context())
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", "no se pudo leer el fondo de promociones")
		return
	}
	response.JSON(w, http.StatusOK, map[string]interface{}{"saldo_minor": saldo, "moneda": "CRC"})
}

// FondearPromociones responde POST /api/v1/admin/promociones/fondos. Registra un
// deposito de la empresa al fondo: SUBE LA RESERVA PUBLICADA, asi que tiene que
// corresponder a un deposito real. Por eso exige referencia.
func (h *Handler) FondearPromociones(w http.ResponseWriter, r *http.Request) {
	adminID := middleware.GetUserID(r.Context())
	var body struct {
		MontoMinor     int64  `json:"amount_minor"`
		Referencia     string `json:"referencia"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	saldo, err := h.service.FondearPromociones(r.Context(), adminID, body.MontoMinor, body.Referencia, body.IdempotencyKey)
	if err != nil {
		if errors.Is(err, ErrFondeoInvalido) {
			response.Error(w, http.StatusBadRequest, "VALIDATION_ERROR",
				"amount_minor > 0, referencia (3+ caracteres) e idempotency_key son obligatorios")
			return
		}
		response.Error(w, http.StatusInternalServerError, "FUNDING_FAILED", "no se pudo registrar el fondeo")
		return
	}
	response.JSON(w, http.StatusOK, map[string]interface{}{"saldo_minor": saldo, "moneda": "CRC"})
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

// GetReferrals returns the caller's referral summary (own code, invited count,
// points earned, promised bonus).
func (h *Handler) GetReferrals(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	summary, err := h.service.GetReferralSummary(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, summary)
}

func (h *Handler) GetCashbackRules(w http.ResponseWriter, r *http.Request) {
	rules, err := h.service.GetCashbackRules(r.Context())
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, rules)
}
