package messaging

import (
	"strings"
	"testing"
)

// Desde que se entra con nombre de usuario, quien pide recuperar la contrasena
// muchas veces tampoco recuerda con QUE usuario entra. Este correo es el unico
// canal que ya llega a esa persona, asi que es donde se le dice. Sin eso,
// recuperar la contrasena no alcanza para volver a entrar.
func TestPasswordResetEmail_DiceElNombreDeUsuario(t *testing.T) {
	_, texto, html := PasswordResetEmail("tok_1", "https://kiramopay.com", "keilor")
	if !strings.Contains(texto, "keilor") {
		t.Error("la version de texto no dice el nombre de usuario")
	}
	if !strings.Contains(html, "keilor") {
		t.Error("la version HTML no dice el nombre de usuario")
	}
}

// Las cuentas anteriores a la migracion 058 no tienen nombre de usuario. El
// correo no puede quedar con una linea vacia ni con la palabra "undefined".
func TestPasswordResetEmail_SinNombreDeUsuarioNoInventaNada(t *testing.T) {
	_, texto, html := PasswordResetEmail("tok_1", "https://kiramopay.com", "")
	for _, cuerpo := range []string{texto, html} {
		if strings.Contains(cuerpo, "nombre de usuario") {
			t.Error("se menciona el nombre de usuario en una cuenta que no tiene")
		}
	}
	// Y el correo sigue sirviendo: el codigo tiene que estar.
	if !strings.Contains(texto, "tok_1") || !strings.Contains(html, "tok_1") {
		t.Error("falta el codigo de restablecimiento")
	}
}

// El nombre lo elige el usuario y aqui se interpola en HTML. Hoy su formato ya
// excluye los caracteres que importan, pero eso no puede ser la unica defensa.
func TestPasswordResetEmail_EscapaElNombreDeUsuario(t *testing.T) {
	_, _, html := PasswordResetEmail("tok_1", "https://kiramopay.com", `<script>alert(1)</script>`)
	if strings.Contains(html, "<script>") {
		t.Fatal("el nombre de usuario entra al HTML sin escapar")
	}
}
