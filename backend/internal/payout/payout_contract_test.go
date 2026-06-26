package payout

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
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

// TestPayoutReadResponseContract drives the read endpoints — list, get one, and
// refresh — through the HTTP handlers and asserts each `data` payload conforms
// to the schema documented in openapi.yaml (an array of Payout for the list, a
// single Payout for get/refresh).
func TestPayoutReadResponseContract(t *testing.T) {
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

	// Seed one real payout so the list and get responses are non-empty.
	p, err := svc.Create(context.Background(), user, req("00012345", 50_000, "contract-read-1"))
	if err != nil {
		t.Fatalf("seed payout: %v", err)
	}

	// List (200) — GET /payouts → array of Payout.
	listURL := "http://localhost:8080/api/v1/payouts"
	rec := httptest.NewRecorder()
	h.List(rec, reqWithUser(http.MethodGet, listURL, "", user, ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("list returned %d, want 200: %s", rec.Code, rec.Body.String())
	}
	list := decodeData(t, rec)
	if items, ok := list.([]interface{}); !ok || len(items) == 0 {
		t.Fatalf("expected a non-empty payout list, got: %s", rec.Body.String())
	}
	if err := contract.ValidateData(router, http.MethodGet, listURL, http.StatusOK, list); err != nil {
		t.Errorf("payout list response violates the Payout array schema: %v", err)
	}

	// Get (200) — GET /payouts/{id} → a single Payout.
	getURL := "http://localhost:8080/api/v1/payouts/" + p.ID
	rec = httptest.NewRecorder()
	h.Get(rec, reqWithUser(http.MethodGet, getURL, "", user, p.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("get returned %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if err := contract.ValidateData(router, http.MethodGet, getURL, http.StatusOK, decodeData(t, rec)); err != nil {
		t.Errorf("payout get response violates the Payout schema: %v", err)
	}

	// Refresh (200) — POST /payouts/{id}/refresh → the current Payout state.
	refreshURL := "http://localhost:8080/api/v1/payouts/" + p.ID + "/refresh"
	rec = httptest.NewRecorder()
	h.Refresh(rec, reqWithUser(http.MethodPost, refreshURL, "", user, p.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("refresh returned %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if err := contract.ValidateData(router, http.MethodPost, refreshURL, http.StatusOK, decodeData(t, rec)); err != nil {
		t.Errorf("payout refresh response violates the Payout schema: %v", err)
	}
}

// reqWithUser builds a request carrying an authenticated user and an optional
// chi {id} path param, the way the real middleware + router would.
func reqWithUser(method, url, body, userID, id string) *http.Request {
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, url, nil)
	} else {
		r = httptest.NewRequest(method, url, strings.NewReader(body))
	}
	ctx := context.WithValue(r.Context(), middleware.UserIDKey, userID)
	if id != "" {
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("id", id)
		ctx = context.WithValue(ctx, chi.RouteCtxKey, rctx)
	}
	return r.WithContext(ctx)
}

// decodeData unwraps the {success, data} envelope and returns the decoded data.
func decodeData(t *testing.T, rec *httptest.ResponseRecorder) interface{} {
	t.Helper()
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
	return data
}
