package messaging

import (
	"strings"
	"testing"
)

func TestPasswordResetEmail(t *testing.T) {
	const token = "tok_abc123"
	subject, texto, htmlCuerpo := PasswordResetEmail(token, "https://kiramopay.com")

	if !strings.Contains(subject, "contraseña") {
		t.Errorf("el asunto perdió la tilde: %q", subject)
	}
	// El token debe estar en AMBAS partes: quien lea el texto plano tiene que
	// poder completar el flujo igual que quien ve el HTML.
	if !strings.Contains(texto, token) {
		t.Error("el token falta en la parte de texto")
	}
	if !strings.Contains(htmlCuerpo, token) {
		t.Error("el token falta en la parte HTML")
	}
	if !strings.Contains(texto, "https://kiramopay.com/?reset_token="+token) {
		t.Error("falta el enlace de un clic en la parte de texto")
	}
	if !strings.Contains(htmlCuerpo, "https://kiramopay.com/?reset_token="+token) {
		t.Error("falta el enlace de un clic en la parte HTML")
	}
}

// Sin appURL no debe quedar ni el botón ni una URL a medio armar; el flujo
// sigue siendo válido pegando el código en la app.
func TestPasswordResetEmailSinEnlace(t *testing.T) {
	_, texto, htmlCuerpo := PasswordResetEmail("tok_1", "")

	if strings.Contains(texto, "http") || strings.Contains(htmlCuerpo, "href=\"http") {
		t.Error("no debía incluirse ningún enlace cuando appURL está vacío")
	}
	if !strings.Contains(texto, "tok_1") || !strings.Contains(htmlCuerpo, "tok_1") {
		t.Error("el código debe seguir presente aunque no haya enlace")
	}
}

// El logo se dibuja con CSS a propósito: los clientes de correo bloquean
// imágenes remotas y descartan SVG en línea, así que un <img> aparecería roto
// en la primera apertura.
func TestPasswordResetEmailLlevaLaMarca(t *testing.T) {
	_, _, htmlCuerpo := PasswordResetEmail("tok_1", "https://kiramopay.com")

	if strings.Contains(htmlCuerpo, "<img") || strings.Contains(htmlCuerpo, "<svg") {
		t.Error("el logo no debe depender de <img> ni de <svg>")
	}
	if !strings.Contains(htmlCuerpo, ">K<") {
		t.Error("falta la K de la marca")
	}
	// El color plano debe acompañar al degradado: Outlook ignora
	// background-image y dejaría el mosaico transparente.
	if !strings.Contains(htmlCuerpo, "background-color:"+brandBlue) {
		t.Error("falta el color de respaldo del mosaico del logo")
	}
	if !strings.Contains(htmlCuerpo, "nunca te va a pedir este código") {
		t.Error("falta el aviso antiphishing")
	}
}

// Un token con caracteres especiales no puede romper el HTML ni inyectar
// etiquetas. No es hipotético: el token entra en el href y en el cuerpo.
func TestPasswordResetEmailEscapaElToken(t *testing.T) {
	_, _, htmlCuerpo := PasswordResetEmail(`"><script>alert(1)</script>`, "https://kiramopay.com")

	if strings.Contains(htmlCuerpo, "<script>") {
		t.Fatal("el token se interpoló sin escapar: hay una etiqueta script en el HTML")
	}
	if !strings.Contains(htmlCuerpo, "&lt;script&gt;") {
		t.Error("se esperaba el token escapado")
	}
}
