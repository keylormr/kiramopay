package user

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// AuditRow es una fila del rastro de auditoria sobre UNA cuenta, con el nombre
// de quien actuo ya resuelto. Lo consume el historial del panel de
// administracion; no lleva IP ni agente de usuario a proposito: el detalle de
// una cuenta no los necesita y el rastro completo ya tiene su propia ruta.
type AuditRow struct {
	ID     string
	Action string
	// ActorName es vacio cuando no actuo una persona (el barrido de
	// vencimientos escribe user_id NULL) o cuando esa cuenta ya no existe.
	ActorName string
	Details   map[string]interface{}
	CreatedAt time.Time
}

// ListAuditForResource devuelve los eventos del rastro cuyo recurso es la
// cuenta dada y cuya accion esta en la lista, del mas reciente al mas viejo.
//
// El filtro por accion no es solo una lista blanca: es lo que hace barata la
// consulta. audit_logs no tiene indice por resource_id, y si por (action,
// created_at); con acciones administrativas, que son pocas, el plan recorre
// ese indice y descarta por recurso, en vez de barrer una tabla que crece con
// cada ingreso.
func (r *Repository) ListAuditForResource(ctx context.Context, resourceID string, actions []string, limit int) ([]AuditRow, error) {
	rows, err := r.db.Query(ctx, `
		SELECT a.id::text, a.action,
		       COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), ''),
		       COALESCE(a.details::text, '{}'), a.created_at
		  FROM audit_logs a
		  LEFT JOIN users u ON u.id = a.user_id
		 WHERE a.resource_id = $1
		   AND a.action = ANY($2::text[])
		 ORDER BY a.created_at DESC, a.id DESC
		 LIMIT $3`,
		resourceID, actions, limit)
	if err != nil {
		return nil, fmt.Errorf("query audit for resource: %w", err)
	}
	defer rows.Close()

	out := make([]AuditRow, 0, 8)
	for rows.Next() {
		var (
			row      AuditRow
			detalles string
		)
		if err := rows.Scan(&row.ID, &row.Action, &row.ActorName, &detalles, &row.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan audit row: %w", err)
		}
		if detalles != "" && detalles != "{}" {
			// Un detalle ilegible no tumba el historial: la fila sale sin el.
			_ = json.Unmarshal([]byte(detalles), &row.Details)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate audit rows: %w", err)
	}
	return out, nil
}
