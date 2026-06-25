package payout

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/middleware"
)

// TestPayoutCreateResponseContract drives a real payout through the HTTP handler
// and asserts the `data` of its {success, data} response conforms to the Payout
// schema documented in openapi.yaml — catching drift between the handler's
// response and the published contract.
func TestPayoutCreateResponseContract(t *testing.T) {
	_, svc, _, user := setup(t)
	h := NewHandler(svc)

	doc, err := contract.LoadSpec("../../docs/openapi.yaml")
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router: %v", err)
	}

	const url = "http://localhost:8080/api/v1/payouts"
	reqBody := `{"rail":"mock","amount_minor":50000,"currency":"CRC",` +
		`"destination":{"type":"bank_account","account":"123456789","name":"Acme SA"},` +
		`"idempotency_key":"contract-1"}`
	req := httptest.NewRequest(http.MethodPost, url, strings.NewReader(reqBody))
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, user))
	rec := httptest.NewRecorder()
	h.Create(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("create returned %d, want 201: %s", rec.Code, rec.Body.String())
	}

	var envelope struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response envelope: %v", err)
	}
	if !envelope.Success {
		t.Fatalf("expected success envelope, got: %s", rec.Body.String())
	}
	var data interface{}
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		t.Fatalf("decode data: %v", err)
	}

	if err := contract.ValidateData(router, http.MethodPost, url, http.StatusCreated, data); err != nil {
		t.Errorf("payout create response violates the Payout schema: %v", err)
	}
}
