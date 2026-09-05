package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Sesiones abiertas, una por dispositivo.
//
// Cada login inserta una fila en user_sessions y abre una familia de refresh
// propia; nada revoca las anteriores, asi que una cuenta puede estar abierta en
// tantos dispositivos como quiera. Esto permite verlas y cerrarlas: una sola, o
// todas.
//
// Cerrar una sesion son SIEMPRE dos cosas, y por eso van juntas en una
// transaccion: marcar la fila (con lo que IsAccessJTIRevoked rechaza su token
// de acceso en la siguiente peticion) y revocar su FAMILIA de refresh. Sin lo
// segundo el dispositivo renueva y vuelve a entrar en menos de quince minutos,
// que es lo que dura el token de acceso: se veria cerrado y no lo estaria.

// SessionView es una sesion abierta tal como se muestra a quien la consulta.
// No lleva tokens ni hashes: solo lo que sirve para reconocer el dispositivo.
type SessionView struct {
	ID         string    `json:"id"`
	DeviceName string    `json:"device_name"`
	IPMasked   string    `json:"ip_masked"`
	CreatedAt  time.Time `json:"created_at"`
	ExpiresAt  time.Time `json:"expires_at"`
	// Current marca la sesion desde la que se hizo la consulta. Lo resuelve el
	// servicio comparando el jti del token que llego.
	Current bool `json:"current"`
}

// La IP se recorta a la red: sirve para distinguir "mi casa" de "otro lugar"
// sin volcar la direccion completa en una respuesta. Es dato personal.
const selectSesiones = `
	SELECT s.id::text,
	       COALESCE(NULLIF(s.user_agent, ''), 'Dispositivo desconocido'),
	       COALESCE(host(network(set_masklen(s.ip_address, 16))), ''),
	       COALESCE(s.created_at, NOW()),
	       s.expires_at,
	       COALESCE(s.access_jti::text, '')
	  FROM user_sessions s
	 WHERE s.user_id = $1::uuid AND s.revoked_at IS NULL AND s.expires_at > NOW()
	 ORDER BY s.created_at DESC
	 LIMIT 50`

// ListActiveSessions devuelve las sesiones vivas de una cuenta, la mas reciente
// primero. currentJTI marca cual es la del que pregunta; vacio si no aplica
// (por ejemplo cuando la consulta la hace un administrador).
func (r *Repository) ListActiveSessions(ctx context.Context, userID, currentJTI string) ([]SessionView, error) {
	rows, err := r.db.Query(ctx, selectSesiones, userID)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	out := make([]SessionView, 0, 8)
	for rows.Next() {
		var v SessionView
		var jti string
		if err := rows.Scan(&v.ID, &v.DeviceName, &v.IPMasked, &v.CreatedAt, &v.ExpiresAt, &jti); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		v.Current = currentJTI != "" && jti == currentJTI
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sessions: %w", err)
	}
	return out, nil
}

// RevokeSessionByID cierra UNA sesion de la cuenta dada y mata su familia de
// refresh, en una sola transaccion. found=false si esa sesion no existe, ya
// estaba cerrada, o no es de esa cuenta — el userID va en el WHERE a proposito,
// para que un id ajeno no cierre la sesion de otra persona.
func (r *Repository) RevokeSessionByID(ctx context.Context, userID, sessionID string) (found bool, err error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return false, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	tag, err := tx.Exec(ctx,
		`UPDATE user_sessions SET revoked_at = NOW()
		  WHERE id = $1::uuid AND user_id = $2::uuid AND revoked_at IS NULL`,
		sessionID, userID,
	)
	if err != nil {
		return false, fmt.Errorf("revoke session: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}

	// La familia entera, no solo el token actual: el dispositivo tiene el
	// ultimo de la cadena y con el se renovaria.
	if _, err := tx.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW()
		  WHERE user_id = $2::uuid AND revoked_at IS NULL
		    AND family_id IN (
		        SELECT rt.family_id FROM refresh_tokens rt
		         WHERE rt.jti = (SELECT s.refresh_jti FROM user_sessions s WHERE s.id = $1::uuid)
		    )`,
		sessionID, userID,
	); err != nil {
		return false, fmt.Errorf("revoke refresh family: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit: %w", err)
	}
	return true, nil
}

// RevokeAllSessions cierra todas las sesiones de la cuenta y revoca todas sus
// familias de refresh. exceptJTI permite dejar viva la sesion desde la que se
// pidio ("cerrar las demas"); vacio las cierra todas, incluida esa.
//
// Devuelve cuantas sesiones cerro.
func (r *Repository) RevokeAllSessions(ctx context.Context, userID, exceptJTI string) (int, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	tag, err := tx.Exec(ctx,
		`UPDATE user_sessions SET revoked_at = NOW()
		  WHERE user_id = $1::uuid AND revoked_at IS NULL
		    AND ($2::text = '' OR access_jti::text <> $2::text)`,
		userID, exceptJTI,
	)
	if err != nil {
		return 0, fmt.Errorf("revoke sessions: %w", err)
	}

	// Las familias de las sesiones que quedaron cerradas. Con exceptJTI, la
	// familia de la sesion que sobrevive NO se toca: si se revocara, esa sesion
	// moriria igual al primer refresh y "cerrar las demas" cerraria todo.
	if _, err := tx.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = NOW()
		  WHERE user_id = $1::uuid AND revoked_at IS NULL
		    AND ($2::text = '' OR family_id NOT IN (
		        SELECT rt.family_id FROM refresh_tokens rt
		         WHERE rt.jti IN (
		             SELECT s.refresh_jti FROM user_sessions s
		              WHERE s.user_id = $1::uuid AND s.access_jti::text = $2::text
		         )
		    ))`,
		userID, exceptJTI,
	); err != nil {
		return 0, fmt.Errorf("revoke refresh families: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit: %w", err)
	}
	return int(tag.RowsAffected()), nil
}
