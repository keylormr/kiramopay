package payment_test

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/payment"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

// Lo que contesta una ruta de servicios, leido entero: el estado, el codigo y
// el texto del rechazo, o el pago y si fue una repeticion.
type respuestaDelServicio struct {
	estado   int
	codigo   string
	mensaje  string
	txID     string
	repetido bool
}

func setupServicios(t *testing.T) (*payment.Handler, *pgxpool.Pool, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l, nil)
	svc := payment.NewService(payment.NewRepository(pool), txSvc, &payment.Options{ConveniosActivos: true})

	pinHash, _ := hash.HashPin("Kiramopay2024!")
	user := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO service_providers (code, name, category, is_active)
		 VALUES ('ICE', 'ICE', 'electricity', true) ON CONFLICT (code) DO NOTHING`); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	return payment.NewHandler(svc), pool, user
}

func llamarServicio(t *testing.T, handler http.HandlerFunc, ruta, cuerpo, user string) respuestaDelServicio {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "http://localhost:8080"+ruta, strings.NewReader(cuerpo))
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, user))
	rec := httptest.NewRecorder()
	handler(rec, req)
	var env struct {
		Data struct {
			TransactionID string `json:"transaction_id"`
			Replayed      bool   `json:"replayed"`
		} `json:"data"`
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("respuesta ilegible %d: %v: %s", rec.Code, err, rec.Body.String())
	}
	return respuestaDelServicio{rec.Code, env.Error.Code, env.Error.Message, env.Data.TransactionID, env.Data.Replayed}
}

func saldoCRC(t *testing.T, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(context.Background(),
		`SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&bal); err != nil {
		t.Fatalf("leer el saldo: %v", err)
	}
	return bal
}

func filasDelHistorial(t *testing.T, pool *pgxpool.Pool, userID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM payment_history WHERE user_id = $1::uuid`, userID).Scan(&n); err != nil {
		t.Fatalf("contar el historial: %v", err)
	}
	return n
}

const saldoInicial = 250000000

// Pagar un recibo o recargar sin saldo, por encima de un tope o con un
// proveedor que no existe salia como 400 PAYMENT_FAILED / RECHARGE_FAILED con
// el error tal cual ("process payment: insufficient balance"), y la pantalla,
// que ya no pinta el texto del servidor, decia solo "no se pudo completar la
// accion": el rechazo mas comun de las dos pantallas no tenia motivo. Cada uno
// sale ahora con su codigo, el mismo que usan SINPE y el pago por QR.
func TestServicios_CadaRechazoSaleConSuCodigo(t *testing.T) {
	h, pool, user := setupServicios(t)
	ctx := context.Background()

	ajustes := []struct {
		nombre   string
		ajuste   string
		deshacer string
		estado   int
		codigo   string
	}{
		{"sin saldo",
			`UPDATE wallets SET balance_crc = 100 WHERE user_id = $1::uuid`,
			`UPDATE wallets SET balance_crc = 250000000 WHERE user_id = $1::uuid`,
			http.StatusUnprocessableEntity, "INSUFFICIENT_BALANCE"},
		{"por encima del tope diario",
			`UPDATE wallets SET daily_limit = 1000 WHERE user_id = $1::uuid`,
			`UPDATE wallets SET daily_limit = 100000000 WHERE user_id = $1::uuid`,
			http.StatusUnprocessableEntity, "DAILY_LIMIT_EXCEEDED"},
		{"por encima del tope mensual",
			`UPDATE wallets SET monthly_limit = 1000 WHERE user_id = $1::uuid`,
			`UPDATE wallets SET monthly_limit = 500000000 WHERE user_id = $1::uuid`,
			http.StatusUnprocessableEntity, "MONTHLY_LIMIT_EXCEEDED"},
	}
	rutas := []struct {
		nombre  string
		handler http.HandlerFunc
		ruta    string
		cuerpo  string
	}{
		{"recibo", h.PayBill, "/api/v1/services/pay-bill",
			`{"provider_code":"ICE","client_id":"123456","amount":500000}`},
		{"recarga", h.Recharge, "/api/v1/services/recharge",
			`{"operator":"kolbi","phone":"88887777","amount":500000}`},
	}
	for _, ruta := range rutas {
		for _, c := range ajustes {
			t.Run(ruta.nombre+" "+c.nombre, func(t *testing.T) {
				if _, err := pool.Exec(ctx, c.ajuste, user); err != nil {
					t.Fatalf("ajuste: %v", err)
				}
				t.Cleanup(func() {
					if _, err := pool.Exec(ctx, c.deshacer, user); err != nil {
						t.Errorf("deshacer: %v", err)
					}
				})
				r := llamarServicio(t, ruta.handler, ruta.ruta, ruta.cuerpo, user)
				if r.estado != c.estado || r.codigo != c.codigo {
					t.Fatalf("= %d %s (%q), se esperaba %d %s", r.estado, r.codigo, r.mensaje, c.estado, c.codigo)
				}
				if strings.Contains(r.mensaje, ":") {
					t.Fatalf("el texto lleva los prefijos internos: %q", r.mensaje)
				}
			})
		}
	}

	// Un proveedor o un operador que no existen son un rechazo de la entrada,
	// no un fallo del servidor.
	if r := llamarServicio(t, h.PayBill, "/api/v1/services/pay-bill",
		`{"provider_code":"NO-EXISTE","client_id":"123456","amount":500000}`, user); r.estado != http.StatusBadRequest || r.codigo != "INVALID_PROVIDER" {
		t.Fatalf("proveedor inexistente = %d %s (%q), se esperaba 400 INVALID_PROVIDER", r.estado, r.codigo, r.mensaje)
	}
	if r := llamarServicio(t, h.Recharge, "/api/v1/services/recharge",
		`{"operator":"no-existe","phone":"88887777","amount":500000}`, user); r.estado != http.StatusBadRequest || r.codigo != "INVALID_OPERATOR" {
		t.Fatalf("operador inexistente = %d %s (%q), se esperaba 400 INVALID_OPERATOR", r.estado, r.codigo, r.mensaje)
	}

	// Ninguno movio dinero ni dejo historial.
	if got := saldoCRC(t, pool, user); got != saldoInicial {
		t.Fatalf("saldo = %d, se esperaba %d", got, saldoInicial)
	}
	if n := filasDelHistorial(t, pool, user); n != 0 {
		t.Fatalf("historial = %d filas, se esperaba ninguna", n)
	}
}

// Lo que el servidor no reconoce es un fallo suyo, y el pago pudo haber salido:
// 500, con el detalle en el log y no en la respuesta. Salia 400 con el error
// tal cual, y el texto interno ("process recharge: wallet not found") viajaba
// hasta la pantalla.
func TestServicios_LoQueNoSeReconoceEsUn500SinElDetalle(t *testing.T) {
	h, pool, user := setupServicios(t)
	if _, err := pool.Exec(context.Background(), `DELETE FROM wallets WHERE user_id = $1::uuid`, user); err != nil {
		t.Fatalf("borrar la billetera: %v", err)
	}

	casos := []struct {
		handler http.HandlerFunc
		ruta    string
		cuerpo  string
		codigo  string
	}{
		{h.PayBill, "/api/v1/services/pay-bill", `{"provider_code":"ICE","client_id":"123456","amount":500000}`, "PAYMENT_FAILED"},
		{h.Recharge, "/api/v1/services/recharge", `{"operator":"kolbi","phone":"88887777","amount":500000}`, "RECHARGE_FAILED"},
	}
	for _, c := range casos {
		r := llamarServicio(t, c.handler, c.ruta, c.cuerpo, user)
		if r.estado != http.StatusInternalServerError || r.codigo != c.codigo {
			t.Fatalf("%s = %d %s (%q), se esperaba 500 %s", c.ruta, r.estado, r.codigo, r.mensaje, c.codigo)
		}
		if strings.Contains(r.mensaje, "wallet") {
			t.Fatalf("%s: la respuesta lleva el detalle interno: %q", c.ruta, r.mensaje)
		}
	}
}

// Pagar un recibo o recargar no llevaba llave de idempotencia: si la respuesta
// se perdia (la red se corto despues del cobro), la pantalla decia "revisa tu
// conexion" con el boton activo, y tocarlo otra vez cobraba de nuevo. Con la
// llave, el reintento contesta con el pago que ya estaba hecho, marcado como
// repeticion, sin cobrar ni dejar otra fila en el historial.
func TestServicios_LaMismaLlaveNoCobraDosVeces(t *testing.T) {
	h, pool, user := setupServicios(t)

	casos := []struct {
		nombre  string
		handler http.HandlerFunc
		ruta    string
		cuerpo  string
	}{
		{"recibo", h.PayBill, "/api/v1/services/pay-bill",
			`{"provider_code":"ICE","client_id":"123456","amount":500000,"idempotency_key":"llave-del-recibo"}`},
		{"recarga", h.Recharge, "/api/v1/services/recharge",
			`{"operator":"kolbi","phone":"88887777","amount":500000,"idempotency_key":"llave-de-la-recarga"}`},
	}
	esperado := int64(saldoInicial)
	for i, c := range casos {
		primero := llamarServicio(t, c.handler, c.ruta, c.cuerpo, user)
		if primero.estado != http.StatusOK || primero.repetido {
			t.Fatalf("%s: el primer intento = %d %s repetido=%v, se esperaba 200 sin repeticion",
				c.nombre, primero.estado, primero.codigo, primero.repetido)
		}
		segundo := llamarServicio(t, c.handler, c.ruta, c.cuerpo, user)
		if segundo.estado != http.StatusOK || !segundo.repetido || segundo.txID != primero.txID {
			t.Fatalf("%s: el reintento = %d %s repetido=%v tx=%s, se esperaba 200 repetido con la tx %s",
				c.nombre, segundo.estado, segundo.codigo, segundo.repetido, segundo.txID, primero.txID)
		}
		esperado -= 500000
		if got := saldoCRC(t, pool, user); got != esperado {
			t.Fatalf("%s: saldo = %d, se esperaba %d (un solo cobro)", c.nombre, got, esperado)
		}
		if n := filasDelHistorial(t, pool, user); n != i+1 {
			t.Fatalf("%s: historial = %d filas, se esperaba %d", c.nombre, n, i+1)
		}
	}
}

// La llave es de UN pago: otro cliente, otro telefono u otro monto bajo la
// misma llave no son el reintento de aquel, y contestar "ya estaba hecho" por
// ellos diria que se pago algo que nunca se pago. Es el mismo 409 que SINPE y
// el pago por QR.
func TestServicios_LaLlaveDeOtroPagoEs409(t *testing.T) {
	h, pool, user := setupServicios(t)

	casos := []struct {
		nombre  string
		handler http.HandlerFunc
		ruta    string
		primero string
		otro    string
	}{
		{"recibo de otro cliente", h.PayBill, "/api/v1/services/pay-bill",
			`{"provider_code":"ICE","client_id":"111111","amount":500000,"idempotency_key":"llave-a"}`,
			`{"provider_code":"ICE","client_id":"222222","amount":500000,"idempotency_key":"llave-a"}`},
		{"recibo por otro monto", h.PayBill, "/api/v1/services/pay-bill",
			`{"provider_code":"ICE","client_id":"111111","amount":500000,"idempotency_key":"llave-b"}`,
			`{"provider_code":"ICE","client_id":"111111","amount":700000,"idempotency_key":"llave-b"}`},
		{"recarga a otro telefono", h.Recharge, "/api/v1/services/recharge",
			`{"operator":"kolbi","phone":"88887777","amount":500000,"idempotency_key":"llave-c"}`,
			`{"operator":"kolbi","phone":"88886666","amount":500000,"idempotency_key":"llave-c"}`},
	}
	esperado := int64(saldoInicial)
	for _, c := range casos {
		if r := llamarServicio(t, c.handler, c.ruta, c.primero, user); r.estado != http.StatusOK {
			t.Fatalf("%s: el primer pago = %d %s (%q)", c.nombre, r.estado, r.codigo, r.mensaje)
		}
		esperado -= 500000
		r := llamarServicio(t, c.handler, c.ruta, c.otro, user)
		if r.estado != http.StatusConflict || r.codigo != "LLAVE_REUTILIZADA" {
			t.Fatalf("%s = %d %s (%q) repetido=%v, se esperaba 409 LLAVE_REUTILIZADA",
				c.nombre, r.estado, r.codigo, r.mensaje, r.repetido)
		}
		if got := saldoCRC(t, pool, user); got != esperado {
			t.Fatalf("%s: saldo = %d, se esperaba %d", c.nombre, got, esperado)
		}
	}
}

// Una llave que no cabe en la columna del libro se rechaza antes de mover
// nada, con su codigo, en vez de reventar en la base.
func TestServicios_LlaveInvalidaSeRechaza(t *testing.T) {
	h, pool, user := setupServicios(t)
	larga := strings.Repeat("k", 101)
	r := llamarServicio(t, h.PayBill, "/api/v1/services/pay-bill",
		`{"provider_code":"ICE","client_id":"123456","amount":500000,"idempotency_key":"`+larga+`"}`, user)
	if r.estado != http.StatusBadRequest || r.codigo != "LLAVE_INVALIDA" {
		t.Fatalf("= %d %s (%q), se esperaba 400 LLAVE_INVALIDA", r.estado, r.codigo, r.mensaje)
	}
	if got := saldoCRC(t, pool, user); got != saldoInicial {
		t.Fatalf("saldo = %d, se esperaba %d", got, saldoInicial)
	}
}
