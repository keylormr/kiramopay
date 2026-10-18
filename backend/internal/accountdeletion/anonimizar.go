package accountdeletion

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Canal es por donde llego la solicitud. Se guarda en users.deletion_channel.
type Canal string

const (
	CanalApp   Canal = "in_app"
	CanalWeb   Canal = "web"
	CanalAdmin Canal = "admin"
)

// opciones afina la eliminacion segun quien la pide.
type opciones struct {
	canal Canal
	// actor es el administrador que la ejecuta; vacio cuando la pide la propia
	// persona. Solo va a la auditoria.
	actor string
	// permitirCuentaBloqueada es true solo para la via que pasa por una persona
	// de operaciones: una cuenta bloqueada o suspendida esta bajo revision y no
	// se elimina sola.
	permitirCuentaBloqueada bool
}

// resultado de eliminar. Correo y Nombre se leen ANTES de borrarlos para poder
// avisar a la persona despues del commit.
type resultado struct {
	Ya           bool
	SolicitadaEn time.Time
	SeEliminaEl  time.Time
	Correo       string
	Nombre       string
}

// eliminarEnTx hace todo el trabajo dentro de la transaccion que le dan, que el
// llamante abre SERIALIZABLE. Cualquier error deja la base como estaba cuando el
// llamante hace rollback.
//
// Orden, y por que:
//  1. Bloquear la fila de la persona y su billetera. Una transferencia
//     concurrente toca esa billetera; con la fila bloqueada, o espera a que
//     terminemos o la serializacion la rechaza.
//  2. Comprobar elegibilidad y bloqueos YA con el bloqueo puesto. Comprobarlos
//     antes seria una carrera: entre la comprobacion y el borrado puede entrar
//     dinero.
//  3. Leer lo que luego se necesita para avisar (correo, nombre).
//  4. Borrar, anonimizar, cerrar. De lo mas lejano a la tumba.
func eliminarEnTx(ctx context.Context, tx pgx.Tx, userID string, op opciones) (resultado, error) {
	var (
		status      string
		role        string
		anonimizada bool
		correo      *string
		nombre      string
	)
	err := tx.QueryRow(ctx,
		`SELECT COALESCE(status, 'active'), COALESCE(role, 'user'),
		        anonymized_at IS NOT NULL, fn_pii_decrypt(email_enc), first_name
		   FROM users
		  WHERE id = $1::uuid
		    FOR UPDATE`,
		userID,
	).Scan(&status, &role, &anonimizada, &correo, &nombre)
	if errors.Is(err, pgx.ErrNoRows) {
		return resultado{}, ErrCuentaNoEncontrada
	}
	if err != nil {
		return resultado{}, fmt.Errorf("leer cuenta: %w", err)
	}
	if anonimizada {
		// Segunda orden sobre la misma cuenta (doble clic, reintento): ya esta.
		return resultado{Ya: true}, nil
	}
	if role != "user" {
		return resultado{}, ErrRolNoPermitido
	}
	// 'closed' sin tumba es un soft-delete anterior a esta funcion: se completa la
	// anonimizacion. Bloqueada o suspendida es otra cosa: esta bajo revision.
	if status != "active" && status != "closed" && !op.permitirCuentaBloqueada {
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

	res := resultado{Nombre: nombre}
	if correo != nil {
		res.Correo = *correo
	}

	for _, paso := range pasos {
		if _, err := tx.Exec(ctx, paso.sql, userID); err != nil {
			return resultado{}, fmt.Errorf("%s: %w", paso.nombre, err)
		}
	}

	// La tumba va al final: los pasos anteriores aun buscan por la identidad.
	if _, err := tx.Exec(ctx, sqlTumba, userID, string(op.canal)); err != nil {
		return resultado{}, fmt.Errorf("tumba: %w", err)
	}

	// Auditoria en la MISMA transaccion (el Logger asincrono puede perder el
	// evento si el proceso cae justo despues del commit). Sin IP ni agente: no se
	// guardan datos nuevos de una persona que acaba de pedir que se borren.
	if _, err := tx.Exec(ctx,
		`INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, risk_level)
		 VALUES ($1::uuid, 'account_deleted', 'user', $1::text,
		         jsonb_build_object('channel', $2::text, 'actor', NULLIF($3::text, '')),
		         'high')`,
		userID, string(op.canal), op.actor,
	); err != nil {
		return resultado{}, fmt.Errorf("auditoria: %w", err)
	}
	return res, nil
}

// paso es una sentencia de la eliminacion. Todas reciben el id de la persona
// como $1 y son idempotentes: repetirlas sobre una cuenta ya tratada no cambia
// nada.
type paso struct {
	nombre string
	sql    string
}

// pasos, de lo mas lejano a la tumba. El texto de cada uno dice por que.
var pasos = []paso{
	// ── Acceso ──────────────────────────────────────────────────────────────
	// Las sesiones se REVOCAN, no se borran: IsAccessJTIRevoked lee user_sessions
	// y una fila ausente no es lo mismo que una revocada. Se sueltan device_id
	// (user_devices se borra mas abajo y la FK no tiene accion) y la IP, el
	// agente y la huella, que son datos personales.
	{"anonimizar sesiones", `UPDATE user_sessions
		SET revoked_at = COALESCE(revoked_at, NOW()), device_id = NULL,
		    ip_address = NULL, user_agent = NULL, device_fingerprint = NULL
		WHERE user_id = $1::uuid`},
	{"borrar refresh", `DELETE FROM refresh_tokens WHERE user_id = $1::uuid`},
	{"borrar reset", `DELETE FROM password_reset_tokens WHERE user_id = $1::uuid`},
	{"borrar mfa", `DELETE FROM mfa_challenges WHERE user_id = $1::uuid`},
	{"borrar recuperacion totp", `DELETE FROM totp_recovery_codes WHERE user_id = $1::uuid`},
	{"borrar totp", `DELETE FROM user_totp WHERE user_id = $1::uuid`},
	{"borrar dispositivos", `DELETE FROM user_devices WHERE user_id = $1::uuid`},
	{"borrar push web", `DELETE FROM push_subscriptions WHERE user_id = $1::uuid`},
	{"borrar push nativo", `DELETE FROM push_dispositivos WHERE user_id = $1::uuid`},
	{"borrar llaves api", `DELETE FROM api_keys WHERE user_id = $1::uuid`},
	{"borrar entregas webhook", `DELETE FROM webhook_deliveries
		WHERE endpoint_id IN (SELECT id FROM webhook_endpoints WHERE user_id = $1::uuid)`},
	{"borrar webhooks", `DELETE FROM webhook_endpoints WHERE user_id = $1::uuid`},

	// ── Contactos y contenido ───────────────────────────────────────────────
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

	// ── Texto y lugares en filas que se quedan ──────────────────────────────
	// El saldo de las metas es cero (lo garantizo el bloqueo); solo queda el
	// nombre que la persona le puso.
	{"anonimizar metas", `UPDATE savings_goals SET name = 'Meta eliminada' WHERE user_id = $1::uuid`},
	{"anonimizar viajes", `UPDATE ride_requests
		SET pickup = '', destination = '', driver_name = NULL, driver_car = NULL, driver_plate = NULL
		WHERE user_id = $1::uuid`},
	// La tarjeta se cancela y pierde el numero y el titular. last4 se queda: es
	// lo que identifica la tarjeta en los movimientos que se conservan.
	{"anonimizar tarjetas", `UPDATE virtual_cards
		SET status = 'cancelled', card_number = '•••• •••• •••• ' || last4,
		    cardholder_name = 'Usuario eliminado', provider_card_id = NULL,
		    frozen_at = COALESCE(frozen_at, NOW())
		WHERE user_id = $1::uuid`},
	// Los QR de la persona dejan de cobrar. Es lo que corta el camino por el que
	// un cliente que aun tiene el codigo le pagaria a una cuenta cerrada.
	{"revocar qr", `UPDATE qr_payment_codes
		SET status = 'revoked', revoked_at = COALESCE(revoked_at, NOW()), note = NULL
		WHERE creator_id = $1::uuid`},
	// La nota de un pago la escribe quien paga; solo se borra la propia.
	{"borrar notas de pagos", `UPDATE qr_payments SET note = NULL WHERE payer_id = $1::uuid`},
	// Un reparto que la persona creo y sigue abierto ya no puede cobrarse: se
	// cancela. Sus propias partes pendientes quedan rechazadas.
	{"cancelar repartos", `UPDATE split_groups SET status = 'cancelled'
		WHERE creator_id = $1::uuid AND status = 'active'`},
	{"anonimizar repartos", `UPDATE split_groups
		SET title = 'Reparto eliminado', description = NULL
		WHERE creator_id = $1::uuid`},
	{"rechazar partes", `UPDATE split_shares SET status = 'declined'
		WHERE user_id = $1::uuid AND status = 'pending'`},
	{"anonimizar partes propias", `UPDATE split_shares
		SET user_name = 'Usuario eliminado', user_phone = NULL
		WHERE user_id = $1::uuid`},
	// Participantes sin cuenta que la persona escribio a mano: sus datos eran de
	// ella para organizar el reparto.
	{"anonimizar participantes escritos", `UPDATE split_shares
		SET user_name = 'Participante', user_phone = NULL
		WHERE user_id IS NULL
		  AND group_id IN (SELECT id FROM split_groups WHERE creator_id = $1::uuid)`},
	{"revocar vinculos de personal", `UPDATE merchant_staff
		SET status = 'revoked', revoked_at = COALESCE(revoked_at, NOW())
		WHERE status <> 'revoked'
		  AND (user_id = $1::uuid
		       OR merchant_id IN (SELECT id FROM qr_merchants WHERE user_id = $1::uuid))`},

	// ── Cierre del dinero ───────────────────────────────────────────────────
	// Los comercios propios quedan inactivos; su identidad legal se conserva
	// (decision del abogado). Despues se cierran las cuentas del libro: el motor
	// se niega a asentar en ellas (ledger.ErrCuentaCerrada).
	{"desactivar comercios", `UPDATE qr_merchants SET active = false WHERE user_id = $1::uuid AND active`},
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
	// Los pagos recurrentes ya se borraron arriba; nada mas se mueve solo.
}

// sqlTumba deja la fila de users como tumba. $1 es el id y $2 el canal.
//
// Que se conserva y por que: id, created_at y role (la identidad del registro);
// kyc_level y kyc_status (acompanan a los registros de cumplimiento, que el
// abogado decide); referral_code (inservible: FindByReferralCode exige cuenta
// activa); referred_by, plan; y el rastro del bloqueo, si lo habia (la 077
// relajo el CHECK para 'closed').
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
    anonymized_at       = NOW(),
    deletion_channel    = $2,
    first_name          = 'Usuario',
    last_name           = 'eliminado',
    username            = NULL,
    birth_date          = NULL,
    birth_date_enc      = NULL,
    profile_picture_url = NULL,
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
