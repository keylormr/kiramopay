package splitpay_test

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/splitpay"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
)

// Una division donde alguien ya pago no se puede cancelar.
//
// Decision del dueno: "No se puede cancelar". Cancelar solo cambia el estado del
// grupo; el dinero de las cuotas pagadas ya esta en la cuenta de quien creo la
// division y no vuelve solo, asi que cancelar dejaba a quien pago con la cuota
// cobrada y sin division. La cuota del propio creador nace pagada y no cuenta:
// no mueve dinero.
//
// Las pruebas hablan con el handler real (DELETE /splits/{id}) y leen el codigo
// del cuerpo: es el contrato que ve la pantalla.

const codigoSinCancelar = "SPLIT_HAS_PAYMENTS"

// cancelarPorHTTP llama al handler de DELETE /splits/{id} y devuelve el estado
// HTTP y el codigo de error ("" cuando salio bien).
func cancelarPorHTTP(h *splitpay.Handler, userID, groupID string) (int, string) {
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/splits/"+groupID, nil)
	rc := chi.NewRouteContext()
	rc.URLParams.Add("id", groupID)
	ctx := context.WithValue(req.Context(), chi.RouteCtxKey, rc)
	ctx = context.WithValue(ctx, middleware.UserIDKey, userID)
	rec := httptest.NewRecorder()
	h.CancelSplit(rec, req.WithContext(ctx))

	var cuerpo struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &cuerpo)
	return rec.Code, cuerpo.Error.Code
}

// servicioSobre arma el servicio completo sobre el pool que se le pase: las
// pruebas de carrera necesitan uno con trazador y otro sin el.
func servicioSobre(pool *pgxpool.Pool) *splitpay.Service {
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l, nil)
	return splitpay.NewService(splitpay.NewRepository(pool), txSvc, user.NewRepository(pool))
}

func estadoDelGrupo(t *testing.T, svc *splitpay.Service, groupID string) string {
	t.Helper()
	g, _, err := svc.GetSplit(context.Background(), groupID)
	if err != nil {
		t.Fatalf("leer la division: %v", err)
	}
	return g.Status
}

func TestCancelar_SinPagosDeOtrosSeCancela(t *testing.T) {
	_, svc, creador, _, _ := montar(t)
	h := splitpay.NewHandler(svc)
	grupo := divisionDeTres(t, svc, creador, "Cena")

	// La cuota del creador nace pagada, y aun asi la division se puede cancelar:
	// esa cuota no movio dinero.
	if estado, codigo := cancelarPorHTTP(h, creador, grupo.ID); estado != http.StatusNoContent {
		t.Fatalf("cancelar sin pagos de otros: %d %q, se esperaba 204", estado, codigo)
	}
	if got := estadoDelGrupo(t, svc, grupo.ID); got != "cancelled" {
		t.Fatalf("la division quedo en %q, se esperaba cancelled", got)
	}
}

func TestCancelar_ConUnaCuotaPagadaPorOtroSeRechazaYNadaCambia(t *testing.T) {
	pool, svc, creador, segundo, tercera := montar(t)
	h := splitpay.NewHandler(svc)
	ctx := context.Background()
	grupo := divisionDeTres(t, svc, creador, "Cena")

	if err := svc.PayShare(ctx, segundo, grupo.ID); err != nil {
		t.Fatalf("pagar la cuota: %v", err)
	}
	creador0, segundo0 := saldoCRC(t, pool, creador), saldoCRC(t, pool, segundo)

	estado, codigo := cancelarPorHTTP(h, creador, grupo.ID)
	if estado != http.StatusConflict || codigo != codigoSinCancelar {
		t.Fatalf("cancelar con una cuota pagada: %d %q, se esperaba 409 %s", estado, codigo, codigoSinCancelar)
	}
	if got := estadoDelGrupo(t, svc, grupo.ID); got != "active" {
		t.Fatalf("la division rechazada quedo en %q, se esperaba active", got)
	}
	if saldoCRC(t, pool, creador) != creador0 || saldoCRC(t, pool, segundo) != segundo0 {
		t.Fatal("un rechazo de cancelacion movio dinero")
	}

	// Sigue viva: quien no habia pagado todavia puede hacerlo.
	if err := svc.PayShare(ctx, tercera, grupo.ID); err != nil {
		t.Fatalf("la division debia seguir aceptando pagos: %v", err)
	}
	if got := estadoDelGrupo(t, svc, grupo.ID); got != "settled" {
		t.Fatalf("pagadas todas las cuotas la division debia quedar liquidada, esta en %q", got)
	}
}

// Rechazar la propia cuota no es pagar: no hay dinero que quede en la cuenta de
// nadie, asi que la division se sigue pudiendo cancelar.
func TestCancelar_UnaCuotaRechazadaNoImpideCancelar(t *testing.T) {
	_, svc, creador, segundo, _ := montar(t)
	h := splitpay.NewHandler(svc)
	grupo := divisionDeTres(t, svc, creador, "Cena")

	if err := svc.DeclineShare(context.Background(), segundo, grupo.ID); err != nil {
		t.Fatalf("rechazar la cuota: %v", err)
	}
	if estado, codigo := cancelarPorHTTP(h, creador, grupo.ID); estado != http.StatusNoContent {
		t.Fatalf("cancelar con una cuota rechazada: %d %q, se esperaba 204", estado, codigo)
	}
}

func TestCancelar_SoloLoHaceQuienCreoLaDivision(t *testing.T) {
	_, svc, creador, segundo, _ := montar(t)
	h := splitpay.NewHandler(svc)
	grupo := divisionDeTres(t, svc, creador, "Cena")

	if estado, _ := cancelarPorHTTP(h, segundo, grupo.ID); estado == http.StatusNoContent {
		t.Fatal("un invitado pudo cancelar la division")
	}
	if got := estadoDelGrupo(t, svc, grupo.ID); got != "active" {
		t.Fatalf("la division quedo en %q, se esperaba active", got)
	}
}

func TestCancelar_DosVecesNoFalla(t *testing.T) {
	_, svc, creador, _, _ := montar(t)
	h := splitpay.NewHandler(svc)
	grupo := divisionDeTres(t, svc, creador, "Cena")

	for i := 1; i <= 2; i++ {
		if estado, codigo := cancelarPorHTTP(h, creador, grupo.ID); estado != http.StatusNoContent {
			t.Fatalf("cancelacion %d: %d %q, se esperaba 204", i, estado, codigo)
		}
	}
}

// Una division liquidada ya cerro: cancelarla no tiene sentido y antes la
// devolvia a "cancelada".
func TestCancelar_UnaDivisionLiquidadaNoSePuedeCancelar(t *testing.T) {
	_, svc, creador, segundo, tercera := montar(t)
	h := splitpay.NewHandler(svc)
	ctx := context.Background()
	grupo := divisionDeTres(t, svc, creador, "Cena")

	for _, id := range []string{segundo, tercera} {
		if err := svc.DeclineShare(ctx, id, grupo.ID); err != nil {
			t.Fatalf("rechazar la cuota: %v", err)
		}
	}
	if got := estadoDelGrupo(t, svc, grupo.ID); got != "settled" {
		t.Fatalf("sin cuotas pendientes la division debia quedar liquidada, esta en %q", got)
	}
	if estado, _ := cancelarPorHTTP(h, creador, grupo.ID); estado == http.StatusNoContent {
		t.Fatal("se cancelo una division ya liquidada")
	}
	if got := estadoDelGrupo(t, svc, grupo.ID); got != "settled" {
		t.Fatalf("la division liquidada quedo en %q", got)
	}
}

// Una division cancelada no cobra: pagar no mueve dinero.
func TestPagar_UnaDivisionCanceladaNoMueveDinero(t *testing.T) {
	pool, svc, creador, segundo, _ := montar(t)
	h := splitpay.NewHandler(svc)
	grupo := divisionDeTres(t, svc, creador, "Cena")

	if estado, codigo := cancelarPorHTTP(h, creador, grupo.ID); estado != http.StatusNoContent {
		t.Fatalf("cancelar: %d %q", estado, codigo)
	}
	creador0, segundo0 := saldoCRC(t, pool, creador), saldoCRC(t, pool, segundo)
	if err := svc.PayShare(context.Background(), segundo, grupo.ID); err == nil {
		t.Fatal("pagar una cuota de una division cancelada devolvio exito")
	}
	if saldoCRC(t, pool, segundo) != segundo0 || saldoCRC(t, pool, creador) != creador0 {
		t.Fatal("se movio dinero en una division cancelada")
	}
}

// ── Pagar y cancelar a la vez ────────────────────────────────────────────────
//
// Lo que no puede pasar: una division CANCELADA con una cuota ajena PAGADA. Es
// la unica combinacion que deja a alguien cobrado sin division.
//
// Ningun estado inicial distingue un orden de otro (sobre una base quieta las
// dos operaciones contestan igual): hay que hacer que la otra confirme JUSTO en
// el hueco entre la lectura y la escritura. Es la receta de testutil.PoolTrazado:
// el servicio bajo prueba corre sobre un pool con un trazador que, al ARRANCAR la
// consulta de escritura, suelta la operacion contraria desde otra conexion y
// espera a que termine o se quede esperando un candado.

// trazadorDeCarrera ejecuta el gancho UNA vez, justo antes de que arranque la
// primera consulta cuyo SQL contiene `contiene`.
type trazadorDeCarrera struct {
	contiene  string
	gancho    func()
	unaVez    sync.Once
	disparado atomic.Bool
}

func (z *trazadorDeCarrera) TraceQueryStart(ctx context.Context, _ *pgx.Conn, d pgx.TraceQueryStartData) context.Context {
	if strings.Contains(d.SQL, z.contiene) {
		z.unaVez.Do(func() {
			z.disparado.Store(true)
			z.gancho()
		})
	}
	return ctx
}

func (z *trazadorDeCarrera) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// esperarATerminarOBloquearse espera a que la operacion soltada desde el gancho
// termine (`termino` se cierra) o quede detenida esperando un candado sobre
// split_groups. Con un candado bien puesto la segunda operacion SE QUEDA
// ESPERANDO a que la primera confirme: no se puede esperar a que termine, o la
// prueba se colgaria justo cuando el arreglo funciona. Con la espera acotada.
func esperarATerminarOBloquearse(t *testing.T, pool *pgxpool.Pool, termino <-chan struct{}) {
	t.Helper()
	limite := time.Now().Add(10 * time.Second)
	for time.Now().Before(limite) {
		select {
		case <-termino:
			return
		default:
		}
		var esperando int
		if err := pool.QueryRow(context.Background(),
			`SELECT count(*) FROM pg_stat_activity
			  WHERE datname = current_database()
			    AND wait_event_type = 'Lock'
			    AND query ILIKE '%split_groups%'`).Scan(&esperando); err == nil && esperando > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Error("la operacion soltada desde el gancho ni termino ni quedo esperando un candado")
}

// esperarFin cierra el ciclo de una operacion soltada desde el gancho, con tope.
func esperarFin(t *testing.T, termino <-chan struct{}) {
	t.Helper()
	select {
	case <-termino:
	case <-time.After(20 * time.Second):
		t.Fatal("la operacion soltada desde el gancho no termino")
	}
}

// exigirCoherencia es la regla de fondo, valga cual valga el orden en que
// ganaron las dos operaciones.
func exigirCoherencia(t *testing.T, pool *pgxpool.Pool, svc *splitpay.Service, grupo *splitpay.SplitGroup,
	creador, segundo string, creador0, segundo0 int64,
) (estado string, pagada bool) {
	t.Helper()
	g, cuotas, err := svc.GetSplit(context.Background(), grupo.ID)
	if err != nil {
		t.Fatalf("leer la division: %v", err)
	}
	c := cuotaDe(t, cuotas, segundo)
	cobrado := segundo0 - saldoCRC(t, pool, segundo)
	recibido := saldoCRC(t, pool, creador) - creador0

	pagada = c.Status == "paid"
	if g.Status == "cancelled" && pagada {
		t.Fatalf("la division quedo CANCELADA con la cuota de otro PAGADA (se cobraron %d centimos): "+
			"quien pago se queda sin division y con el dinero ya movido", cobrado)
	}
	if pagada && (cobrado != 10_000 || recibido != 10_000) {
		t.Fatalf("la cuota quedo pagada pero se cobraron %d y se recibieron %d centimos (se esperaban 10000 y 10000)", cobrado, recibido)
	}
	if !pagada && (cobrado != 0 || recibido != 0) {
		t.Fatalf("la cuota NO quedo pagada y aun asi se cobraron %d centimos y el creador recibio %d", cobrado, recibido)
	}
	return g.Status, pagada
}

// El pago confirma ENTRE la lectura de la cancelacion y su escritura: la
// comprobacion "nadie pago" ya se hizo y ya no vale. La cancelacion tiene que
// mirar y escribir bajo el mismo candado del grupo, de modo que el pago espere a
// que ella termine y encuentre una division cancelada.
func TestCancelarYPagarALaVez_ElPagoQueConfirmaAntesDeEscribirLaCancelacion(t *testing.T) {
	pool, svcPagador, creador, segundo, _ := montar(t)
	ctx := context.Background()
	grupo := divisionDeTres(t, svcPagador, creador, "Cena")

	var errPago error
	pagoTermino := make(chan struct{})
	tz := &trazadorDeCarrera{contiene: "UPDATE split_groups SET status"}
	tz.gancho = func() {
		go func() {
			defer close(pagoTermino)
			errPago = svcPagador.PayShare(ctx, segundo, grupo.ID)
		}()
		esperarATerminarOBloquearse(t, pool, pagoTermino)
	}
	poolTrazado := testutil.PoolTrazado(t, tz)
	h := splitpay.NewHandler(servicioSobre(poolTrazado))

	creador0, segundo0 := saldoCRC(t, pool, creador), saldoCRC(t, pool, segundo)
	estado, codigo := cancelarPorHTTP(h, creador, grupo.ID)
	if !tz.disparado.Load() {
		t.Fatal("el trazador no se disparo: la prueba no corrio la carrera")
	}
	esperarFin(t, pagoTermino)

	status, pagada := exigirCoherencia(t, pool, svcPagador, grupo, creador, segundo, creador0, segundo0)

	// Aqui la cancelacion tomo el candado primero: gana ella y el pago se rechaza
	// sin mover un centimo.
	if estado != http.StatusNoContent || status != "cancelled" {
		t.Fatalf("la cancelacion devolvio %d %q y la division quedo %q: se esperaba 204 y cancelled", estado, codigo, status)
	}
	if errPago == nil || pagada {
		t.Fatalf("el pago contra una division cancelada devolvio %v (cuota pagada: %v): se esperaba un rechazo", errPago, pagada)
	}
}

// La cancelacion llega cuando la cuota YA fue reclamada dentro de la transaccion
// del pago, pero el pago todavia no confirmo: desde afuera nadie ha pagado. La
// cancelacion tiene que esperar al pago y, al ver su cuota pagada, rechazarse.
func TestPagarYCancelarALaVez_LaCancelacionQueLlegaConLaCuotaYaReclamada(t *testing.T) {
	pool, svcCancelador, creador, segundo, _ := montar(t)
	h := splitpay.NewHandler(svcCancelador)
	grupo := divisionDeTres(t, svcCancelador, creador, "Cena")

	var (
		estado       int
		codigoCancel string
	)
	cancelTermino := make(chan struct{})
	tz := &trazadorDeCarrera{contiene: "UPDATE split_shares SET status = 'paid'"}
	tz.gancho = func() {
		go func() {
			defer close(cancelTermino)
			estado, codigoCancel = cancelarPorHTTP(h, creador, grupo.ID)
		}()
		esperarATerminarOBloquearse(t, pool, cancelTermino)
	}
	poolTrazado := testutil.PoolTrazado(t, tz)
	svcPagador := servicioSobre(poolTrazado)

	creador0, segundo0 := saldoCRC(t, pool, creador), saldoCRC(t, pool, segundo)
	errPago := svcPagador.PayShare(context.Background(), segundo, grupo.ID)
	if !tz.disparado.Load() {
		t.Fatal("el trazador no se disparo: la prueba no corrio la carrera")
	}
	esperarFin(t, cancelTermino)

	status, pagada := exigirCoherencia(t, pool, svcCancelador, grupo, creador, segundo, creador0, segundo0)

	// Aqui el pago tomo el candado primero: gana el y la cancelacion se rechaza.
	if errPago != nil || !pagada {
		t.Fatalf("el pago devolvio %v (cuota pagada: %v): se esperaba exito", errPago, pagada)
	}
	if estado != http.StatusConflict || codigoCancel != codigoSinCancelar || status != "active" {
		t.Fatalf("la cancelacion devolvio %d %q y la division quedo %q: se esperaba 409 %s y active",
			estado, codigoCancel, status, codigoSinCancelar)
	}
}

// Las dos operaciones sueltas a la vez, sin trazador: el barrido de la regla de
// fondo con el planificador de verdad.
func TestPagarYCancelarSueltosALaVez_NuncaQuedaCanceladaConPagos(t *testing.T) {
	pool, svc, creador, segundo, _ := montar(t)
	h := splitpay.NewHandler(svc)
	ctx := context.Background()

	for ronda := 1; ronda <= 15; ronda++ {
		grupo := divisionDeTres(t, svc, creador, "Cena")
		creador0, segundo0 := saldoCRC(t, pool, creador), saldoCRC(t, pool, segundo)

		salida := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-salida
			_ = svc.PayShare(ctx, segundo, grupo.ID)
		}()
		go func() {
			defer wg.Done()
			<-salida
			_, _ = cancelarPorHTTP(h, creador, grupo.ID)
		}()
		close(salida)
		wg.Wait()

		exigirCoherencia(t, pool, svc, grupo, creador, segundo, creador0, segundo0)
	}
}
