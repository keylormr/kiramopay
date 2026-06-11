package observability

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel"
)

func TestInitDisabledIsNoop(t *testing.T) {
	shutdown, err := Init(context.Background(), Config{Enabled: false}, nil)
	if err != nil {
		t.Fatalf("Init(disabled) error: %v", err)
	}
	if shutdown == nil {
		t.Fatal("expected a non-nil shutdown func")
	}
	if err := shutdown(context.Background()); err != nil {
		t.Errorf("noop shutdown should not error: %v", err)
	}
	// Propagators are always installed so context still flows.
	if otel.GetTextMapPropagator() == nil {
		t.Error("expected a text-map propagator to be installed")
	}
}

func TestInitEnabledInstallsProvider(t *testing.T) {
	// otlptracehttp connects lazily, so Init succeeds with no live collector.
	shutdown, err := Init(context.Background(), Config{
		Enabled:     true,
		Endpoint:    "localhost:4318",
		Insecure:    true,
		ServiceName: "test-svc",
		Environment: "test",
		SampleRatio: 0.5,
	}, nil)
	if err != nil {
		t.Fatalf("Init(enabled) error: %v", err)
	}
	t.Cleanup(func() { _ = shutdown(context.Background()) })

	// A real SDK tracer provider should now be set (its tracer is non-nil and
	// usable). We just exercise span creation to ensure it doesn't panic.
	tr := otel.Tracer("test")
	_, span := tr.Start(context.Background(), "unit")
	span.End()

	// The meter provider should also be installed: creating an instrument and
	// recording against it must work without a live collector (export is
	// periodic and lazy).
	meter := otel.Meter("test")
	counter, err := meter.Int64Counter("unit.test.counter")
	if err != nil {
		t.Fatalf("create counter: %v", err)
	}
	counter.Add(context.Background(), 1)
}

func TestInitEndpointMissingDisables(t *testing.T) {
	// Enabled but no endpoint → treated as disabled (no-op shutdown).
	shutdown, err := Init(context.Background(), Config{Enabled: true, Endpoint: ""}, nil)
	if err != nil {
		t.Fatalf("Init error: %v", err)
	}
	if err := shutdown(context.Background()); err != nil {
		t.Errorf("noop shutdown should not error: %v", err)
	}
}
