package adminusers

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/user"
)

// El mapeo del rastro al historial no necesita base: estas pruebas corren sin
// Postgres y fijan que de cada accion sale solo lo que el panel cuenta.

func detalles(t *testing.T, s string) map[string]interface{} {
	t.Helper()
	var d map[string]interface{}
	if err := json.Unmarshal([]byte(s), &d); err != nil {
		t.Fatalf("detalles de prueba invalidos: %v", err)
	}
	return d
}

func TestHistoryEntryFrom_BloqueoManualTraeMotivoYSesiones(t *testing.T) {
	e := historyEntryFrom(user.AuditRow{
		ID: "a1", Action: "user_blocked", ActorName: "Keilor Martinez",
		Details:   detalles(t, `{"reason":"reporto el robo","sessions_revoked":3}`),
		CreatedAt: time.Date(2026, 11, 6, 13, 59, 0, 0, time.UTC),
	})
	if e.Reason != "reporto el robo" || e.ActorName != "Keilor Martinez" || e.Automatic {
		t.Fatalf("bloqueo manual mal leido: %+v", e)
	}
	if e.SessionsRevoked == nil || *e.SessionsRevoked != 3 {
		t.Fatalf("sesiones cerradas = %v, esperaba 3", e.SessionsRevoked)
	}
}

func TestHistoryEntryFrom_BloqueoAutomaticoNoTieneAutor(t *testing.T) {
	// Aunque la fila trajera un nombre, el barrido no es una persona.
	e := historyEntryFrom(user.AuditRow{
		Action: "user_blocked", ActorName: "Alguien",
		Details: detalles(t, `{"reason":"demo vencido","sessions_revoked":0,"automatic":true}`),
	})
	if !e.Automatic || e.ActorName != "" {
		t.Fatalf("bloqueo automatico con autor: %+v", e)
	}
	if e.SessionsRevoked == nil || *e.SessionsRevoked != 0 {
		t.Fatalf("cero sesiones debe llegar como 0, no como ausente: %v", e.SessionsRevoked)
	}
}

func TestHistoryEntryFrom_SinConteoNoInventaUnCero(t *testing.T) {
	e := historyEntryFrom(user.AuditRow{Action: "admin_sessions_revoked_all", Details: nil})
	if e.SessionsRevoked != nil {
		t.Fatalf("sin conteo en el rastro debe quedar nil, no %d", *e.SessionsRevoked)
	}
}

func TestHistoryEntryFrom_VencimientoProgramadoYQuitado(t *testing.T) {
	prog := historyEntryFrom(user.AuditRow{
		Action:  "user_expiry_set",
		Details: detalles(t, `{"cleared":false,"expires_at":"2026-12-01T12:00:00Z"}`),
	})
	if prog.Cleared || prog.ExpiresAt == nil || !prog.ExpiresAt.Equal(time.Date(2026, 12, 1, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("vencimiento programado mal leido: %+v", prog)
	}
	quitado := historyEntryFrom(user.AuditRow{Action: "user_expiry_set", Details: detalles(t, `{"cleared":true}`)})
	if !quitado.Cleared || quitado.ExpiresAt != nil {
		t.Fatalf("vencimiento quitado mal leido: %+v", quitado)
	}
}

func TestHistoryEntryFrom_PlanYNadaDeMas(t *testing.T) {
	e := historyEntryFrom(user.AuditRow{
		Action:  "admin_user_plan_set",
		Details: detalles(t, `{"plan_anterior":"free","plan_nuevo":"plus","cobro":false}`),
	})
	if e.PlanFrom != "free" || e.PlanTo != "plus" {
		t.Fatalf("plan mal leido: %+v", e)
	}
	// El id de la sesion cerrada vive en el rastro pero no sale en el historial.
	s := historyEntryFrom(user.AuditRow{Action: "admin_session_revoked", Details: detalles(t, `{"session_id":"abc"}`)})
	b, _ := json.Marshal(s)
	if strings.Contains(string(b), "abc") || strings.Contains(string(b), "session_id") {
		t.Fatalf("el historial expone el detalle crudo: %s", b)
	}
}
