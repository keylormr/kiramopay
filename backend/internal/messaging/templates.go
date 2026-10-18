package messaging

import (
	"fmt"
	"html"
	"strings"
	"time"
)

// VerificationSMS is the message body for a registration phone OTP.
// SMS bodies stay unaccented on purpose: plain ASCII fits the 160-character
// GSM-7 alphabet, while a single accent forces UCS-2 and halves the limit to 70.
func VerificationSMS(code string) string {
	return fmt.Sprintf("KiramoPay: tu codigo de verificacion es %s. Vence en 10 minutos. No lo compartas con nadie.", code)
}

// StepUpSMS is the message body for a high-value transaction step-up code.
func StepUpSMS(code string) string {
	return fmt.Sprintf("KiramoPay: tu codigo de autorizacion es %s. Vence en 5 minutos. Si no fuiste vos, no lo uses.", code)
}

// RegistrationOTPEmail builds the subject and the text/HTML bodies for the
// registration verification code. Email is the delivery channel that actually
// works today (SES); SMS stays as the fallback for whenever a provider lands.
func RegistrationOTPEmail(code string) (subject, textBody, htmlBody string) {
	subject = "Tu código de verificación de KiramoPay"

	var text strings.Builder
	text.WriteString("Estás creando tu cuenta de KiramoPay.\n\n")
	text.WriteString("Tu código de verificación es:\n")
	text.WriteString(code + "\n\n")
	text.WriteString("El código vence en 10 minutos y solo puede usarse una vez.\n")
	text.WriteString("Si no estás creando una cuenta en KiramoPay, ignorá este mensaje.\n\n")
	text.WriteString("KiramoPay nunca te va a pedir este código por teléfono, chat ni redes sociales.\n")

	body := new(strings.Builder)
	body.WriteString(paragraph("Estás creando tu cuenta. Usá este código para verificar tu correo:"))
	body.WriteString(codeBlock(code))
	body.WriteString(note("El código vence en <strong>10 minutos</strong> y solo puede usarse una vez. " +
		"Si no estás creando una cuenta en KiramoPay, ignorá este mensaje."))
	body.WriteString(securityNotice())

	htmlBody = emailShell("Verificá tu correo", "Tu código de verificación vence en 10 minutos.", body.String())
	return subject, text.String(), htmlBody
}

// Brand colours, matching public/icon.svg and the app's primary action colour.
const (
	brandBlue     = "#0A84FF"
	brandBlueDeep = "#2D7BFF"
	inkPrimary    = "#0F172A"
	inkMuted      = "#64748B"
	surfaceSubtle = "#F1F5F9"
	borderSubtle  = "#E2E8F0"
	pageBackdrop  = "#F8FAFC"
)

// PasswordResetEmail builds the subject and the text/HTML bodies for a password
// reset. When appURL is non-empty a one-click link carrying the token is
// included; the raw token is always shown so the in-app flow works without the
// link. token is the single-use reset token from auth.ForgotPassword.
// PasswordResetEmail arma el correo de restablecimiento. username puede venir
// vacio (cuentas anteriores a la migracion 058); cuando viene, se incluye.
//
// Va aqui a proposito: desde que se entra con nombre de usuario, quien pide
// recuperar la contrasena muchas veces tampoco recuerda con QUE usuario entra.
// Este correo es el unico canal que ya llega a esa persona, asi que es el lugar
// natural para decirselo. Sin eso, recuperar la contrasena no alcanza para
// volver a entrar.
func PasswordResetEmail(token, appURL, username string) (subject, textBody, htmlBody string) {
	subject = "Restablece tu contraseña de KiramoPay"

	var link string
	if appURL != "" {
		link = appURL + "/?reset_token=" + token
	}

	var text strings.Builder
	text.WriteString("Recibimos una solicitud para restablecer tu contraseña de KiramoPay.\n\n")
	if username != "" {
		text.WriteString("Tu nombre de usuario es: " + username + "\n\n")
	}
	text.WriteString("Tu código de restablecimiento es:\n")
	text.WriteString(token + "\n\n")
	if link != "" {
		text.WriteString("O abrí este enlace para continuar:\n")
		text.WriteString(link + "\n\n")
	}
	text.WriteString("El código vence en 15 minutos y solo puede usarse una vez.\n")
	text.WriteString("Si no solicitaste este cambio, ignorá este mensaje: tu contraseña sigue igual.\n\n")
	text.WriteString("KiramoPay nunca te va a pedir este código por teléfono, chat ni redes sociales.\n")

	body := new(strings.Builder)
	body.WriteString(paragraph("Recibimos una solicitud para restablecer tu contraseña. Usá este código para continuar:"))
	if username != "" {
		// Escapado: el nombre de usuario lo elige el propio usuario y aqui se
		// interpola en HTML. Hoy su formato ya excluye los caracteres que
		// importan, pero esto no puede depender de que esa regla no cambie.
		body.WriteString(paragraph("Tu nombre de usuario es <strong>" + html.EscapeString(username) + "</strong>."))
	}
	body.WriteString(codeBlock(token))
	if link != "" {
		body.WriteString(button(link, "Restablecer contraseña"))
	}
	body.WriteString(note("El código vence en <strong>15 minutos</strong> y solo puede usarse una vez. " +
		"Si no solicitaste este cambio, ignorá este mensaje: tu contraseña sigue igual."))
	body.WriteString(securityNotice())

	htmlBody = emailShell("Restablecé tu contraseña", "Tu código de restablecimiento vence en 15 minutos.", body.String())
	return subject, text.String(), htmlBody
}

// emailShell wraps content in the branded layout: logo, heading, body, footer.
//
// The markup is deliberately old-fashioned — nested tables, inline styles, no
// <style> block — because that is the subset every mail client renders the same,
// Outlook included. preheader is the grey line clients show next to the subject
// in the inbox list; leaving it out lets them scrape whatever text comes first.
func emailShell(heading, preheader, content string) string {
	var h strings.Builder

	h.WriteString(`<div style="background:` + pageBackdrop + `;margin:0;padding:0;width:100%">`)

	// Hidden preview line: shown in the inbox list, never on the open message.
	h.WriteString(`<div style="display:none;font-size:1px;color:` + pageBackdrop +
		`;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">` +
		html.EscapeString(preheader) + `</div>`)

	h.WriteString(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:` + pageBackdrop + `;border-collapse:collapse">`)
	h.WriteString(`<tr><td align="center" style="padding:32px 16px">`)

	h.WriteString(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:480px;border-collapse:collapse">`)

	// Logo
	h.WriteString(`<tr><td align="center" style="padding:0 0 24px">` + logoMark() + `</td></tr>`)

	// Card
	h.WriteString(`<tr><td style="background:#FFFFFF;border:1px solid ` + borderSubtle +
		`;border-radius:16px;padding:32px 28px">`)
	h.WriteString(`<h1 style="margin:0 0 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;line-height:1.3;font-weight:700;color:` + inkPrimary + `">` +
		html.EscapeString(heading) + `</h1>`)
	h.WriteString(content)
	h.WriteString(`</td></tr>`)

	// Footer
	h.WriteString(`<tr><td align="center" style="padding:24px 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:` + inkMuted + `">`)
	h.WriteString(`KiramoPay &middot; Este es un mensaje automático, no respondas a este correo.`)
	h.WriteString(`</td></tr>`)

	h.WriteString(`</table>`)
	h.WriteString(`</td></tr></table></div>`)
	return h.String()
}

// logoMark draws the app icon — a white K on a rounded blue tile — with a table
// cell instead of an image. Mail clients block remote images by default and
// strip inline SVG, so an <img> logo would show as a broken box on first open;
// this always renders. background-image carries the gradient where it is
// supported and background-color is the flat fallback (Outlook ignores the
// former), so the tile is never transparent.
func logoMark() string {
	return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">` +
		`<tr><td align="center" valign="middle" width="56" height="56" style="width:56px;height:56px;` +
		`background-color:` + brandBlue + `;` +
		`background-image:linear-gradient(135deg,` + brandBlueDeep + ` 0%,` + brandBlue + ` 100%);` +
		`border-radius:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
		`font-size:30px;line-height:56px;font-weight:700;color:#FFFFFF;text-align:center">K</td></tr></table>`
}

func paragraph(s string) string {
	return `<p style="margin:0 0 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:` + inkPrimary + `">` + s + `</p>`
}

// codeBlock renders the token in a monospace panel. word-break keeps a long
// token inside the card instead of stretching it on narrow screens.
func codeBlock(token string) string {
	return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 20px">` +
		`<tr><td style="background:` + surfaceSubtle + `;border-radius:10px;padding:16px;` +
		`font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;line-height:1.5;` +
		`font-weight:600;color:` + inkPrimary + `;word-break:break-all">` +
		html.EscapeString(token) + `</td></tr></table>`
}

// button renders the primary action. Built as a table so Outlook gives it a
// real background: a styled <a> alone renders there as bare blue text.
func button(href, label string) string {
	safe := html.EscapeString(href)
	return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 20px">` +
		`<tr><td align="center" style="background-color:` + brandBlue + `;border-radius:10px">` +
		`<a href="` + safe + `" style="display:inline-block;padding:13px 24px;` +
		`font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
		`font-size:15px;font-weight:600;line-height:1;color:#FFFFFF;text-decoration:none">` +
		html.EscapeString(label) + `</a></td></tr></table>`
}

func note(s string) string {
	return `<p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:` + inkMuted + `">` + s + `</p>`
}

// securityNotice is the anti-phishing line. Stating that we never ask for the
// code elsewhere is what lets someone recognise a scam that copies this design.
func securityNotice() string {
	return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:24px 0 0">` +
		`<tr><td style="border-top:1px solid ` + borderSubtle + `;padding:16px 0 0;` +
		`font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
		`font-size:12px;line-height:1.6;color:` + inkMuted + `">` +
		`KiramoPay nunca te va a pedir este código por teléfono, chat ni redes sociales.` +
		`</td></tr></table>`
}

// DeletionCodeSMS es el cuerpo del codigo con que se comprueba que quien pide
// eliminar una cuenta desde la pagina web controla el telefono registrado.
// ASCII sin tildes, igual que los otros SMS (ver VerificationSMS).
func DeletionCodeSMS(code string) string {
	return fmt.Sprintf("KiramoPay: tu codigo para eliminar la cuenta es %s. Vence en 15 minutos. Si no lo pediste, ignora este mensaje.", code)
}

// DeletionCodeEmail arma el correo con el codigo para confirmar una solicitud de
// eliminacion de cuenta hecha desde la pagina web.
func DeletionCodeEmail(code string) (subject, textBody, htmlBody string) {
	subject = "Confirmá que querés eliminar tu cuenta de KiramoPay"

	var text strings.Builder
	text.WriteString("Alguien pidió eliminar la cuenta de KiramoPay asociada a este correo.\n\n")
	text.WriteString("Si fuiste vos, este es el código para confirmar la solicitud:\n")
	text.WriteString(code + "\n\n")
	text.WriteString("El código vence en 15 minutos y solo puede usarse una vez.\n")
	text.WriteString("Si no fuiste vos, ignorá este mensaje: no se elimina nada sin este código.\n\n")
	text.WriteString("KiramoPay nunca te va a pedir este código por teléfono, chat ni redes sociales.\n")

	body := new(strings.Builder)
	body.WriteString(paragraph("Alguien pidió eliminar la cuenta de KiramoPay asociada a este correo. Si fuiste vos, usá este código para confirmar la solicitud:"))
	body.WriteString(codeBlock(code))
	body.WriteString(note("El código vence en <strong>15 minutos</strong> y solo puede usarse una vez. " +
		"Si no fuiste vos, ignorá este mensaje: no se elimina nada sin este código."))
	body.WriteString(securityNotice())

	htmlBody = emailShell("Confirmá la eliminación de tu cuenta", "Tu código vence en 15 minutos.", body.String())
	return subject, text.String(), htmlBody
}

// zonaCR es la hora de Costa Rica, la de las fechas que se le dan a la persona.
// Si el sistema no trae la base de zonas, se usa el desfase fijo: el pais no
// tiene horario de verano.
var zonaCR = func() *time.Location {
	if z, err := time.LoadLocation("America/Costa_Rica"); err == nil {
		return z
	}
	return time.FixedZone("CST", -6*3600)
}()

func fechaCR(t time.Time) string { return t.In(zonaCR).Format("02/01/2006") }

// AccountDeletionRequestedEmail es la respuesta escrita a la solicitud de
// eliminacion, el dia 0 (Ley 8968, art. 7, y su Reglamento, art. 22). Dice que
// se suprime y cuando, que se conserva por la Ley 7786 y hasta cuando, que la
// persona puede reactivar la cuenta antes del cierre, y que puede acudir a la
// PRODHAB. seEliminaEl es el dia 30; conservaHasta, el vencimiento de la
// conservacion contado desde ese dia.
//
// Nunca nombra un reporte a las autoridades ni el motivo de una conservacion
// mas larga: eso no se le comunica a la persona.
func AccountDeletionRequestedEmail(seEliminaEl, conservaHasta time.Time) (subject, textBody, htmlBody string) {
	subject = "Recibimos tu solicitud para eliminar tu cuenta de KiramoPay"
	dia30 := fechaCR(seEliminaEl)
	hasta := fechaCR(conservaHasta)

	bloqueada := "Recibimos tu solicitud para eliminar tu cuenta de KiramoPay y aceptaste el plazo de 30 días. " +
		"Desde ahora tu cuenta está bloqueada: no podés entrar, mover dinero ni recibir avisos."
	suprime := "El " + dia30 + " se suprimen de forma definitiva tus datos de acceso, tus preferencias, " +
		"tus contactos, tus presupuestos, tus pagos programados, tus alertas, tus conversaciones con el asistente " +
		"y los dispositivos registrados."
	conserva := "La Ley 7786 obliga a KiramoPay a conservar tus documentos de identificación y el registro de tus " +
		"operaciones durante cinco años después del cierre, es decir, hasta el " + hasta + ". Se guardan aparte, " +
		"fuera de la aplicación, y solo se usan para cumplir esa ley. El plazo puede ser mayor únicamente si la ley " +
		"o una autoridad competente lo exige. Al vencer, dejan de estar asociados a vos de forma irreversible."
	reactivar := "Si cambiás de opinión, hasta el " + dia30 + " podés reactivar tu cuenta: entrá a KiramoPay con " +
		"tu contraseña y elegí reactivarla. Reactivarla cancela la eliminación y tu cuenta vuelve a funcionar."
	prodhab := "Si considerás que no se respetaron tus derechos sobre tus datos personales, podés acudir a la " +
		"Agencia de Protección de Datos de los Habitantes (PRODHAB)."
	ajeno := "Si no fuiste vos quien lo pidió, entrá con tu contraseña, reactivá la cuenta y cambiá la contraseña, " +
		"o escribinos desde la página de ayuda de KiramoPay."

	var text strings.Builder
	for _, p := range []string{bloqueada, suprime, conserva, reactivar, prodhab, ajeno} {
		text.WriteString(p + "\n\n")
	}

	body := new(strings.Builder)
	body.WriteString(paragraph(bloqueada))
	body.WriteString(paragraph("<strong>Qué se borra.</strong> " + suprime))
	body.WriteString(paragraph("<strong>Qué se conserva y hasta cuándo.</strong> " + conserva))
	body.WriteString(paragraph("<strong>Si cambiás de opinión.</strong> " + reactivar))
	body.WriteString(paragraph("<strong>Tus derechos.</strong> " + prodhab))
	body.WriteString(note(ajeno))

	htmlBody = emailShell("Recibimos tu solicitud", "Tu cuenta se elimina el "+dia30+".", body.String())
	return subject, strings.TrimRight(text.String(), "\n") + "\n", htmlBody
}

// AccountDeletedEmail avisa, el dia 30, que la cuenta fue eliminada y que lo
// anunciado en la respuesta del dia 0 ya se cumplio. No lleva datos de la
// cuenta: el correo mismo deja de estar en uso en ese acto.
func AccountDeletedEmail() (subject, textBody, htmlBody string) {
	subject = "Tu cuenta de KiramoPay fue eliminada"
	cerrada := "Tu cuenta de KiramoPay fue eliminada y ya no se puede usar ni reactivar."
	hecho := "Se suprimieron tus datos de acceso, tus preferencias, tus contactos y el resto de lo que te " +
		"indicamos al recibir tu solicitud. Lo que la Ley 7786 obliga a conservar queda guardado aparte, por el " +
		"plazo que te informamos, y solo se usa para cumplir esa ley."
	ajeno := "Si no fuiste vos quien lo pidió, escribinos cuanto antes desde la página de ayuda de KiramoPay."

	text := cerrada + "\n\n" + hecho + "\n\n" + ajeno + "\n"

	body := new(strings.Builder)
	body.WriteString(paragraph(cerrada))
	body.WriteString(paragraph(hecho))
	body.WriteString(note(ajeno))

	htmlBody = emailShell("Tu cuenta fue eliminada", "Tu cuenta de KiramoPay fue eliminada.", body.String())
	return subject, text, htmlBody
}

// AccountReactivatedEmail avisa que la cuenta se reactivo y la eliminacion se
// cancelo.
func AccountReactivatedEmail() (subject, textBody, htmlBody string) {
	return "", "", ""
}

// DeletionBlockedEmail le dice a quien pidio eliminar su cuenta desde la web que
// todavia no se pudo y que tiene que resolver. motivos son frases ya redactadas
// (una por cada cosa pendiente). No promete un plazo: lo unico que pide es
// resolverlo y volver a solicitarlo.
func DeletionBlockedEmail(motivos []string) (subject, textBody, htmlBody string) {
	subject = "Todavía no pudimos eliminar tu cuenta de KiramoPay"

	var text strings.Builder
	text.WriteString("Recibimos tu solicitud para eliminar tu cuenta de KiramoPay, pero todavía no se pudo porque:\n\n")
	for _, m := range motivos {
		text.WriteString("- " + m + "\n")
	}
	text.WriteString("\nNo se borró nada. Cuando lo resolvás, volvé a pedir la eliminación en la página de solicitud de KiramoPay.\n")
	text.WriteString("Si no fuiste vos quien lo pidió, no tenés que hacer nada: tu cuenta sigue como estaba.\n")

	body := new(strings.Builder)
	body.WriteString(paragraph("Recibimos tu solicitud para eliminar tu cuenta de KiramoPay, pero todavía no se pudo porque:"))
	items := new(strings.Builder)
	for _, m := range motivos {
		items.WriteString("<li style=\"margin:0 0 6px\">" + html.EscapeString(m) + "</li>")
	}
	body.WriteString(`<ul style="margin:0 0 16px;padding-left:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:` + inkPrimary + `">` + items.String() + `</ul>`)
	body.WriteString(paragraph("No se borró nada. Cuando lo resolvás, volvé a pedir la eliminación en la página de solicitud de KiramoPay."))
	body.WriteString(note("Si no fuiste vos quien lo pidió, no tenés que hacer nada: tu cuenta sigue como estaba."))

	htmlBody = emailShell("Todavía no pudimos eliminar tu cuenta", "No se borró nada.", body.String())
	return subject, text.String(), htmlBody
}
