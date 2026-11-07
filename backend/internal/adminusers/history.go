package adminusers

import (
	"context"
	"fmt"
	"time"

	"github.com/kiramopay/backend/internal/user"
)

// Historial de una cuenta: lo que los administradores, y el barrido de
// vencimientos, le hicieron. Sale del rastro de auditoria que ya se escribe en
// cada accion; esta consulta no registra nada nuevo.

// historyActions es la lista blanca de lo que el panel muestra. El rastro
// guarda tambien busquedas, ingresos y otras acciones con direcciones IP que
// no le tocan al detalle de una cuenta.
var historyActions = []string{
	"user_blocked",
	"user_unblocked",
	"user_expiry_set",
	"admin_session_revoked",
	"admin_sessions_revoked_all",
	"admin_user_plan_set",
}

const (
	defaultHistoryLimit = 30
	maxHistoryLimit     = 100
)

// HistoryEntry es un evento del historial tal como lo lee el panel. Solo trae
// los campos que cada accion necesita para contarse; el detalle crudo del
// rastro no sale.
type HistoryEntry struct {
	ID     string `json:"id"`
	Action string `json:"action"`
	// ActorName es vacio cuando no actuo una persona (Automatic) o cuando la
	// cuenta de quien actuo ya no existe.
	ActorName string `json:"actor_name"`
	// Automatic marca el bloqueo que hizo el barrido al llegar el vencimiento.
	Automatic bool `json:"automatic"`
	// Reason es el motivo escrito al bloquear.
	Reason string `json:"reason,omitempty"`
	// SessionsRevoked: cuantas sesiones se cerraron (bloqueo y "cerrar todas").
	SessionsRevoked *int `json:"sessions_revoked,omitempty"`
	// ExpiresAt es la fecha programada (user_expiry_set). Cleared dice que se
	// quito el vencimiento.
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	Cleared   bool       `json:"cleared,omitempty"`
	// PlanFrom y PlanTo: el cambio de plan asignado a mano.
	PlanFrom  string    `json:"plan_from,omitempty"`
	PlanTo    string    `json:"plan_to,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// History devuelve el historial de la cuenta, del evento mas reciente al mas
// viejo. ErrNotFound si la cuenta no existe.
//
// El rastro se escribe en segundo plano (el Logger vacia su buffer cada dos
// segundos), asi que una accion recien hecha puede tardar ese tiempo en
// aparecer aqui.
func (s *Service) History(ctx context.Context, targetID string, limit int) ([]HistoryEntry, error) {
	if _, err := s.Get(ctx, targetID); err != nil {
		return nil, err
	}
	rows, err := s.users.ListAuditForResource(ctx, targetID, historyActions,
		clampLimit(limit, defaultHistoryLimit, maxHistoryLimit))
	if err != nil {
		return nil, fmt.Errorf("list history: %w", err)
	}
	out := make([]HistoryEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, historyEntryFrom(r))
	}
	return out, nil
}

func historyEntryFrom(r user.AuditRow) HistoryEntry {
	e := HistoryEntry{
		ID:        r.ID,
		Action:    r.Action,
		ActorName: r.ActorName,
		CreatedAt: r.CreatedAt,
	}
	d := r.Details
	switch r.Action {
	case "user_blocked":
		e.Reason = textoDe(d, "reason")
		e.Automatic = boolDe(d, "automatic")
		e.SessionsRevoked = enteroDe(d, "sessions_revoked")
	case "admin_sessions_revoked_all":
		e.SessionsRevoked = enteroDe(d, "sessions_revoked")
	case "user_expiry_set":
		e.Cleared = boolDe(d, "cleared")
		if t, err := time.Parse(time.RFC3339, textoDe(d, "expires_at")); err == nil && !e.Cleared {
			e.ExpiresAt = &t
		}
	case "admin_user_plan_set":
		e.PlanFrom = textoDe(d, "plan_anterior")
		e.PlanTo = textoDe(d, "plan_nuevo")
	}
	// Un bloqueo automatico no tiene autor, aunque la fila trajera un nombre.
	if e.Automatic {
		e.ActorName = ""
	}
	return e
}

func textoDe(d map[string]interface{}, clave string) string {
	if v, ok := d[clave].(string); ok {
		return v
	}
	return ""
}

func boolDe(d map[string]interface{}, clave string) bool {
	v, ok := d[clave].(bool)
	return ok && v
}

// enteroDe lee un numero del JSONB (llega como float64). nil si no esta: "no
// se sabe cuantas" no es lo mismo que "cero".
func enteroDe(d map[string]interface{}, clave string) *int {
	v, ok := d[clave].(float64)
	if !ok {
		return nil
	}
	n := int(v)
	return &n
}
