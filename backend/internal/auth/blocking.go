package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"

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
//  3. WarmBlockedUsers al arranque repone las marcas desde la BD (cubre
//     FLUSHDB, reinicio de Redis, eviccion).
//
// Regla ante fallo parcial: la cuenta queda siempre en el estado MAS
// restrictivo, nunca en uno contradictorio. Bloquear = 1) tx BD, 2) SET de la
// marca (si Redis falla, el bloqueo ya es real y degrada a SESSION_REVOKED).
// Desbloquear = 1) DEL de la marca, 2) tx BD (si el DEL fallara con la BD ya en
// active, la persona entraria y recibiria 403 en todo). El servicio que
// orquesta (adminusers) respeta ese orden; aqui viven las piezas.

func blockedKey(userID string) string { return "auth:blocked:" + userID }

// BlockUserAndRevokeSessions marca la cuenta como bloqueada y revoca todas sus
// familias de refresh y sesiones en una sola tx: o queda todo o no queda nada.
// Idempotente: repetir sobre una cuenta ya bloqueada refresca el rastro y no
// falla. found=false si la cuenta no existe o esta borrada. adminID vacio se
// guarda como NULL (bloqueo sin autor, p.ej. un barrido automatico futuro).
func (r *Repository) BlockUserAndRevokeSessions(ctx context.Context, userID, reason, adminID string) (found bool, sessionsRevoked int, err error) {
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

	tag, err := tx.Exec(ctx,
		`UPDATE users
		    SET status = 'blocked', blocked_at = NOW(), blocked_reason = $2,
		        blocked_by = NULLIF($3::text, '')::uuid, updated_at = NOW()
		  WHERE id = $1::uuid AND deleted_at IS NULL`,
		userID, reason, adminID,
	)
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
	if err := tx.Commit(ctx); err != nil {
		return false, 0, fmt.Errorf("commit: %w", err)
	}
	return true, int(sessions.RowsAffected()), nil
}

// UnblockUser vuelve la cuenta a 'active' y limpia el rastro. Las sesiones
// revocadas por el bloqueo NO se resucitan: la persona vuelve a entrar con su
// contrasena. Idempotente; found=false si no existe o esta borrada.
func (r *Repository) UnblockUser(ctx context.Context, userID string) (found bool, err error) {
	tag, err := r.db.Exec(ctx,
		`UPDATE users
		    SET status = 'active', blocked_at = NULL, blocked_reason = NULL,
		        blocked_by = NULL, updated_at = NOW()
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

// WarmBlockedUsers repone en Redis la marca de toda cuenta bloqueada en BD.
// Se llama al arranque. Devuelve cuantas marcas puso. Sin Redis: (0, nil).
func (r *Repository) WarmBlockedUsers(ctx context.Context) (int, error) {
	if r.redis == nil {
		return 0, nil
	}
	rows, err := r.db.Query(ctx,
		`SELECT id::text FROM users WHERE status = 'blocked' AND deleted_at IS NULL`)
	if err != nil {
		return 0, fmt.Errorf("list blocked users: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return 0, fmt.Errorf("scan blocked user: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate blocked users: %w", err)
	}
	if len(ids) == 0 {
		return 0, nil
	}
	pipe := r.redis.Pipeline()
	for _, id := range ids {
		pipe.Set(ctx, blockedKey(id), "1", 0)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, fmt.Errorf("warm blocked marks: %w", err)
	}
	return len(ids), nil
}
