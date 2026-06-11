package observability

import (
	"net/http"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// HTTPClient returns an http.Client whose transport is instrumented with
// OpenTelemetry: each outbound request becomes a client span and carries W3C
// trace context to the upstream. When tracing is disabled (no provider) the
// transport is inert — it just delegates to http.DefaultTransport.
//
// Pass a context-bearing request (http.NewRequestWithContext) so the client
// span attaches to the active server span; a background context yields a root
// span (correct for timer-driven fetches like the price broadcaster).
func HTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:   timeout,
		Transport: otelhttp.NewTransport(http.DefaultTransport),
	}
}
