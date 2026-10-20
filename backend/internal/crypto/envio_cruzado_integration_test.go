package crypto_test

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/crypto"
	"github.com/kiramopay/backend/internal/testutil"
)

// Dos personas que se envian cripto la una a la otra al mismo tiempo.
//
// El envio toma la billetera de quien envia (el tope) y la de quien recibe (para
// que el dia 0 de la eliminacion de cuenta de esa persona se entere del abono).
// Si cada envio tomara primero la suya, los dos cruzados quedarian cada uno con
// la billetera que el otro espera, y Postgres mataria a uno por interbloqueo: un
// envio valido le llegaria a la persona como un error del servidor. Tomarlas en
// el orden del libro (por id) lo hace imposible.

// barreraDeBilleteras detiene a cada envio justo despues de su primer candado
// sobre una billetera, hasta que el otro tambien tenga el suyo o quede esperando
// uno. Asi los dos llegan a pedir su segunda billetera con la primera tomada,
// que es el unico orden en que un interbloqueo puede ocurrir.
type barreraDeBilleteras struct {
	t        *testing.T
	pool     *pgxpool.Pool
	mu       sync.Mutex
	llegaron map[*pgx.Conn]bool
	listos   chan struct{}
	cuantos  int
	seDio    bool
}

type claveDelSQLCruzado struct{}

func (b *barreraDeBilleteras) TraceQueryStart(ctx context.Context, _ *pgx.Conn, d pgx.TraceQueryStartData) context.Context {
	return context.WithValue(ctx, claveDelSQLCruzado{}, d.SQL)
}

func (b *barreraDeBilleteras) TraceQueryEnd(ctx context.Context, conn *pgx.Conn, d pgx.TraceQueryEndData) {
	sql, _ := ctx.Value(claveDelSQLCruzado{}).(string)
	if d.Err != nil || !tomaUnaBilletera(sql) {
		return
	}
	b.mu.Lock()
	if b.llegaron[conn] {
		b.mu.Unlock()
		return
	}
	b.llegaron[conn] = true
	b.cuantos++
	if b.cuantos == 2 {
		b.seDio = true
		close(b.listos)
	}
	b.mu.Unlock()

	plazo := time.After(5 * time.Second)
	pulso := time.NewTicker(5 * time.Millisecond)
	defer pulso.Stop()
	for {
		select {
		case <-b.listos:
			return
		case <-plazo:
			b.t.Errorf("el otro envio nunca tomo su billetera ni quedo esperando una")
			return
		case <-pulso.C:
			if esperaUnCandado(b.t, b.pool) {
				b.mu.Lock()
				b.seDio = true
				b.mu.Unlock()
				return
			}
		}
	}
}

// tomaUnaBilletera reconoce una sentencia que deja tomada una fila de wallets:
// un SELECT ... FOR UPDATE o un UPDATE. Las lecturas sueltas del tope no.
func tomaUnaBilletera(sql string) bool {
	s := strings.TrimSpace(sql)
	if !strings.Contains(s, "wallets") {
		return false
	}
	return strings.Contains(s, "FOR UPDATE") || strings.HasPrefix(s, "UPDATE wallets")
}

// esperaUnCandado pregunta, desde otra conexion, si alguna consulta de la base
// de pruebas esta esperando un candado de fila.
func esperaUnCandado(t *testing.T, pool *pgxpool.Pool) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var espera bool
	if err := pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM pg_stat_activity
			 WHERE datname = current_database()
			   AND wait_event_type = 'Lock'
			   AND pid <> pg_backend_pid()
		)`).Scan(&espera); err != nil {
		t.Errorf("preguntar por los candados: %v", err)
		return false
	}
	return espera
}

func TestEnviarCripto_DosEnviosCruzadosNoSeTraban(t *testing.T) {
	e := montarEnvio(t)
	ctx := context.Background()
	repo := crypto.NewRepository(e.pool)
	if err := repo.UpsertAsset(ctx, e.quienRecibe, "BTC", "Bitcoin", d(1), d(1000)); err != nil {
		t.Fatalf("sembrar BTC de la otra persona: %v", err)
	}
	qrDeQuienEnvia := e.miCodigo(t, e.quienEnvia)

	barrera := &barreraDeBilleteras{t: t, pool: e.pool, llegaron: map[*pgx.Conn]bool{}, listos: make(chan struct{})}
	svc := servicioDeEnvio(testutil.PoolTrazado(t, barrera), e.urlPrecios, e)

	var wg sync.WaitGroup
	errs := make([]error, 2)
	envios := []struct{ de, qr string }{
		{e.quienEnvia, e.qrDelReceptor},
		{e.quienRecibe, qrDeQuienEnvia},
	}
	for i, env := range envios {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = svc.Send(ctx, env.de, &crypto.SendRequest{Asset: "BTC", Amount: seEnvia, QRData: env.qr})
		}()
	}
	esperarAlOriginal(t, &wg)

	if !barrera.seDio {
		t.Fatal("los envios no llegaron a cruzarse: la prueba no ejercito la carrera")
	}
	for i, err := range errs {
		if err != nil {
			t.Fatalf("el envio cruzado %d fallo: %v", i, err)
		}
	}
	// Cada una envio 0,08 y recibio 0,08: solo pago su comision.
	queda := d(1).Sub(laComision)
	e.exigirSaldos(t, queda, queda)
}
