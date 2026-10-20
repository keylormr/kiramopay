package accountdeletion

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/testutil"
)

type mensaje struct{ Para, Texto string }

type correoFalso struct{ ch chan mensaje }

func nuevoCorreo() *correoFalso { return &correoFalso{ch: make(chan mensaje, 8)} }
func (c *correoFalso) SendEmail(_ context.Context, to, _, text, _ string) error {
	c.ch <- mensaje{Para: to, Texto: text}
	return nil
}

type smsFalso struct{ ch chan mensaje }

func nuevoSMS() *smsFalso { return &smsFalso{ch: make(chan mensaje, 8)} }
func (s *smsFalso) SendSMS(_ context.Context, to, body string) error {
	s.ch <- mensaje{Para: to, Texto: body}
	return nil
}

var seisDigitos = regexp.MustCompile(`\b\d{6}\b`)

// esperar devuelve el siguiente mensaje o falla: el envio va en una goroutine.
func esperar(t *testing.T, ch chan mensaje) mensaje {
	t.Helper()
	select {
	case m := <-ch:
		return m
	case <-time.After(5 * time.Second):
		t.Fatal("no llego ningun mensaje")
		return mensaje{}
	}
}

// nadaMas verifica que NO llega nada: se espera un poco, porque un envio
// indebido tambien iria por la goroutine.
func nadaMas(t *testing.T, ch chan mensaje) {
	t.Helper()
	select {
	case m := <-ch:
		t.Fatalf("llego un mensaje que no debia: %+v", m)
	case <-time.After(400 * time.Millisecond):
	}
}

func codigoDe(t *testing.T, m mensaje) string {
	t.Helper()
	c := seisDigitos.FindString(m.Texto)
	if c == "" {
		t.Fatalf("el mensaje no trae un codigo de 6 digitos: %q", m.Texto)
	}
	return c
}

func estadoDe(t *testing.T, pool *pgxpool.Pool, contacto string) (estado string, hashGuardado *string, intentos int) {
	t.Helper()
	if err := pool.QueryRow(context.Background(), `
		SELECT status, verification_hash, verification_attempts FROM account_deletion_requests
		 WHERE contact_hash = fn_pii_hmac($1) ORDER BY created_at DESC LIMIT 1`, contacto,
	).Scan(&estado, &hashGuardado, &intentos); err != nil {
		t.Fatalf("estado de la solicitud: %v", err)
	}
	return
}

func TestSolicitar_GuardaSoloHashesYManda_ElCodigoAlCorreo(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})

	if err := svc.Solicitar(context.Background(), a.Correo, true); err != nil {
		t.Fatalf("solicitar: %v", err)
	}
	msg := esperar(t, correo.ch)
	if msg.Para != a.Correo {
		t.Errorf("el codigo fue a %q, se esperaba %q", msg.Para, a.Correo)
	}
	codigo := codigoDe(t, msg)

	estado, guardado, _ := estadoDe(t, pool, a.Correo)
	if estado != "pending_verification" || guardado == nil || *guardado != hashCodigo(codigo) {
		t.Errorf("estado=%s hash=%v", estado, guardado)
	}
	// Nada legible: ni el correo, ni el codigo, ni la IP en ninguna columna.
	fila := cuenta1[string](t, pool, `SELECT row_to_json(r)::text FROM account_deletion_requests r LIMIT 1`)
	for _, secreto := range []string{a.Correo, a.Telefono, a.Cedula, codigo, "persona"} {
		if strings.Contains(fila, secreto) {
			t.Errorf("la fila de la solicitud contiene %q: %s", secreto, fila)
		}
	}
}

// Exista o no la cuenta, la respuesta es la misma y no sale ningun mensaje; el
// codigo es lo unico que distingue, y solo lo recibe el dueno.
func TestSolicitar_NoDelataSiLaCuentaExiste(t *testing.T) {
	pool := testutil.TestDB(t)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	if err := svc.Solicitar(ctx, "nadie@ejemplo.test", true); err != nil {
		t.Fatalf("una cuenta inexistente debe responder igual que una real: %v", err)
	}
	nadaMas(t, correo.ch)
	_, guardado, _ := estadoDe(t, pool, "nadie@ejemplo.test")
	if guardado != nil {
		t.Error("una solicitud sin cuenta no debe tener codigo")
	}
	if err := svc.Verificar(ctx, "nadie@ejemplo.test", "123456"); !errors.Is(err, ErrCodigoInvalido) {
		t.Errorf("verificar sin cuenta: %v", err)
	}
}

func TestSolicitar_SoloAceptaCorreoOTelefono(t *testing.T) {
	pool := testutil.TestDB(t)
	svc := nuevoServicio(pool, nil)
	for _, malo := range []string{"", "abc", "702650930", "kiramo.usuario", "   "} {
		if err := svc.Solicitar(context.Background(), malo, true); !errors.Is(err, ErrContactoInvalido) {
			t.Errorf("%q debia ser contacto invalido, salio %v", malo, err)
		}
	}
}

func TestVerificar_CincoFallosAgotanElCodigo(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	codigo := codigoDe(t, esperar(t, correo.ch))

	for i := 0; i < maxIntentosCodigo; i++ {
		if err := svc.Verificar(ctx, a.Correo, "000000"); !errors.Is(err, ErrCodigoInvalido) {
			t.Fatalf("intento %d: %v", i, err)
		}
	}
	if _, _, n := estadoDe(t, pool, a.Correo); n != maxIntentosCodigo {
		t.Errorf("los intentos fallidos no se guardaron: %d", n)
	}
	// Agotado: ni el codigo correcto sirve.
	if err := svc.Verificar(ctx, a.Correo, codigo); !errors.Is(err, ErrCodigoInvalido) {
		t.Fatalf("el codigo correcto no debia servir tras agotar los intentos: %v", err)
	}
}

// El codigo correcto es la solicitud: prueba que la persona controla el contacto
// y ese mismo momento es el dia 0, como en la app. La persona recibe la
// respuesta escrita.
func TestVerificar_CodigoCorrectoIniciaElPlazo(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	codigo := codigoDe(t, esperar(t, correo.ch))
	if err := svc.Verificar(ctx, a.Correo, codigo); err != nil {
		t.Fatalf("verificar: %v", err)
	}
	estado, guardado, _ := estadoDe(t, pool, a.Correo)
	if estado != "scheduled" || guardado != nil {
		t.Errorf("estado=%s hash=%v; debia quedar con el plazo iniciado y sin el hash del codigo", estado, guardado)
	}
	var status, canal string
	if err := pool.QueryRow(ctx, `SELECT status, deletion_channel FROM users WHERE id = $1::uuid`, a.ID).Scan(&status, &canal); err != nil {
		t.Fatal(err)
	}
	if status != "pending_deletion" || canal != "web" {
		t.Errorf("la cuenta quedo en status=%s canal=%s", status, canal)
	}
	if m := esperar(t, correo.ch); m.Para != a.Correo || !strings.Contains(m.Texto, "PRODHAB") {
		t.Errorf("la respuesta escrita no llego como se esperaba: %+v", m)
	}
	// Un codigo no se usa dos veces.
	if err := svc.Verificar(ctx, a.Correo, codigo); !errors.Is(err, ErrCodigoInvalido) {
		t.Errorf("reusar el codigo: %v", err)
	}
}

// Sin la aceptacion expresa del plazo no se registra nada ni se manda codigo.
func TestSolicitar_ExigeAceptarElPlazo(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	if err := svc.Solicitar(context.Background(), a.Correo, false); !errors.Is(err, ErrPlazoNoAceptado) {
		t.Fatalf("se esperaba ErrPlazoNoAceptado, salio %v", err)
	}
	nadaMas(t, correo.ch)
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM account_deletion_requests`); n != 0 {
		t.Errorf("se guardaron %d solicitudes sin aceptar el plazo", n)
	}
}

// Con algo pendiente (saldo) la solicitud queda bloqueada, la cuenta no cambia y
// la persona recibe, en su correo, lo que tiene que resolver. Sin esto la
// solicitud moriria en silencio.
func TestVerificar_ConSaldoQuedaBloqueadaYSeLeEscribe(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()
	fondear(t, pool, a.ID, 500)

	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	if err := svc.Verificar(ctx, a.Correo, codigoDe(t, esperar(t, correo.ch))); err != nil {
		t.Fatalf("un bloqueo no es un error de la verificacion: %v", err)
	}
	if estado, _, _ := estadoDe(t, pool, a.Correo); estado != "blocked" {
		t.Errorf("la solicitud quedo en %s", estado)
	}
	if cuenta1[string](t, pool, `SELECT result_code FROM account_deletion_requests WHERE user_id = $1::uuid`, a.ID) != BloqueoSaldo {
		t.Error("el motivo no quedo en la solicitud")
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "active" {
		t.Fatalf("una cuenta con saldo quedo en %s", st)
	}
	aviso := esperar(t, correo.ch)
	if aviso.Para != a.Correo || !strings.Contains(aviso.Texto, "saldo en tu billetera") || !strings.Contains(aviso.Texto, "No se borró nada") {
		t.Errorf("aviso inesperado: %+v", aviso)
	}
}

func TestVerificar_UnCodigoVencidoNoSirve(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	codigo := codigoDe(t, esperar(t, correo.ch))
	exec(t, pool, `UPDATE account_deletion_requests SET verification_expires_at = NOW() - interval '1 second'`)
	if err := svc.Verificar(ctx, a.Correo, codigo); !errors.Is(err, ErrCodigoInvalido) {
		t.Fatalf("un codigo vencido no debia servir: %v", err)
	}
}

// Pedir de nuevo no inunda: dentro del minuto no cambia el codigo ni manda otro.
func TestSolicitar_NoReenviaDentroDelMinuto(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	esperar(t, correo.ch)
	_, antes, _ := estadoDe(t, pool, a.Correo)

	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	nadaMas(t, correo.ch)
	if _, despues, _ := estadoDe(t, pool, a.Correo); *despues != *antes {
		t.Error("el segundo pedido cambio el codigo dentro del minuto")
	}

	// Pasado el minuto SI se renueva.
	exec(t, pool, `UPDATE account_deletion_requests SET verification_expires_at = NOW() + interval '10 minutes'`)
	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	esperar(t, correo.ch)
}

// Una solicitud que espera a operaciones no se reabre por mas que alguien vuelva
// a pedirla: quien conozca el correo no puede sacarla de la cola.
func TestSolicitar_NoReabreUnaSolicitudEnLaCola(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	bloquearCuenta(t, pool, a.ID)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	if err := svc.Verificar(ctx, a.Correo, codigoDe(t, esperar(t, correo.ch))); err != nil {
		t.Fatal(err)
	}
	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	nadaMas(t, correo.ch)
	if estado, _, _ := estadoDe(t, pool, a.Correo); estado != "verified" {
		t.Errorf("la solicitud verificada quedo en %s", estado)
	}
}

func TestSolicitar_PorTelefonoUsaSMSSiHay_Y_SiNoElCorreoDeLaCuenta(t *testing.T) {
	ctx := context.Background()

	t.Run("con SMS", func(t *testing.T) {
		pool := testutil.TestDB(t)
		a := sembrar(t, pool)
		sms, correo := nuevoSMS(), nuevoCorreo()
		svc := nuevoServicio(pool, &Options{SMS: sms, Email: correo})
		if err := svc.Solicitar(ctx, a.Telefono, true); err != nil {
			t.Fatal(err)
		}
		m := esperar(t, sms.ch)
		if m.Para != a.Telefono {
			t.Errorf("SMS a %q", m.Para)
		}
		codigoDe(t, m)
		nadaMas(t, correo.ch)
	})
	t.Run("sin SMS va al correo de la cuenta", func(t *testing.T) {
		pool := testutil.TestDB(t)
		a := sembrar(t, pool)
		correo := nuevoCorreo()
		svc := nuevoServicio(pool, &Options{Email: correo})
		if err := svc.Solicitar(ctx, a.Telefono, true); err != nil {
			t.Fatal(err)
		}
		if m := esperar(t, correo.ch); m.Para != a.Correo {
			t.Errorf("el codigo fue a %q, se esperaba el correo de la cuenta %q", m.Para, a.Correo)
		}
	})
}

// ── La cola de operaciones: cuentas bajo revision ─────────────────────────

// bloquearCuenta deja la cuenta como la deja un bloqueo de operaciones.
func bloquearCuenta(t *testing.T, pool *pgxpool.Pool, userID string) {
	t.Helper()
	exec(t, pool, `UPDATE users SET status = 'blocked', blocked_at = NOW(), blocked_reason = 'revision de fraude' WHERE id = $1::uuid`, userID)
}

// solicitudEnLaCola deja una solicitud verificada de una cuenta bloqueada, que es
// la unica que espera a una persona.
func solicitudEnLaCola(t *testing.T, pool *pgxpool.Pool, svc *Service, correo *correoFalso, a cuenta) string {
	t.Helper()
	ctx := context.Background()
	bloquearCuenta(t, pool, a.ID)
	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	if err := svc.Verificar(ctx, a.Correo, codigoDe(t, esperar(t, correo.ch))); err != nil {
		t.Fatal(err)
	}
	if estado, _, _ := estadoDe(t, pool, a.Correo); estado != "verified" {
		t.Fatalf("una cuenta bloqueada debia quedar en la cola, quedo en %s", estado)
	}
	return cuenta1[string](t, pool, `SELECT id::text FROM account_deletion_requests WHERE user_id = $1::uuid`, a.ID)
}

// Una cuenta bajo revision no inicia el plazo sola: la atiende una persona, y al
// atenderla el plazo empieza SIN desbloquear la cuenta.
func TestProcesar_UnaCuentaBajoRevisionIniciaElPlazoSinDesbloquearse(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a, admin := sembrar(t, pool), sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	id := solicitudEnLaCola(t, pool, svc, correo, a)

	// La cola la muestra con la cuenta ENMASCARADA.
	cola, err := svc.ListarVerificadas(ctx, 10)
	if err != nil || len(cola) != 1 || cola[0].Cuenta == nil {
		t.Fatalf("cola: %+v %v", cola, err)
	}
	if !strings.Contains(cola[0].Cuenta.CedulaMasked, "•") || strings.Contains(cola[0].Cuenta.CedulaMasked, a.Cedula) {
		t.Errorf("la cedula no sale enmascarada: %q", cola[0].Cuenta.CedulaMasked)
	}

	res, err := svc.Procesar(ctx, id, admin.ID)
	if err != nil || res.Estado != "scheduled" {
		t.Fatalf("procesar: %+v %v", res, err)
	}
	var status, canal string
	var conPlazo bool
	if err := pool.QueryRow(ctx, `SELECT status, deletion_channel, deletion_due_at IS NOT NULL FROM users WHERE id = $1::uuid`, a.ID).
		Scan(&status, &canal, &conPlazo); err != nil {
		t.Fatal(err)
	}
	if status != "blocked" || canal != "web" || !conPlazo {
		t.Errorf("status=%s canal=%s con plazo=%v", status, canal, conPlazo)
	}
	if cuenta1[string](t, pool, `SELECT processed_by::text FROM account_deletion_requests WHERE id = $1::uuid`, id) != admin.ID {
		t.Error("no quedo quien la atendio")
	}
	// El administrador queda en la auditoria como actor.
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM audit_logs WHERE user_id = $1::uuid AND action = 'account_deletion_requested' AND details->>'actor' = $2`, a.ID, admin.ID); n != 1 {
		t.Errorf("el actor no quedo en la auditoria: %d", n)
	}
	// La persona recibe la respuesta escrita.
	if m := esperar(t, correo.ch); m.Para != a.Correo || !strings.Contains(m.Texto, "PRODHAB") {
		t.Errorf("respuesta inesperada: %+v", m)
	}
	// Ya atendida: otra vez no.
	if _, err := svc.Procesar(ctx, id, admin.ID); !errors.Is(err, ErrSolicitudNoPendiente) {
		t.Errorf("atender dos veces: %v", err)
	}
}

func TestProcesar_ConSaldoQuedaBloqueadaYNoSeToca(t *testing.T) {
	pool := testutil.TestDB(t)
	a, admin := sembrar(t, pool), sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	fondear(t, pool, a.ID, 500)
	id := solicitudEnLaCola(t, pool, svc, correo, a)

	res, err := svc.Procesar(context.Background(), id, admin.ID)
	if err != nil {
		t.Fatalf("un bloqueo no es un error del servicio: %v", err)
	}
	if res.Estado != "blocked" || res.Codigo != BloqueoSaldo || len(res.Bloqueos) == 0 {
		t.Fatalf("resultado %+v", res)
	}
	if cuenta1[bool](t, pool, `SELECT deletion_requested_at IS NOT NULL FROM users WHERE id = $1::uuid`, a.ID) {
		t.Fatal("se inicio el plazo de una cuenta con saldo")
	}
	if cuenta1[string](t, pool, `SELECT result_code FROM account_deletion_requests WHERE id = $1::uuid`, id) != BloqueoSaldo {
		t.Error("el motivo no quedo en la solicitud")
	}
	aviso := esperar(t, correo.ch)
	if aviso.Para != a.Correo || !strings.Contains(aviso.Texto, "saldo en tu billetera") {
		t.Errorf("aviso inesperado: %+v", aviso)
	}
}

func TestProcesar_SolicitudSinCuentaSeRechaza(t *testing.T) {
	pool := testutil.TestDB(t)
	admin := sembrar(t, pool)
	exec(t, pool, `INSERT INTO account_deletion_requests (id, contact_kind, contact_hash, status, verified_at, terms_accepted_at)
		VALUES ('d0000000-0000-4000-8000-000000000001', 'email', 'x', 'verified', NOW(), NOW())`)
	res, err := nuevoServicio(pool, nil).Procesar(context.Background(), "d0000000-0000-4000-8000-000000000001", admin.ID)
	if err != nil || res.Estado != "rejected" || res.Codigo != "NO_ACCOUNT" {
		t.Fatalf("%+v %v", res, err)
	}
}

func TestProcesar_NoExiste(t *testing.T) {
	pool := testutil.TestDB(t)
	admin := sembrar(t, pool)
	_, err := nuevoServicio(pool, nil).Procesar(context.Background(), "d0000000-0000-4000-8000-0000000000ff", admin.ID)
	if !errors.Is(err, ErrSolicitudNoEncontrada) {
		t.Fatalf("salio %v", err)
	}
}

func TestRechazar_CierraSinIniciarNada(t *testing.T) {
	pool := testutil.TestDB(t)
	a, admin := sembrar(t, pool), sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	id := solicitudEnLaCola(t, pool, svc, correo, a)

	if err := svc.Rechazar(context.Background(), id, admin.ID); err != nil {
		t.Fatal(err)
	}
	if cuenta1[bool](t, pool, `SELECT deletion_requested_at IS NOT NULL FROM users WHERE id = $1::uuid`, a.ID) {
		t.Fatal("rechazar no debe iniciar el plazo")
	}
	if err := svc.Rechazar(context.Background(), id, admin.ID); !errors.Is(err, ErrSolicitudNoPendiente) {
		t.Errorf("rechazar dos veces: %v", err)
	}
}

// Reactivar cancela tambien la solicitud web que inicio el plazo, para que la
// historia de la solicitud diga lo que paso.
func TestReactivar_CancelaLaSolicitudWeb(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	if err := svc.Verificar(ctx, a.Correo, codigoDe(t, esperar(t, correo.ch))); err != nil {
		t.Fatal(err)
	}
	if ok, err := svc.Reactivar(ctx, a.ID); err != nil || !ok {
		t.Fatalf("reactivar: ok=%v err=%v", ok, err)
	}
	if estado, _, _ := estadoDe(t, pool, a.Correo); estado != "cancelled" {
		t.Errorf("la solicitud web quedo en %s tras reactivar", estado)
	}
}
