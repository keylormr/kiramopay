package accountdeletion

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kiramopay/backend/internal/messaging"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/pkg/identifier"
)

// La via web: la persona que desinstalo la app, o no puede entrar, pide la
// eliminacion en /eliminar-cuenta.
//
//  1. Solicitar: dice el correo o telefono con que se registro. SIEMPRE se
//     responde igual, exista o no la cuenta, para que el formulario no sea un
//     oraculo de enumeracion. Si existe, se le manda un codigo a ESE canal.
//     La solicitud exige aceptar el plazo de 30 dias, igual que en la app.
//  2. Verificar: presenta el codigo. Probarlo prueba que controla el canal, y
//     ese momento es el dia 0: corre la MISMA rutina de la aplicacion, con los
//     mismos bloqueos, y la persona recibe la respuesta escrita. Sin el codigo
//     un formulario abierto seria una puerta para cerrar cuentas ajenas.
//  3. Solo una cuenta bajo revision (bloqueada o suspendida) espera a una
//     persona: operaciones la atiende con Procesar, que inicia el plazo sin
//     desbloquearla, o con Rechazar.
//
// Toda solicitud verificada recibe su respuesta escrita por la bandeja: plazo
// iniciado, que resolver o que no se atiende por esta via. El plazo legal corre
// desde la verificacion, no desde que operaciones la atiende (decision del dueno
// del 2026-10-20).

const (
	vigenciaCodigo    = 15 * time.Minute
	maxIntentosCodigo = 5
	// esperaEntreCodigos es lo minimo que debe pasar entre dos codigos al mismo
	// contacto: sin esto el formulario sirve para llenar de mensajes el telefono
	// o el buzon de otra persona. Se mide con el vencimiento (que es el momento
	// del envio mas vigenciaCodigo) para no agregar una columna.
	esperaEntreCodigos = time.Minute
	// ventanaDeIntentos: los intentos agotados vuelven recien cuando pasa este
	// tiempo sin pedir codigos. Si pedir otro codigo los devolviera, quien conoce
	// el correo de otra persona podria probar cinco por minuto, para siempre.
	ventanaDeIntentos = 24 * time.Hour
)

var (
	// ErrContactoInvalido: lo escrito no es un correo ni un telefono.
	ErrContactoInvalido = errors.New("escribe el correo o el telefono con que te registraste")
	// ErrCodigoInvalido cubre TODO fallo de verificacion (codigo equivocado,
	// vencido, sin solicitud, intentos agotados) con un solo error, para que no
	// distinga casos.
	ErrCodigoInvalido = errors.New("el codigo no es valido o ya vencio")
	// ErrSolicitudNoEncontrada y ErrSolicitudNoPendiente: del lado del panel.
	ErrSolicitudNoEncontrada = errors.New("solicitud no encontrada")
	ErrSolicitudNoPendiente  = errors.New("la solicitud no esta esperando atencion")
	ErrCuentaYaEnPlazo       = errors.New("la cuenta ya esta en el plazo de eliminacion")
)

// codigoNumerico devuelve n digitos aleatorios.
func codigoNumerico(n int) (string, error) {
	const digitos = "0123456789"
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	for i := range b {
		b[i] = digitos[int(b[i])%len(digitos)]
	}
	return string(b), nil
}

// hashCodigo es el SHA-256 del codigo con un prefijo propio de esta operacion.
func hashCodigo(codigo string) string {
	h := sha256.Sum256([]byte("delacct:" + codigo))
	return hex.EncodeToString(h[:])
}

func (s *Service) contacto(raw string) (identifier.Kind, string, error) {
	kind, canonico, err := identifier.Classify(raw)
	if err != nil || (kind != identifier.KindEmail && kind != identifier.KindPhone) {
		return "", "", ErrContactoInvalido
	}
	return kind, canonico, nil
}

// Solicitar registra la solicitud y manda el codigo. Solo devuelve error si lo
// escrito no es un correo ni un telefono, o si la base falla; que la cuenta
// exista o no jamas se nota en la respuesta.
func (s *Service) Solicitar(ctx context.Context, raw string, aceptaPlazo bool) error {
	// Sin la aceptacion expresa del plazo no se registra nada, exista o no la
	// cuenta: la respuesta no distingue.
	if !aceptaPlazo {
		return ErrPlazoNoAceptado
	}
	kind, canonico, err := s.contacto(raw)
	if err != nil {
		return err
	}

	var cuenta *user.UserRecord
	if kind == identifier.KindEmail {
		cuenta, _ = s.users.FindByEmail(ctx, canonico)
	} else {
		cuenta, _ = s.users.FindByPhone(ctx, canonico)
	}

	var contactHash string
	if err := s.pool.QueryRow(ctx, `SELECT fn_pii_hmac($1)`, canonico).Scan(&contactHash); err != nil {
		return fmt.Errorf("hash de contacto: %w", err)
	}

	var codigo, codigoHash string
	var userID *string
	if cuenta != nil {
		codigo, err = codigoNumerico(6)
		if err != nil {
			return fmt.Errorf("generar codigo: %w", err)
		}
		codigoHash = hashCodigo(codigo)
		userID = &cuenta.ID
	}

	// Una sola solicitud abierta por contacto (uq_adr_contacto_abierto). Pedir de
	// nuevo renueva el codigo, pero NUNCA toca una ya verificada: si cualquiera
	// que conozca el correo pudiera reabrirla, sacaria de la cola una solicitud
	// legitima.
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO account_deletion_requests
		       (contact_kind, contact_hash, user_id, status, verification_hash, verification_expires_at,
		        terms_accepted_at)
		VALUES ($1, $2, $3::uuid, 'pending_verification', NULLIF($4, ''),
		        CASE WHEN $4 = '' THEN NULL ELSE NOW() + $5::interval END, NOW())
		ON CONFLICT (contact_hash) WHERE status IN ('pending_verification', 'verified')
		DO UPDATE SET user_id = EXCLUDED.user_id,
		              verification_hash = EXCLUDED.verification_hash,
		              verification_expires_at = EXCLUDED.verification_expires_at,
		              verification_attempts = CASE
		                  WHEN account_deletion_requests.verification_expires_at < NOW() - $7::interval THEN 0
		                  ELSE account_deletion_requests.verification_attempts END,
		              terms_accepted_at = EXCLUDED.terms_accepted_at
		WHERE account_deletion_requests.status = 'pending_verification'
		  AND (account_deletion_requests.verification_expires_at IS NULL
		       OR account_deletion_requests.verification_expires_at < NOW() + $6::interval)
		  -- Con los intentos agotados no sale otro codigo hasta que pase la ventana:
		  -- no serviria, y seria un mensaje mas en el buzon de otra persona.
		  AND (account_deletion_requests.verification_attempts < $8
		       OR account_deletion_requests.verification_expires_at < NOW() - $7::interval)`,
		string(kind), contactHash, userID, codigoHash,
		fmt.Sprintf("%d seconds", int(vigenciaCodigo.Seconds())),
		fmt.Sprintf("%d seconds", int((vigenciaCodigo-esperaEntreCodigos).Seconds())),
		// El vencimiento es el envio mas vigenciaCodigo: "mas de un dia desde el
		// ultimo codigo" es vencido hace mas de la ventana menos la vigencia.
		fmt.Sprintf("%d seconds", int((ventanaDeIntentos-vigenciaCodigo).Seconds())),
		maxIntentosCodigo)
	if err != nil {
		return fmt.Errorf("guardar solicitud: %w", err)
	}

	// El envio va por fuera de la peticion: con o sin cuenta la respuesta tarda
	// lo mismo, y un proveedor lento no retiene al formulario.
	if cuenta != nil && tag.RowsAffected() > 0 {
		// #nosec G118 -- intentionally detached: the request context dies with
		// the response, the delivery must outlive it, and enviarCodigo bounds
		// itself with avisoTimeout.
		go s.enviarCodigo(kind, canonico, cuenta, codigo)
	}
	return nil
}

func (s *Service) enviarCodigo(kind identifier.Kind, canonico string, cuenta *user.UserRecord, codigo string) {
	ctx, cancel := context.WithTimeout(context.Background(), avisoTimeout)
	defer cancel()

	// Por SMS si se pidio con el telefono y hay proveedor; si no, al correo de la
	// cuenta: probar el codigo prueba que controla el buzon registrado, que es una
	// prueba igual de buena de que es la persona.
	if kind == identifier.KindPhone && s.sms != nil {
		if err := s.sms.SendSMS(ctx, canonico, messaging.DeletionCodeSMS(codigo)); err != nil {
			s.logger.Warn("codigo de eliminacion no enviado por SMS", "user", cuenta.ID, "err", err.Error())
		}
		return
	}
	destino := canonico
	if kind == identifier.KindPhone {
		destino = cuenta.Email
	}
	if destino == "" || s.email == nil {
		s.logger.Warn("codigo de eliminacion sin canal de entrega", "user", cuenta.ID)
		return
	}
	subject, text, html := messaging.DeletionCodeEmail(codigo)
	if err := s.email.SendEmail(ctx, destino, subject, text, html); err != nil {
		s.logger.Warn("codigo de eliminacion no enviado por correo", "user", cuenta.ID, "err", err.Error())
	}
}

// RespuestaWeb es lo que la pagina le muestra a quien presento el codigo
// correcto, que ya probo que el contacto es suyo: la misma respuesta escrita que
// le llega por correo.
type RespuestaWeb struct {
	// Resultado: scheduled (empezo el plazo), blocked (hay que resolver algo),
	// rejected (esta cuenta no se elimina por esta via) o received (la atiende
	// una persona). En received no se dice por que: una cuenta bajo revision no
	// se anuncia.
	Resultado     string     `json:"outcome"`
	SeEliminaEl   *time.Time `json:"deletion_due_at,omitempty"`
	ConservaHasta *time.Time `json:"retained_until,omitempty"`
	Bloqueos      []string   `json:"blockers,omitempty"`
	// ResponderAntesDe: hasta cuando hay que responder la que espera a una persona.
	ResponderAntesDe *time.Time `json:"respond_by,omitempty"`
}

// Verificar es Confirmar sin la respuesta para la pagina.
func (s *Service) Verificar(ctx context.Context, raw, codigo string) error {
	_, err := s.Confirmar(ctx, raw, codigo)
	return err
}

// Confirmar comprueba el codigo. Con el codigo correcto empieza el plazo (el dia
// 0), salvo que la cuenta este bajo revision: esa queda en la cola de
// operaciones. Un bloqueo (saldo, algo en curso) no es un error de la
// verificacion: la solicitud queda bloqueada y se le escribe a la persona.
// Devuelve lo que la pagina le muestra.
func (s *Service) Confirmar(ctx context.Context, raw, codigo string) (*RespuestaWeb, error) {
	_, canonico, err := s.contacto(raw)
	if err != nil {
		return nil, err
	}
	var contactHash string
	if err := s.pool.QueryRow(ctx, `SELECT fn_pii_hmac($1)`, canonico).Scan(&contactHash); err != nil {
		return nil, fmt.Errorf("hash de contacto: %w", err)
	}

	// fallido distingue "codigo equivocado" de un error de verdad: el primero debe
	// CONFIRMAR la transaccion (para que el intento sumado quede escrito) y solo
	// despues responder ErrCodigoInvalido; devolver el error desde dentro la
	// desharia y el tope de intentos nunca se alcanzaria.
	var (
		fallido    bool
		cuenta     string
		out        *Atendida
		res        resultado
		verificada time.Time
	)
	err = s.conReintentos(ctx, func(tx pgx.Tx) error {
		fallido, cuenta, out, res, verificada = false, "", nil, resultado{}, time.Time{}
		var (
			id       string
			guardado *string
			vence    *time.Time
			intentos int
			cuentaDe *string
		)
		err := tx.QueryRow(ctx, `
			SELECT id::text, verification_hash, verification_expires_at, verification_attempts, user_id::text
			  FROM account_deletion_requests
			 WHERE contact_hash = $1 AND status = 'pending_verification'
			   FOR UPDATE`, contactHash,
		).Scan(&id, &guardado, &vence, &intentos, &cuentaDe)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrCodigoInvalido
		}
		if err != nil {
			return fmt.Errorf("leer solicitud: %w", err)
		}
		if cuentaDe == nil || guardado == nil || vence == nil || time.Now().After(*vence) || intentos >= maxIntentosCodigo {
			return ErrCodigoInvalido
		}
		esperado := []byte(*guardado)
		recibido := []byte(hashCodigo(codigo))
		if subtle.ConstantTimeCompare(esperado, recibido) != 1 {
			if _, err := tx.Exec(ctx,
				`UPDATE account_deletion_requests SET verification_attempts = verification_attempts + 1 WHERE id = $1::uuid`, id); err != nil {
				return fmt.Errorf("sumar intento: %w", err)
			}
			fallido = true
			return nil
		}
		cuenta = *cuentaDe
		err = tx.QueryRow(ctx, `
			UPDATE account_deletion_requests
			   SET status = 'verified', verified_at = NOW(), verification_hash = NULL
			 WHERE id = $1::uuid
			RETURNING verified_at`, id).Scan(&verificada)
		if err != nil {
			return fmt.Errorf("marcar verificada: %w", err)
		}
		// Una cuenta bajo revision espera a operaciones: no pide la eliminacion
		// sola. Cualquier otra empieza el plazo ahora, en esta misma transaccion.
		var status string
		if err := tx.QueryRow(ctx, `SELECT COALESCE(status, 'active') FROM users WHERE id = $1::uuid`, cuenta).Scan(&status); err != nil {
			return fmt.Errorf("leer cuenta: %w", err)
		}
		if status == "blocked" || status == "suspended" {
			// Su respuesta entra ya a la bandeja, sin decidir, con el plazo desde
			// esta verificacion (decision del dueno del 2026-10-22).
			return encolarSinDecidir(ctx, tx, cuenta, id, verificada)
		}
		out, res, err = atenderEnTx(ctx, tx, id, cuenta, "", opciones{canal: CanalWeb})
		return err
	})
	if err != nil {
		return nil, err
	}
	if fallido {
		return nil, ErrCodigoInvalido
	}
	s.despuesDeAtender(ctx, cuenta, out, res)

	web := &RespuestaWeb{Resultado: "received"}
	if out == nil {
		// La atiende una persona: la pagina dice hasta cuando, no por que.
		antesDe := responderAntesDe(verificada)
		web.ResponderAntesDe = &antesDe
	}
	if out != nil {
		switch out.Estado {
		case "scheduled":
			dia30, hasta := res.SeEliminaEl, conservaHasta(res.SeEliminaEl)
			web.Resultado, web.SeEliminaEl, web.ConservaHasta = RespuestaPlazoIniciado, &dia30, &hasta
		case "blocked":
			web.Resultado, web.Bloqueos = RespuestaBloqueada, codigosDeBloqueo(out.Bloqueos)
		case "rejected":
			web.Resultado = "rejected"
		}
	}
	return web, nil
}

// atenderEnTx pide la eliminacion de la cuenta de una solicitud web ya
// verificada y deja el resultado escrito en la solicitud: el plazo iniciado
// (scheduled), bloqueada con la primera razon, o rechazada. adminID es quien la
// atiende; vacio cuando la atiende el propio codigo de la persona.
func atenderEnTx(ctx context.Context, tx pgx.Tx, solicitudID, userID, adminID string, op opciones) (*Atendida, resultado, error) {
	var out *Atendida
	cerrar := func(estadoFinal, codigo string) error {
		_, err := tx.Exec(ctx, `
			UPDATE account_deletion_requests
			   SET status = $2, result_code = $3, processed_at = NOW(), processed_by = NULLIF($4, '')::uuid
			 WHERE id = $1::uuid`, solicitudID, estadoFinal, codigo, adminID)
		if err != nil {
			return fmt.Errorf("cerrar solicitud: %w", err)
		}
		out = &Atendida{Estado: estadoFinal, Codigo: codigo}
		return nil
	}

	// El plazo legal de la respuesta corre desde la verificacion.
	var verificada *time.Time
	if err := tx.QueryRow(ctx, `SELECT verified_at FROM account_deletion_requests WHERE id = $1::uuid`,
		solicitudID).Scan(&verificada); err != nil {
		return nil, resultado{}, fmt.Errorf("leer la solicitud: %w", err)
	}
	if verificada != nil {
		op.solicitadaEn = *verificada
	}
	// rechazar cierra la solicitud y le deja su respuesta: no se atiende por
	// esta via. No dice por que.
	var respuestaDelRechazo string
	rechazar := func(codigo string) error {
		id, err := responder(ctx, tx, userID, solicitudID, nuevaRespuesta{tipo: RespuestaRechazada, desde: op.solicitadaEn})
		if err != nil {
			return err
		}
		respuestaDelRechazo = id
		return cerrar("rejected", codigo)
	}

	op.actor = adminID
	op.solicitud = solicitudID
	res, err := iniciarEnTx(ctx, tx, userID, op)
	var bloqueada *ErrBloqueada
	switch {
	case err == nil && res.Ya:
		// Pedirla otra vez es otra solicitud y lleva su respuesta. Si la
		// anterior todavia no salio, es esa misma.
		if res.Respuesta, err = respuestaPendiente(ctx, tx, userID, RespuestaPlazoIniciado); err == nil && res.Respuesta == "" {
			dia30 := res.SeEliminaEl
			res.Respuesta, err = responder(ctx, tx, userID, solicitudID, nuevaRespuesta{
				tipo: RespuestaPlazoIniciado, seEliminaEl: &dia30, desde: op.solicitadaEn,
			})
		}
		if err == nil {
			err = cerrar("scheduled", "ALREADY_REQUESTED")
		}
	case err == nil:
		err = cerrar("scheduled", "SCHEDULED")
	case errors.As(err, &bloqueada):
		// La solicitud no pudo empezar, y eso tambien se responde por escrito:
		// que resolver. Va por la bandeja como la del dia 0.
		res = resultado{}
		if res.Respuesta, err = responder(ctx, tx, userID, solicitudID, nuevaRespuesta{
			tipo: RespuestaBloqueada, bloqueos: codigosDeBloqueo(bloqueada.Bloqueos), desde: op.solicitadaEn,
		}); err == nil {
			if err = cerrar("blocked", bloqueada.Bloqueos[0].Codigo); err == nil {
				out.Bloqueos = bloqueada.Bloqueos
			}
		}
	case errors.Is(err, ErrRolNoPermitido):
		res, err = resultado{}, rechazar("ROLE_NOT_ALLOWED")
	case errors.Is(err, user.ErrCuentaDeDemostracion):
		res, err = resultado{}, rechazar("DEMO_ACCOUNT")
	case errors.Is(err, ErrCuentaNoElegible):
		res, err = resultado{}, rechazar("NOT_ELIGIBLE")
	case errors.Is(err, ErrCuentaNoEncontrada):
		// Sin la cuenta no hay a quien responder.
		err = cerrar("rejected", "NOT_FOUND")
	}
	// Lo que haya quedado sin decidir de esta solicitud ya no tiene que decir: la
	// cubre otra respuesta que todavia no salio, o no hay a quien responder.
	if err == nil {
		err = cancelarSinDecidir(ctx, tx, solicitudID)
	}
	if err != nil {
		return nil, resultado{}, err
	}
	if respuestaDelRechazo != "" {
		res.Respuesta = respuestaDelRechazo
	}
	return out, res, nil
}

// despuesDeAtender hace lo que va tras el commit: si empezo el plazo, lo mismo
// que la via de la app; si ya estaba en plazo, quedo bloqueada o se rechazo, el
// primer intento de la respuesta que quedo en la bandeja.
func (s *Service) despuesDeAtender(_ context.Context, userID string, out *Atendida, res resultado) {
	if userID == "" || out == nil {
		return
	}
	switch out.Estado {
	case "scheduled":
		if res.Ya {
			s.entregarAhora(res.Respuesta)
			return
		}
		s.despues(userID, res)
	case "blocked", "rejected":
		s.entregarAhora(res.Respuesta)
	}
}

// SolicitudAdmin es una fila de la cola, tal como la ve operaciones. La cuenta
// va enmascarada desde SQL, como en el resto del panel.
type SolicitudAdmin struct {
	ID           string     `json:"id"`
	ContactKind  string     `json:"contact_kind"`
	Estado       string     `json:"status"`
	CreadaEn     time.Time  `json:"created_at"`
	VerificadaEn *time.Time `json:"verified_at"`
	// ResponderAntesDe es el plazo legal de la respuesta, desde la verificacion.
	ResponderAntesDe time.Time           `json:"respond_by"`
	Cuenta           *user.AdminUserView `json:"account"`
}

// ListarVerificadas devuelve la cola: las solicitudes con el contacto ya
// comprobado, la mas antigua primero.
func (s *Service) ListarVerificadas(ctx context.Context, limite int) ([]SolicitudAdmin, error) {
	// Sin pedido son 50; pedir mas que el tope devuelve el tope. Antes volvia
	// al valor por defecto, y `limit=500` traia menos filas que `limit=100`.
	if limite <= 0 {
		limite = 50
	} else if limite > 100 {
		limite = 100
	}
	filas, err := s.pool.Query(ctx, `
		SELECT id::text, contact_kind, status, created_at, verified_at, COALESCE(user_id::text, '')
		  FROM account_deletion_requests
		 WHERE status = 'verified'
		 ORDER BY verified_at ASC
		 LIMIT $1`, limite)
	if err != nil {
		return nil, fmt.Errorf("listar solicitudes: %w", err)
	}
	defer filas.Close()

	out := make([]SolicitudAdmin, 0, 8)
	for filas.Next() {
		var (
			r      SolicitudAdmin
			userID string
		)
		if err := filas.Scan(&r.ID, &r.ContactKind, &r.Estado, &r.CreadaEn, &r.VerificadaEn, &userID); err != nil {
			return nil, fmt.Errorf("leer solicitud: %w", err)
		}
		desde := r.CreadaEn
		if r.VerificadaEn != nil {
			desde = *r.VerificadaEn
		}
		r.ResponderAntesDe = responderAntesDe(desde)
		if userID != "" {
			// Si la cuenta ya no se puede leer (eliminada por otra via), la fila
			// sale sin ficha y el panel la ve como "sin cuenta".
			if v, err := s.users.GetAdminView(ctx, userID); err == nil {
				r.Cuenta = v
			}
		}
		out = append(out, r)
	}
	if err := filas.Err(); err != nil {
		return nil, fmt.Errorf("recorrer solicitudes: %w", err)
	}
	return out, nil
}

// Resultado de atender una solicitud.
type Atendida struct {
	Estado   string    `json:"status"`
	Codigo   string    `json:"result_code"`
	Bloqueos []Bloqueo `json:"blockers,omitempty"`
}

// Procesar atiende una solicitud de la cola (una cuenta bajo revision): inicia el
// plazo con el canal 'web' y, a diferencia de la via de la app, acepta una cuenta
// bloqueada porque aqui hay una persona de operaciones que la reviso. La cuenta
// sigue bloqueada: pedir la eliminacion no la desbloquea. El resultado queda
// escrito en la solicitud: el plazo iniciado, o bloqueada con la primera razon.
func (s *Service) Procesar(ctx context.Context, solicitudID, adminID string) (*Atendida, error) {
	var (
		out    *Atendida
		res    resultado
		cuenta string
	)
	err := s.conReintentos(ctx, func(tx pgx.Tx) error {
		out, res, cuenta = nil, resultado{}, ""

		var estado string
		var userID *string
		err := tx.QueryRow(ctx, `
			SELECT status, user_id::text FROM account_deletion_requests
			 WHERE id = $1::uuid FOR UPDATE`, solicitudID,
		).Scan(&estado, &userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrSolicitudNoEncontrada
		}
		if err != nil {
			return fmt.Errorf("leer solicitud: %w", err)
		}
		if estado != "verified" {
			return ErrSolicitudNoPendiente
		}

		if userID == nil {
			_, err := tx.Exec(ctx, `
				UPDATE account_deletion_requests
				   SET status = 'rejected', result_code = 'NO_ACCOUNT', processed_at = NOW(), processed_by = $2::uuid
				 WHERE id = $1::uuid`, solicitudID, adminID)
			if err != nil {
				return fmt.Errorf("cerrar solicitud: %w", err)
			}
			out = &Atendida{Estado: "rejected", Codigo: "NO_ACCOUNT"}
			return nil
		}
		cuenta = *userID
		out, res, err = atenderEnTx(ctx, tx, solicitudID, cuenta, adminID, opciones{
			canal: CanalWeb, permitirCuentaBloqueada: true,
		})
		return err
	})
	if err != nil {
		return nil, err
	}
	s.despuesDeAtender(ctx, cuenta, out, res)
	return out, nil
}

// frasesDeBloqueo es lo que se le escribe a la persona por cada cosa pendiente.
// Van aqui, y no en el front, porque salen por correo y no hay pantalla que las
// traduzca; en voseo, como el resto del correo. Un codigo que no este aqui cae
// en la frase generica (motivosDe).
var frasesDeBloqueo = map[string]string{
	BloqueoSaldo:             "tenés saldo en tu billetera: envialo, retiralo o gastalo hasta dejarla en cero",
	BloqueoAhorros:           "tenés dinero en tus metas de ahorro: pasalo a tu billetera",
	BloqueoCripto:            "tenés criptomonedas: vendelas o envialas",
	BloqueoStaking:           "tenés cripto en staking: retirala",
	BloqueoSaldoRegional:     "tenés saldo en una billetera regional",
	BloqueoSaldoComercio:     "tu comercio tiene saldo: pasalo a tu billetera",
	BloqueoCobrosAbiertos:    "tu comercio tiene cobros por QR sin pagar: cancelalos",
	BloqueoMovimientoEnCurso: "tenés un movimiento en proceso: esperá a que termine",
	BloqueoEscrowAbierto:     "tenés un acuerdo de garantía abierto: cerralo o esperá a que se liquide",
	BloqueoPayoutEnCurso:     "tenés un retiro en proceso: esperá a que termine",
	BloqueoTransfronterizo:   "tenés una transferencia internacional en proceso: esperá a que termine",
	BloqueoMarketplace:       "tenés un viaje o un pedido en curso: esperá a que termine",
}

// Rechazar cierra una solicitud de la cola sin iniciar nada (por ejemplo, cuando
// la persona se arrepintio). Tambien se responde por escrito, en la misma
// transaccion, con el plazo contado desde la verificacion. Si la cuenta ya esta
// en el plazo (lo empezo por la app mientras la solicitud esperaba), esa
// respuesta diria que no se borro nada con el plazo corriendo: no se rechaza
// (ErrCuentaYaEnPlazo), y la solicitud se cierra con Iniciar el plazo.
func (s *Service) Rechazar(ctx context.Context, solicitudID, adminID string) error {
	var respuesta string
	err := s.conReintentos(ctx, func(tx pgx.Tx) error {
		respuesta = ""
		var (
			userID     *string
			verificada *time.Time
		)
		err := tx.QueryRow(ctx, `
			UPDATE account_deletion_requests q
			   SET status = 'rejected', result_code = 'REJECTED_BY_ADMIN',
			       processed_at = NOW(), processed_by = $2::uuid
			 WHERE q.id = $1::uuid AND q.status = 'verified'
			   AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = q.user_id AND u.deletion_requested_at IS NOT NULL)
			RETURNING q.user_id::text, q.verified_at`, solicitudID, adminID).Scan(&userID, &verificada)
		if errors.Is(err, pgx.ErrNoRows) {
			var pendiente bool
			if err := tx.QueryRow(ctx, `
				SELECT EXISTS (SELECT 1 FROM account_deletion_requests WHERE id = $1::uuid AND status = 'verified')`,
				solicitudID).Scan(&pendiente); err != nil {
				return fmt.Errorf("leer solicitud: %w", err)
			}
			if pendiente {
				return ErrCuentaYaEnPlazo
			}
			return ErrSolicitudNoPendiente
		}
		if err != nil {
			return fmt.Errorf("rechazar solicitud: %w", err)
		}
		if userID == nil {
			return nil
		}
		r := nuevaRespuesta{tipo: RespuestaRechazada}
		if verificada != nil {
			r.desde = *verificada
		}
		respuesta, err = responder(ctx, tx, *userID, solicitudID, r)
		return err
	})
	if err != nil {
		return err
	}
	s.entregarAhora(respuesta)
	return nil
}
