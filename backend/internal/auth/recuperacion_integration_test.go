package auth_test

import (
	"context"
	"testing"
)

// La recuperacion aceptaba SOLO cedula, y eso ya estaba desalineado con un
// login que aceptaba tres. Con el nombre de usuario se volvio una trampa: quien
// entra con su usuario, olvida la contrasena y teclea ese usuario leia "te
// enviamos instrucciones" y no le llegaba nada nunca. Un 202 que miente es peor
// que un error: el usuario espera un correo que no existe en vez de buscar otra
// via.
//
// Sin el arreglo, el caso del nombre de usuario devuelve token vacio.
func TestForgotPassword_AceptaLosMismosIdentificadoresQueElLogin(t *testing.T) {
	svc, pool, _ := servicioConDemo(t, false)
	id := sembrarConUsuario(t, pool, "702650930", "keilor", false)
	ctx := context.Background()

	// SeedTestUser no siembra correo; se agrega uno verificado para poder
	// probar tambien esa via.
	if _, err := pool.Exec(ctx,
		`UPDATE users SET email_enc = fn_pii_encrypt($2), email_hash = fn_pii_hmac($2),
		        email_verified = true WHERE id = $1::uuid`, id, "keilor@example.com"); err != nil {
		t.Fatalf("sembrar correo: %v", err)
	}

	casos := []struct {
		nombre string
		valor  string
	}{
		{"nombre de usuario", "keilor"},
		{"nombre de usuario en mayusculas", "KEILOR"},
		{"cedula", "702650930"},
		{"cedula con guiones", "7-0265-0930"},
		{"telefono", "88881234"},
		{"correo", "keilor@example.com"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			token, err := svc.ForgotPassword(ctx, c.valor, emptyCtx)
			if err != nil {
				t.Fatalf("ForgotPassword(%q): %v", c.valor, err)
			}
			if token == "" {
				t.Fatalf("ForgotPassword(%q) no encontro la cuenta: no se emitio token", c.valor)
			}
		})
	}
}

// Lo que NO existe sigue sin emitir token, y sin decir por que: la respuesta al
// cliente es constante exista o no la cuenta.
func TestForgotPassword_UnIdentificadorDesconocidoNoEmiteToken(t *testing.T) {
	svc, pool, _ := servicioConDemo(t, false)
	sembrarConUsuario(t, pool, "702650930", "keilor", false)
	ctx := context.Background()

	for _, valor := range []string{"noexiste", "999999999", "otro@example.com", "no clasifica"} {
		token, err := svc.ForgotPassword(ctx, valor, emptyCtx)
		if err != nil {
			t.Fatalf("ForgotPassword(%q) devolvio error en vez de silencio: %v", valor, err)
		}
		if token != "" {
			t.Errorf("ForgotPassword(%q) emitio un token para una cuenta que no existe", valor)
		}
	}
}
