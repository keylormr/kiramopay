package contract_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/buildinfo"
	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/country"
	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/salud"
)

const specPath = "../../docs/openapi.yaml"

// TestOpenAPISpecValid validates that the hand-maintained openapi.yaml is a
// well-formed OpenAPI 3 document: every $ref resolves and every schema is valid.
// This is the cheap gate that catches a broken spec before it ships.
func TestOpenAPISpecValid(t *testing.T) {
	doc, err := contract.LoadSpec(specPath)
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	if err := doc.Validate(context.Background()); err != nil {
		t.Fatalf("openapi spec is invalid: %v", err)
	}
}

// TestHealthResponseContract validates the exact JSON shape the /health handler
// emits against the documented HealthResponse schema (types + enums).
func TestHealthResponseContract(t *testing.T) {
	doc, err := contract.LoadSpec(specPath)
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router: %v", err)
	}
	// El cuerpo sale de salud.Cuerpo, lo MISMO que escribe el handler. Antes
	// esta prueba validaba una copia a mano del formato del handler: cuando el
	// handler sumo `auditoria_descartada`, la copia no, y la respuesta real
	// violo el esquema con la prueba en verde.
	confirmada := time.Date(2026, 9, 11, 14, 0, 0, 0, time.UTC)
	casos := map[string]salud.Cuerpo{
		"sano, con tipo de cambio confirmado": {
			Status: "ok", Version: buildinfo.Version, Environment: "production",
			Services:         salud.Servicios{Database: "ok", Redis: "ok"},
			WebsocketClients: 3, LastDriftCRC: 0, DiasDeParticiones: 420, AuditoriaDescartada: 0,
			CryptoPrices: crypto.Diagnostics{Plan: "demo", LastStatus: 200,
				LastSuccessAt: "2026-09-04T18:00:00Z", CachedAssets: 10},
			TipoDeCambio: country.DiagnosticoTipoDeCambio{Fuente: "hacienda", UsdCrc: 450.06,
				Compra: 444.22, FechaFuente: "2026-09-11", UltimaConfirmacion: &confirmada},
		},
		"degradado, recien arrancado y sin tipo de cambio": {
			Status: "degraded", Version: buildinfo.Version, Environment: "production",
			Services:          salud.Servicios{Database: "error", Redis: "ok"},
			DiasDeParticiones: -1, AuditoriaDescartada: 7,
			CryptoPrices: crypto.Diagnostics{Plan: "none"},
			TipoDeCambio: country.DiagnosticoTipoDeCambio{Fuente: "hacienda",
				UltimoError: "hacienda: HTTP 503"},
		},
	}
	for nombre, cuerpo := range casos {
		if err := contract.ValidateResponseBody(router, http.MethodGet, "http://localhost:8080/health",
			http.StatusOK, cuerpo.JSON()); err != nil {
			t.Errorf("%s: /health viola el esquema: %v", nombre, err)
		}
	}
}
