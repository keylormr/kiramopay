// Package contract holds API contract tests: they assert that backend responses
// conform to the published OpenAPI spec (backend/docs/openapi.yaml), and that the
// spec itself is a well-formed OpenAPI 3 document.
//
// This is the foundation (spec validation + a reusable response-validation
// harness, exercised against /health). Extending it to the money endpoints needs
// their real responses, which means a test-friendly router builder — a follow-up.
package contract_test

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"
)

const specPath = "../../docs/openapi.yaml"

func loadSpec(t *testing.T) *openapi3.T {
	t.Helper()
	loader := openapi3.NewLoader()
	doc, err := loader.LoadFromFile(specPath)
	if err != nil {
		t.Fatalf("load openapi spec: %v", err)
	}
	return doc
}

// TestOpenAPISpecValid validates that the hand-maintained openapi.yaml is a
// well-formed OpenAPI 3 document: every $ref resolves and every schema is valid.
// This is the cheap gate that catches a broken spec before it ships.
func TestOpenAPISpecValid(t *testing.T) {
	doc := loadSpec(t)
	if err := doc.Validate(context.Background()); err != nil {
		t.Fatalf("openapi spec is invalid: %v", err)
	}
}

func newRouter(t *testing.T, doc *openapi3.T) routers.Router {
	t.Helper()
	r, err := gorillamux.NewRouter(doc)
	if err != nil {
		t.Fatalf("build router from spec: %v", err)
	}
	return r
}

// assertJSONResponseValid checks that a JSON response body conforms to the schema
// the spec documents for (method, url, status). It is the reusable contract
// harness — point it at any documented endpoint's real response.
func assertJSONResponseValid(t *testing.T, router routers.Router, method, url string, status int, body []byte) {
	t.Helper()
	req := httptest.NewRequest(method, url, nil)
	route, pathParams, err := router.FindRoute(req)
	if err != nil {
		t.Fatalf("no spec route for %s %s: %v", method, url, err)
	}
	input := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: &openapi3filter.RequestValidationInput{
			Request:    req,
			PathParams: pathParams,
			Route:      route,
		},
		Status: status,
		Header: http.Header{"Content-Type": []string{"application/json"}},
		Body:   io.NopCloser(bytes.NewReader(body)),
	}
	if err := openapi3filter.ValidateResponse(context.Background(), input); err != nil {
		t.Errorf("%s %s (status %d) violates the spec: %v\nbody: %s", method, url, status, err, body)
	}
}

// TestHealthResponseContract validates the exact JSON shape the /health handler
// emits against the documented HealthResponse schema (types + enums).
func TestHealthResponseContract(t *testing.T) {
	doc := loadSpec(t)
	router := newRouter(t, doc)
	// Mirrors the format string written by the /health handler in cmd/api/main.go.
	body := []byte(`{"status":"ok","version":"1.0.0","environment":"production",` +
		`"services":{"database":"ok","redis":"ok"},"websocket_clients":3,"last_drift_crc":0}`)
	assertJSONResponseValid(t, router, http.MethodGet, "http://localhost:8080/health", http.StatusOK, body)
}
