package messaging

import (
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestPasswordResetEmail(t *testing.T) {
	const token = "tok_abc123"
	subject, texto, htmlCuerpo := PasswordResetEmail(token, "https://kiramopay.com", "")

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
	_, texto, htmlCuerpo := PasswordResetEmail("tok_1", "", "")

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
	_, _, htmlCuerpo := PasswordResetEmail("tok_1", "https://kiramopay.com", "")

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
	_, _, htmlCuerpo := PasswordResetEmail(`"><script>alert(1)</script>`, "https://kiramopay.com", "")

	if strings.Contains(htmlCuerpo, "<script>") {
		t.Fatal("el token se interpoló sin escapar: hay una etiqueta script en el HTML")
	}
	if !strings.Contains(htmlCuerpo, "&lt;script&gt;") {
		t.Error("se esperaba el token escapado")
	}
}

func TestRegistrationOTPEmail(t *testing.T) {
	const codigo = "482913"
	subject, texto, htmlCuerpo := RegistrationOTPEmail(codigo)

	if !strings.Contains(subject, "verificación") {
		t.Errorf("el asunto perdió la tilde: %q", subject)
	}
	// El código debe estar en AMBAS partes: quien lea el texto plano tiene que
	// poder completar el registro igual que quien ve el HTML.
	if !strings.Contains(texto, codigo) {
		t.Error("el código falta en la parte de texto")
	}
	if !strings.Contains(htmlCuerpo, codigo) {
		t.Error("el código falta en la parte HTML")
	}
	if !strings.Contains(texto, "10 minutos") || !strings.Contains(htmlCuerpo, "10 minutos") {
		t.Error("falta el vencimiento de 10 minutos")
	}
}

func TestDeletionCodeEmailLlevaElCodigoYElVencimiento(t *testing.T) {
	subject, text, html := DeletionCodeEmail("481516")
	if !strings.Contains(subject, "eliminar") {
		t.Errorf("el asunto no dice de que se trata: %q", subject)
	}
	for nombre, cuerpo := range map[string]string{"texto": text, "html": html} {
		if !strings.Contains(cuerpo, "481516") {
			t.Errorf("el cuerpo %s no lleva el codigo", nombre)
		}
		if !strings.Contains(cuerpo, "15 minutos") {
			t.Errorf("el cuerpo %s no dice cuando vence", nombre)
		}
	}
}

// El SMS entra en una sola parte solo si es ASCII y cabe en 160 caracteres (ver
// VerificationSMS); una tilde lo parte en dos.
func TestDeletionCodeSMSEsAsciiYCabeEnUnaParte(t *testing.T) {
	sms := DeletionCodeSMS("123456")
	if len(sms) > 160 {
		t.Errorf("el SMS mide %d, mas que una parte", len(sms))
	}
	for _, r := range sms {
		if r > 127 {
			t.Fatalf("el SMS lleva un caracter no ASCII: %q", r)
		}
	}
	if !strings.Contains(sms, "123456") {
		t.Error("el SMS no lleva el codigo")
	}
}

// El aviso de cuenta eliminada llega a un buzon que se borra en el mismo acto:
// no debe repetir ningun dato de la cuenta.
func TestAccountDeletedEmailNoLlevaDatosDeLaCuenta(t *testing.T) {
	_, text, html := AccountDeletedEmail()
	for nombre, cuerpo := range map[string]string{"texto": text, "html": html} {
		if strings.Contains(cuerpo, "@") && nombre == "texto" {
			t.Errorf("el %s lleva algo con forma de correo", nombre)
		}
		if !strings.Contains(cuerpo, "eliminada") {
			t.Errorf("el %s no dice que la cuenta fue eliminada", nombre)
		}
	}
}

func TestDeletionBlockedEmailListaLosMotivosYEscapaElHTML(t *testing.T) {
	_, text, html := DeletionBlockedEmail([]string{"Tienes saldo en tu billetera.", "Un <script> en el texto"})
	if !strings.Contains(text, "- Tienes saldo en tu billetera.") {
		t.Errorf("el texto no lista el motivo: %q", text)
	}
	if !strings.Contains(html, "Tienes saldo en tu billetera.") || strings.Contains(html, "<script>") {
		t.Errorf("el html no escapa o no lista: %q", html)
	}
	if !strings.Contains(text, "No se borró nada") {
		t.Error("tiene que decir que no se borro nada")
	}
}

// La respuesta escrita del dia 0 (Ley 8968, art. 7 y Reglamento art. 22): que se
// suprime el dia 30, que se conserva por la Ley 7786 y hasta cuando, que se puede
// reactivar antes, y que la persona puede acudir a la PRODHAB. Nunca menciona un
// reporte de operacion sospechosa ni a la UIF.
func TestAccountDeletionRequestedEmailEsLaRespuestaEscrita(t *testing.T) {
	cr := time.FixedZone("CR", -6*3600)
	dia30 := time.Date(2026, 11, 17, 15, 4, 0, 0, cr)
	hasta := time.Date(2031, 11, 17, 15, 4, 0, 0, cr)
	subject, text, html := AccountDeletionRequestedEmail(dia30, hasta)
	if subject == "" {
		t.Fatal("sin asunto")
	}
	for nombre, cuerpo := range map[string]string{"texto": text, "html": html} {
		for _, debe := range []string{"17/11/2026", "17/11/2031", "7786", "PRODHAB", "reactivar", "contactos", "conversaciones"} {
			if !strings.Contains(cuerpo, debe) {
				t.Errorf("el %s no dice %q", nombre, debe)
			}
		}
		if m := mencionProhibida.FindString(cuerpo); m != "" {
			t.Errorf("el %s menciona %q", nombre, m)
		}
	}
}

// Las fechas salen en la hora de Costa Rica: un cierre a las 23:30 de Costa Rica
// ya es el dia siguiente en UTC, y el correo debe decir el dia de la persona.
func TestAccountDeletionRequestedEmailFechaEnHoraDeCostaRica(t *testing.T) {
	dia30 := time.Date(2026, 11, 18, 5, 30, 0, 0, time.UTC) // 17/11 23:30 en Costa Rica
	_, text, _ := AccountDeletionRequestedEmail(dia30, dia30.AddDate(5, 0, 0))
	if !strings.Contains(text, "17/11/2026") || strings.Contains(text, "18/11/2026") {
		t.Errorf("la fecha no salio en la hora de Costa Rica:\n%s", text)
	}
}

// mencionProhibida: lo que la respuesta a la persona nunca puede nombrar.
var mencionProhibida = regexp.MustCompile(`(?i)sospechos|\buif\b|\bros\b`)

// Ningun correo de la eliminacion nombra lo que la persona no puede saber: ni el
// de la respuesta, ni el del cierre, ni el de lo pendiente, ni el de la
// reactivacion.
func TestCorreosDeLaEliminacionNoMencionanElReporte(t *testing.T) {
	dia30 := time.Date(2026, 11, 17, 15, 4, 0, 0, time.UTC)
	correos := map[string][2]string{}
	_, a, b := AccountDeletionRequestedEmail(dia30, dia30.AddDate(5, 0, 0))
	correos["respuesta"] = [2]string{a, b}
	_, a, b = AccountDeletedEmail()
	correos["cierre"] = [2]string{a, b}
	_, a, b = DeletionBlockedEmail([]string{"Tienes saldo en tu billetera."})
	correos["pendiente"] = [2]string{a, b}
	_, a, b = AccountReactivatedEmail()
	correos["reactivacion"] = [2]string{a, b}
	_, a, b = DeletionRejectedEmail()
	correos["rechazo"] = [2]string{a, b}
	for nombre, c := range correos {
		for _, cuerpo := range c {
			if m := mencionProhibida.FindString(cuerpo); m != "" {
				t.Errorf("el correo de %s menciona %q", nombre, m)
			}
		}
	}
}

// La reactivacion avisa por correo y dice que hacer si no fue la persona.
func TestAccountReactivatedEmail(t *testing.T) {
	subject, text, html := AccountReactivatedEmail()
	if subject == "" {
		t.Fatal("sin asunto")
	}
	for nombre, cuerpo := range map[string]string{"texto": text, "html": html} {
		for _, debe := range []string{"reactiv", "contraseña"} {
			if !strings.Contains(cuerpo, debe) {
				t.Errorf("el %s no dice %q", nombre, debe)
			}
		}
	}
}

// La solicitud web que no se puede atender tambien se responde por escrito
// (decision del dueno del 2026-10-20): que no se borro nada, a donde escribir y
// el derecho a acudir a la PRODHAB. Nunca dice por que: la cuenta puede estar
// bajo revision, ser de demostracion o de un administrador.
func TestDeletionRejectedEmailEsLaRespuestaEscrita(t *testing.T) {
	subject, text, html := DeletionRejectedEmail()
	if subject == "" {
		t.Fatal("sin asunto")
	}
	for nombre, cuerpo := range map[string]string{"texto": text, "html": html} {
		for _, debe := range []string{"No se borró nada", "privacidad", "PRODHAB", "escribinos"} {
			if !strings.Contains(cuerpo, debe) {
				t.Errorf("el %s no dice %q:\n%s", nombre, debe, cuerpo)
			}
		}
		for _, motivo := range []string{"bloque", "revisión", "demostración", "administrador", "suspend"} {
			if strings.Contains(strings.ToLower(cuerpo), motivo) {
				t.Errorf("el %s deja ver el motivo (%q):\n%s", nombre, motivo, cuerpo)
			}
		}
	}
}

// El chat de soporte no existe y los correos mandaban a "la pagina de ayuda de
// KiramoPay" o a un "contacto de privacidad" que la politica dejaba sin definir:
// la persona no tenia a quien escribir. Todo correo que manda a escribir lo dice
// con el correo de soporte, en el texto y como enlace mailto en el HTML.
func TestCorreosQueMandanAEscribirDanElCorreoDeSoporte(t *testing.T) {
	const correo = "soporte@kiramopay.com"
	dia := time.Date(2026, 11, 30, 12, 0, 0, 0, time.UTC)

	casos := map[string]func() (string, string, string){
		"solicitud recibida":  func() (string, string, string) { return AccountDeletionRequestedEmail(dia, dia) },
		"cuenta eliminada":    AccountDeletedEmail,
		"cuenta reactivada":   AccountReactivatedEmail,
		"solicitud rechazada": DeletionRejectedEmail,
	}
	for nombre, armar := range casos {
		_, texto, htmlCuerpo := armar()

		if !strings.Contains(texto, correo) {
			t.Errorf("%s: el texto no da el correo de soporte:\n%s", nombre, texto)
		}
		if !strings.Contains(htmlCuerpo, `href="mailto:`+correo+`"`) {
			t.Errorf("%s: el HTML no lleva el enlace mailto de soporte", nombre)
		}
		for parte, cuerpo := range map[string]string{"texto": texto, "html": htmlCuerpo} {
			if strings.Contains(cuerpo, "página de ayuda") {
				t.Errorf("%s: el %s todavia manda a una pagina de ayuda sin contacto", nombre, parte)
			}
			if strings.Contains(cuerpo, "contacto de privacidad que aparece") {
				t.Errorf("%s: el %s todavia manda a un contacto de privacidad sin definir", nombre, parte)
			}
		}
	}
}

// En el texto plano la direccion va sin marcas: el enlace es solo del HTML.
func TestCorreoDeSoporteSoloEsEnlaceEnElHTML(t *testing.T) {
	_, texto, _ := AccountDeletedEmail()
	if !strings.Contains(texto, "soporte@kiramopay.com") {
		t.Fatalf("el texto no da el correo de soporte:\n%s", texto)
	}
	if strings.Contains(texto, "<a ") || strings.Contains(texto, "mailto:") {
		t.Errorf("el texto plano no debe llevar marcas de enlace:\n%s", texto)
	}
}
