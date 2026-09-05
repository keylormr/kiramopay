package middleware

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
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

// RecordRequest inserta la clave en el mapa de SUMAS antes que en el de
// CUENTAS, en dos tomas distintas del lock. En esa ventana /metrics veia la
// clave con su suma y hacia .Load() sobre un puntero nil: la peticion moria en
// panico y con ella el endpoint de metricas, justo cuando mas se necesita.
// La prueba monta la ventana a proposito en vez de perseguir la carrera.
func TestMetricsHandler_ClaveSinParejaNoTumbaElEndpoint(t *testing.T) {
	const clave = "GET_/prueba/sin-pareja"
	m := globalMetrics

	m.mu.Lock()
	suma := &atomic.Int64{}
	suma.Add(120)
	m.requestDurationSums[clave] = suma
	m.mu.Unlock()

	rec := httptest.NewRecorder()
	panico := func() (p any) {
		defer func() { p = recover() }()
		MetricsHandler(rec, httptest.NewRequest("GET", "/metrics", nil))
		return nil
	}()

	// La limpieza NO puede ir en un defer: el panico ocurre con el RLock del
	// handler tomado y nadie lo suelta, asi que un Lock aqui colgaria la prueba
	// en vez de reportar el fallo. Ese candado colgado es, ademas, el segundo
	// dano del defecto: deja /metrics inservible para siempre.
	if panico != nil {
		t.Fatalf("/metrics entro en panico por una clave sin pareja: %v", panico)
	}

	m.mu.Lock()
	delete(m.requestDurationSums, clave)
	delete(m.requestDurationCounts, clave)
	m.mu.Unlock()

	if strings.Contains(rec.Body.String(), "/prueba/sin-pareja") {
		t.Fatalf("una clave sin cuenta no puede publicar promedio:\n%s", rec.Body.String())
	}
}

// Sin patron de ruta no hay clave estable: registrarla es dejar que la memoria
// crezca a pedido. RecordRequest tiene que ignorarla aunque el llamador se
// olvide del guardia.
func TestRecordRequest_SinPatronNoRegistraClave(t *testing.T) {
	RecordRequest("GET", "", http.StatusNotFound, 5*time.Millisecond)

	globalMetrics.mu.RLock()
	defer globalMetrics.mu.RUnlock()
	for _, k := range []string{"GET__404", "GET_"} {
		if _, ok := globalMetrics.requestCounts[k]; ok {
			t.Fatalf("una peticion sin patron creo la clave %q", k)
		}
	}
	if _, ok := globalMetrics.requestDurationSums["GET_"]; ok {
		t.Fatal("una peticion sin patron creo clave de duracion")
	}
}
