package middleware

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

// OtelRouteTag refines otelhttp telemetry once chi has matched a route:
// the server span is renamed to "<METHOD> <route-pattern>" (e.g.
// "POST /api/v1/auth/login") with an http.route attribute, and the same
// attribute is added to the otelhttp Labeler so the RED metrics
// (http.server.* duration/size histograms) are dimensioned by route. Without
// this the span name would be just the method (otelhttp can't know the chi
// pattern up front), and using the raw URL path would explode cardinality
// with per-request IDs.
//
// It is inert when telemetry is disabled: SpanFromContext returns a
// non-recording span whose SetName/SetAttributes are no-ops, and the labeler
// feeds no-op instruments.
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

		// Metrics: otelhttp records its histograms after this middleware
		// returns, so attributes added here make it into the measurement.
		labeler, _ := otelhttp.LabelerFromContext(r.Context())
		labeler.Add(semconv.HTTPRoute(pattern))

		// Traces: rename the span to the low-cardinality route pattern.
		span := trace.SpanFromContext(r.Context())
		if !span.IsRecording() {
			return
		}
		span.SetName(r.Method + " " + pattern)
		span.SetAttributes(semconv.HTTPRoute(pattern))
	})
}
