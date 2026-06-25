package contract_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/kiramopay/backend/internal/contract"
)

const specPath = "../../docs/openapi.yaml"

// TestOpenAPISpecValid validates that the hand-maintained openapi.yaml is a
// well-formed OpenAPI 3 document: every $ref resolves and every schema is valid.
// This is the cheap gate that catches a broken spec before it ships.
func TestOpenAPISpecValid(t *testing.T) {
	doc, err := contract.LoadSpec(specPath)
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	if err := doc.Validate(context.Background()); err != nil {
		t.Fatalf("openapi spec is invalid: %v", err)
	}
}

// TestHealthResponseContract validates the exact JSON shape the /health handler
// emits against the documented HealthResponse schema (types + enums).
func TestHealthResponseContract(t *testing.T) {
	doc, err := contract.LoadSpec(specPath)
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router: %v", err)
	}
	// Mirrors the format string written by the /health handler in cmd/api/main.go.
	body := []byte(`{"status":"ok","version":"1.0.0","environment":"production",` +
		`"services":{"database":"ok","redis":"ok"},"websocket_clients":3,"last_drift_crc":0}`)
	if err := contract.ValidateResponseBody(router, http.MethodGet, "http://localhost:8080/health", http.StatusOK, body); err != nil {
		t.Errorf("/health response violates the spec: %v", err)
	}
}
