package contract_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/pkg/response"
)

// Un administrador no actua sobre lo suyo (PR 295 en adelante): cada ruta de
// administracion que decide sobre una persona, un comercio o un acuerdo responde
// 403 ADMIN_IS_AFFECTED_PARTY cuando quien actua es la parte afectada. El spec
// lo documenta en cada una, con el sobre de error: un 403 sin contenido en el
// spec deja pasar cualquier cuerpo, asi que tambien se mira la descripcion.
func TestAdministradorParteAfectada_EstaEnElContrato(t *testing.T) {
	router := routerDeLaSpec(t)
	casos := []struct{ metodo, ruta string }{
		{http.MethodPost, "/api/v1/admin/kyc/" + unUUID + "/decision"},
		{http.MethodPost, "/api/v1/admin/merchants/" + merchUUID + "/approve"},
		{http.MethodPost, "/api/v1/admin/merchants/" + merchUUID + "/reject"},
		{http.MethodPatch, "/api/v1/admin/merchants/" + merchUUID + "/commission"},
		{http.MethodPatch, "/api/v1/admin/merchants/" + merchUUID + "/plan"},
		{http.MethodPost, "/api/v1/admin/merchants/" + merchUUID + "/close"},
		{http.MethodPost, "/api/v1/admin/escrow/" + unUUID + "/resolve"},
		{http.MethodPost, "/api/v1/admin/uif/reports/" + unUUID + "/review"},
		{http.MethodPatch, "/api/v1/admin/fraud/alerts/" + unUUID},
		{http.MethodPost, "/api/v1/admin/fraud/restrict/" + unUUID},
		{http.MethodPatch, "/api/v1/admin/users/" + unUUID + "/plan"},
	}
	for _, c := range casos {
		t.Run(c.metodo+" "+c.ruta, func(t *testing.T) {
			ruta, _, err := router.FindRoute(httptest.NewRequest(c.metodo, base+c.ruta, nil))
			if err != nil {
				t.Fatalf("la ruta no esta en el spec: %v", err)
			}
			prohibido := ruta.Operation.Responses.Status(http.StatusForbidden)
			if prohibido == nil || prohibido.Value == nil || prohibido.Value.Description == nil ||
				!strings.Contains(*prohibido.Value.Description, "ADMIN_IS_AFFECTED_PARTY") {
				t.Fatalf("el 403 no documenta ADMIN_IS_AFFECTED_PARTY")
			}
			if prohibido.Value.Content.Get("application/json") == nil {
				t.Fatalf("el 403 no documenta el sobre de error")
			}
			rec := httptest.NewRecorder()
			response.Error(rec, http.StatusForbidden, "ADMIN_IS_AFFECTED_PARTY", "an administrator cannot act on their own account")
			if err := contract.ValidateResponseBody(router, c.metodo, base+c.ruta, http.StatusForbidden, rec.Body.Bytes()); err != nil {
				t.Errorf("403 ADMIN_IS_AFFECTED_PARTY viola el esquema: %v", err)
			}
		})
	}
}
