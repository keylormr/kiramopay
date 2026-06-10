package middleware

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

// OtelRouteTag refines the otelhttp server span once chi has matched a route,
// renaming it to "<METHOD> <route-pattern>" (e.g. "POST /api/v1/auth/login")
// and attaching the http.route attribute. Without this the span name would be
// just the method (otelhttp can't know the chi pattern up front), and using the
// raw URL path would explode cardinality with per-request IDs.
//
// It is inert when tracing is disabled: SpanFromContext returns a non-recording
// span whose SetName/SetAttributes are no-ops.
func OtelRouteTag(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)

		// RoutePattern is fully resolved only after the chain has run.
		rc := chi.RouteContext(r.Context())
		if rc == nil {
			return
		}
		pattern := rc.RoutePattern()
		if pattern == "" {
			return
		}
		span := trace.SpanFromContext(r.Context())
		if !span.IsRecording() {
			return
		}
		span.SetName(r.Method + " " + pattern)
		span.SetAttributes(semconv.HTTPRoute(pattern))
	})
}
