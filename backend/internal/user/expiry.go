package user

import (
	"context"
	"fmt"
	"time"
)

// Vencimiento programado de cuentas (migracion 053).
//
// users.expires_at es una fecha, no un estado: mientras no llega, la cuenta es
// una cuenta normal. Quien la convierte en un bloqueo es el barrido de la API
// (adminusers.Poller), que al vencer pasa por el MISMO camino que un bloqueo
// manual — tx en BD, marca en Redis, corte del socket — para que no existan
// dos formas distintas de estar bloqueado.
//
// Nada aqui escribe users.status: hacerlo por fuera de
// auth.Repository.BlockUserAndRevokeSessions dejaria sesiones vivas y violaria
// chk_users_blocked_coherente, que exige fecha y motivo.

// ListDueForExpiry devuelve los IDs de las cuentas cuyo vencimiento ya paso y
// que todavia no estan bloqueadas, la mas vencida primero.
//
// Solo IDs: el barrido no necesita la ficha y adminViewSelect descifraria tres
// campos de PII por fila. El filtro es exactamente el predicado de
// idx_users_expires_at mas la exclusion de administradores (una cuenta admin
// no se bloquea ni a mano) y el corte por fecha.
func (r *Repository) ListDueForExpiry(ctx context.Context, now time.Time, limit int) ([]string, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := r.db.Query(ctx,
		`SELECT id::text
		   FROM users
		  WHERE expires_at IS NOT NULL
		    AND status <> 'blocked'
		    AND deleted_at IS NULL
		    AND expires_at <= $1
		    AND COALESCE(role, 'user') <> 'admin'
		  ORDER BY expires_at
		  LIMIT $2`,
		now, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("list due for expiry: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan due for expiry: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate due for expiry: %w", err)
	}
	return ids, nil
}

// SetExpiresAt programa o quita el vencimiento de una cuenta. at nil lo quita.
// found=false si la cuenta no existe o esta borrada.
//
// No valida que la fecha sea futura: programar un vencimiento ya pasado es la
// forma legitima de decir "que el barrido la cierre en el proximo tick", y el
// bloqueo inmediato sigue existiendo aparte.
func (r *Repository) SetExpiresAt(ctx context.Context, userID string, at *time.Time) (found bool, err error) {
	tag, err := r.db.Exec(ctx,
		`UPDATE users SET expires_at = $2, updated_at = NOW()
		  WHERE id = $1::uuid AND deleted_at IS NULL`,
		userID, at,
	)
	if err != nil {
		return false, fmt.Errorf("set expires_at: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}
