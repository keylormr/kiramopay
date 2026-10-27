package database

import "testing"

// En una base recien creada las migraciones corren ANTES que el sembrador, asi
// que la 082 y la 084 (keilor administra y entra sin contrasena) y la 026
// (admin.kp administra) no alcanzan a las cuentas que el sembrador inserta
// despues. El sembrador las crea ya asi. keilor es la UNICA administradora que
// entra sin contrasena (decision del dueno, 2026-10-27): con cualquier otra, el
// CHECK chk_users_demo_login_no_admin abortaria el INSERT.
func TestSembrador_SoloKeilorAdministraSinContrasena(t *testing.T) {
	porNombre := map[string]TestUser{}
	for _, u := range DefaultTestUsers {
		if u.Role == "admin" && u.DemoLogin && u.Username != "keilor" {
			t.Errorf("%s es administradora y entra sin contrasena", u.Username)
		}
		porNombre[u.Username] = u
	}
	for _, c := range []struct {
		nombre string
		demo   bool
	}{{"keilor", true}, {"admin.kp", false}} {
		u, ok := porNombre[c.nombre]
		if !ok {
			t.Errorf("el sembrador no crea %s", c.nombre)
			continue
		}
		if u.Role != "admin" || u.DemoLogin != c.demo {
			t.Errorf("%s nace con role=%q demo_login=%v; se esperaba admin y %v", c.nombre, u.Role, u.DemoLogin, c.demo)
		}
	}
}
