// Package contract provides helpers for API contract tests: validating that
// backend responses conform to the published OpenAPI spec (docs/openapi.yaml).
//
// Handlers wrap their payload in a {success, data} envelope while the spec
// documents the inner `data` shape, so ValidateData validates the unwrapped
// data. ValidateResponseBody validates a whole body for endpoints whose spec
// documents it directly (e.g. /health).
package contract

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"
)

// LoadSpec loads an OpenAPI 3 document from a YAML/JSON file, resolving $refs.
func LoadSpec(path string) (*openapi3.T, error) {
	doc, err := openapi3.NewLoader().LoadFromFile(path)
	if err != nil {
		return nil, fmt.Errorf("load openapi spec %q: %w", path, err)
	}
	return doc, nil
}

// NewRouter builds a spec-driven router that resolves a request to its
// documented operation.
func NewRouter(doc *openapi3.T) (routers.Router, error) {
	r, err := gorillamux.NewRouter(doc)
	if err != nil {
		return nil, fmt.Errorf("build router from spec: %w", err)
	}
	return r, nil
}

// ValidateResponseBody validates a full JSON response body against the schema the
// spec documents for (method, url, status).
func ValidateResponseBody(router routers.Router, method, url string, status int, body []byte) error {
	route, pathParams, err := findRoute(router, method, url)
	if err != nil {
		return err
	}
	input := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: &openapi3filter.RequestValidationInput{
			Request:    httptest.NewRequest(method, url, nil),
			PathParams: pathParams,
			Route:      route,
		},
		Status: status,
		Header: http.Header{"Content-Type": []string{"application/json"}},
		Body:   io.NopCloser(bytes.NewReader(body)),
	}
	return openapi3filter.ValidateResponse(context.Background(), input)
}

// ValidateData validates the `data` payload of a {success, data} response
// envelope against the schema the spec documents for (method, url, status).
// `data` is a decoded JSON value (map/slice/scalar).
func ValidateData(router routers.Router, method, url string, status int, data interface{}) error {
	route, _, err := findRoute(router, method, url)
	if err != nil {
		return err
	}
	schema, err := responseSchema(route, status)
	if err != nil {
		return fmt.Errorf("%s %s (status %d): %w", method, url, status, err)
	}
	if err := schema.VisitJSON(data); err != nil {
		return fmt.Errorf("%s %s (status %d) data violates the spec: %w", method, url, status, err)
	}
	return nil
}

func findRoute(router routers.Router, method, url string) (*routers.Route, map[string]string, error) {
	route, pathParams, err := router.FindRoute(httptest.NewRequest(method, url, nil))
	if err != nil {
		return nil, nil, fmt.Errorf("no spec route for %s %s: %w", method, url, err)
	}
	return route, pathParams, nil
}

func responseSchema(route *routers.Route, status int) (*openapi3.Schema, error) {
	if route.Operation == nil || route.Operation.Responses == nil {
		return nil, fmt.Errorf("spec operation has no responses")
	}
	resp := route.Operation.Responses.Status(status)
	if resp == nil || resp.Value == nil {
		return nil, fmt.Errorf("spec documents no %d response", status)
	}
	mt := resp.Value.Content.Get("application/json")
	if mt == nil || mt.Schema == nil || mt.Schema.Value == nil {
		return nil, fmt.Errorf("spec documents no application/json schema for %d", status)
	}
	return mt.Schema.Value, nil
}
