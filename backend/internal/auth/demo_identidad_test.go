package auth_test

import (
	"context"
	"errors"
	"testing"

	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/user"
)

// LA CADENA QUE ESTO CORTA, en tres peticiones:
//  1. entrar sin contrasena tecleando el nombre de usuario;
//  2. PATCH /users/me cambiando el correo de la cuenta (no pedia contrasena);
//  3. pedir recuperacion, que manda el enlace al correo que este en la fila.
//
// Al final de esos tres pasos la cuenta es de quien lo hizo PARA SIEMPRE, y
// apagar la bandera de demostracion ya no la recupera. Una cuenta que abre sin
// contrasena es un accesorio, no la cuenta de una persona: no tiene por que
// poder cambiar su propia identidad ni fijarse una contrasena.
func TestCuentaDeDemostracion_NoCambiaSuIdentidadNiSuContrasena(t *testing.T) {
	svc, pool, _ := servicioConDemo(t, true)
	id := sembrarConUsuario(t, pool, "702650930", "demo", true)

	userSvc := user.NewService(user.NewRepository(pool))
	correo := "atacante@evil.com"
	if _, err := userSvc.UpdateProfile(context.Background(), id,
		&user.UpdateProfileRequest{Email: &correo}); !errors.Is(err, user.ErrCuentaDeDemostracion) {
		t.Fatalf("una cuenta de demostracion cambio su correo: %v", err)
	}

	if err := svc.ChangePassword(context.Background(), id,
		&auth.ChangePasswordRequest{OldPassword: "Kiramopay2024!", NewPassword: "OtraClave2026!"},
		emptyCtx); !errors.Is(err, auth.ErrCuentaDeDemostracion) {
		t.Fatalf("una cuenta de demostracion se fijo una contrasena: %v", err)
	}
}

// Y una cuenta normal sigue pudiendo hacer las dos cosas: la guarda no puede
// convertirse en una restriccion para todo el mundo.
func TestCuentaNormal_SiCambiaSuIdentidadYSuContrasena(t *testing.T) {
	svc, pool, _ := servicioConDemo(t, true)
	id := sembrarConUsuario(t, pool, "702650930", "keilor", false)

	userSvc := user.NewService(user.NewRepository(pool))
	nombre := "Keilor"
	if _, err := userSvc.UpdateProfile(context.Background(), id,
		&user.UpdateProfileRequest{FirstName: &nombre}); err != nil {
		t.Fatalf("una cuenta normal no pudo actualizar su perfil: %v", err)
	}
	if err := svc.ChangePassword(context.Background(), id,
		&auth.ChangePasswordRequest{OldPassword: "Kiramopay2024!", NewPassword: "OtraClave2026!"},
		emptyCtx); err != nil {
		t.Fatalf("una cuenta normal no pudo cambiar su contrasena: %v", err)
	}
}
