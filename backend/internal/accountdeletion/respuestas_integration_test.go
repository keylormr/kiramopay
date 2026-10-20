package accountdeletion

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/testutil"
)

// La respuesta escrita del dia 0 (Ley 8968 art. 7, Reglamento arts. 18 y 22) ya
// no es de mejor esfuerzo: queda en una bandeja en la misma transaccion de la
// solicitud, el barrido la reintenta hasta entregarla, y la que no puede salir
// pasa a operaciones. Decision del dueno del 2026-10-20.

// correoQueFalla rechaza los primeros envios, como un proveedor caido, y
// despues entrega. El error trae la direccion, como un rebote de SMTP real: la
// bandeja no la puede guardar.
type correoQueFalla struct {
	mu     sync.Mutex
	fallas int
	ch     chan mensaje
}

func nuevoCorreoQueFalla(fallas int) *correoQueFalla {
	return &correoQueFalla{fallas: fallas, ch: make(chan mensaje, 8)}
}

func (c *correoQueFalla) SendEmail(_ context.Context, to, _, text, _ string) error {
	c.mu.Lock()
	if c.fallas > 0 {
		c.fallas--
		c.mu.Unlock()
		return errors.New("550 5.1.1 <" + to + ">: proveedor caido")
	}
	c.mu.Unlock()
	c.ch <- mensaje{Para: to, Texto: text}
	return nil
}

// arreglar: el proveedor vuelve.
func (c *correoQueFalla) arreglar() {
	c.mu.Lock()
	c.fallas = 0
	c.mu.Unlock()
}

// filaRespuesta es una fila de la bandeja, leida tal cual.
type filaRespuesta struct {
	ID          string
	Tipo        string
	Intentos    int
	Error       *string
	Escalada    bool
	Entregada   bool
	Via         *string
	Por         *string
	Cancelada   bool
	ConCorreo   bool
	SeEliminaEl *time.Time
	Bloqueos    []string
	Nota        *string
}

func leerRespuestas(ctx context.Context, pool *pgxpool.Pool, userID string) ([]filaRespuesta, error) {
	filas, err := pool.Query(ctx, `
		SELECT id::text, kind, attempts, last_error, escalated_at IS NOT NULL, delivered_at IS NOT NULL,
		       delivered_via, delivered_by::text, cancelled_at IS NOT NULL, email_enc IS NOT NULL,
		       deletion_due_at, blockers, delivery_note
		  FROM account_deletion_responses
		 WHERE user_id = $1::uuid
		 ORDER BY created_at, id`, userID)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	var out []filaRespuesta
	for filas.Next() {
		var r filaRespuesta
		if err := filas.Scan(&r.ID, &r.Tipo, &r.Intentos, &r.Error, &r.Escalada, &r.Entregada,
			&r.Via, &r.Por, &r.Cancelada, &r.ConCorreo, &r.SeEliminaEl, &r.Bloqueos, &r.Nota); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, filas.Err()
}

func respuestasDe(t *testing.T, pool *pgxpool.Pool, userID string) []filaRespuesta {
	t.Helper()
	rs, err := leerRespuestas(context.Background(), pool, userID)
	if err != nil {
		t.Fatalf("leer la bandeja: %v", err)
	}
	return rs
}

// unaRespuesta exige que la persona tenga exactamente una respuesta.
func unaRespuesta(t *testing.T, pool *pgxpool.Pool, userID string) filaRespuesta {
	t.Helper()
	rs := respuestasDe(t, pool, userID)
	if len(rs) != 1 {
		t.Fatalf("la bandeja tiene %d respuestas de la persona, se esperaba 1", len(rs))
	}
	return rs[0]
}

// esperarRespuesta espera a que la unica respuesta de la persona cumpla cond:
// el primer intento va en una goroutine despues del commit.
func esperarRespuesta(t *testing.T, pool *pgxpool.Pool, userID, que string, cond func(filaRespuesta) bool) filaRespuesta {
	t.Helper()
	limite := time.Now().Add(5 * time.Second)
	for {
		rs, err := leerRespuestas(context.Background(), pool, userID)
		if err == nil && len(rs) == 1 && cond(rs[0]) {
			return rs[0]
		}
		if time.Now().After(limite) {
			t.Fatalf("la respuesta nunca quedo %s: %+v (err=%v)", que, rs, err)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// sinCorreo deja la cuenta como las viejas que se registraron sin correo.
func sinCorreo(t *testing.T, pool *pgxpool.Pool, userID string) {
	t.Helper()
	exec(t, pool, `UPDATE users SET email_enc = NULL, email_hash = NULL WHERE id = $1::uuid`, userID)
}

func administrador(t *testing.T, pool *pgxpool.Pool) cuenta {
	t.Helper()
	a := sembrar(t, pool)
	exec(t, pool, `UPDATE users SET role = 'admin' WHERE id = $1::uuid`, a.ID)
	return a
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ── La bandeja ────────────────────────────────────────────────────────────

// La solicitud y su respuesta van juntas: si el dia 0 quedo escrito, la
// respuesta tambien, con el dia 30 que informa y el plazo legal para darla.
func TestRespuesta_ElDiaCeroLaDejaEnLaBandeja(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	svc := nuevoServicio(pool, nil)
	res := pedir(t, svc, a.ID)

	r := unaRespuesta(t, pool, a.ID)
	if r.Tipo != RespuestaPlazoIniciado || r.Entregada || r.Cancelada {
		t.Errorf("respuesta inesperada: %+v", r)
	}
	if r.SeEliminaEl == nil || !r.SeEliminaEl.Equal(res.SeEliminaEl) {
		t.Errorf("la respuesta informa el dia 30 %v, la cuenta dice %v", r.SeEliminaEl, res.SeEliminaEl)
	}
	// Cinco dias habiles: nunca menos de cinco dias naturales ni mas de ocho.
	plazo := cuenta1[time.Time](t, pool, `SELECT respond_by FROM account_deletion_responses WHERE id = $1::uuid`, r.ID)
	if d := time.Until(plazo); d < 5*24*time.Hour-time.Minute || d > 8*24*time.Hour {
		t.Errorf("el plazo para responder es %v desde ahora; deben ser cinco dias habiles", d)
	}
}

// El primer intento sale apenas se confirma, y la bandeja guarda la constancia.
func TestRespuesta_SaleYQuedaConstancia(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})

	if _, err := svc.EliminarMiCuenta(context.Background(), a.ID, Confirmacion{Password: claveDePrueba, AceptaPlazo: true}); err != nil {
		t.Fatal(err)
	}
	if m := esperar(t, correo.ch); m.Para != a.Correo || !strings.Contains(m.Texto, "PRODHAB") {
		t.Fatalf("la respuesta no llego: %+v", m)
	}
	r := esperarRespuesta(t, pool, a.ID, "entregada", func(r filaRespuesta) bool { return r.Entregada })
	if deref(r.Via) != "email" || r.Intentos != 1 || r.Error != nil || r.Escalada {
		t.Errorf("constancia inesperada: %+v", r)
	}
	nadaMas(t, correo.ch)
}

// Con el proveedor caido no se pierde: queda el fallo (sin la direccion) y el
// barrido la manda cuando le toca.
func TestRespuesta_SiElProveedorFallaSeReintenta(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreoQueFalla(1)
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	if _, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba, AceptaPlazo: true}); err != nil {
		t.Fatal(err)
	}
	r := esperarRespuesta(t, pool, a.ID, "con el primer intento fallido", func(r filaRespuesta) bool { return r.Intentos == 1 && r.Error != nil })
	if deref(r.Error) != MotivoEnvioFallido || r.Entregada || r.Escalada {
		t.Errorf("tras el primer fallo: %+v", r)
	}
	fila := cuenta1[string](t, pool, `SELECT row_to_json(r)::text FROM account_deletion_responses r WHERE user_id = $1::uuid`, a.ID)
	if strings.Contains(fila, a.Correo) {
		t.Errorf("la bandeja guardo la direccion que traia el error del proveedor: %s", fila)
	}

	// Todavia no le toca: el barrido no la manda otra vez enseguida.
	if n, err := svc.EntregarRespuestas(ctx, time.Now(), 100); err != nil || n != 0 {
		t.Fatalf("antes de su turno: n=%d err=%v", n, err)
	}
	if r := unaRespuesta(t, pool, a.ID); r.Intentos != 1 {
		t.Errorf("el barrido la intento antes de su turno: %+v", r)
	}

	// Le toca: sale.
	if n, err := svc.EntregarRespuestas(ctx, time.Now().Add(time.Hour), 100); err != nil || n != 1 {
		t.Fatalf("en su turno: n=%d err=%v", n, err)
	}
	if m := esperar(t, correo.ch); m.Para != a.Correo || !strings.Contains(m.Texto, "PRODHAB") {
		t.Errorf("la respuesta del reintento: %+v", m)
	}
	if r := unaRespuesta(t, pool, a.ID); !r.Entregada || r.Intentos != 2 || r.Error != nil {
		t.Errorf("tras el reintento: %+v", r)
	}
}

// Si el proceso cae entre el commit y el envio, la respuesta sigue en la
// bandeja y la manda el proceso que arranca despues.
func TestRespuesta_UnReinicioNoLaPierde(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	// pedir corre solo la transaccion del dia 0: nada de lo que va despues.
	pedir(t, nuevoServicio(pool, nil), a.ID)

	correo := nuevoCorreo()
	otro := nuevoServicio(pool, &Options{Email: correo})
	if n, err := otro.EntregarRespuestas(context.Background(), time.Now(), 100); err != nil || n != 1 {
		t.Fatalf("el proceso nuevo no la entrego: n=%d err=%v", n, err)
	}
	if m := esperar(t, correo.ch); m.Para != a.Correo {
		t.Errorf("la respuesta fue a %q", m.Para)
	}
	if r := unaRespuesta(t, pool, a.ID); !r.Entregada {
		t.Errorf("no quedo entregada: %+v", r)
	}
}

// Sin a donde mandarla, pasa a operaciones, que la entrega por otro medio y
// deja constancia de como.
func TestRespuesta_SinAQuienMandarlaPasaAOperaciones(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	sinCorreo(t, pool, a.ID)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()
	res := pedir(t, svc, a.ID)

	if n, err := svc.EntregarRespuestas(ctx, time.Now(), 100); err != nil || n != 0 {
		t.Fatalf("sin correo no hay entrega: n=%d err=%v", n, err)
	}
	nadaMas(t, correo.ch)
	r := unaRespuesta(t, pool, a.ID)
	if !r.Escalada || deref(r.Error) != MotivoSinCanal || r.Entregada {
		t.Fatalf("sin correo debia pasar a operaciones: %+v", r)
	}

	lista, err := svc.RespuestasSinEntregar(ctx, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(lista) != 1 || lista[0].ID != r.ID {
		t.Fatalf("el panel no la lista: %+v", lista)
	}
	p := lista[0]
	if p.Tipo != RespuestaPlazoIniciado || p.Motivo != MotivoSinCanal || p.Cuenta == nil {
		t.Errorf("fila del panel: %+v", p)
	}
	if p.SeEliminaEl == nil || !p.SeEliminaEl.Equal(res.SeEliminaEl) ||
		p.ConservaHasta == nil || !p.ConservaHasta.Equal(res.SeEliminaEl.AddDate(5, 0, 0)) {
		t.Errorf("el panel no trae lo que hay que decirle: %+v", p)
	}
	if p.ResponderAntesDe.Before(time.Now().Add(4 * 24 * time.Hour)) {
		t.Errorf("el panel no trae el plazo legal: %v", p.ResponderAntesDe)
	}

	admin := administrador(t, pool)
	if err := svc.MarcarRespuestaEntregada(ctx, r.ID, admin.ID, "   "); !errors.Is(err, ErrNotaRequerida) {
		t.Errorf("sin nota: %v", err)
	}
	if err := svc.MarcarRespuestaEntregada(ctx, r.ID, admin.ID, "Se la leimos por telefono el 20/10"); err != nil {
		t.Fatalf("marcarla entregada: %v", err)
	}
	r = unaRespuesta(t, pool, a.ID)
	if !r.Entregada || deref(r.Via) != "manual" || deref(r.Por) != admin.ID || deref(r.Nota) == "" {
		t.Errorf("constancia de la entrega a mano: %+v", r)
	}
	if lista, _ := svc.RespuestasSinEntregar(ctx, 50); len(lista) != 0 {
		t.Errorf("entregada, sigue en el panel: %+v", lista)
	}
	if n := cuenta1[int](t, pool, `SELECT COUNT(*) FROM audit_logs
		WHERE user_id = $1::uuid AND action = 'account_deletion_response_delivered'`, a.ID); n != 1 {
		t.Errorf("la entrega a mano no quedo en la auditoria (%d filas)", n)
	}

	if err := svc.MarcarRespuestaEntregada(ctx, r.ID, admin.ID, "otra vez"); !errors.Is(err, ErrRespuestaCerrada) {
		t.Errorf("marcarla dos veces: %v", err)
	}
	if err := svc.MarcarRespuestaEntregada(ctx, uuid.NewString(), admin.ID, "x"); !errors.Is(err, ErrRespuestaNoEncontrada) {
		t.Errorf("una que no existe: %v", err)
	}
}

// Con el proveedor caido, a las 48 horas pasa a operaciones, y sigue
// reintentando: si el proveedor vuelve, sale sola y deja el panel.
func TestRespuesta_A48HorasSinSalirPasaAOperaciones(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreoQueFalla(100)
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()
	pedir(t, svc, a.ID)

	if _, err := svc.EntregarRespuestas(ctx, time.Now(), 100); err != nil {
		t.Fatal(err)
	}
	if r := unaRespuesta(t, pool, a.ID); r.Intentos != 1 || deref(r.Error) != MotivoEnvioFallido || r.Escalada {
		t.Fatalf("recien pedida, un fallo no la pasa a operaciones: %+v", r)
	}

	exec(t, pool, `UPDATE account_deletion_responses SET created_at = created_at - interval '49 hours' WHERE user_id = $1::uuid`, a.ID)
	if _, err := svc.EntregarRespuestas(ctx, time.Now().Add(7*time.Hour), 100); err != nil {
		t.Fatal(err)
	}
	r := unaRespuesta(t, pool, a.ID)
	if r.Intentos != 2 || !r.Escalada || r.Entregada {
		t.Fatalf("a las 48 horas sin salir debia pasar a operaciones: %+v", r)
	}
	if lista, _ := svc.RespuestasSinEntregar(ctx, 50); len(lista) != 1 || lista[0].Motivo != MotivoEnvioFallido {
		t.Errorf("el panel: %+v", lista)
	}

	correo.arreglar()
	if n, err := svc.EntregarRespuestas(ctx, time.Now().Add(14*time.Hour), 100); err != nil || n != 1 {
		t.Fatalf("con el proveedor de vuelta: n=%d err=%v", n, err)
	}
	if m := esperar(t, correo.ch); m.Para != a.Correo {
		t.Errorf("fue a %q", m.Para)
	}
	if r := unaRespuesta(t, pool, a.ID); !r.Entregada || deref(r.Via) != "email" {
		t.Errorf("no quedo entregada: %+v", r)
	}
	if lista, _ := svc.RespuestasSinEntregar(ctx, 50); len(lista) != 0 {
		t.Errorf("entregada, sigue en el panel: %+v", lista)
	}
}

// ── La cuenta sin correo ──────────────────────────────────────────────────

// Una cuenta sin correo da uno solo para la respuesta. No queda en el perfil, y
// en la bandeja se borra al entregarla.
func TestRespuesta_UnaCuentaSinCorreoDaUnoParaLaRespuesta(t *testing.T) {
	pool := testutil.TestDB(t)
	a, b := sembrar(t, pool), sembrar(t, pool)
	sinCorreo(t, pool, a.ID)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	if pf, err := svc.Preflight(ctx, a.ID); err != nil || !pf.RequiereCorreoParaRespuesta {
		t.Errorf("sin correo, la revision previa debe pedirlo: %+v %v", pf, err)
	}
	if pf, err := svc.Preflight(ctx, b.ID); err != nil || pf.RequiereCorreoParaRespuesta {
		t.Errorf("con correo, la revision previa no lo pide: %+v %v", pf, err)
	}

	pedido := Confirmacion{Password: claveDePrueba, AceptaPlazo: true}
	if _, err := svc.EliminarMiCuenta(ctx, a.ID, pedido); !errors.Is(err, ErrCorreoParaRespuesta) {
		t.Errorf("sin correo para la respuesta: %v", err)
	}
	pedido.CorreoParaRespuesta = "no-es-un-correo"
	if _, err := svc.EliminarMiCuenta(ctx, a.ID, pedido); !errors.Is(err, ErrCorreoParaRespuestaInvalido) {
		t.Errorf("con un correo invalido: %v", err)
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "active" {
		t.Fatalf("sin a donde responder, la solicitud no debia empezar: %s", st)
	}

	pedido.CorreoParaRespuesta = "  respuesta@ejemplo.test "
	pedido.ConfirmacionCorreo = "respuesta@ejemplo.test"
	res, err := svc.EliminarMiCuenta(ctx, a.ID, pedido)
	if err != nil {
		t.Fatalf("con el correo para la respuesta: %v", err)
	}
	m := esperar(t, correo.ch)
	if m.Para != "respuesta@ejemplo.test" || !strings.Contains(m.Texto, res.SeEliminaEl.In(zonaDePrueba).Format("02/01/2006")) {
		t.Errorf("la respuesta: %+v", m)
	}
	r := esperarRespuesta(t, pool, a.ID, "entregada", func(r filaRespuesta) bool { return r.Entregada })
	if r.ConCorreo {
		t.Error("entregada, la bandeja conserva el correo que se dio para ella")
	}
	if cuenta1[bool](t, pool, `SELECT email_enc IS NOT NULL FROM users WHERE id = $1::uuid`, a.ID) {
		t.Error("el correo para la respuesta quedo en el perfil")
	}
}

// Reactivar antes de que salga la cancela, y se lleva el correo que se dio.
func TestRespuesta_ReactivarCancelaLaQueNoSalio(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	sinCorreo(t, pool, a.ID)
	correo := nuevoCorreoQueFalla(100)
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	if _, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{
		Password: claveDePrueba, AceptaPlazo: true, CorreoParaRespuesta: "respuesta@ejemplo.test", ConfirmacionCorreo: "respuesta@ejemplo.test",
	}); err != nil {
		t.Fatal(err)
	}
	esperarRespuesta(t, pool, a.ID, "con el primer intento", func(r filaRespuesta) bool { return r.Intentos == 1 })
	if ok, err := svc.Reactivar(ctx, a.ID); err != nil || !ok {
		t.Fatalf("reactivar: ok=%v err=%v", ok, err)
	}
	r := unaRespuesta(t, pool, a.ID)
	if !r.Cancelada || r.Entregada || r.ConCorreo {
		t.Errorf("reactivada, la respuesta debia quedar cancelada y sin el correo: %+v", r)
	}
	correo.arreglar()
	if n, err := svc.EntregarRespuestas(ctx, time.Now().Add(time.Hour), 100); err != nil || n != 0 {
		t.Errorf("una respuesta cancelada salio: n=%d err=%v", n, err)
	}
	nadaMas(t, correo.ch)
}

// El dia 30 se borra el correo que se dio y la fila queda (es la constancia);
// al desasociar se vacia la nota de operaciones.
func TestRespuesta_DiaTreintaYDesasociacion(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	sinCorreo(t, pool, a.ID)
	svc := nuevoServicio(pool, &Options{Email: nuevoCorreoQueFalla(100)})
	ctx := context.Background()

	if _, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{
		Password: claveDePrueba, AceptaPlazo: true, CorreoParaRespuesta: "respuesta@ejemplo.test", ConfirmacionCorreo: "respuesta@ejemplo.test",
	}); err != nil {
		t.Fatal(err)
	}
	esperarRespuesta(t, pool, a.ID, "con el primer intento", func(r filaRespuesta) bool { return r.Intentos == 1 })
	cerrar(t, pool, svc, a.ID)
	r := unaRespuesta(t, pool, a.ID)
	if r.ConCorreo {
		t.Error("cerrada la cuenta, la bandeja conserva el correo que se dio para la respuesta")
	}

	if err := svc.MarcarRespuestaEntregada(ctx, r.ID, administrador(t, pool).ID, "Se la entregamos en persona a Maria Rojas"); err != nil {
		t.Fatal(err)
	}
	envejecer(t, pool, a.ID, 5)
	if _, err := svc.DesasociarVencidas(ctx, time.Now(), 100); err != nil {
		t.Fatal(err)
	}
	r = unaRespuesta(t, pool, a.ID)
	if r.Nota != nil || !r.Entregada {
		t.Errorf("desasociada, la constancia queda y la nota no: %+v", r)
	}
}

// ── La via web ────────────────────────────────────────────────────────────

// Con el codigo correcto la pagina recibe la misma respuesta que el correo.
func TestConfirmar_LaPaginaRecibeLaRespuesta(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	out, err := svc.Confirmar(ctx, a.Correo, codigoDe(t, esperar(t, correo.ch)))
	if err != nil {
		t.Fatal(err)
	}
	dia30 := cuenta1[time.Time](t, pool, `SELECT deletion_due_at FROM users WHERE id = $1::uuid`, a.ID)
	if out.Resultado != RespuestaPlazoIniciado || out.SeEliminaEl == nil || !out.SeEliminaEl.Equal(dia30) ||
		out.ConservaHasta == nil || !out.ConservaHasta.Equal(dia30.AddDate(5, 0, 0)) || len(out.Bloqueos) != 0 {
		t.Errorf("respuesta para la pagina: %+v (dia 30 %v)", out, dia30)
	}
	esperar(t, correo.ch)
	if r := esperarRespuesta(t, pool, a.ID, "entregada", func(r filaRespuesta) bool { return r.Entregada }); r.Tipo != RespuestaPlazoIniciado {
		t.Errorf("la bandeja: %+v", r)
	}
}

// Una cuenta bajo revision espera a una persona: la pagina no dice por que, y
// todavia no hay respuesta que mandar.
func TestConfirmar_UnaCuentaBajoRevisionNoDiceNada(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	bloquearCuenta(t, pool, a.ID)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	out, err := svc.Confirmar(ctx, a.Correo, codigoDe(t, esperar(t, correo.ch)))
	if err != nil {
		t.Fatal(err)
	}
	if out.Resultado != "received" || out.SeEliminaEl != nil || out.ConservaHasta != nil || len(out.Bloqueos) != 0 {
		t.Errorf("bajo revision la pagina no debe decir nada de la cuenta: %+v", out)
	}
	if rs := respuestasDe(t, pool, a.ID); len(rs) != 0 {
		t.Errorf("bajo revision no hay respuesta hasta que la atienda una persona: %+v", rs)
	}
}

// La solicitud web que no pudo empezar tambien es una respuesta debida: va por
// la bandeja, en voseo, y la pagina dice que resolver.
func TestRespuesta_LaSolicitudWebBloqueadaVaPorLaBandeja(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()
	fondear(t, pool, a.ID, 500)

	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	out, err := svc.Confirmar(ctx, a.Correo, codigoDe(t, esperar(t, correo.ch)))
	if err != nil {
		t.Fatal(err)
	}
	if out.Resultado != RespuestaBloqueada || !slices.Equal(out.Bloqueos, []string{BloqueoSaldo}) || out.SeEliminaEl != nil {
		t.Errorf("respuesta para la pagina: %+v", out)
	}
	aviso := esperar(t, correo.ch)
	if aviso.Para != a.Correo || !strings.Contains(aviso.Texto, "tenés saldo en tu billetera") || !strings.Contains(aviso.Texto, "No se borró nada") {
		t.Errorf("el aviso debe ir en voseo y decir que resolver: %+v", aviso)
	}
	r := esperarRespuesta(t, pool, a.ID, "entregada", func(r filaRespuesta) bool { return r.Entregada })
	if r.Tipo != RespuestaBloqueada || !slices.Equal(r.Bloqueos, []string{BloqueoSaldo}) || r.SeEliminaEl != nil {
		t.Errorf("la bandeja: %+v", r)
	}
}

// Pedirla otra vez por la web con la cuenta ya en plazo es otra solicitud:
// lleva su propia respuesta, aunque la primera ya haya salido.
func TestRespuesta_LaSolicitudWebRepetidaLlevaSuPropiaRespuesta(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	if _, err := svc.EliminarMiCuenta(ctx, a.ID, Confirmacion{Password: claveDePrueba, AceptaPlazo: true}); err != nil {
		t.Fatal(err)
	}
	esperar(t, correo.ch)
	esperarRespuesta(t, pool, a.ID, "entregada", func(r filaRespuesta) bool { return r.Entregada })

	if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Confirmar(ctx, a.Correo, codigoDe(t, esperar(t, correo.ch))); err != nil {
		t.Fatal(err)
	}
	if m := esperar(t, correo.ch); !strings.Contains(m.Texto, "PRODHAB") {
		t.Errorf("la segunda respuesta: %+v", m)
	}
	limite := time.Now().Add(5 * time.Second)
	for {
		rs := respuestasDe(t, pool, a.ID)
		if len(rs) == 2 && rs[0].Entregada && rs[1].Entregada && rs[1].Tipo == RespuestaPlazoIniciado {
			break
		}
		if time.Now().After(limite) {
			t.Fatalf("se esperaban dos respuestas entregadas: %+v", rs)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// ── El barrido ────────────────────────────────────────────────────────────

func TestPoller_EntregaLasRespuestasPendientes(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	pedir(t, nuevoServicio(pool, nil), a.ID)

	correo := nuevoCorreo()
	p := NewPoller(nuevoServicio(pool, &Options{Email: correo}), pool, time.Minute, slog.Default())
	p.tick(context.Background())
	if m := esperar(t, correo.ch); m.Para != a.Correo {
		t.Errorf("fue a %q", m.Para)
	}
	if r := unaRespuesta(t, pool, a.ID); !r.Entregada {
		t.Errorf("el barrido no la dejo entregada: %+v", r)
	}
}
