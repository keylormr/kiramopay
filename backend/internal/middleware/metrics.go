package middleware

import (
	"fmt"
	"net/http"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Metrics holds application-wide metrics (Prometheus-compatible text format).
type Metrics struct {
	mu sync.RWMutex

	// HTTP request counters by method_path_status
	requestCounts map[string]*atomic.Int64
	// HTTP request duration sums by method_path (in ms)
	requestDurationSums map[string]*atomic.Int64
	// HTTP request duration counts by method_path
	requestDurationCounts map[string]*atomic.Int64

	// Global counters
	totalRequests atomic.Int64
	totalErrors   atomic.Int64

	// Business-invariant signals, set out-of-band by background workers.
	ledgerDriftCRC          atomic.Int64 // residual cache↔journal CRC drift (abs minor units)
	webhookDeliveriesFailed atomic.Int64 // cumulative failed webhook delivery attempts

	startTime time.Time
}

var globalMetrics = &Metrics{
	requestCounts:         make(map[string]*atomic.Int64),
	requestDurationSums:   make(map[string]*atomic.Int64),
	requestDurationCounts: make(map[string]*atomic.Int64),
	startTime:             time.Now(),
}

// SetLedgerDriftCRC publishes the residual cache↔journal CRC drift (minor units,
// magnitude) observed by the reconciliation worker. Surfaced as the
// kiramopay_ledger_drift_crc gauge: a non-zero value means the wallets cache and
// the immutable journal disagree after reconciliation and a human should look.
func SetLedgerDriftCRC(driftMinor int64) {
	globalMetrics.ledgerDriftCRC.Store(driftMinor)
}

// RecordWebhookDeliveryFailed increments the count of failed webhook delivery
// attempts. Surfaced as the kiramopay_webhook_deliveries_failed counter.
func RecordWebhookDeliveryFailed() {
	globalMetrics.webhookDeliveriesFailed.Add(1)
}

// RecordRequest records an HTTP request in metrics.
func RecordRequest(method, path string, status int, duration time.Duration) {
	m := globalMetrics
	m.totalRequests.Add(1)
	if status >= 500 {
		m.totalErrors.Add(1)
	}

	// Normalize path: replace UUIDs and numeric IDs with {id}
	normalizedPath := normalizePath(path)

	// Request count by method + path + status
	countKey := fmt.Sprintf("%s_%s_%d", method, normalizedPath, status)
	counter := m.getOrCreateCounter(countKey)
	counter.Add(1)

	// Duration by method + path
	durKey := fmt.Sprintf("%s_%s", method, normalizedPath)
	durSum := m.getOrCreateDurationSum(durKey)
	durSum.Add(duration.Milliseconds())
	durCount := m.getOrCreateDurationCount(durKey)
	durCount.Add(1)
}

func (m *Metrics) getOrCreateCounter(key string) *atomic.Int64 {
	m.mu.RLock()
	if c, ok := m.requestCounts[key]; ok {
		m.mu.RUnlock()
		return c
	}
	m.mu.RUnlock()

	m.mu.Lock()
	defer m.mu.Unlock()
	if c, ok := m.requestCounts[key]; ok {
		return c
	}
	c := &atomic.Int64{}
	m.requestCounts[key] = c
	return c
}

func (m *Metrics) getOrCreateDurationSum(key string) *atomic.Int64 {
	m.mu.RLock()
	if c, ok := m.requestDurationSums[key]; ok {
		m.mu.RUnlock()
		return c
	}
	m.mu.RUnlock()

	m.mu.Lock()
	defer m.mu.Unlock()
	if c, ok := m.requestDurationSums[key]; ok {
		return c
	}
	c := &atomic.Int64{}
	m.requestDurationSums[key] = c
	return c
}

func (m *Metrics) getOrCreateDurationCount(key string) *atomic.Int64 {
	m.mu.RLock()
	if c, ok := m.requestDurationCounts[key]; ok {
		m.mu.RUnlock()
		return c
	}
	m.mu.RUnlock()

	m.mu.Lock()
	defer m.mu.Unlock()
	if c, ok := m.requestDurationCounts[key]; ok {
		return c
	}
	c := &atomic.Int64{}
	m.requestDurationCounts[key] = c
	return c
}

// normalizePath replaces UUIDs and numeric segments with {id}.
func normalizePath(path string) string {
	parts := strings.Split(path, "/")
	for i, p := range parts {
		if len(p) == 36 && strings.Count(p, "-") == 4 {
			parts[i] = "{id}" // UUID
		} else if len(p) > 0 && isNumeric(p) {
			parts[i] = "{id}" // Numeric ID
		}
	}
	return strings.Join(parts, "/")
}

func isNumeric(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// MetricsHandler returns Prometheus-compatible text exposition format.
func MetricsHandler(w http.ResponseWriter, r *http.Request) {
	m := globalMetrics
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")

	var sb strings.Builder

	// Uptime
	uptime := time.Since(m.startTime).Seconds()
	sb.WriteString("# HELP kiramopay_uptime_seconds Time since server start.\n")
	sb.WriteString("# TYPE kiramopay_uptime_seconds gauge\n")
	fmt.Fprintf(&sb, "kiramopay_uptime_seconds %.2f\n\n", uptime)

	// Total requests
	sb.WriteString("# HELP kiramopay_http_requests_total Total HTTP requests.\n")
	sb.WriteString("# TYPE kiramopay_http_requests_total counter\n")
	fmt.Fprintf(&sb, "kiramopay_http_requests_total %d\n\n", m.totalRequests.Load())

	// Total errors
	sb.WriteString("# HELP kiramopay_http_errors_total Total HTTP 5xx errors.\n")
	sb.WriteString("# TYPE kiramopay_http_errors_total counter\n")
	fmt.Fprintf(&sb, "kiramopay_http_errors_total %d\n\n", m.totalErrors.Load())

	// Per-route request counts
	sb.WriteString("# HELP kiramopay_http_request_count HTTP requests by method, path, status.\n")
	sb.WriteString("# TYPE kiramopay_http_request_count counter\n")
	m.mu.RLock()
	keys := make([]string, 0, len(m.requestCounts))
	for k := range m.requestCounts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		parts := strings.SplitN(k, "_", 3)
		if len(parts) == 3 {
			fmt.Fprintf(&sb,
				"kiramopay_http_request_count{method=%q,path=%q,status=%q} %d\n",
				parts[0], parts[1], parts[2], m.requestCounts[k].Load(),
			)
		}
	}
	m.mu.RUnlock()
	sb.WriteString("\n")

	// Per-route duration averages
	sb.WriteString("# HELP kiramopay_http_request_duration_ms_avg Average request duration in milliseconds.\n")
	sb.WriteString("# TYPE kiramopay_http_request_duration_ms_avg gauge\n")
	m.mu.RLock()
	durKeys := make([]string, 0, len(m.requestDurationSums))
	for k := range m.requestDurationSums {
		durKeys = append(durKeys, k)
	}
	sort.Strings(durKeys)
	for _, k := range durKeys {
		count := m.requestDurationCounts[k].Load()
		if count > 0 {
			avg := float64(m.requestDurationSums[k].Load()) / float64(count)
			parts := strings.SplitN(k, "_", 2)
			if len(parts) == 2 {
				fmt.Fprintf(&sb,
					"kiramopay_http_request_duration_ms_avg{method=%q,path=%q} %.2f\n",
					parts[0], parts[1], avg,
				)
			}
		}
	}
	m.mu.RUnlock()
	sb.WriteString("\n")

	// Business-invariant signals (set by background workers; default 0).
	sb.WriteString("# HELP kiramopay_ledger_drift_crc Residual cache vs journal CRC drift (minor units) from the last reconcile.\n")
	sb.WriteString("# TYPE kiramopay_ledger_drift_crc gauge\n")
	fmt.Fprintf(&sb, "kiramopay_ledger_drift_crc %d\n\n", m.ledgerDriftCRC.Load())

	sb.WriteString("# HELP kiramopay_webhook_deliveries_failed Total failed webhook delivery attempts.\n")
	sb.WriteString("# TYPE kiramopay_webhook_deliveries_failed counter\n")
	fmt.Fprintf(&sb, "kiramopay_webhook_deliveries_failed %d\n\n", m.webhookDeliveriesFailed.Load())

	// Go runtime metrics
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	sb.WriteString("# HELP kiramopay_go_goroutines Number of goroutines.\n")
	sb.WriteString("# TYPE kiramopay_go_goroutines gauge\n")
	fmt.Fprintf(&sb, "kiramopay_go_goroutines %d\n\n", runtime.NumGoroutine())

	sb.WriteString("# HELP kiramopay_go_heap_alloc_bytes Heap memory allocated in bytes.\n")
	sb.WriteString("# TYPE kiramopay_go_heap_alloc_bytes gauge\n")
	fmt.Fprintf(&sb, "kiramopay_go_heap_alloc_bytes %d\n\n", memStats.HeapAlloc)

	sb.WriteString("# HELP kiramopay_go_heap_sys_bytes Heap memory obtained from OS in bytes.\n")
	sb.WriteString("# TYPE kiramopay_go_heap_sys_bytes gauge\n")
	fmt.Fprintf(&sb, "kiramopay_go_heap_sys_bytes %d\n\n", memStats.HeapSys)

	sb.WriteString("# HELP kiramopay_go_gc_total Total number of GC cycles.\n")
	sb.WriteString("# TYPE kiramopay_go_gc_total counter\n")
	fmt.Fprintf(&sb, "kiramopay_go_gc_total %d\n", memStats.NumGC)

	_, _ = w.Write([]byte(sb.String()))
}
