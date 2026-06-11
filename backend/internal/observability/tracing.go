// Package observability wires OpenTelemetry distributed tracing and metrics
// for the API.
//
// Telemetry is OFF unless an OTLP endpoint is configured (OTEL_EXPORTER_OTLP_
// ENDPOINT). When off, Init installs only the W3C propagators and returns a
// no-op shutdown, so all instrumentation (otelhttp, otelpgx, runtime) stays
// cheap and inert — the binary runs identically with no collector present,
// which is what local dev and CI need.
//
// When on:
//   - traces: a batching OTLP/HTTP exporter ships spans with a service.name +
//     deployment.environment resource and a parent-based ratio sampler.
//   - metrics: a periodic OTLP/HTTP reader exports the RED metrics recorded by
//     otelhttp (request rate/errors/duration, dimensioned by http.route via
//     middleware.OtelRouteTag) plus Go runtime metrics (goroutines, heap, GC).
package observability

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Config controls telemetry setup.
type Config struct {
	Enabled     bool
	Endpoint    string // OTLP/HTTP endpoint host:port, e.g. "localhost:4318"
	Insecure    bool   // use http:// instead of https:// to the collector
	ServiceName string
	Environment string
	SampleRatio float64 // 0 < r <= 1; defaults to 1.0 (sample everything)
}

// ShutdownFunc flushes and stops the telemetry providers. Always safe to call.
type ShutdownFunc func(context.Context) error

// Init configures the global OpenTelemetry tracer + meter providers and the
// propagators. Returns a shutdown function that flushes pending telemetry.
func Init(ctx context.Context, cfg Config, logger *slog.Logger) (ShutdownFunc, error) {
	// W3C trace-context + baggage propagation is always installed so inbound
	// and outbound requests carry context even when we don't export locally.
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	if !cfg.Enabled || cfg.Endpoint == "" {
		if logger != nil {
			logger.Info("telemetry disabled (no OTEL endpoint configured)")
		}
		return func(context.Context) error { return nil }, nil
	}

	res := newResource(cfg)

	tp, err := newTracerProvider(ctx, cfg, res)
	if err != nil {
		return nil, err
	}
	otel.SetTracerProvider(tp)

	mp, err := newMeterProvider(ctx, cfg, res)
	if err != nil {
		// Roll back the tracer provider so we don't half-initialize.
		_ = tp.Shutdown(ctx)
		return nil, err
	}
	otel.SetMeterProvider(mp)

	if err := startRuntimeMetrics(); err != nil && logger != nil {
		logger.Warn("runtime metrics not started", "error", err)
	}

	if logger != nil {
		logger.Info("telemetry enabled",
			"endpoint", cfg.Endpoint,
			"service", cfg.ServiceName,
			"sample_ratio", effectiveRatio(cfg.SampleRatio),
		)
	}
	return func(ctx context.Context) error {
		return errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx))
	}, nil
}

func newResource(cfg Config) *resource.Resource {
	res, err := resource.Merge(resource.Default(), resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceName(cfg.ServiceName),
		semconv.DeploymentEnvironment(cfg.Environment),
	))
	if err != nil {
		// Schema-conflict between Default() and ours is non-fatal; fall back.
		return resource.Default()
	}
	return res
}

func newTracerProvider(ctx context.Context, cfg Config, res *resource.Resource) (*sdktrace.TracerProvider, error) {
	opts := []otlptracehttp.Option{otlptracehttp.WithEndpoint(cfg.Endpoint)}
	if cfg.Insecure {
		opts = append(opts, otlptracehttp.WithInsecure())
	}
	exporter, err := otlptracehttp.New(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("create otlp trace exporter: %w", err)
	}
	return sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(
			sdktrace.TraceIDRatioBased(effectiveRatio(cfg.SampleRatio)))),
	), nil
}

func effectiveRatio(r float64) float64 {
	if r <= 0 || r > 1 {
		return 1.0
	}
	return r
}
