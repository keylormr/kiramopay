package accountdeletion

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/testutil"
)

// Lo que el dueno decidio el 2026-10-20 sobre lo que la revision de la bandeja
// dejo en sus manos:
//
//   - Operaciones puede ver el contacto completo de una respuesta del panel, y
//     cada vista queda en la auditoria.
//   - Toda solicitud web verificada recibe respuesta escrita por la bandeja,
//     tambien las rechazadas, con el plazo legal contado desde la verificacion.
//   - El correo dado solo para la respuesta se pide dos veces, y el panel marca
//     la respuesta que va a un correo que nadie confirmo.

const correoDado = "Dado.Respuesta@ejemplo.test"

// conCorreoDado pide la eliminacion de una cuenta sin correo con el correo dado
// para la respuesta, escrito dos veces.
func conCorreoDado(t *testing.T, svc *Service, userID string) *Solicitud {
	t.Helper()
	s, err := svc.EliminarMiCuenta(context.Background(), userID, Confirmacion{
		Password: claveDePrueba, AceptaPlazo: true,
		CorreoParaRespuesta: correoDado, ConfirmacionCorreo: correoDado,
	})
	if err != nil {
		t.Fatalf("pedir la eliminacion con el correo dado: %v", err)
	}
	return s
}

// enElPanel devuelve la respuesta de la cuenta que lista el panel, o nil.
func enElPanel(t *testing.T, svc *Service, userID string) *RespuestaPendiente {
	t.Helper()
	lista, err := svc.RespuestasSinEntregar(context.Background(), 100)
	if err != nil {
		t.Fatal(err)
	}
	for i := range lista {
		if lista[i].UserID == userID {
			return &lista[i]
		}
	}
	return nil
}

func vistasDelContacto(t *testing.T, pool *pgxpool.Pool, userID, adminID, respuesta string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM audit_logs
		 WHERE user_id = $1::uuid AND action = 'account_deletion_response_contact_viewed'
		   AND details->>'actor' = $2 AND details->>'response' = $3 AND created_at IS NOT NULL`,
		userID, adminID, respuesta).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// ── Ver el contacto ───────────────────────────────────────────────────────

// Para entregar por otro medio hace falta el contacto completo: el telefono, el
// correo de la cuenta y el que la persona dio solo para la respuesta. Cada vez
// que alguien lo mira queda en la auditoria, con quien y cuando.
func TestRespuesta_VerContactoDaElCompletoYQuedaEnLaAuditoria(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	sinCorreo(t, pool, a.ID)
	admin := administrador(t, pool)
	svc := nuevoServicio(pool, nil)
	ctx := context.Background()
	conCorreoDado(t, svc, a.ID)
	// Sin proveedor no sale: pasa a operaciones.
	if _, err := svc.EntregarRespuestas(ctx, time.Now(), 100); err != nil {
		t.Fatal(err)
	}
	r := unaRespuesta(t, pool, a.ID)
	if !r.Escalada {
		t.Fatalf("debia estar en el panel: %+v", r)
	}

	c, err := svc.ContactoDeRespuesta(ctx, r.ID, admin.ID)
	if err != nil {
		t.Fatalf("ver el contacto: %v", err)
	}
	if c == nil || c.Telefono != a.Telefono || c.Correo != "" || c.CorreoParaRespuesta != correoDado {
		t.Errorf("el contacto completo: %+v (telefono %s)", c, a.Telefono)
	}
	if n := vistasDelContacto(t, pool, a.ID, admin.ID, r.ID); n != 1 {
		t.Errorf("la vista debe quedar en la auditoria: %d filas", n)
	}
	if _, err := svc.ContactoDeRespuesta(ctx, r.ID, admin.ID); err != nil {
		t.Fatal(err)
	}
	if n := vistasDelContacto(t, pool, a.ID, admin.ID, r.ID); n != 2 {
		t.Errorf("cada vista deja su fila: %d", n)
	}

	// Entregada, sale del panel y su contacto ya no se ve.
	if err := svc.MarcarRespuestaEntregada(ctx, r.ID, admin.ID, "Se la leimos por telefono"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ContactoDeRespuesta(ctx, r.ID, admin.ID); !errors.Is(err, ErrRespuestaFueraDelPanel) {
		t.Errorf("entregada: %v", err)
	}
	if n := vistasDelContacto(t, pool, a.ID, admin.ID, r.ID); n != 2 {
		t.Errorf("un pedido rechazado no es una vista: %d", n)
	}
	if _, err := svc.ContactoDeRespuesta(ctx, uuid.NewString(), admin.ID); !errors.Is(err, ErrRespuestaNoEncontrada) {
		t.Errorf("una que no existe: %v", err)
	}
}

// El contacto solo se ve de las respuestas que estan en el panel: una que el
// barrido todavia esta reintentando no es asunto de operaciones.
func TestRespuesta_VerContactoSoloDeLasDelPanel(t *testing.T) {
	pool := testutil.TestDB(t)
	a, admin := sembrar(t, pool), administrador(t, pool)
	svc := nuevoServicio(pool, &Options{Email: nuevoCorreoQueFalla(100)})
	pedir(t, svc, a.ID)
	if _, err := svc.EntregarRespuestas(context.Background(), time.Now(), 100); err != nil {
		t.Fatal(err)
	}
	r := esperarRespuesta(t, pool, a.ID, "intentada", func(r filaRespuesta) bool { return r.Intentos >= 1 })
	if r.Escalada {
		t.Fatalf("recien intentada no debia estar en el panel: %+v", r)
	}
	if _, err := svc.ContactoDeRespuesta(context.Background(), r.ID, admin.ID); !errors.Is(err, ErrRespuestaFueraDelPanel) {
		t.Errorf("fuera del panel: %v", err)
	}
	if n := vistasDelContacto(t, pool, a.ID, admin.ID, r.ID); n != 0 {
		t.Errorf("sin contacto no hay vista: %d", n)
	}
}

func TestHandler_VerContactoDeUnaRespuesta(t *testing.T) {
	pool := testutil.TestDB(t)
	a, admin := sembrar(t, pool), administrador(t, pool)
	svc := nuevoServicio(pool, nil)
	srv := router(NewHandler(svc, nil), admin.ID)
	pedir(t, svc, a.ID)
	if _, err := svc.EntregarRespuestas(context.Background(), time.Now(), 100); err != nil {
		t.Fatal(err)
	}
	id := unaRespuesta(t, pool, a.ID).ID
	ruta := "/admin/account-deletion-responses/" + id + "/contact"

	rec, env := llamar(t, srv, "POST", ruta, "")
	var c struct {
		Telefono *string `json:"phone"`
		Correo   *string `json:"email"`
		ParaResp *string `json:"response_email"`
	}
	_ = json.Unmarshal(env.Data, &c)
	if rec.Code != 200 || deref(c.Telefono) != a.Telefono || deref(c.Correo) != a.Correo || c.ParaResp == nil || *c.ParaResp != "" {
		t.Fatalf("ver el contacto: %d %s", rec.Code, rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("un contacto completo no se guarda en ninguna cache: %q", cc)
	}
	if err := svc.MarcarRespuestaEntregada(context.Background(), id, admin.ID, "por telefono"); err != nil {
		t.Fatal(err)
	}
	if rec, env := llamar(t, srv, "POST", ruta, ""); rec.Code != 409 || env.Error == nil || env.Error.Code != "NOT_PENDING" {
		t.Errorf("entregada: %d %s", rec.Code, rec.Body.String())
	}
	for _, otra := range []string{"no-es-uuid", uuid.NewString()} {
		if rec, _ := llamar(t, srv, "POST", "/admin/account-deletion-responses/"+otra+"/contact", ""); rec.Code != 404 {
			t.Errorf("%s: %d", otra, rec.Code)
		}
	}
}

// ── Toda solicitud verificada tiene su respuesta ──────────────────────────

// verificadaHace corre al pasado la verificacion de una solicitud de la cola y
// devuelve la fecha que quedo: operaciones la atiende dias despues.
func verificadaHace(t *testing.T, pool *pgxpool.Pool, solicitud string, dias int) time.Time {
	t.Helper()
	var v time.Time
	if err := pool.QueryRow(context.Background(), `
		UPDATE account_deletion_requests SET verified_at = verified_at - make_interval(days => $2)
		 WHERE id = $1::uuid RETURNING verified_at`, solicitud, dias).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func respondeAntesDe(t *testing.T, pool *pgxpool.Pool, respuesta string) time.Time {
	t.Helper()
	var v time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT respond_by FROM account_deletion_responses WHERE id = $1::uuid`, respuesta).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

// La respuesta no dice por que no se pudo: la cuenta puede estar bajo revision
// o ser de un tipo que no se elimina por esta via. Tampoco nombra a la UIF.
func sinElMotivo(t *testing.T, texto string) {
	t.Helper()
	for _, motivo := range []string{"bloque", "revisión", "fraude", "demostración", "administrador", "UIF", "ROS "} {
		if strings.Contains(texto, motivo) {
			t.Errorf("la respuesta deja ver el motivo (%q):\n%s", motivo, texto)
		}
	}
}

// Rechazar una solicitud de la cola tambien se responde por escrito, y el plazo
// legal se cuenta desde que la persona verifico, no desde que operaciones la
// atendio.
func TestRespuesta_RechazarLaSolicitudLeEscribe(t *testing.T) {
	pool := testutil.TestDB(t)
	a, admin := sembrar(t, pool), administrador(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	id := solicitudEnLaCola(t, pool, svc, correo, a)
	verificada := verificadaHace(t, pool, id, 3)

	if err := svc.Rechazar(context.Background(), id, admin.ID); err != nil {
		t.Fatal(err)
	}
	m := esperar(t, correo.ch)
	if m.Para != a.Correo || !strings.Contains(m.Texto, "No se borró nada") || !strings.Contains(m.Texto, "PRODHAB") {
		t.Errorf("la respuesta del rechazo: %+v", m)
	}
	sinElMotivo(t, m.Texto)
	r := esperarRespuesta(t, pool, a.ID, "entregada", func(r filaRespuesta) bool { return r.Entregada })
	if r.Tipo != RespuestaRechazada {
		t.Errorf("la bandeja: %+v", r)
	}
	if got, want := respondeAntesDe(t, pool, r.ID), responderAntesDe(verificada); !got.Equal(want) {
		t.Errorf("el plazo se cuenta desde la verificacion: %v, se esperaba %v", got, want)
	}
}

// Procesar dias despues tampoco corre el plazo legal.
func TestRespuesta_ProcesarCuentaElPlazoDesdeLaVerificacion(t *testing.T) {
	pool := testutil.TestDB(t)
	a, admin := sembrar(t, pool), administrador(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	id := solicitudEnLaCola(t, pool, svc, correo, a)
	verificada := verificadaHace(t, pool, id, 4)

	if res, err := svc.Procesar(context.Background(), id, admin.ID); err != nil || res.Estado != "scheduled" {
		t.Fatalf("procesar: %+v %v", res, err)
	}
	esperar(t, correo.ch)
	r := esperarRespuesta(t, pool, a.ID, "entregada", func(r filaRespuesta) bool { return r.Entregada })
	if got, want := respondeAntesDe(t, pool, r.ID), responderAntesDe(verificada); !got.Equal(want) {
		t.Errorf("el plazo se cuenta desde la verificacion: %v, se esperaba %v", got, want)
	}
}

// Las que la verificacion misma rechaza (una cuenta de demostracion, de un
// administrador, o que ya no esta activa) reciben su respuesta escrita.
func TestRespuesta_LosRechazosAlVerificarLeEscriben(t *testing.T) {
	casos := map[string]string{
		"DEMO_ACCOUNT":     `UPDATE users SET demo_login = true WHERE id = $1::uuid`,
		"ROLE_NOT_ALLOWED": `UPDATE users SET role = 'admin' WHERE id = $1::uuid`,
		"NOT_ELIGIBLE":     `UPDATE users SET status = 'closed' WHERE id = $1::uuid`,
	}
	for codigo, preparar := range casos {
		t.Run(codigo, func(t *testing.T) {
			pool := testutil.TestDB(t)
			a := sembrar(t, pool)
			exec(t, pool, preparar, a.ID)
			correo := nuevoCorreo()
			svc := nuevoServicio(pool, &Options{Email: correo})
			ctx := context.Background()

			if err := svc.Solicitar(ctx, a.Correo, true); err != nil {
				t.Fatal(err)
			}
			out, err := svc.Confirmar(ctx, a.Correo, codigoDe(t, esperar(t, correo.ch)))
			if err != nil || out.Resultado != RespuestaRechazada {
				t.Fatalf("la pagina: %+v %v", out, err)
			}
			if got := cuenta1[string](t, pool, `SELECT result_code FROM account_deletion_requests WHERE user_id = $1::uuid`, a.ID); got != codigo {
				t.Fatalf("resultado de la solicitud: %s", got)
			}
			m := esperar(t, correo.ch)
			if m.Para != a.Correo || !strings.Contains(m.Texto, "No se borró nada") || !strings.Contains(m.Texto, "PRODHAB") {
				t.Errorf("la respuesta: %+v", m)
			}
			sinElMotivo(t, m.Texto)
			r := esperarRespuesta(t, pool, a.ID, "entregada", func(r filaRespuesta) bool { return r.Entregada })
			verificada := cuenta1[time.Time](t, pool, `SELECT verified_at FROM account_deletion_requests WHERE user_id = $1::uuid`, a.ID)
			if r.Tipo != RespuestaRechazada || !respondeAntesDe(t, pool, r.ID).Equal(responderAntesDe(verificada)) {
				t.Errorf("la bandeja: %+v", r)
			}
		})
	}
}

// El rechazo de la via web va en la MISMA transaccion que cierra la solicitud.
func TestRespuesta_ElRechazoWebVaEnLaMismaTransaccion(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	exec(t, pool, `UPDATE users SET demo_login = true WHERE id = $1::uuid`, a.ID)
	id := cuenta1[string](t, pool, `
		INSERT INTO account_deletion_requests (contact_kind, contact_hash, user_id, status, verified_at, terms_accepted_at)
		VALUES ('email', fn_pii_hmac($2), $1::uuid, 'verified', NOW(), NOW()) RETURNING id::text`, a.ID, a.Correo)
	ctx := context.Background()
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	out, res, err := atenderEnTx(ctx, tx, id, a.ID, "", opciones{canal: CanalWeb})
	if err != nil || out == nil || out.Estado != "rejected" || res.Respuesta == "" {
		t.Fatalf("atender: %+v %+v %v", out, res, err)
	}
	var dentro int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM account_deletion_responses WHERE user_id = $1::uuid`, a.ID).Scan(&dentro); err != nil {
		t.Fatal(err)
	}
	if dentro != 1 {
		t.Fatalf("dentro de la transaccion: %d respuestas", dentro)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if n := contar(t, pool, "account_deletion_responses", "user_id", a.ID); n != 0 {
		t.Errorf("deshecha la transaccion, quedaron %d respuestas", n)
	}
}

// Una respuesta que nace cerca de su plazo (la atendieron dias despues de la
// verificacion) no espera las 48 horas: al primer fallo pasa a operaciones.
func TestRespuesta_LaQueNaceCercaDelPlazoPasaAOperacionesAlPrimerFallo(t *testing.T) {
	pool := testutil.TestDB(t)
	a, admin := sembrar(t, pool), administrador(t, pool)
	correo := nuevoCorreo()
	id := solicitudEnLaCola(t, pool, nuevoServicio(pool, &Options{Email: correo}), correo, a)
	verificadaHace(t, pool, id, 5)

	caido := nuevoServicio(pool, &Options{Email: nuevoCorreoQueFalla(100)})
	if _, err := caido.Procesar(context.Background(), id, admin.ID); err != nil {
		t.Fatal(err)
	}
	r := esperarRespuesta(t, pool, a.ID, "intentada", func(r filaRespuesta) bool { return r.Intentos >= 1 && r.Error != nil })
	if !r.Escalada {
		t.Errorf("con el plazo encima, el primer fallo debe pasarla a operaciones: %+v", r)
	}
}

// La pagina y el panel dicen hasta cuando hay que responder una solicitud que
// espera a una persona, contado desde la verificacion.
func TestConfirmar_BajoRevisionDiceHastaCuandoSeResponde(t *testing.T) {
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
	verificada := cuenta1[time.Time](t, pool, `SELECT verified_at FROM account_deletion_requests WHERE user_id = $1::uuid`, a.ID)
	if out.Resultado != "received" || out.ResponderAntesDe == nil || !out.ResponderAntesDe.Equal(responderAntesDe(verificada)) {
		t.Errorf("la pagina: %+v (verificada %v)", out, verificada)
	}
	cola, err := svc.ListarVerificadas(ctx, 50)
	if err != nil {
		t.Fatal(err)
	}
	var visto bool
	for _, s := range cola {
		if s.Cuenta != nil && s.Cuenta.ID == a.ID {
			visto = true
			if !s.ResponderAntesDe.Equal(responderAntesDe(verificada)) {
				t.Errorf("la cola: %+v", s)
			}
		}
	}
	if !visto {
		t.Fatalf("la solicitud no esta en la cola: %+v", cola)
	}
}

// ── El correo dado para la respuesta ──────────────────────────────────────

// Se pide dos veces y tienen que coincidir. Se mira antes que la contrasena:
// un error de tipeo no gasta intentos.
func TestEliminar_ElCorreoParaLaRespuestaSePideDosVeces(t *testing.T) {
	pool := testutil.TestDB(t)
	a, b := sembrar(t, pool), sembrar(t, pool)
	sinCorreo(t, pool, a.ID)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	ctx := context.Background()

	pedido := Confirmacion{Password: "una-clave-equivocada", AceptaPlazo: true, CorreoParaRespuesta: "respuesta@ejemplo.test"}
	for _, repetido := range []string{"", "respuesta@ejemplo.tes", "otra@ejemplo.test"} {
		pedido.ConfirmacionCorreo = repetido
		if _, err := svc.EliminarMiCuenta(ctx, a.ID, pedido); !errors.Is(err, ErrCorreoParaRespuestaNoCoincide) {
			t.Errorf("repetido %q: %v", repetido, err)
		}
	}
	if st := cuenta1[string](t, pool, `SELECT status FROM users WHERE id = $1::uuid`, a.ID); st != "active" {
		t.Fatalf("sin coincidir, la solicitud no debia empezar: %s", st)
	}

	pedido.Password, pedido.ConfirmacionCorreo = claveDePrueba, "  Respuesta@Ejemplo.test "
	if _, err := svc.EliminarMiCuenta(ctx, a.ID, pedido); err != nil {
		t.Fatalf("con los dos iguales (sin importar mayusculas): %v", err)
	}
	if m := esperar(t, correo.ch); m.Para != "respuesta@ejemplo.test" {
		t.Errorf("la respuesta va al primero: %+v", m)
	}

	// Una cuenta con correo no da otro: lo que traiga se ignora.
	if _, err := svc.EliminarMiCuenta(ctx, b.ID, Confirmacion{Password: claveDePrueba, AceptaPlazo: true, CorreoParaRespuesta: "x@ejemplo.test"}); err != nil {
		t.Errorf("con correo en la cuenta: %v", err)
	}
}

func TestHandler_EliminarPideElCorreoDosVeces(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	sinCorreo(t, pool, a.ID)
	srv := router(NewHandler(nuevoServicio(pool, nil), nil), a.ID)
	base := `"password":"` + claveDePrueba + `","accept_terms":true,"response_email":"respuesta@ejemplo.test"`

	if rec, env := llamar(t, srv, "POST", "/users/me/delete-account", `{`+base+`,"response_email_confirmation":"otra@ejemplo.test"}`); rec.Code != 400 || env.Error == nil || env.Error.Code != "RESPONSE_EMAIL_MISMATCH" {
		t.Errorf("distintos: %d %s", rec.Code, rec.Body.String())
	}
	if rec, _ := llamar(t, srv, "POST", "/users/me/delete-account", `{`+base+`,"response_email_confirmation":"respuesta@ejemplo.test"}`); rec.Code != 200 {
		t.Errorf("iguales: %d %s", rec.Code, rec.Body.String())
	}
}

// La respuesta que va al correo dado (que nadie confirmo) lleva la marca en el
// panel; la que va al correo de la cuenta, no.
func TestRespuesta_ElPanelMarcaElCorreoSinConfirmar(t *testing.T) {
	pool := testutil.TestDB(t)
	a, b := sembrar(t, pool), sembrar(t, pool)
	sinCorreo(t, pool, a.ID)
	svc := nuevoServicio(pool, nil)
	ctx := context.Background()
	conCorreoDado(t, svc, a.ID)
	if _, err := svc.EliminarMiCuenta(ctx, b.ID, Confirmacion{Password: claveDePrueba, AceptaPlazo: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EntregarRespuestas(ctx, time.Now(), 100); err != nil {
		t.Fatal(err)
	}
	pa, pb := enElPanel(t, svc, a.ID), enElPanel(t, svc, b.ID)
	if pa == nil || pb == nil {
		t.Fatalf("las dos debian estar en el panel: %+v %+v", pa, pb)
	}
	if !pa.CorreoSinConfirmar || pb.CorreoSinConfirmar {
		t.Errorf("la marca: dado %v, de la cuenta %v", pa.CorreoSinConfirmar, pb.CorreoSinConfirmar)
	}
}
