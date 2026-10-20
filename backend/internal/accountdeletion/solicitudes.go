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
//     desbloquearla.

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
// correcto: la misma respuesta escrita que le llega por correo.
type RespuestaWeb struct {
	// Resultado: scheduled (empezo el plazo), blocked (hay que resolver algo) o
	// received (la atiende una persona; no se dice por que).
	Resultado     string     `json:"outcome"`
	SeEliminaEl   *time.Time `json:"deletion_due_at,omitempty"`
	ConservaHasta *time.Time `json:"retained_until,omitempty"`
	Bloqueos      []string   `json:"blockers,omitempty"`
}

// Confirmar es Verificar con la respuesta para la pagina.
func (s *Service) Confirmar(ctx context.Context, raw, codigo string) (*RespuestaWeb, error) {
	if err := s.Verificar(ctx, raw, codigo); err != nil {
		return nil, err
	}
	return &RespuestaWeb{Resultado: "received"}, nil
}

// Verificar comprueba el codigo. Con el codigo correcto empieza el plazo (el dia
// 0), salvo que la cuenta este bajo revision: esa queda en la cola de
// operaciones. Un bloqueo (saldo, algo en curso) no es un error de la
// verificacion: la solicitud queda bloqueada y se le escribe a la persona.
func (s *Service) Verificar(ctx context.Context, raw, codigo string) error {
	_, canonico, err := s.contacto(raw)
	if err != nil {
		return err
	}
	var contactHash string
	if err := s.pool.QueryRow(ctx, `SELECT fn_pii_hmac($1)`, canonico).Scan(&contactHash); err != nil {
		return fmt.Errorf("hash de contacto: %w", err)
	}

	// fallido distingue "codigo equivocado" de un error de verdad: el primero debe
	// CONFIRMAR la transaccion (para que el intento sumado quede escrito) y solo
	// despues responder ErrCodigoInvalido; devolver el error desde dentro la
	// desharia y el tope de intentos nunca se alcanzaria.
	var (
		fallido bool
		cuenta  string
		out     *Atendida
		res     resultado
	)
	err = s.conReintentos(ctx, func(tx pgx.Tx) error {
		fallido, cuenta, out, res = false, "", nil, resultado{}
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
		_, err = tx.Exec(ctx, `
			UPDATE account_deletion_requests
			   SET status = 'verified', verified_at = NOW(), verification_hash = NULL
			 WHERE id = $1::uuid`, id)
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
			return nil
		}
		out, res, err = atenderEnTx(ctx, tx, id, cuenta, "", opciones{canal: CanalWeb})
		return err
	})
	if err != nil {
		return err
	}
	if fallido {
		return ErrCodigoInvalido
	}
	s.despuesDeAtender(ctx, cuenta, out, res)
	return nil
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

	op.actor = adminID
	res, err := iniciarEnTx(ctx, tx, userID, op)
	var bloqueada *ErrBloqueada
	switch {
	case err == nil && res.Ya:
		err = cerrar("scheduled", "ALREADY_REQUESTED")
	case err == nil:
		err = cerrar("scheduled", "SCHEDULED")
	case errors.As(err, &bloqueada):
		if err = cerrar("blocked", bloqueada.Bloqueos[0].Codigo); err == nil {
			out.Bloqueos = bloqueada.Bloqueos
		}
	case errors.Is(err, ErrRolNoPermitido):
		err = cerrar("rejected", "ROLE_NOT_ALLOWED")
	case errors.Is(err, user.ErrCuentaDeDemostracion):
		err = cerrar("rejected", "DEMO_ACCOUNT")
	case errors.Is(err, ErrCuentaNoElegible):
		err = cerrar("rejected", "NOT_ELIGIBLE")
	case errors.Is(err, ErrCuentaNoEncontrada):
		err = cerrar("rejected", "NOT_FOUND")
	}
	if err != nil {
		return nil, resultado{}, err
	}
	return out, res, nil
}

// despuesDeAtender manda lo que corresponde tras el commit: la respuesta
// escrita si empezo el plazo (otra vez, si ya estaba en plazo), o lo que hay
// que resolver si quedo bloqueada.
func (s *Service) despuesDeAtender(ctx context.Context, userID string, out *Atendida, res resultado) {
	if userID == "" || out == nil {
		return
	}
	switch out.Estado {
	case "scheduled":
		if res.Ya {
			s.responderPorEscrito(userID, res)
			return
		}
		s.despues(userID, res)
	case "blocked":
		s.avisarBloqueo(ctx, userID, out.Bloqueos)
	}
}

// SolicitudAdmin es una fila de la cola, tal como la ve operaciones. La cuenta
// va enmascarada desde SQL, como en el resto del panel.
type SolicitudAdmin struct {
	ID           string              `json:"id"`
	ContactKind  string              `json:"contact_kind"`
	Estado       string              `json:"status"`
	CreadaEn     time.Time           `json:"created_at"`
	VerificadaEn *time.Time          `json:"verified_at"`
	Cuenta       *user.AdminUserView `json:"account"`
}

// ListarVerificadas devuelve la cola: las solicitudes con el contacto ya
// comprobado, la mas antigua primero.
func (s *Service) ListarVerificadas(ctx context.Context, limite int) ([]SolicitudAdmin, error) {
	if limite <= 0 || limite > 100 {
		limite = 50
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
// traduzca. Un codigo que no este aqui cae en la frase generica.
var frasesDeBloqueo = map[string]string{
	BloqueoSaldo:             "tienes saldo en tu billetera: envíalo, retíralo o gástalo hasta dejarla en cero",
	BloqueoAhorros:           "tienes dinero en tus metas de ahorro: pásalo a tu billetera",
	BloqueoCripto:            "tienes criptomonedas: véndelas o envíalas",
	BloqueoStaking:           "tienes cripto en staking: retírala",
	BloqueoSaldoRegional:     "tienes saldo en una billetera regional",
	BloqueoSaldoComercio:     "tu comercio tiene saldo: pásalo a tu billetera",
	BloqueoCobrosAbiertos:    "tu comercio tiene cobros por QR sin pagar: cancélalos",
	BloqueoMovimientoEnCurso: "tienes un movimiento en proceso: espera a que termine",
	BloqueoEscrowAbierto:     "tienes un acuerdo de garantía abierto: ciérralo o espera a que se liquide",
	BloqueoPayoutEnCurso:     "tienes un retiro en proceso: espera a que termine",
	BloqueoTransfronterizo:   "tienes una transferencia internacional en proceso: espera a que termine",
	BloqueoMarketplace:       "tienes un viaje o un pedido en curso: espera a que termine",
}

// avisarBloqueo le escribe a la persona, al correo de su cuenta, que su
// solicitud todavia no se pudo atender y que tiene que resolver. Sin esto una
// solicitud hecha desde la web que no se puede completar moriria en silencio: la
// pagina promete que se avisa. Sin correo en la cuenta no hay a donde avisar y la
// solicitud queda marcada como bloqueada para operaciones. Es de mejor esfuerzo:
// la base ya quedo escrita.
func (s *Service) avisarBloqueo(ctx context.Context, userID string, bloqueos []Bloqueo) {
	if s.email == nil || len(bloqueos) == 0 {
		return
	}
	u, err := s.users.FindByID(ctx, userID)
	if err != nil || u.Email == "" {
		return
	}
	motivos := make([]string, 0, len(bloqueos))
	for _, b := range bloqueos {
		if f, ok := frasesDeBloqueo[b.Codigo]; ok {
			motivos = append(motivos, f)
		} else {
			motivos = append(motivos, "hay algo pendiente en tu cuenta")
		}
	}
	// #nosec G118 -- intentionally detached: the request context dies with the
	// response and the notice must outlive it; it bounds itself with avisoTimeout.
	go func(correo string) {
		cctx, cancel := context.WithTimeout(context.Background(), avisoTimeout)
		defer cancel()
		subject, text, html := messaging.DeletionBlockedEmail(motivos)
		if err := s.email.SendEmail(cctx, correo, subject, text, html); err != nil {
			s.logger.Warn("aviso de eliminacion bloqueada no enviado", "user", userID, "err", err.Error())
		}
	}(u.Email)
}

// Rechazar cierra una solicitud de la cola sin iniciar nada (por ejemplo, cuando
// la persona se arrepintio).
func (s *Service) Rechazar(ctx context.Context, solicitudID, adminID string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE account_deletion_requests
		   SET status = 'rejected', result_code = 'REJECTED_BY_ADMIN',
		       processed_at = NOW(), processed_by = $2::uuid
		 WHERE id = $1::uuid AND status = 'verified'`, solicitudID, adminID)
	if err != nil {
		return fmt.Errorf("rechazar solicitud: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrSolicitudNoPendiente
	}
	return nil
}
