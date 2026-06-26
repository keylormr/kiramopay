package escrow_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/escrow"
	"github.com/kiramopay/backend/internal/middleware"
)

const specPath = "../../docs/openapi.yaml"

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

// TestEscrowResponseContract creates and funds a real agreement through the HTTP
// handler and asserts both responses (201 create + 200 fund — a money-moving
// transition) conform to the EscrowAgreement schema in openapi.yaml.
func TestEscrowResponseContract(t *testing.T) {
	_, svc, buyer, seller := setup(t)
	h := escrow.NewHandler(svc)

	doc, err := contract.LoadSpec(specPath)
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router: %v", err)
	}

	// Create (201) — a pending agreement, no money moves.
	const createURL = "http://localhost:8080/api/v1/escrow"
	createBody := `{"seller_id":"` + seller + `","amount_minor":50000,"currency":"CRC","description":"contract test"}`
	rec := httptest.NewRecorder()
	h.Create(rec, reqWithUser(http.MethodPost, createURL, createBody, buyer, ""))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create returned %d, want 201: %s", rec.Code, rec.Body.String())
	}
	created := decodeData(t, rec)
	if err := contract.ValidateData(router, http.MethodPost, createURL, http.StatusCreated, created); err != nil {
		t.Errorf("escrow create response violates the EscrowAgreement schema: %v", err)
	}
	id, _ := created.(map[string]interface{})["id"].(string)
	if id == "" {
		t.Fatalf("no agreement id in create response")
	}

	// Fund (200) — buyer funds; 500 CRC is below the MFA threshold.
	fundURL := "http://localhost:8080/api/v1/escrow/" + id + "/fund"
	rec = httptest.NewRecorder()
	h.Fund(rec, reqWithUser(http.MethodPost, fundURL, "", buyer, id))
	if rec.Code != http.StatusOK {
		t.Fatalf("fund returned %d, want 200: %s", rec.Code, rec.Body.String())
	}
	funded := decodeData(t, rec)
	if err := contract.ValidateData(router, http.MethodPost, fundURL, http.StatusOK, funded); err != nil {
		t.Errorf("escrow fund response violates the EscrowAgreement schema: %v", err)
	}
}

// TestEscrowReadResponseContract drives the read endpoints — list and get one —
// through the HTTP handlers and asserts each `data` payload conforms to the
// schema documented in openapi.yaml (an array of EscrowAgreement for the list,
// a single EscrowAgreement for get).
func TestEscrowReadResponseContract(t *testing.T) {
	_, svc, buyer, seller := setup(t)
	h := escrow.NewHandler(svc)

	doc, err := contract.LoadSpec(specPath)
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router: %v", err)
	}

	// Seed one real agreement so the list and get responses are non-empty.
	const createURL = "http://localhost:8080/api/v1/escrow"
	createBody := `{"seller_id":"` + seller + `","amount_minor":50000,"currency":"CRC","description":"read contract test"}`
	rec := httptest.NewRecorder()
	h.Create(rec, reqWithUser(http.MethodPost, createURL, createBody, buyer, ""))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create returned %d, want 201: %s", rec.Code, rec.Body.String())
	}
	id, _ := decodeData(t, rec).(map[string]interface{})["id"].(string)
	if id == "" {
		t.Fatalf("no agreement id in create response")
	}

	// List (200) — GET /escrow → array of EscrowAgreement.
	listURL := "http://localhost:8080/api/v1/escrow"
	rec = httptest.NewRecorder()
	h.List(rec, reqWithUser(http.MethodGet, listURL, "", buyer, ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("list returned %d, want 200: %s", rec.Code, rec.Body.String())
	}
	list := decodeData(t, rec)
	if items, ok := list.([]interface{}); !ok || len(items) == 0 {
		t.Fatalf("expected a non-empty agreement list, got: %s", rec.Body.String())
	}
	if err := contract.ValidateData(router, http.MethodGet, listURL, http.StatusOK, list); err != nil {
		t.Errorf("escrow list response violates the EscrowAgreement array schema: %v", err)
	}

	// Get (200) — GET /escrow/{id} → a single EscrowAgreement.
	getURL := "http://localhost:8080/api/v1/escrow/" + id
	rec = httptest.NewRecorder()
	h.Get(rec, reqWithUser(http.MethodGet, getURL, "", buyer, id))
	if rec.Code != http.StatusOK {
		t.Fatalf("get returned %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if err := contract.ValidateData(router, http.MethodGet, getURL, http.StatusOK, decodeData(t, rec)); err != nil {
		t.Errorf("escrow get response violates the EscrowAgreement schema: %v", err)
	}
}
