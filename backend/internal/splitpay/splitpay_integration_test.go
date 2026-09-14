package splitpay_test

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/splitpay"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
)

// Hasta ahora ninguna prueba ejecutaba el SQL de dividir cuenta: reparto_test.go
// solo reparte en memoria. Por eso el INSERT de las cuotas, que Postgres
// rechazaba siempre con 42P08, llego a produccion con la CI en verde y nadie
// pudo crear una sola division. Estas pruebas corren contra la base real.

const (
	telefonoSegundo = "+50688885678" // testutil.SeedTestUser2
	telefonoTercera = "+50688885003" // testutil.SeedTestUser3
)

func montar(t *testing.T) (*pgxpool.Pool, *splitpay.Service, string, string, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	creador := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	segundo := testutil.SeedTestUser2(t, pool)
	tercera := testutil.SeedTestUser3(t, pool)

	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l, nil)
	svc := splitpay.NewService(splitpay.NewRepository(pool), txSvc, user.NewRepository(pool))
	return pool, svc, creador, segundo, tercera
}

func saldoCRC(t *testing.T, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var saldo int64
	if err := pool.QueryRow(context.Background(),
		`SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&saldo); err != nil {
		t.Fatalf("leer billetera: %v", err)
	}
	return saldo
}

// cuotaDe busca la cuota de una cuenta en lo que quedo GUARDADO, no en lo que
// devolvio la llamada: lo que se examina es el SQL.
func cuotaDe(t *testing.T, cuotas []splitpay.SplitShare, userID string) splitpay.SplitShare {
	t.Helper()
	for _, c := range cuotas {
		if c.UserID == userID {
			return c
		}
	}
	t.Fatalf("no quedo guardada ninguna cuota para %s", userID)
	return splitpay.SplitShare{}
}

func TestCrearDivision_PartesIgualesQuedaGuardada(t *testing.T) {
	_, svc, creador, segundo, tercera := montar(t)
	ctx := context.Background()

	grupo, _, err := svc.CreateSplit(ctx, creador, &splitpay.CreateSplitRequest{
		Title: "Cena", TotalAmount: 30_000, Currency: "CRC", SplitType: "equal",
		Participants: []splitpay.ParticipantReq{{UserPhone: telefonoSegundo}, {UserPhone: telefonoTercera}},
	})
	if err != nil {
		t.Fatalf("crear una division en partes iguales: %v", err)
	}

	guardado, cuotas, err := svc.GetSplit(ctx, grupo.ID)
	if err != nil {
		t.Fatalf("leer la division creada: %v", err)
	}
	if guardado.TotalAmount != 30_000 || guardado.SplitType != "equal" || guardado.Status != "active" {
		t.Fatalf("grupo guardado = %+v", guardado)
	}
	if len(cuotas) != 3 {
		t.Fatalf("se guardaron %d cuotas, se esperaban 3 (el creador y dos invitados)", len(cuotas))
	}

	// La cuota del creador nace pagada y CON fecha: es la fila que disparaba
	// el 42P08.
	propia := cuotaDe(t, cuotas, creador)
	if propia.Status != "paid" || propia.PaidAt == nil {
		t.Fatalf("cuota del creador = %+v, se esperaba pagada y con fecha", propia)
	}
	var suma int64
	for _, id := range []string{segundo, tercera} {
		c := cuotaDe(t, cuotas, id)
		if c.Status != "pending" || c.PaidAt != nil || c.Amount != 10_000 {
			t.Fatalf("cuota de %s = %+v, se esperaba pendiente, sin fecha y de 10000", id, c)
		}
		suma += c.Amount
	}
	if suma+propia.Amount != 30_000 {
		t.Fatalf("las cuotas suman %d, no el total 30000", suma+propia.Amount)
	}
}

func TestCrearDivision_PersonalizadaQuedaGuardada(t *testing.T) {
	_, svc, creador, segundo, tercera := montar(t)
	ctx := context.Background()

	grupo, _, err := svc.CreateSplit(ctx, creador, &splitpay.CreateSplitRequest{
		Title: "Supermercado", TotalAmount: 30_000, Currency: "CRC", SplitType: "custom",
		Participants: []splitpay.ParticipantReq{
			{UserPhone: telefonoSegundo, Amount: 12_000},
			{UserPhone: telefonoTercera, Amount: 8_000},
		},
	})
	if err != nil {
		t.Fatalf("crear una division personalizada: %v", err)
	}

	_, cuotas, err := svc.GetSplit(ctx, grupo.ID)
	if err != nil {
		t.Fatalf("leer la division creada: %v", err)
	}
	quiere := map[string]int64{creador: 10_000, segundo: 12_000, tercera: 8_000}
	for id, monto := range quiere {
		if c := cuotaDe(t, cuotas, id); c.Amount != monto {
			t.Fatalf("cuota de %s = %d, se esperaba %d", id, c.Amount, monto)
		}
	}
	if c := cuotaDe(t, cuotas, creador); c.Status != "paid" || c.PaidAt == nil {
		t.Fatalf("cuota del creador = %+v, se esperaba pagada y con fecha", c)
	}
}

// listar llama al handler real y devuelve `data` crudo, para ver si salio
// `[]` o `null`.
func listar(t *testing.T, h *splitpay.Handler, userID string) json.RawMessage {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/splits", nil)
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, userID))
	rec := httptest.NewRecorder()
	h.ListSplits(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /splits = %d: %s", rec.Code, rec.Body.String())
	}
	var sobre struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("respuesta ilegible: %v", err)
	}
	return sobre.Data
}

// Quien no tiene divisiones recibia `data: null`, y la pantalla lo tomaba por
// un error de carga en vez de mostrar su estado vacio.
func TestListarDivisiones_SinNingunaDevuelveArregloVacio(t *testing.T) {
	_, svc, creador, segundo, _ := montar(t)
	h := splitpay.NewHandler(svc)

	if got := string(listar(t, h, segundo)); got != "[]" {
		t.Fatalf("sin divisiones, data = %s, se esperaba []", got)
	}

	if _, _, err := svc.CreateSplit(context.Background(), creador, &splitpay.CreateSplitRequest{
		Title: "Cena", TotalAmount: 30_000, SplitType: "equal",
		Participants: []splitpay.ParticipantReq{{UserPhone: telefonoSegundo}, {UserPhone: telefonoTercera}},
	}); err != nil {
		t.Fatalf("crear division: %v", err)
	}
	var grupos []splitpay.SplitGroup
	if err := json.Unmarshal(listar(t, h, segundo), &grupos); err != nil || len(grupos) != 1 {
		t.Fatalf("un invitado debe ver la division: %v (err %v)", grupos, err)
	}
}

// El resto del camino tampoco habia corrido nunca, porque no existia division
// alguna que pagar: pagar mueve el dinero por el libro y, cuando no queda nada
// pendiente, la division se liquida.
func TestDivision_PagarYRechazarLaLiquida(t *testing.T) {
	pool, svc, creador, segundo, tercera := montar(t)
	ctx := context.Background()

	grupo, _, err := svc.CreateSplit(ctx, creador, &splitpay.CreateSplitRequest{
		Title: "Cena", TotalAmount: 30_000, Currency: "CRC", SplitType: "equal",
		Participants: []splitpay.ParticipantReq{{UserPhone: telefonoSegundo}, {UserPhone: telefonoTercera}},
	})
	if err != nil {
		t.Fatalf("crear division: %v", err)
	}

	creador0, segundo0 := saldoCRC(t, pool, creador), saldoCRC(t, pool, segundo)
	if err := svc.PayShare(ctx, segundo, grupo.ID); err != nil {
		t.Fatalf("pagar la cuota: %v", err)
	}
	if got := saldoCRC(t, pool, segundo); got != segundo0-10_000 {
		t.Fatalf("saldo de quien pago = %d, se esperaba %d", got, segundo0-10_000)
	}
	if got := saldoCRC(t, pool, creador); got != creador0+10_000 {
		t.Fatalf("saldo del creador = %d, se esperaba %d", got, creador0+10_000)
	}

	if err := svc.DeclineShare(ctx, tercera, grupo.ID); err != nil {
		t.Fatalf("rechazar la cuota: %v", err)
	}
	guardado, cuotas, err := svc.GetSplit(ctx, grupo.ID)
	if err != nil {
		t.Fatalf("leer la division: %v", err)
	}
	if guardado.Status != "settled" || guardado.SettledAt == nil {
		t.Fatalf("sin cuotas pendientes la division debe quedar liquidada: %+v", guardado)
	}
	if c := cuotaDe(t, cuotas, segundo); c.Status != "paid" || c.PaidAt == nil {
		t.Fatalf("cuota pagada = %+v", c)
	}
	if c := cuotaDe(t, cuotas, tercera); c.Status != "declined" {
		t.Fatalf("cuota rechazada = %+v", c)
	}
}
