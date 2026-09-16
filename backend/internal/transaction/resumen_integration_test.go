package transaction_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
)

// insertarMovimiento escribe la fila directo, con el instante exacto que la
// prueba necesita. created_date lleva la fecha UTC del instante, que es como la
// escribe el servidor (corre en UTC).
func insertarMovimiento(t *testing.T, pool *pgxpool.Pool, userID, tipo, moneda, estado string, monto int64, cuando time.Time) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO transactions (id, wallet_id, user_id, type, amount, currency, status, counterparty_name, created_at, created_date)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date)`,
		uuid.New().String(), uuid.New().String(), userID, tipo, monto, moneda, estado,
		"Contraparte "+tipo, cuando, cuando.UTC().Format("2006-01-02"),
	); err != nil {
		t.Fatalf("insertar movimiento: %v", err)
	}
}

// La pantalla de analisis confia en este resumen para TODO el periodo, asi que
// tiene que contar exactamente lo que el periodo contiene: los dias se cortan en
// hora de Costa Rica, solo cuentan los completados y nunca los de otra persona.
func TestResumen_CuentaElPeriodoCompletoEnHoraDeCostaRica(t *testing.T) {
	svc, pool, userID := setupTxServiceConPool(t)
	otro := testutil.SeedTestUser2(t, pool)
	utc := func(mes time.Month, dia, hora, minuto int) time.Time {
		return time.Date(2026, mes, dia, hora, minuto, 0, 0, time.UTC)
	}

	// 23:59 del 31 de julio en Costa Rica: es de JULIO aunque en UTC ya sea agosto.
	insertarMovimiento(t, pool, userID, "sinpe_send", "CRC", "completed", 1_000, utc(8, 1, 5, 59))
	// Medianoche del 1 de agosto en Costa Rica: es de agosto. Dos del mismo tipo
	// el mismo dia se suman en un solo grupo.
	insertarMovimiento(t, pool, userID, "qr_payment", "CRC", "completed", 2_000, utc(8, 1, 6, 0))
	insertarMovimiento(t, pool, userID, "qr_payment", "CRC", "completed", 3_000, utc(8, 1, 20, 0))
	// 23:59 del 31 de agosto en Costa Rica: en UTC ya es septiembre y sigue siendo agosto.
	insertarMovimiento(t, pool, userID, "sinpe_receive", "CRC", "completed", 50_000, utc(9, 1, 5, 59))
	// Medianoche del 1 de septiembre: fuera del rango.
	insertarMovimiento(t, pool, userID, "sinpe_send", "CRC", "completed", 7_000, utc(9, 1, 6, 0))
	// Otra moneda: grupo aparte, nunca sumado a los colones.
	insertarMovimiento(t, pool, userID, "bill_payment", "USD", "completed", 1_549, utc(8, 10, 15, 0))
	// Lo que no movio dinero no es gasto.
	insertarMovimiento(t, pool, userID, "sinpe_send", "CRC", "pending", 9_999_00, utc(8, 10, 15, 0))
	insertarMovimiento(t, pool, userID, "sinpe_send", "CRC", "failed", 8_888_00, utc(8, 10, 15, 0))
	// Y lo de otra persona tampoco.
	insertarMovimiento(t, pool, otro, "sinpe_send", "CRC", "completed", 4_444_00, utc(8, 10, 15, 0))

	rango, err := transaction.ParseRangoResumen("2026-08-01", "2026-09-01")
	if err != nil {
		t.Fatalf("rango: %v", err)
	}
	res, err := svc.Resumen(context.Background(), userID, rango)
	if err != nil {
		t.Fatalf("Resumen: %v", err)
	}

	type clave struct{ fecha, tipo, moneda string }
	got := map[clave]transaction.GrupoResumen{}
	for _, g := range res.Groups {
		got[clave{g.Fecha, g.Type, g.Currency}] = g
	}
	esperado := map[clave][2]int64{ // {cantidad, monto}
		{"2026-08-01", "qr_payment", "CRC"}:    {2, 5_000},
		{"2026-08-31", "sinpe_receive", "CRC"}: {1, 50_000},
		{"2026-08-10", "bill_payment", "USD"}:  {1, 1_549},
	}
	if len(got) != len(esperado) {
		t.Fatalf("grupos = %+v\nesperaba exactamente %d grupos: %+v", res.Groups, len(esperado), esperado)
	}
	for k, v := range esperado {
		g, ok := got[k]
		if !ok {
			t.Errorf("falta el grupo %+v; llegaron %+v", k, res.Groups)
			continue
		}
		if int64(g.Count) != v[0] || g.Amount != v[1] {
			t.Errorf("grupo %+v = %d movimientos por %d, esperaba %d por %d", k, g.Count, g.Amount, v[0], v[1])
		}
	}

	for _, tx := range res.Top {
		if tx.UserID != userID {
			t.Errorf("un movimiento de otra persona se colo en los principales: %+v", tx)
		}
		if tx.Status != transaction.StatusCompleted {
			t.Errorf("un movimiento %s se colo en los principales: %+v", tx.Status, tx)
		}
	}
	if len(res.Top) != 4 {
		t.Errorf("principales = %d, esperaba los 4 completados del rango", len(res.Top))
	}
	if res.From != "2026-08-01" || res.To != "2026-09-01" || res.Timezone != "America/Costa_Rica" {
		t.Errorf("cabecera = %s/%s/%s", res.From, res.To, res.Timezone)
	}
	// El primer movimiento completado es el de las 23:59 del 31 de julio en
	// Costa Rica, aunque quede fuera del rango: la fecha es de todo el historial.
	if res.PrimeraFecha == nil || *res.PrimeraFecha != "2026-07-31" {
		t.Errorf("first_date = %v, esperaba 2026-07-31", res.PrimeraFecha)
	}
}

// Sin ningun movimiento completado no hay primera fecha: el campo viaja como
// null y la pantalla no compara contra nada.
func TestResumen_SinHistorialNoHayPrimeraFecha(t *testing.T) {
	svc, pool, userID := setupTxServiceConPool(t)
	insertarMovimiento(t, pool, userID, "sinpe_send", "CRC", "failed", 1_000, time.Date(2026, 8, 3, 18, 0, 0, 0, time.UTC))

	rango, _ := transaction.ParseRangoResumen("2026-08-01", "2026-09-01")
	res, err := svc.Resumen(context.Background(), userID, rango)
	if err != nil {
		t.Fatalf("Resumen: %v", err)
	}
	if res.PrimeraFecha != nil {
		t.Errorf("first_date = %q, esperaba null", *res.PrimeraFecha)
	}
	if len(res.Groups) != 0 || len(res.Top) != 0 {
		t.Errorf("un movimiento fallido no cuenta: grupos %+v, principales %+v", res.Groups, res.Top)
	}

	// Y el sobre lleva el campo en null, no ausente.
	cuerpo, _ := json.Marshal(res)
	if !strings.Contains(string(cuerpo), `"first_date":null`) {
		t.Errorf("first_date debe viajar como null: %s", cuerpo)
	}
}

// Los principales van por tipo y no en total: si los seis mas grandes fueran
// ingresos, el filtro "Gastos" de la pantalla quedaria vacio aunque haya gastos.
func TestResumen_PrincipalesPorTipo(t *testing.T) {
	svc, pool, userID := setupTxServiceConPool(t)
	base := time.Date(2026, 8, 5, 15, 0, 0, 0, time.UTC)
	for i := 0; i < 8; i++ {
		insertarMovimiento(t, pool, userID, "sinpe_receive", "CRC", "completed", int64(1_000_000+i), base.Add(time.Duration(i)*time.Hour))
	}
	insertarMovimiento(t, pool, userID, "qr_payment", "CRC", "completed", 500, base)

	rango, _ := transaction.ParseRangoResumen("2026-08-01", "2026-09-01")
	res, err := svc.Resumen(context.Background(), userID, rango)
	if err != nil {
		t.Fatalf("Resumen: %v", err)
	}
	porTipo := map[string]int{}
	for _, tx := range res.Top {
		porTipo[tx.Type]++
	}
	if porTipo["sinpe_receive"] != transaction.PrincipalesPorTipo {
		t.Errorf("sinpe_receive en principales = %d, esperaba el tope de %d", porTipo["sinpe_receive"], transaction.PrincipalesPorTipo)
	}
	if porTipo["qr_payment"] != 1 {
		t.Errorf("el gasto pequeno quedo fuera de los principales: %+v", res.Top)
	}
	// Y se ordenan del mas grande al mas chico.
	for i := 1; i < len(res.Top); i++ {
		if res.Top[i].Amount > res.Top[i-1].Amount {
			t.Fatalf("principales fuera de orden en %d: %+v", i, res.Top)
		}
	}
}

// La respuesta real del handler cumple el contrato publicado en openapi.yaml.
func TestResumen_CumpleElContrato(t *testing.T) {
	svc, pool, userID := setupTxServiceConPool(t)
	insertarMovimiento(t, pool, userID, "qr_payment", "CRC", "completed", 2_500, time.Date(2026, 8, 3, 18, 0, 0, 0, time.UTC))

	doc, err := contract.LoadSpec("../../docs/openapi.yaml")
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router: %v", err)
	}

	url := "http://localhost:8080/api/v1/transactions/summary?from=2026-08-01&to=2026-09-01"
	req := httptest.NewRequest(http.MethodGet, url, nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	transaction.NewHandler(svc).Summary(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("summary: status %d: %s", rec.Code, rec.Body.String())
	}

	var env struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil || !env.Success {
		t.Fatalf("sobre invalido (%v): %s", err, rec.Body.String())
	}
	var data interface{}
	if err := json.Unmarshal(env.Data, &data); err != nil {
		t.Fatalf("data: %v", err)
	}
	if err := contract.ValidateData(router, http.MethodGet, url, http.StatusOK, data); err != nil {
		t.Errorf("la respuesta de /transactions/summary viola el esquema: %v", err)
	}
}
