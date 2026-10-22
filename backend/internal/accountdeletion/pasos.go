package accountdeletion

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/user"
)

// Canal es por donde llego la solicitud. Se guarda en users.deletion_channel.
type Canal string

const (
	CanalApp   Canal = "in_app"
	CanalWeb   Canal = "web"
	CanalAdmin Canal = "admin"
)

// plazo es lo que corre entre el pedido y el cierre efectivo. La persona lo
// acepta de forma expresa al pedir la eliminacion.
const plazo = 30 * 24 * time.Hour

// Anos que se conserva lo que la ley obliga, contados desde el cierre: cinco
// (Ley 7786, art. 16), o diez con la marca de conservacion extendida que pone
// cumplimiento (users.retention_extended_at).
const (
	anosDeConservacion           = 5
	intervaloConservacion        = "5 years"
	intervaloConservacionExtensa = "10 years"
)

// opciones afina la solicitud segun quien la pide.
type opciones struct {
	canal Canal
	// actor es el administrador que la atiende; vacio cuando la pide la propia
	// persona. Solo va a la auditoria.
	actor string
	// permitirCuentaBloqueada es true solo para la via que pasa por una persona
	// de operaciones: una cuenta bloqueada o suspendida esta bajo revision y no
	// pide la eliminacion sola. Aun asi la cuenta SIGUE bloqueada: pedir la
	// eliminacion no la desbloquea.
	permitirCuentaBloqueada bool
	// correoParaRespuesta es el correo que dio, solo para la respuesta escrita,
	// una persona cuya cuenta no tiene correo. Se ignora si la cuenta tiene uno.
	correoParaRespuesta string
	// respuesta es la respuesta escrita sobre la que actua operaciones. Solo va
	// a la auditoria.
	respuesta string
	// solicitadaEn es cuando se verifico la solicitud web: de ahi corre el plazo
	// legal de la respuesta, aunque operaciones la atienda despues. Vacio en la
	// via de la app, que pide y responde en el mismo acto.
	solicitadaEn time.Time
	// solicitud es la solicitud web que se atiende: su respuesta sin decidir es
	// la que se completa. Vacio en la via de la app.
	solicitud string
	// fuente dice de donde salio lo que se revela cuando no es la cuenta:
	// closed_account_record si Ver contacto leyo lo conservado por ley. Solo va
	// a la auditoria.
	fuente string
}

// resultado de pedir la eliminacion. Respuesta es el id de la respuesta escrita
// que quedo en la bandeja, para el primer intento despues del commit; vacio si
// no se encolo ninguna (la segunda orden de la app, por ejemplo).
type resultado struct {
	Ya           bool
	SolicitadaEn time.Time
	SeEliminaEl  time.Time
	Correo       string
	Nombre       string
	Respuesta    string
}

// ── Dia 0 ─────────────────────────────────────────────────────────────────

// iniciarEnTx pide la eliminacion dentro de la transaccion que le dan, que el
// llamante abre SERIALIZABLE. No borra nada: corta el acceso y el dinero, y
// fija el dia 30.
//
// Orden, y por que:
//  1. Bloquear la fila de la persona y su billetera. Una transferencia
//     concurrente toca esa billetera; con la fila bloqueada, o espera a que
//     terminemos o la serializacion la rechaza.
//  2. Comprobar elegibilidad y bloqueos YA con el bloqueo puesto. Comprobarlos
//     antes seria una carrera: entre la comprobacion y el cierre del libro puede
//     entrar dinero.
//  3. Cerrar el libro, revocar el acceso y fijar las fechas.
func iniciarEnTx(ctx context.Context, tx pgx.Tx, userID string, op opciones) (resultado, error) {
	var (
		status, role  string
		pedida, vence *time.Time
		cerrada, demo bool
		correo        *string
		nombre        string
	)
	err := tx.QueryRow(ctx,
		`SELECT COALESCE(status, 'active'), COALESCE(role, 'user'),
		        deletion_requested_at, deletion_due_at, deleted_at IS NOT NULL,
		        COALESCE(demo_login, false), fn_pii_decrypt(email_enc), first_name
		   FROM users
		  WHERE id = $1::uuid
		    FOR UPDATE`,
		userID,
	).Scan(&status, &role, &pedida, &vence, &cerrada, &demo, &correo, &nombre)
	if errors.Is(err, pgx.ErrNoRows) {
		return resultado{}, ErrCuentaNoEncontrada
	}
	if err != nil {
		return resultado{}, fmt.Errorf("leer cuenta: %w", err)
	}
	res := resultado{Nombre: nombre}
	if correo != nil {
		res.Correo = *correo
	}
	if pedida != nil && vence != nil {
		// Segunda orden sobre la misma cuenta (doble clic, reintento, la app y la
		// web a la vez): la solicitud ya existe y el plazo no vuelve a correr.
		res.Ya, res.SolicitadaEn, res.SeEliminaEl = true, *pedida, *vence
		return res, nil
	}
	if cerrada {
		return resultado{}, ErrCuentaNoElegible
	}
	if role != "user" {
		return resultado{}, ErrRolNoPermitido
	}
	// Una cuenta de demostracion no se elimina por ninguna via: la app lo
	// rechaza antes de la contrasena, y la web llega hasta aqui con el codigo del
	// correo.
	if demo {
		return resultado{}, user.ErrCuentaDeDemostracion
	}
	// Elegible: activa, o bajo revision cuando una persona de operaciones la atiende.
	bajoRevision := status == "blocked" || status == "suspended"
	elegible := status == "active" || (bajoRevision && op.permitirCuentaBloqueada)
	if !elegible {
		return resultado{}, ErrCuentaNoElegible
	}

	if _, err := tx.Exec(ctx, `SELECT 1 FROM wallets WHERE user_id = $1::uuid FOR UPDATE`, userID); err != nil {
		return resultado{}, fmt.Errorf("bloquear billetera: %w", err)
	}
	bloqueos, err := bloqueosDe(ctx, tx, userID)
	if err != nil {
		return resultado{}, err
	}
	if len(bloqueos) > 0 {
		return resultado{}, &ErrBloqueada{Bloqueos: bloqueos}
	}

	// Una cuenta bajo revision conserva su estado: el bloqueo es de operaciones
	// y lo levanta operaciones (al desbloquear vuelve a 'pending_deletion').
	err = tx.QueryRow(ctx, `
		UPDATE users SET
		    status                     = CASE WHEN status = 'active' THEN 'pending_deletion' ELSE status END,
		    deletion_requested_at      = NOW(),
		    deletion_due_at            = NOW() + $2::interval,
		    deletion_terms_accepted_at = NOW(),
		    deletion_channel           = $3,
		    updated_at                 = NOW()
		WHERE id = $1::uuid
		RETURNING deletion_requested_at, deletion_due_at`,
		userID, fmt.Sprintf("%d seconds", int(plazo.Seconds())), string(op.canal),
	).Scan(&res.SolicitadaEn, &res.SeEliminaEl)
	if err != nil {
		return resultado{}, fmt.Errorf("registrar la solicitud: %w", err)
	}
	if err := correr(ctx, tx, pasosDelDiaCero, userID); err != nil {
		return resultado{}, err
	}
	// Auditoria en la MISMA transaccion (el Logger asincrono puede perder el
	// evento si el proceso cae justo despues del commit). Sin IP ni agente: no se
	// guardan datos nuevos de una persona que acaba de pedir que se borren.
	if err := auditar(ctx, tx, userID, "account_deletion_requested", op); err != nil {
		return resultado{}, err
	}
	// La respuesta escrita queda en la bandeja en esta MISMA transaccion: si la
	// solicitud quedo, la respuesta tambien, aunque el proceso caiga despues.
	correoDado := ""
	if res.Correo == "" {
		correoDado = op.correoParaRespuesta
	}
	dia30 := res.SeEliminaEl
	if res.Respuesta, err = responder(ctx, tx, userID, op.solicitud, nuevaRespuesta{
		tipo: RespuestaPlazoIniciado, seEliminaEl: &dia30, correoDado: correoDado, desde: op.solicitadaEn,
	}); err != nil {
		return resultado{}, err
	}
	// Una solicitud anterior que habia quedado bloqueada o rechazada ya no tiene
	// nada que resolver: su respuesta (que no se borro nada) no debe salir
	// despues de esta.
	if _, err := tx.Exec(ctx, `
		UPDATE account_deletion_responses SET cancelled_at = NOW(), email_enc = NULL
		 WHERE user_id = $1::uuid AND kind IN ($2, $3) AND delivered_at IS NULL AND cancelled_at IS NULL`,
		userID, RespuestaBloqueada, RespuestaRechazada); err != nil {
		return resultado{}, fmt.Errorf("cancelar la respuesta de la solicitud bloqueada: %w", err)
	}
	return res, nil
}

// pasosDelDiaCero cortan el acceso y el dinero sin borrar nada de lo que la
// persona encontraria al reactivar.
var pasosDelDiaCero = []paso{
	// Las sesiones y las familias de refresh se REVOCAN (las mismas sentencias
	// que el bloqueo, auth.blockAndRevoke): IsAccessJTIRevoked lee
	// user_sessions y el refresh muere por familia revocada. Al reactivar no se
	// resucitan: la persona entra con su contrasena.
	{"revocar refresh", `UPDATE refresh_tokens SET revoked_at = NOW()
		WHERE user_id = $1::uuid AND revoked_at IS NULL`},
	{"revocar sesiones", `UPDATE user_sessions SET revoked_at = NOW()
		WHERE user_id = $1::uuid AND revoked_at IS NULL`},
	// El canal B2B autentica por llave, no por JWT.
	{"revocar llaves api", `UPDATE api_keys SET status = 'revoked', revoked_at = NOW()
		WHERE user_id = $1::uuid AND status = 'active'`},
	// Sin avisos: una suscripcion es una credencial de entrega, no un registro.
	// Al reactivar, la persona vuelve a encenderlos desde Perfil.
	{"borrar push web", `DELETE FROM push_subscriptions WHERE user_id = $1::uuid`},
	{"borrar push nativo", `DELETE FROM push_dispositivos WHERE user_id = $1::uuid`},
	// El motor del libro se niega a asentar en una cuenta cerrada
	// (ledger.ErrCuentaCerrada): ni entra ni sale dinero, aunque un cliente
	// conserve un QR o un id viejo. Reactivar las reabre.
	//
	// El motor crea al vuelo la cuenta de una moneda que todavia no existe; si
	// se dejara asi, el primer cobro en dolares a un comercio sin cuenta en
	// dolares abriria una nueva. Por eso las que faltan se crean ya cerradas.
	// Sin destino en ON CONFLICT: cualquier unico (el codigo, o persona y
	// moneda) significa que ya existe, y la siguiente sentencia la cierra.
	{"provisionar cerradas las que faltan", `INSERT INTO ledger_accounts
		       (code, type, user_id, merchant_id, currency, normal_balance, closed_at)
		SELECT 'USER:' || $1::text || ':' || v.c, 'user_wallet', $1::uuid, NULL::uuid, v.c, 'credit', NOW()
		  FROM (VALUES ('CRC'), ('USD')) AS v(c)
		UNION ALL
		SELECT 'MERCHANT:' || m.id::text || ':' || v.c, 'merchant_wallet', NULL::uuid, m.id, v.c, 'credit', NOW()
		  FROM qr_merchants m, (VALUES ('CRC'), ('USD')) AS v(c)
		 WHERE m.user_id = $1::uuid
		ON CONFLICT DO NOTHING`},
	{"cerrar cuentas del libro", `UPDATE ledger_accounts SET closed_at = NOW()
		WHERE closed_at IS NULL
		  AND (user_id = $1::uuid
		       OR merchant_id IN (SELECT id FROM qr_merchants WHERE user_id = $1::uuid))`},
}

// motivoCierreDeComercio es el motivo con que el dia 30 cierra los comercios de
// la persona. Es el que la 079 completa en los que cerro la 077, y el que el
// dueno lee en "Comercios cerrados".
const motivoCierreDeComercio = "account_deletion"

// cerrarComercios cierra, con qrpayment.CerrarComercioEnTx, los comercios de la
// persona que siguen abiertos: es la unica forma de cerrar uno (marca quien y
// por que, revoca el equipo y los rotulos, y deja el rastro). Quien cierra es
// la propia persona: la fila de users se conserva, y asi el dueno lo lee como
// cerrado por el, con el motivo de la eliminacion.
//
// CerrarComercioEnTx pide READ COMMITTED porque, si un pago entrara mientras
// espera la fila del comercio, una foto vieja leeria el saldo sin ese pago.
// Aqui no puede pasar: las cuentas del libro del comercio estan cerradas desde
// el dia 0, asi que ningun pago entra, y un pago que tomo la fila antes hace
// fallar esta transaccion por serializacion y el reintento lo ve.
//
// Si un comercio no se puede cerrar (saldo o cobros vivos, que bloqueosDe ya
// deberia haber visto), devuelve ErrBloqueada: es un error para que la
// transaccion se deshaga entera, y el barrido lo trata como algo pendiente.
func cerrarComercios(ctx context.Context, tx pgx.Tx, userID string) error {
	filas, err := tx.Query(ctx, `SELECT id::text FROM qr_merchants
		WHERE user_id = $1::uuid AND closed_at IS NULL ORDER BY id`, userID)
	if err != nil {
		return fmt.Errorf("leer los comercios: %w", err)
	}
	ids, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("leer los comercios: %w", err)
	}
	for _, id := range ids {
		_, err := qrpayment.CerrarComercioEnTx(ctx, tx, id, qrpayment.Cierre{
			CerradoPor: userID,
			Motivo:     motivoCierreDeComercio,
			Accion:     qrpayment.AccionCierrePropio,
		})
		var conSaldo *qrpayment.ComercioConSaldoError
		var conCobros *qrpayment.ComercioConCobrosError
		switch {
		case err == nil:
		case errors.As(err, &conSaldo):
			return &ErrBloqueada{Bloqueos: []Bloqueo{{Codigo: BloqueoSaldoComercio}}}
		case errors.As(err, &conCobros):
			return &ErrBloqueada{Bloqueos: []Bloqueo{{Codigo: BloqueoCobrosAbiertos}}}
		default:
			return fmt.Errorf("cerrar el comercio %s: %w", id, err)
		}
	}
	return nil
}

// ── Reactivar ─────────────────────────────────────────────────────────────

// reactivarEnTx cancela el proceso si la cuenta esta en 'pending_deletion' y el
// barrido no la cerro (ver SeEliminaEl). false sin error: no habia nada que
// reactivar. La carrera con el cierre la ordena la fila de users: cerrarEnTx la
// bloquea, asi que o cierra primero (y aqui no hay fila) o reactiva primero (y
// el cierre ya no la encuentra en 'pending_deletion').
func reactivarEnTx(ctx context.Context, tx pgx.Tx, userID string) (bool, error) {
	tag, err := tx.Exec(ctx, `
		UPDATE users SET
		    status = 'active',
		    deletion_requested_at = NULL, deletion_due_at = NULL,
		    deletion_terms_accepted_at = NULL, deletion_channel = NULL,
		    updated_at = NOW()
		WHERE id = $1::uuid AND status = 'pending_deletion'
		  AND deleted_at IS NULL`, userID)
	if err != nil {
		return false, fmt.Errorf("reactivar la cuenta: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	for _, p := range []paso{
		{"reabrir cuentas del libro", `UPDATE ledger_accounts SET closed_at = NULL
			WHERE closed_at IS NOT NULL
			  AND (user_id = $1::uuid
			       OR merchant_id IN (SELECT id FROM qr_merchants WHERE user_id = $1::uuid))`},
		// La solicitud web que inicio el plazo queda cancelada: su historia dice
		// lo que paso.
		{"cancelar la solicitud web", `UPDATE account_deletion_requests
			SET status = 'cancelled', result_code = 'REACTIVATED', processed_at = NOW()
			WHERE user_id = $1::uuid AND status = 'scheduled'`},
		// La respuesta del dia 0 que todavia no salio ya no corresponde: la
		// persona cancelo la solicitud. El correo que dio para ella se borra.
		{"cancelar la respuesta pendiente", `UPDATE account_deletion_responses
			SET cancelled_at = NOW(), email_enc = NULL
			WHERE user_id = $1::uuid AND kind = 'scheduled'
			  AND delivered_at IS NULL AND cancelled_at IS NULL`},
	} {
		if _, err := tx.Exec(ctx, p.sql, userID); err != nil {
			return false, fmt.Errorf("%s: %w", p.nombre, err)
		}
	}
	if err := auditar(ctx, tx, userID, "account_deletion_cancelled", opciones{}); err != nil {
		return false, err
	}
	return true, nil
}

// ── Dia 30 ────────────────────────────────────────────────────────────────

// cerrarEnTx hace el cierre efectivo de una cuenta cuyo dia 30 ya llego. false
// sin error: no correspondia (ya cerrada, reactivada, todavia en plazo) o
// aparecio algo pendiente; en ese caso no toca nada y operaciones lo ve en el
// log.
//
// Lo que hace, segun la clasificacion de cada tabla (clasificacion.go):
//   - SUPRIME lo que la persona tiene derecho a borrar.
//   - REVOCA las credenciales: la fila queda (es el rastro de acceso), el
//     secreto se destruye.
//   - DEPURA el texto que la persona escribio en filas que se quedan.
//   - CONSERVA lo que la ley obliga, y saca la identidad de users a
//     closed_account_records. Ahi solo la lee Ver contacto de una respuesta
//     escrita sin entregar, con uso limitado (ContactoDeRespuesta).
func cerrarEnTx(ctx context.Context, tx pgx.Tx, userID string, now time.Time) (bool, []Bloqueo, error) {
	var canal string
	err := tx.QueryRow(ctx, `
		SELECT deletion_channel FROM users
		 WHERE id = $1::uuid AND deletion_requested_at IS NOT NULL
		   AND deleted_at IS NULL AND deletion_due_at <= $2
		   FOR UPDATE`, userID, now).Scan(&canal)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, fmt.Errorf("leer cuenta: %w", err)
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM wallets WHERE user_id = $1::uuid FOR UPDATE`, userID); err != nil {
		return false, nil, fmt.Errorf("bloquear billetera: %w", err)
	}
	// El libro esta cerrado desde el dia 0, asi que no deberia aparecer nada. Si
	// aparece, no se cierra a ciegas: una cuenta con saldo no se apaga.
	bloqueos, err := bloqueosDe(ctx, tx, userID)
	if err != nil {
		return false, nil, err
	}
	if len(bloqueos) > 0 {
		return false, bloqueos, nil
	}
	if err := cerrarComercios(ctx, tx, userID); err != nil {
		return false, nil, err
	}

	// La identidad sale de users ANTES de la tumba, con el mismo cifrado.
	if _, err := tx.Exec(ctx, `
		INSERT INTO closed_account_records
		       (user_id, first_name, last_name, birth_date, birth_date_enc,
		        cedula_hash, cedula_enc, phone_hash, phone_enc, email_hash, email_enc)
		SELECT id, first_name, last_name, birth_date, birth_date_enc,
		       cedula_hash, cedula_enc, phone_hash, phone_enc, email_hash, email_enc
		  FROM users WHERE id = $1::uuid
		ON CONFLICT (user_id) DO NOTHING`, userID); err != nil {
		return false, nil, fmt.Errorf("conservar la identidad: %w", err)
	}
	if err := correr(ctx, tx, pasosDelDiaTreinta, userID); err != nil {
		return false, nil, err
	}
	// La tumba va al final: los pasos anteriores aun buscan por la identidad.
	if _, err := tx.Exec(ctx, sqlTumba, userID); err != nil {
		return false, nil, fmt.Errorf("tumba: %w", err)
	}
	if err := auditar(ctx, tx, userID, "account_closed", opciones{canal: Canal(canal)}); err != nil {
		return false, nil, err
	}
	return true, nil, nil
}

// pasosDelDiaTreinta, de lo mas lejano a la tumba. El texto de cada uno dice
// por que.
var pasosDelDiaTreinta = []paso{
	// ── Suprimir: lo que la persona tiene derecho a borrar ──────────────────
	// Sesiones antes que dispositivos (user_sessions.device_id no tiene accion).
	// Borrarlas es seguro: se revocaron el dia 0 y los tokens de acceso viven
	// minutos, no 30 dias.
	{"borrar sesiones", `DELETE FROM user_sessions WHERE user_id = $1::uuid`},
	{"borrar dispositivos", `DELETE FROM user_devices WHERE user_id = $1::uuid`},
	{"borrar push web", `DELETE FROM push_subscriptions WHERE user_id = $1::uuid`},
	{"borrar push nativo", `DELETE FROM push_dispositivos WHERE user_id = $1::uuid`},
	{"borrar entregas webhook", `DELETE FROM webhook_deliveries
		WHERE endpoint_id IN (SELECT id FROM webhook_endpoints WHERE user_id = $1::uuid)`},
	{"borrar contactos sinpe", `DELETE FROM sinpe_contacts WHERE user_id = $1::uuid`},
	{"borrar cuentas bancarias", `DELETE FROM linked_bank_accounts WHERE user_id = $1::uuid`},
	{"borrar servicios guardados", `DELETE FROM saved_services WHERE user_id = $1::uuid`},
	{"borrar presupuestos", `DELETE FROM budgets WHERE user_id = $1::uuid`},
	{"borrar pagos recurrentes", `DELETE FROM recurring_payments WHERE user_id = $1::uuid`},
	{"borrar alertas de precio", `DELETE FROM crypto_price_alerts WHERE user_id = $1::uuid`},
	{"borrar conversaciones", `DELETE FROM assistant_conversations WHERE user_id = $1::uuid`},
	{"borrar notificaciones", `DELETE FROM notification_history WHERE user_id = $1::uuid`},
	{"borrar interes en planes", `DELETE FROM plan_interest WHERE user_id = $1::uuid`},
	{"borrar conexiones de socios", `DELETE FROM user_partner_connections WHERE user_id = $1::uuid`},

	// ── Revocar: la fila queda, el secreto no ───────────────────────────────
	// Quitar acceso no es borrar registros (regla del dueno): queda cuando se
	// emitio y cuando se revoco cada credencial; el hash, el secreto, la IP y el
	// agente se destruyen. Los reemplazos llevan el id para no chocar con los
	// UNIQUE de cada tabla.
	{"revocar refresh", `UPDATE refresh_tokens
		SET revoked_at = COALESCE(revoked_at, NOW()), token_hash = 'revoked:' || jti::text,
		    ip_address = NULL, user_agent = NULL
		WHERE user_id = $1::uuid`},
	{"revocar reset", `UPDATE password_reset_tokens
		SET token_hash = 'revoked:' || id::text, requested_ip = NULL,
		    used_at = COALESCE(used_at, NOW())
		WHERE user_id = $1::uuid`},
	{"revocar mfa", `UPDATE mfa_challenges
		SET code_hash = 'revoked', metadata = '{}'::jsonb, consumed_at = COALESCE(consumed_at, NOW())
		WHERE user_id = $1::uuid`},
	{"revocar totp", `UPDATE user_totp
		SET enabled = false, secret_enc = '\x00'::bytea, disabled_at = COALESCE(disabled_at, NOW()),
		    updated_at = NOW()
		WHERE user_id = $1::uuid`},
	{"revocar recuperacion totp", `UPDATE totp_recovery_codes
		SET code_hash = 'revoked:' || id::text, invalidated_at = COALESCE(invalidated_at, NOW())
		WHERE user_id = $1::uuid`},
	{"revocar llaves api", `UPDATE api_keys
		SET status = 'revoked', revoked_at = COALESCE(revoked_at, NOW()), key_hash = 'revoked:' || id::text
		WHERE user_id = $1::uuid`},
	{"revocar webhooks", `UPDATE webhook_endpoints
		SET status = 'disabled', secret = 'revoked', url = ''
		WHERE user_id = $1::uuid`},
	{"revocar vinculos de personal", `UPDATE merchant_staff
		SET status = 'revoked', revoked_at = COALESCE(revoked_at, NOW())
		WHERE status <> 'revoked'
		  AND (user_id = $1::uuid
		       OR merchant_id IN (SELECT id FROM qr_merchants WHERE user_id = $1::uuid))`},

	// ── Depurar: lo que la persona escribio, en filas que se quedan ─────────
	// El saldo de las metas es cero (lo garantizo el bloqueo); solo queda el
	// nombre que la persona le puso.
	{"depurar metas", `UPDATE savings_goals SET name = 'Meta eliminada' WHERE user_id = $1::uuid`},
	{"depurar viajes", `UPDATE ride_requests
		SET pickup = '', destination = '', driver_name = NULL, driver_car = NULL, driver_plate = NULL
		WHERE user_id = $1::uuid`},
	// La tarjeta se cancela y pierde el numero y el titular. last4 se queda: es
	// lo que identifica la tarjeta en los movimientos que se conservan.
	{"cancelar tarjetas", `UPDATE virtual_cards
		SET status = 'cancelled', card_number = '•••• •••• •••• ' || last4,
		    cardholder_name = 'Usuario eliminado', provider_card_id = NULL,
		    frozen_at = COALESCE(frozen_at, NOW())
		WHERE user_id = $1::uuid`},
	// Los QR de la persona dejan de cobrar. El libro ya los rechazaba desde el
	// dia 0; esto los saca de circulacion.
	{"revocar qr", `UPDATE qr_payment_codes
		SET status = 'revoked', revoked_at = COALESCE(revoked_at, NOW()), note = NULL
		WHERE creator_id = $1::uuid AND status <> 'revoked'`},
	{"depurar notas de qr", `UPDATE qr_payment_codes SET note = NULL WHERE creator_id = $1::uuid`},
	// Un reparto que la persona creo y sigue abierto ya no puede cobrarse: se
	// cancela. Sus propias partes pendientes quedan rechazadas.
	{"cancelar repartos", `UPDATE split_groups SET status = 'cancelled'
		WHERE creator_id = $1::uuid AND status = 'active'`},
	{"depurar repartos", `UPDATE split_groups
		SET title = 'Reparto eliminado', description = NULL
		WHERE creator_id = $1::uuid`},
	{"rechazar partes", `UPDATE split_shares SET status = 'declined'
		WHERE user_id = $1::uuid AND status = 'pending'`},
	{"depurar partes propias", `UPDATE split_shares
		SET user_name = 'Usuario eliminado', user_phone = NULL
		WHERE user_id = $1::uuid`},
	// El correo que la persona dio solo para la respuesta escrita. La fila queda:
	// es la constancia de que se respondio.
	{"depurar el correo de la respuesta", `UPDATE account_deletion_responses SET email_enc = NULL
		WHERE user_id = $1::uuid AND email_enc IS NOT NULL`},
	// Participantes sin cuenta que la persona escribio a mano: sus datos eran de
	// ella para organizar el reparto.
	{"depurar participantes escritos", `UPDATE split_shares
		SET user_name = 'Participante', user_phone = NULL
		WHERE user_id IS NULL
		  AND group_id IN (SELECT id FROM split_groups WHERE creator_id = $1::uuid)`},

	// ── El comercio y el dinero: cerrados, no borrados ──────────────────────
	// El comercio ya lo cerro cerrarComercios, antes de estos pasos.
	{"desactivar sedes", `UPDATE merchant_locations SET active = false
		WHERE active AND merchant_id IN (SELECT id FROM qr_merchants WHERE user_id = $1::uuid)`},
	{"desactivar catalogo", `UPDATE merchant_catalog_items SET active = false
		WHERE active AND merchant_id IN (SELECT id FROM qr_merchants WHERE user_id = $1::uuid)`},
	{"cerrar cuentas del libro", `UPDATE ledger_accounts SET closed_at = COALESCE(closed_at, NOW())
		WHERE user_id = $1::uuid
		   OR merchant_id IN (SELECT id FROM qr_merchants WHERE user_id = $1::uuid)`},
	// version + 1: quien tenia la billetera leida con la version vieja y la
	// intenta escribir (bloqueo optimista) falla en vez de pisar el cierre.
	{"cerrar billetera", `UPDATE wallets SET status = 'closed', version = version + 1, updated_at = NOW()
		WHERE user_id = $1::uuid`},
	{"cerrar billeteras regionales", `UPDATE regional_wallets SET active = false, updated_at = NOW()
		WHERE user_id = $1::uuid AND active`},
}

// sqlTumba deja la fila de users sin datos personales. $1 es el id.
//
// La identidad ya esta en closed_account_records. Aqui quedan id, created_at y
// role (la identidad del registro), kyc_level y kyc_status (acompanan a los
// registros de cumplimiento), referral_code (inservible: FindByReferralCode
// exige cuenta activa), referred_by, plan, las fechas de la solicitud y el
// rastro del bloqueo, si lo habia (la 077 relajo el CHECK para 'closed').
//
// retention_until es hasta cuando se conserva lo que la ley obliga. Se fija
// aqui; si cumplimiento pone la marca despues, el barrido de la desasociacion
// la mira al ejecutar.
//
// Los valores de reemplazo de cedula y telefono llevan ':' y miden menos de 64,
// asi que no pueden coincidir con un HMAC hexadecimal ni entre dos cuentas, y
// liberan la cedula y el telefono para que la persona pueda registrarse de nuevo.
// password_hash deja de ser un hash valido, de modo que VerifyPassword falla
// cerrado.
const sqlTumba = `
UPDATE users SET
    status              = 'closed',
    deleted_at          = NOW(),
    retention_until     = NOW() + CASE WHEN retention_extended_at IS NOT NULL
                                       THEN interval '` + intervaloConservacionExtensa + `'
                                       ELSE interval '` + intervaloConservacion + `' END,
    first_name          = 'Usuario',
    last_name           = 'eliminado',
    username            = NULL,
    birth_date          = NULL,
    birth_date_enc      = NULL,
    profile_picture_url = NULL,
    language            = NULL,
    biometric_enabled   = false,
    biometric_public_key = NULL,
    phone_verified      = false,
    email_verified      = false,
    cedula_hash         = 'deleted:' || id::text,
    cedula_enc          = fn_pii_encrypt('deleted'),
    phone_hash          = 'deleted:' || id::text,
    phone_enc           = fn_pii_encrypt('deleted'),
    email_hash          = NULL,
    email_enc           = NULL,
    password_hash       = '!deleted',
    demo_login          = false,
    expires_at          = NULL,
    updated_at          = NOW()
WHERE id = $1::uuid`

// ── Dia 30 + 5 anos (10 con la marca) ─────────────────────────────────────

// sqlConservacionVencida es la condicion de una cuenta cuya conservacion ya
// vencio en $2. La marca puesta despues del cierre lleva el vencimiento a diez
// anos aunque retention_until diga cinco.
var sqlConservacionVencida = `retention_until IS NOT NULL AND dissociated_at IS NULL
	AND retention_until <= $2
	AND (retention_extended_at IS NULL OR deleted_at + interval '` + intervaloConservacionExtensa + `' <= $2)
	AND ` + sinCasoAbierto("$2")

// sinCasoAbierto deja fuera de la desasociacion a quien tiene un caso abierto:
// un reporte que nadie reviso o una alerta de fraude que alguien esta
// investigando. La desasociacion es irreversible, y un caso abierto sin
// persona a quien atribuirlo ya no se puede cerrar; cerrado el caso, el barrido
// siguiente la desasocia. Una alerta que nadie atendio no cuenta: las alertas
// nacen abiertas y solo las cierra una persona, asi que esperar por ellas
// alargaria la conservacion sin que la ley ni una autoridad lo pidan. Y ningun
// caso la detiene pasados diez anos del cierre, el tope de la conservacion.
// fecha es el parametro con el momento del barrido.
func sinCasoAbierto(fecha string) string {
	return `(deleted_at + interval '` + intervaloConservacionExtensa + `' <= ` + fecha + `
	OR (NOT EXISTS (SELECT 1 FROM uif_reports r
	                 WHERE r.user_id = users.id AND r.status = 'pending')
	    AND NOT EXISTS (SELECT 1 FROM fraud_alerts f
	                     WHERE f.user_id = users.id AND f.status = 'investigating')))`
}

// desasociarEnTx deja lo conservado sin nada que identifique a la persona, de
// forma irreversible. Las filas y los montos quedan (son rastro contable y
// estadistica); los nombres, documentos, telefonos, direcciones, notas e IP no.
// Los registros de la otra parte de cada operacion no se tocan: siguen su
// propio plazo.
func desasociarEnTx(ctx context.Context, tx pgx.Tx, userID string, now time.Time) (bool, error) {
	var id string
	err := tx.QueryRow(ctx, `SELECT id::text FROM users WHERE id = $1::uuid AND `+sqlConservacionVencida+` FOR UPDATE`,
		userID, now).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("leer cuenta: %w", err)
	}
	if err := correr(ctx, tx, pasosDeLaDesasociacion, userID); err != nil {
		return false, err
	}
	// Despues del vaciado de la auditoria, y sin detalle: la fila dice cuando se
	// hizo y nada mas.
	if _, err := tx.Exec(ctx,
		`INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, risk_level)
		 VALUES ($1::uuid, 'account_dissociated', 'user', $1::text, '{}'::jsonb, 'high')`, userID); err != nil {
		return false, fmt.Errorf("auditoria: %w", err)
	}
	return true, nil
}

// pasosDeLaDesasociacion vacian los datos de lo que se conservo.
var pasosDeLaDesasociacion = []paso{
	{"vaciar la identidad conservada", `UPDATE closed_account_records
		SET first_name = NULL, last_name = NULL, birth_date = NULL, birth_date_enc = NULL,
		    cedula_hash = NULL, cedula_enc = NULL, phone_hash = NULL, phone_enc = NULL,
		    email_hash = NULL, email_enc = NULL, dissociated_at = NOW()
		WHERE user_id = $1::uuid`},
	{"marcar la cuenta", `UPDATE users
		SET dissociated_at = NOW(), blocked_reason = NULL, blocked_by = NULL, updated_at = NOW()
		WHERE id = $1::uuid`},
	// Cumplimiento.
	{"desasociar kyc", `UPDATE kyc_verifications
		SET full_legal_name = '', document_number = '', birth_date = NULL, nationality = NULL,
		    reviewer_notes = NULL
		WHERE user_id = $1::uuid`},
	{"desasociar documentos kyc", `UPDATE kyc_documents SET file_ref = '', sha256 = NULL
		WHERE verification_id IN (SELECT id FROM kyc_verifications WHERE user_id = $1::uuid)`},
	{"desasociar identidad", `UPDATE identity_verifications
		SET cedula_hash = 'dissociated', verified_name = NULL
		WHERE user_id = $1::uuid`},
	{"desasociar tamizajes", `UPDATE sanction_screenings SET query_name = '', normalized_query = ''
		WHERE user_id = $1::uuid`},
	{"desasociar reportes", `UPDATE uif_reports SET reason = '', reviewer_notes = NULL
		WHERE user_id = $1::uuid`},
	{"desasociar evaluaciones de fraude", `UPDATE fraud_assessments SET factors = '[]'
		WHERE user_id = $1::uuid`},
	{"desasociar alertas de fraude", `UPDATE fraud_alerts SET message = ''
		WHERE user_id = $1::uuid`},
	// La auditoria particionada: no se toca created_date (clave de particion).
	{"desasociar auditoria", `UPDATE audit_logs
		SET ip_address = NULL, user_agent = NULL, details = '{}'::jsonb
		WHERE user_id = $1::uuid`},
	// Operaciones. Solo las filas de la persona: la otra parte conserva las suyas.
	{"desasociar movimientos", `UPDATE transactions
		SET counterparty_name = NULL, counterparty_phone = NULL, counterparty_account = NULL,
		    metadata = '{}'::jsonb, location_lat = NULL, location_lng = NULL
		WHERE user_id = $1::uuid`},
	{"desasociar sinpe", `UPDATE sinpe_history SET phone = '', contact_name = '', description = NULL
		WHERE user_id = $1::uuid`},
	{"desasociar sinpe archivado", `UPDATE sinpe_history_archive SET phone = '', contact_name = '', description = NULL
		WHERE user_id = $1::uuid`},
	{"desasociar recibos", `UPDATE payment_history SET client_id = '' WHERE user_id = $1::uuid`},
	{"desasociar cripto", `UPDATE crypto_transactions SET counterparty_name = NULL WHERE user_id = $1::uuid`},
	{"desasociar envios internacionales", `UPDATE cross_border_transfers SET receiver_phone = ''
		WHERE sender_id = $1::uuid`},
	{"desasociar retiros", `UPDATE payouts
		SET destination = '{}'::jsonb, external_id = NULL, failure_reason = NULL, updated_at = NOW()
		WHERE user_id = $1::uuid`},
	{"desasociar notas de pagos", `UPDATE qr_payments SET note = NULL WHERE payer_id = $1::uuid`},
	{"desasociar notas de cobros", `UPDATE qr_charges SET note = '' WHERE created_by = $1::uuid`},
	// El comercio cerrado deja de nombrar a nadie. El motivo que escribio un
	// administrador es texto libre y puede nombrar a la persona: queda la marca
	// de que lo cerro un administrador, que es lo que el dueno ya leia. Los
	// motivos fijos (el del dueno y el de la eliminacion) no nombran a nadie.
	{"desasociar comercios", `UPDATE qr_merchants
		SET name = 'Comercio cerrado', cedula = '', legal_name = '', description = '',
		    logo_url = NULL, rejection_reason = '',
		    closure_reason = CASE
		        WHEN closure_reason IS NULL OR closure_reason IN ('` + qrpayment.MotivoCierrePropio + `', '` + motivoCierreDeComercio + `')
		        THEN closure_reason
		        ELSE '` + qrpayment.MotivoCierrePorAdmin + `' END
		WHERE user_id = $1::uuid`},
	// La cola web guarda el HMAC del contacto: con el se podria volver a
	// asociar la solicitud a un correo o un telefono. Queda el resultado.
	{"desasociar solicitudes web", `UPDATE account_deletion_requests
		SET contact_hash = 'dissociated:' || id::text, verification_hash = NULL
		WHERE user_id = $1::uuid`},
	{"desasociar sedes", `UPDATE merchant_locations SET name = 'Sede', address = ''
		WHERE merchant_id IN (SELECT id FROM qr_merchants WHERE user_id = $1::uuid)`},
	// La constancia de la respuesta escrita queda (fechas y via); la nota de
	// operaciones es texto libre y puede nombrar a la persona.
	{"desasociar respuestas", `UPDATE account_deletion_responses SET delivery_note = NULL, email_enc = NULL
		WHERE user_id = $1::uuid`},
}

// ── Piezas comunes ────────────────────────────────────────────────────────

// paso es una sentencia de la linea de tiempo. Todas reciben el id de la
// persona como $1 y son idempotentes: repetirlas sobre una cuenta ya tratada no
// cambia nada.
type paso struct {
	nombre string
	sql    string
}

func correr(ctx context.Context, tx pgx.Tx, pasos []paso, userID string) error {
	for _, p := range pasos {
		if _, err := tx.Exec(ctx, p.sql, userID); err != nil {
			return fmt.Errorf("%s: %w", p.nombre, err)
		}
	}
	return nil
}

// auditar deja la fila de auditoria en la MISMA transaccion, sin IP ni agente.
func auditar(ctx context.Context, tx pgx.Tx, userID, accion string, op opciones) error {
	if _, err := tx.Exec(ctx,
		`INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, risk_level)
		 VALUES ($1::uuid, $2, 'user', $1::text,
		         jsonb_strip_nulls(jsonb_build_object('channel', NULLIF($3::text, ''), 'actor', NULLIF($4::text, ''),
		                                              'response', NULLIF($5::text, ''), 'source', NULLIF($6::text, ''))),
		         'high')`,
		userID, accion, string(op.canal), op.actor, op.respuesta, op.fuente,
	); err != nil {
		return fmt.Errorf("auditoria: %w", err)
	}
	return nil
}
