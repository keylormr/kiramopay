package escrow_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/escrow"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
)

// Un escrow fondeado no vencia nunca: si el comprador se callaba, la plata
// quedaba retenida para siempre. Ahora, cuando un plazo vence, pierde quien
// tenia que actuar y no lo hizo.

type aviso struct{ usuario, titulo, cuerpo string }

type avisosDePrueba struct {
	mu   sync.Mutex
	lista []aviso
}

func (a *avisosDePrueba) NotifyUser(_ context.Context, userID, title, body, _ string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.lista = append(a.lista, aviso{userID, title, body})
	return nil
}

func (a *avisosDePrueba) para(userID string) []aviso {
	a.mu.Lock()
	defer a.mu.Unlock()
	var out []aviso
	for _, x := range a.lista {
		if x.usuario == userID {
			out = append(out, x)
		}
	}
	return out
}

func (a *avisosDePrueba) total() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.lista)
}

func conPlazos(t *testing.T) (*pgxpool.Pool, *escrow.Service, *avisosDePrueba, string, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	comprador := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	vendedor := testutil.SeedTestUser2(t, pool)
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	eng := ledger.NewEngine(pool, logger)
	avisos := &avisosDePrueba{}
	svc := escrow.NewService(escrow.NewRepository(pool), eng, &escrow.Options{
		MFA:      mfaDePrueba{desde: 100_000, verificado: true},
		Plazos:   &escrow.Plazos{DiasParaEntregar: 14, DiasParaRevisar: 7, AvisoAntes: 48 * time.Hour},
		Notifier: avisos,
	})
	fundWallet(t, eng, comprador, 1_000_000)
	return pool, svc, avisos, comprador, vendedor
}

func fondeado(t *testing.T, svc *escrow.Service, comprador, vendedor string) *escrow.Agreement {
	t.Helper()
	ctx := context.Background()
	a, err := svc.Create(ctx, comprador, &escrow.CreateRequest{
		SellerID: vendedor, AmountMinor: 150_000, Currency: "CRC", Description: "bicicleta",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	f, err := svc.Fund(ctx, comprador, a.ID)
	if err != nil {
		t.Fatalf("Fund: %v", err)
	}
	return f
}

// correrReloj mueve un plazo del acuerdo, como si hubiera pasado el tiempo.
func correrReloj(t *testing.T, pool *pgxpool.Pool, id, columna, intervalo string) {
	t.Helper()
	// columna e intervalo son literales de la prueba, no entrada externa.
	if _, err := pool.Exec(context.Background(),
		`UPDATE escrow_agreements SET `+columna+` = NOW() + $2::interval WHERE id = $1::uuid`, //nolint:gosec // test-only
		id, intervalo); err != nil {
		t.Fatalf("correr reloj: %v", err)
	}
}

func cerca(t *testing.T, nombre string, got *time.Time, want time.Time) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s vacio, se esperaba ~%s", nombre, want)
	}
	if d := got.Sub(want); d < -5*time.Minute || d > 5*time.Minute {
		t.Fatalf("%s = %s, se esperaba ~%s", nombre, got, want)
	}
}

func TestFondearFijaElPlazoDeEntrega(t *testing.T) {
	_, svc, _, comprador, vendedor := conPlazos(t)
	a := fondeado(t, svc, comprador, vendedor)

	cerca(t, "deliver_by", a.DeliverBy, time.Now().Add(14*24*time.Hour))
	if a.DeliveredAt != nil || a.ReviewBy != nil {
		t.Fatalf("recien fondeado no puede tener entrega ni plazo de revision: %+v", a)
	}
}

func TestSoloElVendedorMarcaLaEntrega(t *testing.T) {
	_, svc, avisos, comprador, vendedor := conPlazos(t)
	ctx := context.Background()
	a := fondeado(t, svc, comprador, vendedor)

	if _, err := svc.MarcarEntregado(ctx, comprador, a.ID); !errors.Is(err, escrow.ErrNotSeller) {
		t.Fatalf("el comprador marco la entrega: err = %v", err)
	}
	if _, err := svc.MarcarEntregado(ctx, "99999999-9999-9999-9999-999999999999", a.ID); !errors.Is(err, escrow.ErrNotParty) {
		t.Fatalf("un tercero marco la entrega: err = %v", err)
	}

	e, err := svc.MarcarEntregado(ctx, vendedor, a.ID)
	if err != nil {
		t.Fatalf("MarcarEntregado: %v", err)
	}
	cerca(t, "delivered_at", e.DeliveredAt, time.Now())
	cerca(t, "review_by", e.ReviewBy, time.Now().Add(7*24*time.Hour))
	if len(avisos.para(comprador)) != 1 {
		t.Fatalf("al comprador le llegaron %d avisos, se esperaba 1", len(avisos.para(comprador)))
	}

	// Dos veces no: el plazo del comprador no se puede estirar marcando de nuevo.
	if _, err := svc.MarcarEntregado(ctx, vendedor, a.ID); !errors.Is(err, escrow.ErrBadTransition) {
		t.Fatalf("segunda entrega: err = %v, se esperaba ErrBadTransition", err)
	}
}

func TestSinEntregaSeLeDevuelveAlComprador(t *testing.T) {
	pool, svc, avisos, comprador, vendedor := conPlazos(t)
	ctx := context.Background()
	antes := walletCRC(t, pool, comprador)
	a := fondeado(t, svc, comprador, vendedor)
	correrReloj(t, pool, a.ID, "entregar_antes", "-1 minute")

	_, cerrados, err := svc.VencerAcuerdos(ctx, 100)
	if err != nil {
		t.Fatalf("VencerAcuerdos: %v", err)
	}
	if cerrados != 1 {
		t.Fatalf("cerrados = %d, se esperaba 1", cerrados)
	}
	fin, _ := svc.ObtenerParaAdmin(ctx, a.ID)
	if fin.Status != escrow.StatusRefunded || fin.ClosedByExpiry != escrow.VencioEntrega {
		t.Fatalf("acuerdo = %s / %q, se esperaba refunded / entrega", fin.Status, fin.ClosedByExpiry)
	}
	if got := walletCRC(t, pool, comprador); got != antes {
		t.Fatalf("billetera del comprador = %d, se esperaba %d de vuelta", got, antes)
	}
	if got := escrowAccountBalance(t, pool); got != 0 {
		t.Fatalf("SYSTEM:ESCROW = %d, se esperaba 0", got)
	}
	if len(avisos.para(comprador)) == 0 || len(avisos.para(vendedor)) == 0 {
		t.Fatal("el cierre por vencimiento se le tiene que avisar a las dos partes")
	}
}

func TestSinReclamoSeLePagaAlVendedor(t *testing.T) {
	pool, svc, _, comprador, vendedor := conPlazos(t)
	ctx := context.Background()
	antes := walletCRC(t, pool, vendedor)
	a := fondeado(t, svc, comprador, vendedor)
	if _, err := svc.MarcarEntregado(ctx, vendedor, a.ID); err != nil {
		t.Fatalf("MarcarEntregado: %v", err)
	}
	// El plazo de ENTREGA ya vencido no importa: se entrego. Manda el de revision.
	correrReloj(t, pool, a.ID, "entregar_antes", "-30 days")
	correrReloj(t, pool, a.ID, "revisar_antes", "-1 minute")

	if _, cerrados, err := svc.VencerAcuerdos(ctx, 100); err != nil || cerrados != 1 {
		t.Fatalf("VencerAcuerdos: cerrados=%d err=%v", cerrados, err)
	}
	fin, _ := svc.ObtenerParaAdmin(ctx, a.ID)
	if fin.Status != escrow.StatusReleased || fin.ClosedByExpiry != escrow.VencioRevision {
		t.Fatalf("acuerdo = %s / %q, se esperaba released / revision", fin.Status, fin.ClosedByExpiry)
	}
	if got := walletCRC(t, pool, vendedor); got != antes+150_000 {
		t.Fatalf("billetera del vendedor = %d, se esperaba %d", got, antes+150_000)
	}
}

// Una disputa detiene el reloj: el caso lo decide una persona, no el barrido.
func TestUnaDisputaDetieneElReloj(t *testing.T) {
	pool, svc, _, comprador, vendedor := conPlazos(t)
	ctx := context.Background()
	a := fondeado(t, svc, comprador, vendedor)
	if _, err := svc.Dispute(ctx, comprador, a.ID, "no llego"); err != nil {
		t.Fatalf("Dispute: %v", err)
	}
	correrReloj(t, pool, a.ID, "entregar_antes", "-10 days")

	if _, cerrados, err := svc.VencerAcuerdos(ctx, 100); err != nil || cerrados != 0 {
		t.Fatalf("VencerAcuerdos sobre una disputa: cerrados=%d err=%v", cerrados, err)
	}
	fin, _ := svc.ObtenerParaAdmin(ctx, a.ID)
	if fin.Status != escrow.StatusDisputed {
		t.Fatalf("estado = %s, la disputa tenia que seguir abierta", fin.Status)
	}
}

// El aviso sale una vez por plazo, a las dos partes, y marcar la entrega abre
// un plazo nuevo con su propio aviso.
func TestAvisaUnaVezPorPlazo(t *testing.T) {
	pool, svc, avisos, comprador, vendedor := conPlazos(t)
	ctx := context.Background()
	a := fondeado(t, svc, comprador, vendedor)
	correrReloj(t, pool, a.ID, "entregar_antes", "24 hours")

	if avisados, cerrados, err := svc.VencerAcuerdos(ctx, 100); err != nil || avisados != 1 || cerrados != 0 {
		t.Fatalf("primer barrido: avisados=%d cerrados=%d err=%v", avisados, cerrados, err)
	}
	if n := avisos.total(); n != 2 {
		t.Fatalf("avisos = %d, se esperaban 2 (vendedor y comprador)", n)
	}
	if !strings.Contains(avisos.para(vendedor)[0].cuerpo, "₡1,500.00") {
		t.Fatalf("el aviso no dice el monto con miles: %q", avisos.para(vendedor)[0].cuerpo)
	}
	if avisados, _, _ := svc.VencerAcuerdos(ctx, 100); avisados != 0 {
		t.Fatalf("segundo barrido aviso %d veces mas", avisados)
	}

	if _, err := svc.MarcarEntregado(ctx, vendedor, a.ID); err != nil {
		t.Fatalf("MarcarEntregado: %v", err)
	}
	correrReloj(t, pool, a.ID, "revisar_antes", "24 hours")
	if avisados, _, _ := svc.VencerAcuerdos(ctx, 100); avisados != 1 {
		t.Fatalf("el plazo de revision tiene su propio aviso: avisados=%d", avisados)
	}
}

// La disputa tenia una sola salida, la del arbitro. Ahora cada parte puede
// ceder: el comprador libera, el vendedor devuelve.
func TestLasPartesPuedenCederEnUnaDisputa(t *testing.T) {
	_, svc, _, comprador, vendedor := conPlazos(t)
	ctx := context.Background()

	a := fondeado(t, svc, comprador, vendedor)
	if _, err := svc.Dispute(ctx, vendedor, a.ID, "no me pagan"); err != nil {
		t.Fatalf("Dispute: %v", err)
	}
	// El vendedor no puede "ceder" liberandose la plata a si mismo.
	if _, err := svc.Release(ctx, vendedor, a.ID); !errors.Is(err, escrow.ErrNotBuyer) {
		t.Fatalf("el vendedor libero en disputa: err = %v", err)
	}
	if r, err := svc.Release(ctx, comprador, a.ID); err != nil || r.Status != escrow.StatusReleased {
		t.Fatalf("el comprador cede: err=%v", err)
	}

	b := fondeado(t, svc, comprador, vendedor)
	if _, err := svc.Dispute(ctx, comprador, b.ID, "no llego"); err != nil {
		t.Fatalf("Dispute: %v", err)
	}
	if r, err := svc.Refund(ctx, vendedor, b.ID); err != nil || r.Status != escrow.StatusRefunded {
		t.Fatalf("el vendedor cede: err=%v", err)
	}
}

// Un acuerdo fondeado sin plazo no puede sobrevivir un barrido: es justo el
// que no venceria nunca.
func TestUnAcuerdoFondeadoSinPlazoRecibeUno(t *testing.T) {
	pool, svc, _, comprador, vendedor := conPlazos(t)
	ctx := context.Background()
	a := fondeado(t, svc, comprador, vendedor)
	if _, err := pool.Exec(ctx, `UPDATE escrow_agreements SET entregar_antes = NULL WHERE id = $1::uuid`, a.ID); err != nil {
		t.Fatalf("borrar plazo: %v", err)
	}
	if _, _, err := svc.VencerAcuerdos(ctx, 100); err != nil {
		t.Fatalf("VencerAcuerdos: %v", err)
	}
	fin, _ := svc.ObtenerParaAdmin(ctx, a.ID)
	cerca(t, "deliver_by repuesto", fin.DeliverBy, time.Now().Add(14*24*time.Hour))
}

// Un plazo vencido ya decidio el resultado. El barrido corre cada minuto: sin la
// guarda, en ese minuto se podia marcar una entrega tardia o abrir una disputa
// tardia y frenar lo que la regla ya habia dado.
func TestUnPlazoVencidoYaDecidio(t *testing.T) {
	pool, svc, _, comprador, vendedor := conPlazos(t)
	ctx := context.Background()

	a := fondeado(t, svc, comprador, vendedor)
	correrReloj(t, pool, a.ID, "entregar_antes", "-1 minute")
	if _, err := svc.MarcarEntregado(ctx, vendedor, a.ID); !errors.Is(err, escrow.ErrPlazoVencido) {
		t.Fatalf("entrega tardia: err = %v, se esperaba ErrPlazoVencido", err)
	}
	if _, err := svc.Dispute(ctx, comprador, a.ID, "tarde"); !errors.Is(err, escrow.ErrPlazoVencido) {
		t.Fatalf("disputa tardia: err = %v, se esperaba ErrPlazoVencido", err)
	}

	b := fondeado(t, svc, comprador, vendedor)
	if _, err := svc.MarcarEntregado(ctx, vendedor, b.ID); err != nil {
		t.Fatalf("MarcarEntregado: %v", err)
	}
	correrReloj(t, pool, b.ID, "revisar_antes", "-1 minute")
	if _, err := svc.Dispute(ctx, comprador, b.ID, "tarde"); !errors.Is(err, escrow.ErrPlazoVencido) {
		t.Fatalf("reclamo fuera del plazo de revision: err = %v, se esperaba ErrPlazoVencido", err)
	}
	// Liberar tarde si se puede: le da a la otra parte lo mismo que el plazo.
	if _, err := svc.Release(ctx, comprador, b.ID); err != nil {
		t.Fatalf("liberar tarde: %v", err)
	}
}
