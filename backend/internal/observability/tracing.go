// Package observability wires OpenTelemetry distributed tracing for the API.
//
// Tracing is OFF unless an OTLP endpoint is configured (OTEL_EXPORTER_OTLP_
// ENDPOINT). When off, Init installs only the W3C propagators and returns a
// no-op shutdown, so all instrumentation (otelhttp, otelpgx) stays cheap and
// inert — the binary runs identically with no collector present, which is what
// local dev and CI need.
//
// When on, a batching OTLP/HTTP exporter ships spans to the collector with a
// service.name + deployment.environment resource and a parent-based ratio
// sampler.
package observability

import (
	"context"
	"fmt"
	"log/slog"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Config controls tracing setup.
type Config struct {
	Enabled     bool
	Endpoint    string // OTLP/HTTP endpoint host:port, e.g. "localhost:4318"
	Insecure    bool   // use http:// instead of https:// to the collector
	ServiceName string
	Environment string
	SampleRatio float64 // 0 < r <= 1; defaults to 1.0 (sample everything)
}

// ShutdownFunc flushes and stops the tracer provider. Always safe to call.
type ShutdownFunc func(context.Context) error

// Init configures the global OpenTelemetry tracer provider and propagators.
// Returns a shutdown function that flushes pending spans.
func Init(ctx context.Context, cfg Config, logger *slog.Logger) (ShutdownFunc, error) {
	// W3C trace-context + baggage propagation is always installed so inbound
	// and outbound requests carry context even when we don't export locally.
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	if !cfg.Enabled || cfg.Endpoint == "" {
		if logger != nil {
			logger.Info("tracing disabled (no OTEL endpoint configured)")
		}
		return func(context.Context) error { return nil }, nil
	}

	opts := []otlptracehttp.Option{otlptracehttp.WithEndpoint(cfg.Endpoint)}
	if cfg.Insecure {
		opts = append(opts, otlptracehttp.WithInsecure())
	}
	exporter, err := otlptracehttp.New(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("create otlp trace exporter: %w", err)
	}

	res, err := resource.Merge(resource.Default(), resource.NewWithAttributes(
		semconv.SchemaURL,
		semconv.ServiceName(cfg.ServiceName),
		semconv.DeploymentEnvironment(cfg.Environment),
	))
	if err != nil {
		// Schema-conflict between Default() and ours is non-fatal; fall back.
		res = resource.Default()
	}

	ratio := cfg.SampleRatio
	if ratio <= 0 || ratio > 1 {
		ratio = 1.0
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(ratio))),
	)
	otel.SetTracerProvider(tp)

	if logger != nil {
		logger.Info("tracing enabled",
			"endpoint", cfg.Endpoint,
			"service", cfg.ServiceName,
			"sample_ratio", ratio,
		)
	}
	return tp.Shutdown, nil
}
