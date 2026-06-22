package middleware

import (
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func scrapeMetrics(t *testing.T) string {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/metrics", nil)
	MetricsHandler(rec, req)
	return rec.Body.String()
}

// metricValue returns the numeric value of an unlabeled metric line
// ("name <value>"), or fails the test if it is absent.
func metricValue(t *testing.T, body, name string) int64 {
	t.Helper()
	for _, line := range strings.Split(body, "\n") {
		if strings.HasPrefix(line, name+" ") {
			v, err := strconv.ParseInt(strings.TrimSpace(strings.TrimPrefix(line, name+" ")), 10, 64)
			if err != nil {
				t.Fatalf("parse %q: %v", line, err)
			}
			return v
		}
	}
	t.Fatalf("metric %q not found in:\n%s", name, body)
	return 0
}

func TestLedgerDriftGaugeReflectsLatestValue(t *testing.T) {
	SetLedgerDriftCRC(4200)
	if got := metricValue(t, scrapeMetrics(t), "kiramopay_ledger_drift_crc"); got != 4200 {
		t.Errorf("drift gauge = %d, want 4200", got)
	}
	// A gauge tracks the latest reconcile result — auto-fix clearing drift returns it to 0.
	SetLedgerDriftCRC(0)
	if got := metricValue(t, scrapeMetrics(t), "kiramopay_ledger_drift_crc"); got != 0 {
		t.Errorf("drift gauge = %d, want 0 after reset", got)
	}
}

func TestWebhookFailuresCounterIsMonotonic(t *testing.T) {
	before := metricValue(t, scrapeMetrics(t), "kiramopay_webhook_deliveries_failed")
	RecordWebhookDeliveryFailed()
	RecordWebhookDeliveryFailed()
	after := metricValue(t, scrapeMetrics(t), "kiramopay_webhook_deliveries_failed")
	if after != before+2 {
		t.Errorf("webhook failure counter: before=%d after=%d, want +2", before, after)
	}
}
