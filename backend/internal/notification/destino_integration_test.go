package notification_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/notification"
	"github.com/kiramopay/backend/internal/testutil"
)

// Tocar un aviso en la campana solo lo marcaba leido. Ahora el aviso guarda con
// que abrir su pantalla (migracion 092) y la lista lo devuelve en "data". Los
// avisos de antes no traen nada y la lista sale igual que siempre.

type avisoConDatos struct {
	Title string            `json:"title"`
	Type  string            `json:"type"`
	Data  map[string]string `json:"data"`
}

func TestListaDeAvisos_TraeLosDatosParaAbrirLaPantalla(t *testing.T) {
	pool := testutil.TestDB(t)
	userID := testutil.SeedTestUser(t, pool, "702650941", "hash-de-prueba")
	ctx := context.Background()
	svc := notification.NewService(notification.NewRepository(pool), "", "")

	if err := svc.NotificarEnSuIdioma(ctx, userID, notification.AvisoAlertaPrecioSubio,
		map[string]any{"activo": "BTC"}, "price_alert"); err != nil {
		t.Fatalf("alerta de precio: %v", err)
	}
	if err := svc.NotificarEnSuIdioma(ctx, userID, notification.AvisoSinpeRecibido,
		map[string]any{"monto": "₡100.00", "movimiento": "5a4c1d2e-0000-4000-8000-0000000000aa"}, "transaction"); err != nil {
		t.Fatalf("SINPE recibido: %v", err)
	}
	// Uno de antes de la migracion: sin datos.
	sembrarAviso(t, pool, userID, "SINPE recibido", "Recibiste ₡25.00 por SINPE Móvil")

	const url = "/api/v1/notifications?lang=es"
	rec := comoUsuario(rutasDelHistorial(pool), userID, http.MethodGet, url)
	if rec.Code != http.StatusOK {
		t.Fatalf("listar: %d %s", rec.Code, rec.Body.String())
	}
	doc, err := contract.LoadSpec("../../docs/openapi.yaml")
	if err != nil {
		t.Fatalf("spec: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router de la spec: %v", err)
	}
	if err := contract.ValidateResponseBody(router, http.MethodGet, "http://localhost:8080"+url, rec.Code, rec.Body.Bytes()); err != nil {
		t.Fatalf("GET %s no cumple la spec: %v", url, err)
	}

	var sobre struct {
		Data []avisoConDatos `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("la lista no es JSON: %v", err)
	}
	if len(sobre.Data) != 3 {
		t.Fatalf("la lista trae %d avisos, esperaba 3: %s", len(sobre.Data), rec.Body.String())
	}
	var alerta, sinpe, viejo *avisoConDatos
	for i := range sobre.Data {
		a := &sobre.Data[i]
		switch {
		case a.Type == "price_alert":
			alerta = a
		case a.Data != nil:
			sinpe = a
		default:
			viejo = a
		}
	}
	if alerta == nil || alerta.Data["activo"] != "BTC" || len(alerta.Data) != 1 {
		t.Errorf("alerta de precio: %+v, esperaba data {activo: BTC}", alerta)
	}
	if sinpe == nil || sinpe.Data["movimiento"] != "5a4c1d2e-0000-4000-8000-0000000000aa" || len(sinpe.Data) != 1 {
		t.Errorf("SINPE recibido: %+v, esperaba data {movimiento} y sin el monto", sinpe)
	}
	if viejo == nil || viejo.Data != nil {
		t.Errorf("aviso de antes: %+v, esperaba sin data", viejo)
	}

	// Lo guardado: NULL para el viejo, no un objeto vacio.
	var nulos int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM notification_history WHERE user_id = $1::uuid AND datos IS NULL`, userID).Scan(&nulos); err != nil {
		t.Fatalf("contar: %v", err)
	}
	if nulos != 1 {
		t.Errorf("avisos con datos NULL = %d, esperaba 1", nulos)
	}
}
