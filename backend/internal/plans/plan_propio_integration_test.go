package plans_test

import (
	"net/http"
	"testing"

	"github.com/kiramopay/backend/internal/plans"
)

// Desde el PR 295 administra una cuenta personal. El plan se asigna a mano
// mientras no exista el cobro; un administrador no se lo asigna a si mismo
// (se daria Pro gratis, o se bajaria sin que nadie lo revise). La ruta
// responde 403 ADMIN_IS_AFFECTED_PARTY y el plan no cambia.
func TestAsignarPlan_UnAdministradorNoSeAsignaElSuyo(t *testing.T) {
	f := setup(t, nil)
	router := newRouter(plans.NewHandler(f.svc), f.userRepo, f.adminID)
	ruta := "/admin/users/" + f.adminID + "/plan"
	antes := f.planDe(t, f.adminID)

	for _, plan := range []string{"pro", "plus", "free"} {
		status, env := do(t, router, http.MethodPatch, ruta, `{"plan":"`+plan+`"}`)
		if status != http.StatusForbidden || errorCode(env) != "ADMIN_IS_AFFECTED_PARTY" {
			t.Errorf("asignarse %s: %d %s, se esperaba 403 ADMIN_IS_AFFECTED_PARTY", plan, status, errorCode(env))
		}
	}
	if p := f.planDe(t, f.adminID); p != antes {
		t.Fatalf("el plan del administrador paso de %q a %q", antes, p)
	}

	// A otra cuenta si se lo asigna.
	if status, env := do(t, router, http.MethodPatch, "/admin/users/"+victorID+"/plan", `{"plan":"plus"}`); status != http.StatusOK {
		t.Fatalf("asignar a otra cuenta: %d %s", status, errorCode(env))
	}
}
