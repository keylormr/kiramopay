package auth_test

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/auth"
)

// La respuesta del login lleva el mismo dato que el perfil: la app arma con ella
// lo que muestra en Perfil antes de que nadie pida GET /users/me.

func TestLogin_LaRespuestaDiceSiLaCuentaEntraSinContrasena(t *testing.T) {
	ctx := context.Background()

	t.Run("cuenta de demostracion con la bandera encendida", func(t *testing.T) {
		svc, pool, _ := servicioConDemo(t, true)
		sembrarConUsuario(t, pool, "702650930", "demo", true)

		sinClave, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "demo", Password: ""}, emptyCtx)
		if err != nil {
			t.Fatalf("entrar sin contrasena: %v", err)
		}
		if !sinClave.User.PasswordlessLogin {
			t.Fatal("entrando sin contrasena, la respuesta no dice que la cuenta entra sin contrasena")
		}
		// Es un dato de la cuenta, no de como entro esta vez.
		conClave, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "demo", Password: "Kiramopay2024!"}, emptyCtx)
		if err != nil {
			t.Fatalf("entrar con contrasena: %v", err)
		}
		if !conClave.User.PasswordlessLogin {
			t.Fatal("entrando con contrasena, la respuesta no dice que la cuenta entra sin contrasena")
		}
	})

	t.Run("cuenta normal", func(t *testing.T) {
		svc, pool, _ := servicioConDemo(t, true)
		sembrarConUsuario(t, pool, "702650930", "normal", false)

		res, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "normal", Password: "Kiramopay2024!"}, emptyCtx)
		if err != nil {
			t.Fatalf("entrar: %v", err)
		}
		if res.User.PasswordlessLogin {
			t.Fatal("una cuenta normal figura como que entra sin contrasena")
		}
	})

	t.Run("cuenta marcada con la bandera apagada", func(t *testing.T) {
		svc, pool, _ := servicioConDemo(t, false)
		sembrarConUsuario(t, pool, "702650930", "demo", true)

		res, err := svc.Login(ctx, &auth.LoginRequest{Identifier: "demo", Password: "Kiramopay2024!"}, emptyCtx)
		if err != nil {
			t.Fatalf("entrar: %v", err)
		}
		if res.User.PasswordlessLogin {
			t.Fatal("con la bandera apagada la cuenta figura como que entra sin contrasena")
		}
	})
}
