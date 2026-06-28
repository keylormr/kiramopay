package sinpe_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/sinpe"
)

// TestSinpeSendResponseContract drives a real SINPE transfer through the HTTP
// handler and asserts the `data` of its {success, data} response conforms to the
// SinpeSendResponse schema documented in openapi.yaml — catching drift between the
// handler's response and the published contract.
func TestSinpeSendResponseContract(t *testing.T) {
	svc, user := setupSinpeService(t)
	h := sinpe.NewHandler(svc)

	doc, err := contract.LoadSpec("../../docs/openapi.yaml")
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router: %v", err)
	}

	const url = "http://localhost:8080/api/v1/sinpe/send"
	// 50,000 CRC — below the daily limit and the MFA threshold, so it completes.
	body := `{"phone":"+50688885678","amount":5000000,"description":"contract"}`
	req := httptest.NewRequest(http.MethodPost, url, strings.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, user))
	rec := httptest.NewRecorder()
	h.Send(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("send returned %d, want 200: %s", rec.Code, rec.Body.String())
	}

	var env struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if !env.Success {
		t.Fatalf("expected success envelope, got: %s", rec.Body.String())
	}
	var data interface{}
	if err := json.Unmarshal(env.Data, &data); err != nil {
		t.Fatalf("decode data: %v", err)
	}

	if err := contract.ValidateData(router, http.MethodPost, url, http.StatusOK, data); err != nil {
		t.Errorf("sinpe send response violates the SinpeSendResponse schema: %v", err)
	}
}
