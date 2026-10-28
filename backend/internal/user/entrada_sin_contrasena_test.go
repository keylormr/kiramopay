package user_test

import (
	"encoding/json"
	"testing"

	"github.com/kiramopay/backend/internal/user"
)

// La app no sabia si la cuenta entra sin contrasena (users.demo_login con
// DEMO_LOGIN_ENABLED encendida). A esas cuentas el Perfil les ofrecia "Cambiar
// contrasena" y "Eliminar cuenta", y las dos fallaban porque piden la contrasena
// actual. El servidor lo dice en el perfil, con las mismas condiciones del login
// sin contrasena: la marca de la cuenta Y la bandera del servidor, a la vez.

func TestUserRecord_EntraSinContrasenaSoloConLasDosCondiciones(t *testing.T) {
	casos := []struct {
		nombre   string
		demo     bool
		encendid bool
		estado   string
		espera   bool
	}{
		{"cuenta de demostracion con la bandera encendida", true, true, "active", true},
		// La bandera apagada es la palanca: la misma cuenta vuelve a pedir contrasena.
		{"cuenta de demostracion con la bandera apagada", true, false, "active", false},
		{"cuenta normal con la bandera encendida", false, true, "active", false},
		{"cuenta normal con la bandera apagada", false, false, "active", false},
		// El login sin contrasena exige la cuenta activa.
		{"cuenta de demostracion bloqueada", true, true, "blocked", false},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			u := &user.UserRecord{DemoLogin: c.demo, Status: c.estado}
			u.MarcarEntradaSinContrasena(c.encendid)
			if u.PasswordlessLogin != c.espera {
				t.Fatalf("PasswordlessLogin = %v, se esperaba %v", u.PasswordlessLogin, c.espera)
			}
		})
	}
}

// El dato sale al cliente como passwordless_login, siempre presente; la marca
// interna de la cuenta (demo_login) sigue sin salir nunca.
func TestUserRecord_ElJSONTraeSoloElDatoNoLaMarca(t *testing.T) {
	u := &user.UserRecord{ID: "u1", DemoLogin: true, Status: "active"}
	u.MarcarEntradaSinContrasena(true)
	crudo, err := json.Marshal(u)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var campos map[string]any
	if err := json.Unmarshal(crudo, &campos); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if v, ok := campos["passwordless_login"]; !ok || v != true {
		t.Fatalf("passwordless_login = %v (presente: %v), se esperaba true", v, ok)
	}
	if _, ok := campos["demo_login"]; ok {
		t.Fatalf("la marca interna demo_login salio al cliente: %s", crudo)
	}

	normal, _ := json.Marshal(&user.UserRecord{ID: "u2", Status: "active"})
	var otros map[string]any
	_ = json.Unmarshal(normal, &otros)
	if v, ok := otros["passwordless_login"]; !ok || v != false {
		t.Fatalf("una cuenta normal: passwordless_login = %v (presente: %v), se esperaba false", v, ok)
	}
}
