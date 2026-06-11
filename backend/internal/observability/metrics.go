package observability

import (
	"context"
	"fmt"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/runtime"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
)

// metricExportInterval is how often the periodic reader pushes metrics to the
// collector. 60s is the OTel default and plenty for RED dashboards.
const metricExportInterval = 60 * time.Second

// newMeterProvider builds the OTLP/HTTP metric pipeline. The instruments
// themselves are created lazily by instrumentation libraries (otelhttp records
// http.server.* request duration/size histograms; the runtime package records
// goroutines/heap/GC) once this provider is installed globally.
func newMeterProvider(ctx context.Context, cfg Config, res *resource.Resource) (*sdkmetric.MeterProvider, error) {
	opts := []otlpmetrichttp.Option{otlpmetrichttp.WithEndpoint(cfg.Endpoint)}
	if cfg.Insecure {
		opts = append(opts, otlpmetrichttp.WithInsecure())
	}
	exporter, err := otlpmetrichttp.New(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("create otlp metric exporter: %w", err)
	}
	return sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(exporter,
			sdkmetric.WithInterval(metricExportInterval))),
		sdkmetric.WithResource(res),
	), nil
}

// startRuntimeMetrics begins collecting Go runtime metrics (goroutines, heap,
// GC pauses, …) against the global meter provider. Call only after the
// provider is installed.
func startRuntimeMetrics() error {
	return runtime.Start(runtime.WithMinimumReadMemStatsInterval(15 * time.Second))
}
