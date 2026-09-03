package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Bloqueo remoto de cuentas: tres capas, por orden de autoridad.
//
//  1. BD (autoritativa): users.status='blocked' + revocacion de refresh_tokens
//     y user_sessions en UNA tx serializable, calcada de
//     ChangePasswordAndRevokeSessions. Con esto solo el bloqueo ya es efectivo:
//     IsAccessJTIRevoked lee user_sessions en la siguiente peticion y el
//     refresh muere por familia revocada, aunque Redis este caido.
//  2. Redis: marca auth:blocked:<user_id> SIN TTL. Es lo que consulta el
//     middleware RejectBlocked para responder ACCOUNT_BLOCKED (distinguible de
//     SESSION_REVOKED) sin ir a la BD en cada peticion.
//  3. ReconcileBlockedMarks pone las marcas al dia contra la BD, al arranque y
//     cada tanto desde el barrido (cubre FLUSHDB, reinicio de Redis, eviccion,
//     y tambien la marca que sobra tras un desbloqueo a medias).
//
// Regla ante fallo parcial: la cuenta queda siempre en el estado MAS
// restrictivo, nunca en uno contradictorio. Bloquear = 1) tx BD, 2) SET de la
// marca (si Redis falla, el bloqueo ya es real y degrada a SESSION_REVOKED).
// Desbloquear = 1) DEL de la marca, 2) tx BD (si el DEL fallara con la BD ya en
// active, la persona entraria y recibiria 403 en todo). El servicio que
// orquesta (adminusers) respeta ese orden; aqui viven las piezas.

func blockedKey(userID string) string { return "auth:blocked:" + userID }

// BlockUserAndRevokeSessions marca la cuenta como bloqueada y revoca todas sus
// familias de refresh, sesiones y API keys de comercio en una sola tx: o queda
// todo o no queda nada. Las API keys tambien: el canal B2B autentica por key,
// no por JWT, y sin revocarlas el bloqueado seguiria moviendo dinero por ahi.
// Idempotente: repetir sobre una cuenta ya bloqueada refresca el rastro y no
// falla, que es lo que hace inofensivo el doble clic del administrador.
// found=false si la cuenta no existe o esta borrada. adminID vacio se guarda
// como NULL (bloqueo sin autor).
//
// Este es el camino MANUAL. El barrido de vencimientos usa
// BlockExpiredUserAndRevokeSessions, que no repisa un bloqueo ajeno.
func (r *Repository) BlockUserAndRevokeSessions(ctx context.Context, userID, reason, adminID string) (found bool, sessionsRevoked int, err error) {
	return r.blockAndRevoke(ctx, userID, reason,
		`UPDATE users
		    SET status = 'blocked', blocked_at = NOW(), blocked_reason = $2,
		        blocked_by = NULLIF($3::text, '')::uuid, updated_at = NOW()
		  WHERE id = $1::uuid AND deleted_at IS NULL`,
		[]any{userID, reason, adminID})
}

// BlockExpiredUserAndRevokeSessions es el bloqueo del barrido de vencimientos.
// Hace lo mismo que el manual salvo en una cosa: su UPDATE vuelve a comprobar,
// en el mismo statement, la razon por la que la cuenta entro en el lote.
//
// El barrido lee una lista de candidatos y despues los bloquea uno por uno, asi
// que entre la lectura y el turno de una fila pueden pasar segundos. En esa
// ventana un administrador puede haber bloqueado la cuenta a mano por otro
// motivo, haber extendido o quitado su vencimiento, o haberla ascendido a
// administrador. Con el UPDATE incondicional del camino manual, el barrido
// llegaba tarde y pisaba esas tres decisiones: la peor era dejar
// blocked_reason='demo vencido' y blocked_by=NULL sobre un bloqueo humano,
// borrando de la ficha el motivo real y a su autor.
//
// found=false (sin error) significa "ya no corresponde": la cuenta se bloqueo
// por otra via, dejo de estar vencida o dejo de ser bloqueable. El barrido lo
// trata como un salto, no como un fallo.
func (r *Repository) BlockExpiredUserAndRevokeSessions(ctx context.Context, userID, reason string, now time.Time) (found bool, sessionsRevoked int, err error) {
	return r.blockAndRevoke(ctx, userID, reason,
		`UPDATE users
		    SET status = 'blocked', blocked_at = NOW(), blocked_reason = $2,
		        blocked_by = NULL, updated_at = NOW()
		  WHERE id = $1::uuid AND deleted_at IS NULL
		    AND status <> 'blocked'
		    AND expires_at IS NOT NULL AND expires_at <= $3
		    AND COALESCE(role, 'user') <> 'admin'`,
		[]any{userID, reason, now})
}

// blockAndRevoke corre el UPDATE que le den y, si toco la fila, revoca en la
// MISMA tx serializable las familias de refresh, las sesiones y las API keys.
// La diferencia entre el bloqueo manual y el automatico es solo ese UPDATE; lo
// que viene despues tiene que ser identico, y por eso vive en un solo lugar.
func (r *Repository) blockAndRevoke(ctx context.Context, userID, reason, updateSQL string, args []any) (found bool, sessionsRevoked int, err error) {
	// El CHECK chk_users_blocked_coherente exige motivo; '' lo pasaria (no es
	// NULL) y dejaria un bloqueo sin explicacion en la auditoria.
	if strings.TrimSpace(reason) == "" {
		return false, 0, errors.New("block reason required")
	}
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return false, 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // rollback is a no-op once committed

	tag, err := tx.Exec(ctx, updateSQL, args...)
	if err != nil {
		return false, 0, fmt.Errorf("block user: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return false, 0, nil
	}
	if _, err := tx.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW()
		 WHERE user_id = $1::uuid AND revoked_at IS NULL`,
		userID,
	); err != nil {
		return false, 0, fmt.Errorf("revoke refresh tokens: %w", err)
	}
	sessions, err := tx.Exec(ctx,
		`UPDATE user_sessions SET revoked_at = NOW()
		 WHERE user_id = $1::uuid AND revoked_at IS NULL`,
		userID,
	)
	if err != nil {
		return false, 0, fmt.Errorf("revoke sessions: %w", err)
	}
	// ResolveKey solo acepta status = 'active', asi que esto corta el canal B2B
	// en la siguiente peticion. Al desbloquear NO se resucitan (como las
	// sesiones): el comercio genera keys nuevas.
	if _, err := tx.Exec(ctx,
		`UPDATE api_keys SET status = 'revoked', revoked_at = NOW()
		 WHERE user_id = $1::uuid AND status = 'active'`,
		userID,
	); err != nil {
		return false, 0, fmt.Errorf("revoke api keys: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, 0, fmt.Errorf("commit: %w", err)
	}
	return true, int(sessions.RowsAffected()), nil
}

// UnblockUser vuelve la cuenta a 'active' y limpia el rastro. Las sesiones
// revocadas por el bloqueo NO se resucitan: la persona vuelve a entrar con su
// contrasena. Idempotente; found=false si no existe o esta borrada.
//
// Un vencimiento YA CUMPLIDO se borra en el mismo UPDATE: sin eso, desbloquear
// a mano una demo vencida duraria hasta el siguiente tick del barrido, que la
// volveria a bloquear con el mismo motivo. Un vencimiento FUTURO se conserva:
// ahi el desbloqueo resuelve otra cosa y la demo sigue teniendo su fecha.
func (r *Repository) UnblockUser(ctx context.Context, userID string) (found bool, err error) {
	tag, err := r.db.Exec(ctx,
		`UPDATE users
		    SET status = 'active', blocked_at = NULL, blocked_reason = NULL,
		        blocked_by = NULL, updated_at = NOW(),
		        expires_at = CASE WHEN expires_at <= NOW() THEN NULL ELSE expires_at END
		  WHERE id = $1::uuid AND deleted_at IS NULL`,
		userID,
	)
	if err != nil {
		return false, fmt.Errorf("unblock user: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// MarkUserBlocked pone la marca en Redis, sin TTL. Sin Redis es no-op: la BD
// ya es autoritativa (ver arriba).
func (r *Repository) MarkUserBlocked(ctx context.Context, userID string) error {
	if r.redis == nil {
		return nil
	}
	return r.redis.Set(ctx, blockedKey(userID), "1", 0).Err()
}

// ClearUserBlocked quita la marca. Sin Redis es no-op.
func (r *Repository) ClearUserBlocked(ctx context.Context, userID string) error {
	if r.redis == nil {
		return nil
	}
	return r.redis.Del(ctx, blockedKey(userID)).Err()
}

// IsUserBlocked responde si la cuenta tiene la marca de bloqueo. Fail-closed:
// ante error devuelve (true, err) y el middleware responde 503, igual que
// IsAccessJTIRevoked. Sin Redis configurado consulta la BD directamente (una
// lectura por peticion, solo en ese despliegue).
func (r *Repository) IsUserBlocked(ctx context.Context, userID string) (bool, error) {
	if r.redis == nil {
		var status string
		err := r.db.QueryRow(ctx,
			`SELECT COALESCE(status, 'active') FROM users WHERE id = $1::uuid AND deleted_at IS NULL`,
			userID,
		).Scan(&status)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return true, fmt.Errorf("blocked lookup: %w", err)
		}
		return status == "blocked", nil
	}
	n, err := r.redis.Exists(ctx, blockedKey(userID)).Result()
	if err != nil {
		return true, fmt.Errorf("blocked lookup: %w", err)
	}
	return n > 0, nil
}

// La llave del turno de repaso vive FUERA del prefijo de las marcas: si
// compartiera prefijo, el propio repaso la leeria como si fuera la marca de un
// usuario llamado "gate" y la borraria.
const reconcileGateKey = "auth:blocked-reconcile:gate"

// TryClaimBlockedReconcile gana el turno de repasar las marcas para la ventana
// que se le pida, y devuelve false si otra instancia ya lo gano.
//
// El turno es una llave con TTL en vez de un contador en memoria a proposito.
// El lock de cluster elige lider TICK A TICK, no de forma pegajosa, asi que con
// la API escalada un contador local haria que el repaso dependiera de que la
// misma instancia gane justo su tick numero diez. La llave es del cluster: la
// gana cualquiera que este de turno y caduca sola.
func (r *Repository) TryClaimBlockedReconcile(ctx context.Context, every time.Duration) (bool, error) {
	if r.redis == nil || every <= 0 {
		return false, nil
	}
	ok, err := r.redis.SetNX(ctx, reconcileGateKey, "1", every).Result()
	if err != nil {
		return false, fmt.Errorf("claim blocked reconcile: %w", err)
	}
	return ok, nil
}

// ReconcileBlockedMarks sincroniza las marcas de Redis con la BD en LAS DOS
// direcciones: repone las que faltan y borra las que sobran. Devuelve cuantas
// puso y cuantas quito.
//
// Reponer cubre la marca que se perdio por un fallo de Redis al bloquear (en el
// barrido automatico nadie lo nota ni reintenta) o por una eviccion.
//
// Borrar es igual de necesario, y es lo que hace seguro repetir este repaso.
// Desbloquear quita la marca ANTES de comprometer el UPDATE en BD — ese orden
// es deliberado, deja la cuenta en el estado mas restrictivo si algo falla a
// medias —, asi que un repaso que caiga en esa ventana lee la fila todavia como
// bloqueada y repone una marca sobre una cuenta que un instante despues queda
// activa. Sin la limpieza, esa marca sobrevive para siempre: la ficha del
// administrador dice "activa" y la persona recibe ACCOUNT_BLOCKED en cada
// peticion, sin nada que explique por que.
func (r *Repository) ReconcileBlockedMarks(ctx context.Context) (added, removed int, err error) {
	if r.redis == nil {
		return 0, 0, nil
	}

	// Redis PRIMERO y la BD despues, y ese orden decide quien gana los empates.
	// Solo se borra una marca que ya existia cuando empezo el repaso Y que la BD
	// desmiente despues: una cuenta bloqueada mientras el repaso corre no
	// aparece en la lectura de Redis, asi que no puede caer en el borrado. Al
	// reves — leer la BD primero — una cuenta bloqueada en el medio quedaria
	// fuera de la foto de la BD pero con marca en Redis, y el repaso le borraria
	// una marca legitima.
	enRedis := make(map[string]bool)
	iter := r.redis.Scan(ctx, 0, blockedKey("*"), 100).Iterator()
	for iter.Next(ctx) {
		enRedis[strings.TrimPrefix(iter.Val(), blockedKey(""))] = true
	}
	if err := iter.Err(); err != nil {
		return 0, 0, fmt.Errorf("scan blocked marks: %w", err)
	}

	enBD := make(map[string]bool)
	rows, err := r.db.Query(ctx,
		`SELECT id::text FROM users WHERE status = 'blocked' AND deleted_at IS NULL`)
	if err != nil {
		return 0, 0, fmt.Errorf("list blocked users: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return 0, 0, fmt.Errorf("scan blocked user: %w", err)
		}
		enBD[id] = true
	}
	if err := rows.Err(); err != nil {
		return 0, 0, fmt.Errorf("iterate blocked users: %w", err)
	}

	pipe := r.redis.Pipeline()
	for id := range enBD {
		if !enRedis[id] {
			pipe.Set(ctx, blockedKey(id), "1", 0)
			added++
		}
	}
	for id := range enRedis {
		if !enBD[id] {
			pipe.Del(ctx, blockedKey(id))
			removed++
		}
	}
	if added+removed == 0 {
		return 0, 0, nil
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, 0, fmt.Errorf("apply blocked mark fixes: %w", err)
	}
	return added, removed, nil
}
