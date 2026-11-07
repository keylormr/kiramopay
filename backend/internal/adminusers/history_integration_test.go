package adminusers_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/adminusers"
	"github.com/kiramopay/backend/internal/audit"
)

func TestHistory_LoQueSeLeHizoALaCuenta_DelMasRecienteAlMasViejo(t *testing.T) {
	f := setup(t, nil)
	logger := audit.NewLogger(audit.NewRepository(f.pool), 20)
	svc := adminusers.NewService(f.userRepo, f.authRepo, &adminusers.Options{AuditLogger: logger})
	ctx := context.Background()

	if _, err := svc.Block(ctx, f.userID, f.adminID, "reporto el robo", actor); err != nil {
		t.Fatalf("Block() error: %v", err)
	}
	if _, err := svc.Unblock(ctx, f.userID, f.adminID, actor); err != nil {
		t.Fatalf("Unblock() error: %v", err)
	}
	cuando := time.Now().Add(72 * time.Hour).UTC().Truncate(time.Second)
	if _, err := svc.SetExpiry(ctx, f.userID, f.adminID, &cuando, actor); err != nil {
		t.Fatalf("SetExpiry() error: %v", err)
	}
	// Los cierres de sesion se guardan con resource_type "session" y el id de
	// la cuenta como recurso: el historial los tiene que traer igual.
	if _, err := svc.RevokeAllSessions(ctx, f.userID, f.adminID, actor); err != nil {
		t.Fatalf("RevokeAllSessions() error: %v", err)
	}
	// Ruido que NO debe salir en el historial de la cuenta: una busqueda (sin
	// recurso) y un bloqueo de OTRA cuenta.
	if _, err := svc.Search(ctx, keilorEmail, 0, f.adminID, actor); err != nil {
		t.Fatalf("Search() error: %v", err)
	}
	if _, err := svc.Block(ctx, keilorID, f.adminID, "otra cuenta", actor); err != nil {
		t.Fatalf("Block(keilor) error: %v", err)
	}
	logger.Stop() // vacia el buffer a la tabla

	got, err := svc.History(ctx, f.userID, 0)
	if err != nil {
		t.Fatalf("History() error: %v", err)
	}
	acciones := make([]string, len(got))
	for i, e := range got {
		acciones[i] = e.Action
	}
	want := []string{"admin_sessions_revoked_all", "user_expiry_set", "user_unblocked", "user_blocked"}
	if len(acciones) != len(want) {
		t.Fatalf("acciones = %v, esperaba %v", acciones, want)
	}
	for i := range want {
		if acciones[i] != want[i] {
			t.Fatalf("acciones = %v, esperaba %v (del mas reciente al mas viejo)", acciones, want)
		}
	}

	if got[0].SessionsRevoked == nil {
		t.Fatalf("el cierre de todas debe decir cuantas cerro: %+v", got[0])
	}

	bloqueo := got[3]
	if bloqueo.ActorName != "Admin User" || bloqueo.Reason != "reporto el robo" || bloqueo.Automatic {
		t.Fatalf("bloqueo mal contado: %+v", bloqueo)
	}
	if bloqueo.SessionsRevoked == nil {
		t.Fatalf("el bloqueo debe decir cuantas sesiones cerro: %+v", bloqueo)
	}
	venc := got[1]
	if venc.ExpiresAt == nil || !venc.ExpiresAt.Equal(cuando) || venc.Cleared {
		t.Fatalf("vencimiento mal contado: %+v (esperaba %s)", venc, cuando)
	}
}

func TestHistory_CuentaInexistente(t *testing.T) {
	f := setup(t, nil)
	if _, err := f.svc.History(context.Background(), sinCuentaID, 0); err != adminusers.ErrNotFound {
		t.Fatalf("History(inexistente) err = %v, esperaba ErrNotFound", err)
	}
}

func TestHandler_History(t *testing.T) {
	f := setup(t, nil)
	admin := newRouter(adminusers.NewHandler(f.svc), f.userRepo, f.adminID)
	noAdmin := newRouter(adminusers.NewHandler(f.svc), f.userRepo, f.userID)

	status, env := do(t, admin, http.MethodGet, "/admin/users/"+f.userID+"/history", "")
	if status != http.StatusOK || !env.Success {
		t.Fatalf("history: %d %s", status, string(env.Data))
	}
	var lista []adminusers.HistoryEntry
	if err := json.Unmarshal(env.Data, &lista); err != nil {
		t.Fatalf("data no es una lista: %v (%s)", err, string(env.Data))
	}
	// Sin acciones todavia la lista va vacia, nunca null.
	if string(env.Data) != "[]" {
		t.Fatalf("historial vacio = %s, esperaba []", string(env.Data))
	}

	cases := []struct {
		name, target, code string
		router             http.Handler
		status             int
	}{
		{"no admin", "/admin/users/" + f.userID + "/history", "FORBIDDEN", noAdmin, http.StatusForbidden},
		{"id invalido", "/admin/users/123/history", "INVALID_ID", admin, http.StatusBadRequest},
		{"inexistente", "/admin/users/" + sinCuentaID + "/history", "USER_NOT_FOUND", admin, http.StatusNotFound},
	}
	for _, c := range cases {
		status, env := do(t, c.router, http.MethodGet, c.target, "")
		if status != c.status || errorCode(env) != c.code {
			t.Errorf("%s: %d %s, esperaba %d %s", c.name, status, errorCode(env), c.status, c.code)
		}
	}
}
