package qrpayment_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/testutil"
)

// Desde el PR 295 administra una cuenta personal que tiene comercios. Un
// administrador no revisa ni gestiona un comercio del que es dueno: no lo
// aprueba ni lo rechaza, no le cambia la comision ni el plan, y no lo cierra
// por la ruta de administracion, que pide un motivo y no la contrasena. Su
// propio comercio lo cierra como cualquier dueno, reautenticandose.

// revisorDePrueba es quien aprueba, rechaza o le cambia el plan a un comercio
// en estas pruebas: el pagador que siembran setupQR y setupCierre
// (testutil.SeedTestUser). El servicio no mira el rol, eso lo hace la ruta;
// lo que si mira es que el revisor no sea el dueno.
const revisorDePrueba = "00000000-0000-0000-0000-000000000001"

// otroAdministrador es una cuenta con rol de administrador que no es duena de
// ningun comercio, para las pruebas que pasan por RequireAdmin.
func otroAdministrador(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	id := testutil.SeedTestUser3(t, pool)
	if _, err := pool.Exec(context.Background(), `UPDATE users SET role = 'admin' WHERE id = $1::uuid`, id); err != nil {
		t.Fatalf("hacer administrador a %s: %v", id, err)
	}
	return id
}

func TestComercioPropio_UnAdministradorNoLoRevisaNiLoGestiona(t *testing.T) {
	svc, pool, payer, owner := setupCierre(t, nil)
	h := qrpayment.NewHandler(svc)
	pendiente := registrarComercio(t, svc, owner, "Cafeteria Propia")
	verificado := comercioVerificado(t, svc, owner)
	admin := "/api/v1/admin/merchants/"

	casos := []struct {
		nombre  string
		handler http.HandlerFunc
		method  string
		url     string
		cuerpo  string
		id      string
	}{
		{"aprobar el suyo", h.ApproveMerchant, http.MethodPost, admin + pendiente.ID + "/approve", `{}`, pendiente.ID},
		{"rechazar el suyo", h.RejectMerchant, http.MethodPost, admin + pendiente.ID + "/reject", `{"reason":"no"}`, pendiente.ID},
		{"bajarle la comision al suyo", h.SetCommission, http.MethodPatch, admin + verificado.ID + "/commission", `{"commission_bps":0}`, verificado.ID},
		{"darle la analitica al suyo", h.SetMerchantPlan, http.MethodPatch, admin + verificado.ID + "/plan", `{"plan":"analitica"}`, verificado.ID},
		{"cerrar el suyo sin contrasena", h.AdminCloseMerchant, http.MethodPost, admin + verificado.ID + "/close", `{"reason":"lo cierro yo"}`, verificado.ID},
	}
	for _, c := range casos {
		rec := httptest.NewRecorder()
		c.handler(rec, peticion(c.method, c.url, c.cuerpo, owner, c.id))
		if rec.Code != http.StatusForbidden || codigoDeError(t, rec) != "ADMIN_IS_AFFECTED_PARTY" {
			t.Errorf("%s: %d %s, se esperaba 403 ADMIN_IS_AFFECTED_PARTY", c.nombre, rec.Code, rec.Body.String())
		}
	}

	for _, c := range []struct {
		nombre, sql, id string
	}{
		{"pendiente revisado", `SELECT COUNT(*) FROM qr_merchants WHERE id = $1::uuid AND (verification_status <> 'pending' OR reviewed_by IS NOT NULL)`, pendiente.ID},
		{"comision cambiada", `SELECT COUNT(*) FROM qr_merchants WHERE id = $1::uuid AND commission_bps = 0`, verificado.ID},
		{"plan cambiado", `SELECT COUNT(*) FROM qr_merchants WHERE id = $1::uuid AND plan <> 'base'`, verificado.ID},
		{"comercio cerrado", `SELECT COUNT(*) FROM qr_merchants WHERE id = $1::uuid AND (closed_at IS NOT NULL OR active IS NOT TRUE)`, verificado.ID},
		{"rastro de plan", `SELECT COUNT(*) FROM audit_logs WHERE action = 'admin_merchant_plan_set' AND resource_id = $1`, verificado.ID},
		{"rastro de cierre", `SELECT COUNT(*) FROM audit_logs WHERE action = 'admin_merchant_closed' AND resource_id = $1`, verificado.ID},
	} {
		if n := contar(t, pool, c.sql, c.id); n != 0 {
			t.Errorf("%s: %d", c.nombre, n)
		}
	}

	// Otro administrador si lo revisa.
	rec := httptest.NewRecorder()
	h.ApproveMerchant(rec, peticion(http.MethodPost, admin+pendiente.ID+"/approve", `{}`, payer, pendiente.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("otro administrador aprueba: %d %s", rec.Code, rec.Body.String())
	}
	// Y el dueno cierra el suyo como dueno, con su contrasena.
	cerrarComoDueno(t, svc, verificado.ID, owner)
}
