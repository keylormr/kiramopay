package accountdeletion

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kiramopay/backend/internal/testutil"
)

// Lo que encontro la revision adversaria de la bandeja de respuestas
// (2026-10-20): la reserva y la transaccion, que ninguna prueba ejercia de
// verdad; el log; las respuestas de cuentas ya cerradas; la de 'bloqueada' que
// sobrevivia al plazo; y la nota de operaciones.

// correoQueEspera retiene el primer envio hasta que lo suelten, como un
// proveedor lento; los demas salen enseguida. Cuenta cuantos hubo.
type correoQueEspera struct {
	mu     sync.Mutex
	envios int
	entro  chan struct{}
	soltar chan struct{}
}

func nuevoCorreoQueEspera() *correoQueEspera {
	return &correoQueEspera{entro: make(chan struct{}), soltar: make(chan struct{})}
}

func (c *correoQueEspera) SendEmail(ctx context.Context, _, _, _, _ string) error {
	c.mu.Lock()
	c.envios++
	primero := c.envios == 1
	c.mu.Unlock()
	if primero {
		close(c.entro)
		select {
		case <-c.soltar:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

func (c *correoQueEspera) cuantos() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.envios
}

// correoQueRebota rechaza todo con la direccion en minusculas, como la
// devuelve normalizada un proveedor real.
type correoQueRebota struct{}

func (correoQueRebota) SendEmail(_ context.Context, to, _, _, _ string) error {
	return errors.New("550 5.1.1 <" + strings.ToLower(to) + ">: el buzon no existe")
}

// bufferSeguro es un bytes.Buffer que se puede escribir desde varias goroutines.
type bufferSeguro struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *bufferSeguro) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}

func (b *bufferSeguro) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.String()
}

// La reserva es la que impide el envio doble: con un intento mandando, otro con
// el mismo reloj no la toma; entregada, no sale otra vez aunque ya le tocaria.
func TestRespuesta_LaReservaImpideElEnvioDoble(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	pedir(t, nuevoServicio(pool, nil), a.ID)
	id := unaRespuesta(t, pool, a.ID).ID
	correo := nuevoCorreoQueEspera()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()
	now := time.Now()

	primero := make(chan bool, 1)
	go func() {
		ok, err := svc.entregarUna(ctx, id, now)
		if err != nil {
			t.Errorf("primer intento: %v", err)
		}
		primero <- ok
	}()
	select {
	case <-correo.entro:
	case <-time.After(5 * time.Second):
		t.Fatal("el primer envio no empezo")
	}

	if ok, err := svc.entregarUna(ctx, id, now); err != nil || ok {
		t.Fatalf("con el primero mandando, otro intento la tomo: ok=%v err=%v", ok, err)
	}
	close(correo.soltar)
	if ok := <-primero; !ok {
		t.Fatal("el primer envio no quedo entregado")
	}
	if ok, err := svc.entregarUna(ctx, id, now.Add(time.Hour)); err != nil || ok {
		t.Fatalf("entregada, salio otra vez: ok=%v err=%v", ok, err)
	}
	if n := correo.cuantos(); n != 1 {
		t.Errorf("la respuesta salio %d veces", n)
	}
}

// Si el proceso que la reservo muere antes de mandarla, la reserva vence sola y
// el barrido la retoma.
func TestRespuesta_UnaReservaVencidaSeRetoma(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	pedir(t, nuevoServicio(pool, nil), a.ID)
	id := unaRespuesta(t, pool, a.ID).ID
	exec(t, pool, `UPDATE account_deletion_responses
		SET attempts = 1, next_attempt_at = NOW() + interval '2 minutes' WHERE id = $1::uuid`, id)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	if n, err := svc.EntregarRespuestas(ctx, time.Now(), 100); err != nil || n != 0 {
		t.Fatalf("todavia reservada: n=%d err=%v", n, err)
	}
	nadaMas(t, correo.ch)
	if n, err := svc.EntregarRespuestas(ctx, time.Now().Add(3*time.Minute), 100); err != nil || n != 1 {
		t.Fatalf("vencida la reserva: n=%d err=%v", n, err)
	}
	esperar(t, correo.ch)
	if r := unaRespuesta(t, pool, a.ID); !r.Entregada || r.Intentos != 2 {
		t.Errorf("tras retomarla: %+v", r)
	}
}

// La respuesta va en la transaccion del dia 0: se ve adentro antes del commit,
// y un rollback no deja ninguna.
func TestRespuesta_VaEnLaMismaTransaccion(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	ctx := context.Background()

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := iniciarEnTx(ctx, tx, a.ID, opciones{canal: CanalApp}); err != nil {
		t.Fatal(err)
	}
	var dentro int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM account_deletion_responses WHERE user_id = $1::uuid`, a.ID).Scan(&dentro); err != nil {
		t.Fatal(err)
	}
	if dentro != 1 {
		t.Fatalf("dentro de la transaccion del dia 0 hay %d respuestas, se esperaba 1", dentro)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if rs := respuestasDe(t, pool, a.ID); len(rs) != 0 {
		t.Errorf("deshecho el dia 0, quedo la respuesta: %+v", rs)
	}
}

// El fallo del proveedor va al log sin la direccion, aunque el proveedor la
// devuelva con otras mayusculas.
func TestRespuesta_ElLogNoLlevaElCorreo(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	exec(t, pool, `UPDATE users SET email_enc = fn_pii_encrypt('Persona.Mixta@Ejemplo.TEST') WHERE id = $1::uuid`, a.ID)
	pedir(t, nuevoServicio(pool, nil), a.ID)
	var log bufferSeguro
	svc := nuevoServicio(pool, &Options{Email: correoQueRebota{}, Logger: slog.New(slog.NewTextHandler(&log, nil))})

	if _, err := svc.EntregarRespuestas(context.Background(), time.Now(), 100); err != nil {
		t.Fatal(err)
	}
	texto := log.String()
	if !strings.Contains(texto, "respuesta escrita no enviada") {
		t.Fatalf("el fallo no quedo en el log: %q", texto)
	}
	if strings.Contains(strings.ToLower(texto), "persona.mixta@ejemplo.test") {
		t.Errorf("el log lleva la direccion: %q", texto)
	}
}

// Empezar el plazo deja sin efecto la respuesta de una solicitud anterior que
// habia quedado bloqueada: ya no hay nada que resolver, y operaciones no debe
// decirle a la persona que no se borro nada.
func TestRespuesta_EmpezarElPlazoCancelaLaDeBloqueada(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	bloqueada := cuenta1[string](t, pool, `
		INSERT INTO account_deletion_responses (user_id, kind, blockers, respond_by, attempts, last_error, escalated_at)
		VALUES ($1::uuid, 'blocked', ARRAY['BALANCE_POSITIVE'], NOW() + interval '5 days', 1, 'no_channel', NOW())
		RETURNING id::text`, a.ID)
	svc := nuevoServicio(pool, nil)

	pedir(t, svc, a.ID)
	for _, r := range respuestasDe(t, pool, a.ID) {
		if r.ID == bloqueada && !r.Cancelada {
			t.Errorf("empezado el plazo, la respuesta de la solicitud bloqueada sigue pendiente: %+v", r)
		}
		if r.Tipo == RespuestaPlazoIniciado && r.Cancelada {
			t.Errorf("se cancelo la respuesta del plazo: %+v", r)
		}
	}
	lista, err := svc.RespuestasSinEntregar(context.Background(), 50)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range lista {
		if p.ID == bloqueada {
			t.Errorf("el panel sigue pidiendo la respuesta de la solicitud bloqueada: %+v", p)
		}
	}
}

// La respuesta pendiente de una cuenta que ya se cerro: el panel la muestra con
// el id de la cuenta (la tarjeta enmascarada ya no existe), y el barrido deja
// de reintentarla, porque ya no habra a donde mandarla.
func TestRespuesta_LaDeUnaCuentaCerradaSeAtiendeYNoSeReintenta(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	sinCorreo(t, pool, a.ID)
	svc := nuevoServicio(pool, &Options{Email: nuevoCorreo()})
	ctx := context.Background()
	pedir(t, svc, a.ID)
	if _, err := svc.EntregarRespuestas(ctx, time.Now(), 100); err != nil {
		t.Fatal(err)
	}
	cerrar(t, pool, svc, a.ID)
	antes := unaRespuesta(t, pool, a.ID).Intentos

	for _, h := range []int{7, 13, 48} {
		if _, err := svc.EntregarRespuestas(ctx, time.Now().Add(time.Duration(h)*time.Hour), 100); err != nil {
			t.Fatal(err)
		}
	}
	if despues := unaRespuesta(t, pool, a.ID).Intentos; despues > antes+1 {
		t.Errorf("la respuesta de una cuenta cerrada se sigue reintentando: %d intentos, %d al cerrar", despues, antes)
	}

	lista, err := svc.RespuestasSinEntregar(ctx, 50)
	if err != nil {
		t.Fatal(err)
	}
	var p *RespuestaPendiente
	for i := range lista {
		if lista[i].UserID == a.ID {
			p = &lista[i]
		}
	}
	if p == nil {
		t.Fatalf("el panel no la muestra con el id de la cuenta: %+v", lista)
	}
	if !p.CuentaCerrada || p.Cuenta != nil {
		t.Errorf("debe decir que la cuenta se cerro: %+v", p)
	}
}

// La nota de operaciones no se corta en silencio, y la auditoria dice cual
// respuesta se marco.
func TestRespuesta_MarcarEntregadaNotaLargaYAuditoria(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	sinCorreo(t, pool, a.ID)
	svc := nuevoServicio(pool, nil)
	ctx := context.Background()
	pedir(t, svc, a.ID)
	if _, err := svc.EntregarRespuestas(ctx, time.Now(), 100); err != nil {
		t.Fatal(err)
	}
	id := unaRespuesta(t, pool, a.ID).ID
	admin := administrador(t, pool)

	larga := strings.Repeat("á", maxNota+1)
	if err := svc.MarcarRespuestaEntregada(ctx, id, admin.ID, larga); !errors.Is(err, ErrNotaLarga) {
		t.Errorf("una nota de %d caracteres: %v", maxNota+1, err)
	}
	if r := unaRespuesta(t, pool, a.ID); r.Entregada {
		t.Fatalf("con la nota rechazada quedo entregada: %+v", r)
	}
	srv := router(NewHandler(svc, nil), admin.ID)
	ruta := "/admin/account-deletion-responses/" + id + "/delivered"
	if rec, env := llamar(t, srv, "POST", ruta, `{"note":"`+strings.Repeat("a", maxNota+1)+`"}`); rec.Code != 400 || env.Error == nil || env.Error.Code != "NOTE_TOO_LONG" {
		t.Errorf("nota larga por HTTP: %d %s", rec.Code, rec.Body.String())
	}

	if err := svc.MarcarRespuestaEntregada(ctx, id, admin.ID, strings.Repeat("á", maxNota)); err != nil {
		t.Fatalf("una nota del largo justo: %v", err)
	}
	if got := cuenta1[string](t, pool, `SELECT COALESCE(details->>'response', '') FROM audit_logs
		WHERE user_id = $1::uuid AND action = 'account_deletion_response_delivered'`, a.ID); got != id {
		t.Errorf("la auditoria no dice cual respuesta se marco: %q, se esperaba %q", got, id)
	}
}
