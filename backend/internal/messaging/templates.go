package messaging

import (
	"fmt"
	"html"
	"strings"
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
func PasswordResetEmail(token, appURL string) (subject, textBody, htmlBody string) {
	subject = "Restablece tu contraseña de KiramoPay"

	var link string
	if appURL != "" {
		link = appURL + "/?reset_token=" + token
	}

	var text strings.Builder
	text.WriteString("Recibimos una solicitud para restablecer tu contraseña de KiramoPay.\n\n")
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
