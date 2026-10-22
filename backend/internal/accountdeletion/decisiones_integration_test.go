package accountdeletion

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
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
//     la respuesta que va a un correo que nadie confirmo. Las que ya salieron a
//     ese correo quedan 30 dias en una lista propia, solo para leer.

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
// devuelve la fecha que quedo: operaciones la atiende dias despues. La respuesta
// sin decidir nacio con esa verificacion, asi que corre con ella.
func verificadaHace(t *testing.T, pool *pgxpool.Pool, solicitud string, dias int) time.Time {
	t.Helper()
	var v time.Time
	if err := pool.QueryRow(context.Background(), `
		UPDATE account_deletion_requests SET verified_at = verified_at - make_interval(days => $2)
		 WHERE id = $1::uuid RETURNING verified_at`, solicitud, dias).Scan(&v); err != nil {
		t.Fatal(err)
	}
	exec(t, pool, `
		UPDATE account_deletion_responses
		   SET respond_by = $2, created_at = created_at - make_interval(days => $3)
		 WHERE request_id = $1::uuid AND kind = 'undecided'`, solicitud, responderAntesDe(v), dias)
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
	bajo := strings.ToLower(texto)
	for _, motivo := range motivosQueNoSeDicen {
		if motivo.MatchString(bajo) {
			t.Errorf("la respuesta deja ver el motivo (%s):\n%s", motivo, texto)
		}
	}
}

// motivosQueNoSeDicen, en minusculas y por palabra: "demo" no debe coincidir con
// "podemos", ni "ros" con "otros".
var motivosQueNoSeDicen = []*regexp.Regexp{
	regexp.MustCompile(`bloque`),
	regexp.MustCompile(`revisi(ó|o)n`),
	regexp.MustCompile(`suspend`),
	regexp.MustCompile(`fraude`),
	regexp.MustCompile(`\bdemo\b|demostraci`),
	regexp.MustCompile(`administrador`),
	regexp.MustCompile(`\buif\b`),
	regexp.MustCompile(`\bros\b`),
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

// Cerrada la cuenta (dia 30), users ya no guarda su contacto: queda en
// closed_account_records. Decision del dueno del 2026-10-22: Ver contacto lo lee
// de ahi, solo para entregar esta respuesta a la misma persona, y la vista queda
// en la auditoria como cualquier otra. Desasociado lo conservado, ya no hay
// contacto: sale vacio y una vista que no revela nada no se audita.
func TestRespuesta_VerContactoDeUnaCuentaCerradaLeeLoConservado(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	sinCorreo(t, pool, a.ID)
	admin := administrador(t, pool)
	svc := nuevoServicio(pool, nil)
	ctx := context.Background()
	pedir(t, svc, a.ID)
	if _, err := svc.EntregarRespuestas(ctx, time.Now(), 100); err != nil {
		t.Fatal(err)
	}
	cerrar(t, pool, svc, a.ID)
	r := unaRespuesta(t, pool, a.ID)
	if !r.Escalada || r.Entregada {
		t.Fatalf("debia seguir en el panel: %+v", r)
	}

	c, err := svc.ContactoDeRespuesta(ctx, r.ID, admin.ID)
	if err != nil {
		t.Fatalf("ver el contacto: %v", err)
	}
	if c.Telefono != a.Telefono || c.Correo != "" || c.CorreoParaRespuesta != "" {
		t.Errorf("de una cuenta cerrada sale el contacto conservado: %+v", c)
	}
	if n := vistasDelContacto(t, pool, a.ID, admin.ID, r.ID); n != 1 {
		t.Errorf("la vista de lo conservado queda en la auditoria: %d", n)
	}

	exec(t, pool, `UPDATE closed_account_records
		SET first_name = NULL, last_name = NULL, birth_date = NULL, birth_date_enc = NULL,
		    cedula_hash = NULL, cedula_enc = NULL, phone_hash = NULL, phone_enc = NULL,
		    email_hash = NULL, email_enc = NULL, dissociated_at = NOW()
		WHERE user_id = $1::uuid`, a.ID)
	c, err = svc.ContactoDeRespuesta(ctx, r.ID, admin.ID)
	if err != nil || c.Telefono != "" || c.Correo != "" || c.CorreoParaRespuesta != "" {
		t.Errorf("desasociado lo conservado no queda contacto: %+v %v", c, err)
	}
	if n := vistasDelContacto(t, pool, a.ID, admin.ID, r.ID); n != 1 {
		t.Errorf("una vista que no revela nada no va a la auditoria: %d", n)
	}
}

// La respuesta pendiente de un rechazo tampoco debe salir despues de que la
// persona empezo el plazo por otra via.
func TestRespuesta_EmpezarElPlazoCancelaLaDeRechazo(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	rechazo := cuenta1[string](t, pool, `
		INSERT INTO account_deletion_responses (user_id, kind, respond_by, attempts, last_error, escalated_at)
		VALUES ($1::uuid, 'rejected', NOW() + interval '5 days', 1, 'no_channel', NOW())
		RETURNING id::text`, a.ID)
	// Ni la ya entregada ni la de otra cuenta se tocan.
	entregada := cuenta1[string](t, pool, `
		INSERT INTO account_deletion_responses (user_id, kind, respond_by, delivered_at, delivered_via)
		VALUES ($1::uuid, 'rejected', NOW() + interval '5 days', NOW(), 'email')
		RETURNING id::text`, a.ID)
	otra := sembrar(t, pool)
	deOtra := cuenta1[string](t, pool, `
		INSERT INTO account_deletion_responses (user_id, kind, respond_by)
		VALUES ($1::uuid, 'rejected', NOW() + interval '5 days')
		RETURNING id::text`, otra.ID)
	svc := nuevoServicio(pool, nil)

	pedir(t, svc, a.ID)
	for _, r := range respuestasDe(t, pool, a.ID) {
		if r.ID == rechazo && !r.Cancelada {
			t.Errorf("empezado el plazo, la respuesta del rechazo sigue pendiente: %+v", r)
		}
		if r.ID == entregada && (r.Cancelada || !r.Entregada) {
			t.Errorf("la ya entregada no se toca: %+v", r)
		}
	}
	for _, r := range respuestasDe(t, pool, otra.ID) {
		if r.ID == deOtra && r.Cancelada {
			t.Errorf("la de otra cuenta no se toca: %+v", r)
		}
	}
	if p := enElPanel(t, svc, a.ID); p != nil && p.ID == rechazo {
		t.Errorf("el panel sigue pidiendo la respuesta del rechazo: %+v", p)
	}
}

// ── Las que ya salieron a un correo sin confirmar ─────────────────────────

// enviadaSinConfirmar devuelve la de la cuenta en la lista de las que salieron
// a un correo que nadie confirmo, o nil.
func enviadaSinConfirmar(t *testing.T, svc *Service, userID string) *RespuestaEnviadaSinConfirmar {
	t.Helper()
	lista, err := svc.EnviadasSinConfirmar(context.Background(), 100)
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

// Una respuesta que salio sola deja el panel. Si salio al correo dado solo para
// la respuesta, nadie sabe si le llego a la persona: operaciones la ve 30 dias
// en su propia lista. Solo cuenta ese correo: el de la cuenta, aunque no este
// verificado, no; tampoco una que operaciones entrego por otro medio.
func TestRespuesta_LasEnviadasAUnCorreoSinConfirmar(t *testing.T) {
	pool := testutil.TestDB(t)
	dado, deLaCuenta, vieja, aMano := sembrar(t, pool), sembrar(t, pool), sembrar(t, pool), sembrar(t, pool)
	for _, c := range []cuenta{dado, vieja, aMano} {
		sinCorreo(t, pool, c.ID)
	}
	exec(t, pool, `UPDATE users SET email_verified = false WHERE id = $1::uuid`, deLaCuenta.ID)
	admin := administrador(t, pool)
	ctx := context.Background()
	conCorreo := nuevoServicio(pool, &Options{Email: nuevoCorreo()})

	conCorreoDado(t, conCorreo, dado.ID)
	conCorreoDado(t, conCorreo, vieja.ID)
	if _, err := conCorreo.EliminarMiCuenta(ctx, deLaCuenta.ID, Confirmacion{Password: claveDePrueba, AceptaPlazo: true}); err != nil {
		t.Fatal(err)
	}
	for _, c := range []cuenta{dado, vieja, deLaCuenta} {
		esperarRespuesta(t, pool, c.ID, "entregada por correo", func(r filaRespuesta) bool { return r.Entregada })
	}
	exec(t, pool, `UPDATE account_deletion_responses SET delivered_at = NOW() - interval '31 days' WHERE user_id = $1::uuid`, vieja.ID)

	sinProveedor := nuevoServicio(pool, nil)
	conCorreoDado(t, sinProveedor, aMano.ID)
	// Sin proveedor el primer intento no corre: la pasa al panel el barrido.
	if _, err := sinProveedor.EntregarRespuestas(ctx, time.Now(), 100); err != nil {
		t.Fatal(err)
	}
	r := unaRespuesta(t, pool, aMano.ID)
	if !r.Escalada {
		t.Fatalf("sin a donde mandarla debia pasar al panel: %+v", r)
	}
	if err := sinProveedor.MarcarRespuestaEntregada(ctx, r.ID, admin.ID, "se la leimos por telefono"); err != nil {
		t.Fatal(err)
	}

	e := enviadaSinConfirmar(t, conCorreo, dado.ID)
	if e == nil {
		t.Fatal("la que salio al correo dado debe estar en la lista")
	}
	if e.Tipo != RespuestaPlazoIniciado || e.EntregadaEn.IsZero() || e.Cuenta == nil || e.CuentaCerrada {
		t.Errorf("la enviada: %+v", e)
	}
	for que, c := range map[string]cuenta{
		"la del correo de la cuenta sin verificar":  deLaCuenta,
		"la de hace 31 dias":                        vieja,
		"la que operaciones entrego por otro medio": aMano,
	} {
		if enviadaSinConfirmar(t, conCorreo, c.ID) != nil {
			t.Errorf("%s no va en la lista", que)
		}
	}
}

func TestHandler_ListarLasEnviadasSinConfirmar(t *testing.T) {
	pool := testutil.TestDB(t)
	a, admin := sembrar(t, pool), administrador(t, pool)
	sinCorreo(t, pool, a.ID)
	svc := nuevoServicio(pool, &Options{Email: nuevoCorreo()})
	srv := router(NewHandler(svc, nil), admin.ID)
	conCorreoDado(t, svc, a.ID)
	esperarRespuesta(t, pool, a.ID, "entregada por correo", func(r filaRespuesta) bool { return r.Entregada })

	rec, env := llamar(t, srv, "GET", "/admin/account-deletion-responses/sent-unconfirmed", "")
	var lista []struct {
		ID          string          `json:"id"`
		Kind        string          `json:"kind"`
		DeliveredAt *time.Time      `json:"delivered_at"`
		UserID      string          `json:"user_id"`
		Closed      *bool           `json:"account_closed"`
		Account     json.RawMessage `json:"account"`
	}
	_ = json.Unmarshal(env.Data, &lista)
	if rec.Code != 200 || len(lista) != 1 || lista[0].Kind != "scheduled" || lista[0].DeliveredAt == nil ||
		lista[0].UserID != a.ID || lista[0].Closed == nil || len(lista[0].Account) < 3 {
		t.Fatalf("la lista: %d %s", rec.Code, rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("la lista no se guarda en ninguna cache: %q", cc)
	}
	if strings.Contains(strings.ToLower(rec.Body.String()), strings.ToLower(correoDado)) {
		t.Errorf("la lista no muestra el correo al que salio: %s", rec.Body.String())
	}
}

// Mientras la solicitud esperaba en la cola, la cuenta se desbloqueo y la persona
// empezo el plazo por la app. Rechazar le escribiria "no se borro nada" con el
// plazo corriendo: no se rechaza, y la solicitud se cierra con Iniciar el plazo.
func TestRespuesta_RechazarConElPlazoYaCorriendoNoLeEscribeQueNoSeBorroNada(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a, admin := sembrar(t, pool), administrador(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	solicitud := solicitudEnLaCola(t, pool, svc, correo, a)
	exec(t, pool, `UPDATE users SET status = 'active', blocked_at = NULL, blocked_reason = NULL WHERE id = $1::uuid`, a.ID)
	pedir(t, svc, a.ID)

	if err := svc.Rechazar(ctx, solicitud, admin.ID); !errors.Is(err, ErrCuentaYaEnPlazo) {
		t.Fatalf("rechazar con el plazo corriendo: %v", err)
	}
	for _, r := range respuestasDe(t, pool, a.ID) {
		if r.Tipo == RespuestaRechazada {
			t.Errorf("con el plazo corriendo no se le escribe que no se borro nada: %+v", r)
		}
	}
	if estado, _, _ := estadoDe(t, pool, a.Correo); estado != "verified" {
		t.Errorf("la solicitud sigue en la cola, para cerrarla con Iniciar el plazo: %s", estado)
	}
	srv := router(NewHandler(svc, nil), admin.ID)
	if rec, env := llamar(t, srv, "POST", "/admin/account-deletion-requests/"+solicitud+"/reject", ""); rec.Code != 409 || env.Error == nil || env.Error.Code != "ALREADY_SCHEDULED" {
		t.Errorf("el handler: %d %s", rec.Code, rec.Body.String())
	}
}

// ── La cuenta en revision tiene su respuesta desde la verificacion ─────────
//
// Decision del dueno del 2026-10-22: la respuesta entra a la bandeja apenas se
// verifica la solicitud, con el plazo desde ahi. Si nadie la procesa ni la
// rechaza, pasa sola a "Respuestas por entregar" antes del plazo. Al procesar o
// rechazar se completa esa misma fila, no una nueva.

// sinDecidirConPlazoEncima deja la respuesta sin decidir de la cuenta con dos
// dias de plazo, menos de los tres que operaciones necesita, y corre el barrido.
func sinDecidirConPlazoEncima(t *testing.T, pool *pgxpool.Pool, svc *Service, userID string) filaRespuesta {
	t.Helper()
	r := unaRespuesta(t, pool, userID)
	exec(t, pool, `UPDATE account_deletion_responses SET respond_by = NOW() + interval '2 days' WHERE id = $1::uuid`, r.ID)
	if _, err := svc.EntregarRespuestas(context.Background(), time.Now(), 100); err != nil {
		t.Fatal(err)
	}
	return r
}

func TestRespuesta_LaCuentaEnRevisionTieneSuFilaDesdeLaVerificacion(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	solicitud := solicitudEnLaCola(t, pool, svc, correo, a)

	r := unaRespuesta(t, pool, a.ID)
	if r.Tipo != RespuestaSinDecidir || r.Escalada || r.Entregada || r.Cancelada {
		t.Fatalf("al verificar debia quedar una respuesta sin decidir: %+v", r)
	}
	verificada := cuenta1[time.Time](t, pool, `SELECT verified_at FROM account_deletion_requests WHERE id = $1::uuid`, solicitud)
	if got, want := respondeAntesDe(t, pool, r.ID), responderAntesDe(verificada); got.Sub(want).Abs() > time.Second {
		t.Errorf("el plazo corre desde la verificacion: %v, se esperaba %v", got, want)
	}
	// Sin decidir no hay nada que mandar, y con plazo de sobra el barrido no la toca.
	if _, err := svc.EntregarRespuestas(ctx, time.Now(), 100); err != nil {
		t.Fatal(err)
	}
	if r := unaRespuesta(t, pool, a.ID); r.Intentos != 0 || r.Entregada || r.Escalada {
		t.Errorf("el barrido no manda ni escala una sin decidir con plazo de sobra: %+v", r)
	}
	select {
	case m := <-correo.ch:
		t.Errorf("salio un correo sin decidir nada: %+v", m)
	default:
	}
}

func TestRespuesta_SinDecidirPasaSolaAlPanelAntesDelPlazo(t *testing.T) {
	pool := testutil.TestDB(t)
	a := sembrar(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	solicitudEnLaCola(t, pool, svc, correo, a)

	r := sinDecidirConPlazoEncima(t, pool, svc, a.ID)
	p := enElPanel(t, svc, a.ID)
	if p == nil || p.ID != r.ID || p.Tipo != RespuestaSinDecidir {
		t.Fatalf("sin atender y con el plazo encima, debia pasar sola al panel: %+v", p)
	}
	if r := unaRespuesta(t, pool, a.ID); r.Intentos != 0 || r.Entregada {
		t.Errorf("pasa al panel sin intentar mandar nada: %+v", r)
	}
}

func TestRespuesta_ProcesarCompletaLaMismaFila(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a, admin := sembrar(t, pool), administrador(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	solicitud := solicitudEnLaCola(t, pool, svc, correo, a)
	antes := sinDecidirConPlazoEncima(t, pool, svc, a.ID)
	plazo := respondeAntesDe(t, pool, antes.ID)

	if _, err := svc.Procesar(ctx, solicitud, admin.ID); err != nil {
		t.Fatal(err)
	}
	r := esperarRespuesta(t, pool, a.ID, "la misma fila, completada y entregada", func(r filaRespuesta) bool { return r.Entregada })
	if r.ID != antes.ID || r.Tipo != RespuestaPlazoIniciado || r.SeEliminaEl == nil {
		t.Errorf("procesar completa la misma fila: antes %+v, despues %+v", antes, r)
	}
	if got := respondeAntesDe(t, pool, r.ID); !got.Equal(plazo) {
		t.Errorf("el plazo no cambia al completarla: %v, era %v", got, plazo)
	}
}

func TestRespuesta_RechazarCompletaLaMismaFila(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a, admin := sembrar(t, pool), administrador(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	solicitud := solicitudEnLaCola(t, pool, svc, correo, a)
	antes := unaRespuesta(t, pool, a.ID)

	if err := svc.Rechazar(ctx, solicitud, admin.ID); err != nil {
		t.Fatal(err)
	}
	r := esperarRespuesta(t, pool, a.ID, "la misma fila, completada y entregada", func(r filaRespuesta) bool { return r.Entregada })
	if r.ID != antes.ID || r.Tipo != RespuestaRechazada {
		t.Errorf("rechazar completa la misma fila: antes %+v, despues %+v", antes, r)
	}
}

// Sin decidir no hay nada que entregar por otro medio: operaciones atiende la
// solicitud, y la respuesta sale con lo que decida.
func TestRespuesta_SinDecidirNoSeMarcaNiSeVeElContacto(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	a, admin := sembrar(t, pool), administrador(t, pool)
	correo := nuevoCorreo()
	svc := nuevoServicio(pool, &Options{Email: correo})
	solicitudEnLaCola(t, pool, svc, correo, a)
	r := sinDecidirConPlazoEncima(t, pool, svc, a.ID)

	if err := svc.MarcarRespuestaEntregada(ctx, r.ID, admin.ID, "por telefono"); !errors.Is(err, ErrRespuestaSinDecidir) {
		t.Errorf("marcar entregada una sin decidir: %v", err)
	}
	if _, err := svc.ContactoDeRespuesta(ctx, r.ID, admin.ID); !errors.Is(err, ErrRespuestaSinDecidir) {
		t.Errorf("ver el contacto de una sin decidir: %v", err)
	}
	srv := router(NewHandler(svc, nil), admin.ID)
	for _, ruta := range []string{"/delivered", "/contact"} {
		rec, env := llamar(t, srv, "POST", "/admin/account-deletion-responses/"+r.ID+ruta, `{"note":"por telefono"}`)
		if rec.Code != 409 || env.Error == nil || env.Error.Code != "NOT_DECIDED" {
			t.Errorf("%s: %d %s", ruta, rec.Code, rec.Body.String())
		}
	}
}
