package database

import "testing"

// En una base recien creada las migraciones corren ANTES que el sembrador, asi
// que la 082 (keilor administra) y la 026 (admin.kp administra) no alcanzan a
// las cuentas que el sembrador inserta despues. El sembrador las crea ya con su
// rol. Y ninguna cuenta sembrada puede ser administradora y de demostracion a
// la vez: el CHECK chk_users_demo_login_no_admin abortaria el INSERT.
func TestSembrador_LosAdministradoresNacenConRolYPidenContrasena(t *testing.T) {
	porNombre := map[string]TestUser{}
	for _, u := range DefaultTestUsers {
		if u.Role == "admin" && u.DemoLogin {
			t.Errorf("%s es administradora y entra sin contrasena", u.Username)
		}
		porNombre[u.Username] = u
	}
	for _, nombre := range []string{"keilor", "admin.kp"} {
		u, ok := porNombre[nombre]
		if !ok {
			t.Errorf("el sembrador no crea %s", nombre)
			continue
		}
		if u.Role != "admin" || u.DemoLogin {
			t.Errorf("%s nace con role=%q demo_login=%v; se esperaba admin y false", nombre, u.Role, u.DemoLogin)
		}
	}
}
