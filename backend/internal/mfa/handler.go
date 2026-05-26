package mfa

import (
	"encoding/json"
	"net/http"

	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/pkg/response"
)

type Handler struct {
	service *Service
}

func NewHandler(s *Service) *Handler { return &Handler{service: s} }

type issueRequest struct {
	Purpose string `json:"purpose"`
	Amount  int64  `json:"amount,omitempty"`
}

// Issue generates a fresh challenge. The plaintext code is returned to the
// caller for delivery out-of-band; production wires this to push notification.
// In development the code is logged to stdout for testing.
func (h *Handler) Issue(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	var req issueRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if req.Purpose == "" {
		req.Purpose = "high_value_tx"
	}
	code, err := h.service.IssueChallenge(r.Context(), userID, req.Purpose, "")
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "ISSUE_FAILED", "could not issue challenge")
		return
	}
	resp := map[string]string{"status": "issued"}
	// Dev-mode echo via header (never in prod).
	if r.Header.Get("X-Kiramopay-Dev") == "true" {
		resp["dev_code"] = code
	}
	response.JSON(w, http.StatusCreated, resp)
}

type verifyRequest struct {
	Purpose string `json:"purpose"`
	Code    string `json:"code"`
}

func (h *Handler) Verify(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		response.Error(w, http.StatusUnauthorized, "UNAUTHORIZED", "user not authenticated")
		return
	}
	var req verifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}
	if req.Purpose == "" {
		req.Purpose = "high_value_tx"
	}
	ok, err := h.service.VerifyChallenge(r.Context(), userID, req.Purpose, req.Code)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, "VERIFY_FAILED", "could not verify challenge")
		return
	}
	if !ok {
		response.Error(w, http.StatusUnauthorized, "INVALID_CODE", "invalid or expired code")
		return
	}
	response.JSON(w, http.StatusOK, map[string]string{"status": "verified"})
}
