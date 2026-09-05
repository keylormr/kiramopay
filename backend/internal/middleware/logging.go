package middleware

import (
	"bufio"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/otel/trace"
)

type statusWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (sw *statusWriter) WriteHeader(code int) {
	sw.status = code
	sw.ResponseWriter.WriteHeader(code)
}

func (sw *statusWriter) Write(b []byte) (int, error) {
	n, err := sw.ResponseWriter.Write(b)
	sw.bytes += n
	return n, err
}

// Hijack forwards the wrapped writer's http.Hijacker. Embedding only exposes
// the methods of the http.ResponseWriter interface, so without this the
// WebSocket upgrade sees a writer with no Hijack and fails with a 500
// ("response does not implement http.Hijacker") on every /ws route.
func (sw *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := sw.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("middleware: underlying ResponseWriter does not implement http.Hijacker")
	}
	return hj.Hijack()
}

// Flush forwards the wrapped writer's http.Flusher — same embedding pitfall as
// Hijack, but for streaming responses.
func (sw *statusWriter) Flush() {
	if f, ok := sw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// clientIPForLog logs the resolved client IP, keeping the raw RemoteAddr as a
// fallback so a log line never loses the connection identity entirely.
func clientIPForLog(r *http.Request) string {
	if ip := RequestIP(r); ip != "" {
		return ip
	}
	return r.RemoteAddr
}

// Logger is a structured logging middleware using slog.
func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(sw, r)

		duration := time.Since(start)
		reqID := chimw.GetReqID(r.Context())

		attrs := []slog.Attr{
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", sw.status),
			slog.Duration("duration", duration),
			slog.String("ip", clientIPForLog(r)),
			slog.Int("bytes", sw.bytes),
		}
		if reqID != "" {
			attrs = append(attrs, slog.String("request_id", reqID))
		}
		// Correlate logs with traces: emit the active trace/span IDs when a
		// recording span is present (no-op when tracing is disabled).
		if sc := trace.SpanContextFromContext(r.Context()); sc.IsValid() {
			attrs = append(attrs,
				slog.String("trace_id", sc.TraceID().String()),
				slog.String("span_id", sc.SpanID().String()),
			)
		}
		if userAgent := r.UserAgent(); userAgent != "" {
			attrs = append(attrs, slog.String("user_agent", userAgent))
		}

		level := slog.LevelInfo
		if sw.status >= 500 {
			level = slog.LevelError
		} else if sw.status >= 400 {
			level = slog.LevelWarn
		}

		slog.LogAttrs(r.Context(), level, "http request", attrs...)

		// Metricas por PATRON de ruta, nunca por la URL cruda. Los mapas de
		// metricas no desalojan nada y este middleware corre POR ENCIMA del
		// limitador, asi que indexar por r.URL.Path dejaba que cualquiera los
		// hiciera crecer sin limite pidiendo rutas inventadas: hasta las
		// peticiones rechazadas con 429 dejaban su clave. El patron es el
		// mismo que usa OtelRouteTag y solo esta resuelto despues de que la
		// cadena corrio. Patron vacio = chi no reconocio la ruta (404) o la
		// peticion murio antes de enrutarse (429): queda en el log, no en las
		// metricas, que es lo unico acotado.
		if rc := chi.RouteContext(r.Context()); rc != nil {
			if patron := rc.RoutePattern(); patron != "" {
				RecordRequest(r.Method, patron, sw.status, duration)
			}
		}
	})
}
