package splitpay

import (
	"encoding/json"
	"errors"
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

func (h *Handler) CreateSplit(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req CreateSplitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	group, shares, err := h.service.CreateSplit(r.Context(), userID, &req)
	if err != nil {
		writeCreateSplitError(w, err)
		return
	}

	response.JSON(w, http.StatusCreated, map[string]interface{}{
		"group":  group,
		"shares": shares,
	})
}

// writeCreateSplitError traduce un error de CreateSplit a un codigo estable.
//
// Antes los nueve rechazos de forma llegaban con el mismo codigo generico
// CREATE_FAILED y el texto crudo en ingles de fmt.Errorf, incluyendo montos en
// centimos ("the shares (40000) add up to more than the total (30000)") — la
// pantalla los mostraba tal cual dentro de una app en espanol (hallazgo QA
// n=52). Ahora cada caso tiene su propio codigo; el mensaje que viaja es fijo
// y solo para diagnostico, nunca lo que decide que ve la persona: eso lo elige
// la pantalla a partir del CODIGO, en su propio idioma y con sus propios
// montos (que ya tiene en colones, sin depender de este texto).
func writeCreateSplitError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrTitleRequired):
		response.Error(w, http.StatusBadRequest, "SPLIT_TITLE_REQUIRED", "title is required")
	case errors.Is(err, ErrInvalidAmount):
		response.Error(w, http.StatusBadRequest, "SPLIT_INVALID_AMOUNT", "total amount must be positive")
	case errors.Is(err, ErrParticipantRequired):
		response.Error(w, http.StatusBadRequest, "SPLIT_PARTICIPANT_REQUIRED", "at least one participant besides you is required")
	case errors.Is(err, ErrPhoneRequired):
		response.Error(w, http.StatusBadRequest, "SPLIT_PHONE_REQUIRED", "participant needs a phone number")
	case errors.Is(err, ErrInvalidPhone):
		response.Error(w, http.StatusBadRequest, "SPLIT_INVALID_PHONE", "participant phone is not a valid number")
	case errors.Is(err, ErrAccountNotFound):
		response.Error(w, http.StatusUnprocessableEntity, "SPLIT_ACCOUNT_NOT_FOUND", "participant has no KiramoPay account")
	case errors.Is(err, ErrSelfIncluded):
		response.Error(w, http.StatusBadRequest, "SPLIT_SELF_INCLUDED", "cannot include your own phone as a participant")
	case errors.Is(err, ErrDuplicateParticipant):
		response.Error(w, http.StatusBadRequest, "SPLIT_DUPLICATE_PARTICIPANT", "participant appears twice in the split")
	case errors.Is(err, ErrTotalTooSmall):
		response.Error(w, http.StatusBadRequest, "SPLIT_TOTAL_TOO_SMALL", "total is too small to split among the participants")
	case errors.Is(err, ErrCustomAmountRequired):
		response.Error(w, http.StatusBadRequest, "SPLIT_CUSTOM_AMOUNT_REQUIRED", "custom participant amount must be positive")
	case errors.Is(err, ErrExceedsTotal):
		response.Error(w, http.StatusBadRequest, "SPLIT_EXCEEDS_TOTAL", "custom shares add up to more than the total")
	case errors.Is(err, ErrPercentageRequired):
		response.Error(w, http.StatusBadRequest, "SPLIT_PERCENTAGE_REQUIRED", "participant percentage must be positive")
	case errors.Is(err, ErrPercentageExceedsTotal):
		response.Error(w, http.StatusBadRequest, "SPLIT_PERCENTAGE_EXCEEDS_TOTAL", "percentages add up to more than 100")
	case errors.Is(err, ErrPercentageRoundsToZero):
		response.Error(w, http.StatusBadRequest, "SPLIT_PERCENTAGE_ROUNDS_TO_ZERO", "percentage rounds down to zero")
	case errors.Is(err, ErrInvalidSplitType):
		response.Error(w, http.StatusBadRequest, "SPLIT_INVALID_TYPE", "invalid split type")
	case errors.Is(err, ErrInvalidRequest):
		response.Error(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
	default:
		// ErrAccountLookupUnavailable y cualquier fallo de infraestructura
		// (escribir el grupo, la transaccion) caen aqui: son 500, y
		// response.Error ya blinda el mensaje que sale al cliente.
		response.Error(w, http.StatusInternalServerError, "CREATE_FAILED", err.Error())
	}
}

func (h *Handler) GetSplit(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	groupID := chi.URLParam(r, "id")
	group, shares, err := h.service.GetSplit(r.Context(), groupID)
	if err != nil {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", err.Error())
		return
	}
	// Ownership check: only the creator or a participant may read the split (IDOR).
	allowed := group.CreatorID == userID
	for _, s := range shares {
		if s.UserID == userID {
			allowed = true
			break
		}
	}
	if !allowed {
		response.Error(w, http.StatusNotFound, "NOT_FOUND", "split not found")
		return
	}

	response.JSON(w, http.StatusOK, map[string]interface{}{
		"group":  group,
		"shares": shares,
	})
}

func (h *Handler) ListSplits(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	groups, err := h.service.ListUserSplits(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "FETCH_FAILED", err.Error())
		return
	}
	response.JSON(w, http.StatusOK, groups)
}

func (h *Handler) PayShare(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	groupID := chi.URLParam(r, "id")

	if err := h.service.PayShare(r.Context(), userID, groupID); err != nil {
		response.Error(w, http.StatusBadRequest, "PAY_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) DeclineShare(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	groupID := chi.URLParam(r, "id")

	if err := h.service.DeclineShare(r.Context(), userID, groupID); err != nil {
		response.Error(w, http.StatusBadRequest, "DECLINE_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}

func (h *Handler) CancelSplit(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	groupID := chi.URLParam(r, "id")

	if err := h.service.CancelSplit(r.Context(), userID, groupID); err != nil {
		response.Error(w, http.StatusBadRequest, "CANCEL_FAILED", err.Error())
		return
	}
	response.NoContent(w)
}
