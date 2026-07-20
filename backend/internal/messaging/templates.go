package messaging

import (
	"fmt"
	"html"
	"strings"
)

// VerificationSMS is the message body for a registration phone OTP.
func VerificationSMS(code string) string {
	return fmt.Sprintf("KiramoPay: tu codigo de verificacion es %s. Vence en 10 minutos. No lo compartas con nadie.", code)
}

// StepUpSMS is the message body for a high-value transaction step-up code.
func StepUpSMS(code string) string {
	return fmt.Sprintf("KiramoPay: tu codigo de autorizacion es %s. Vence en 5 minutos. Si no fuiste vos, no lo uses.", code)
}

// PasswordResetEmail builds the subject and the text/HTML bodies for a password
// reset. When appURL is non-empty a one-click link carrying the token is
// included; the raw token is always shown so the in-app flow works without the
// link. token is the single-use reset token from auth.ForgotPassword.
func PasswordResetEmail(token, appURL string) (subject, textBody, htmlBody string) {
	subject = "Restablece tu contrasena de KiramoPay"

	var link string
	if appURL != "" {
		link = appURL + "/?reset_token=" + token
	}

	var text strings.Builder
	text.WriteString("Recibimos una solicitud para restablecer tu contrasena de KiramoPay.\n\n")
	text.WriteString("Tu codigo de restablecimiento es:\n")
	text.WriteString(token + "\n\n")
	if link != "" {
		text.WriteString("O abre este enlace para continuar:\n")
		text.WriteString(link + "\n\n")
	}
	text.WriteString("El codigo vence en 15 minutos y solo puede usarse una vez.\n")
	text.WriteString("Si no solicitaste este cambio, ignora este mensaje: tu contrasena sigue igual.\n")

	esc := html.EscapeString(token)
	var h strings.Builder
	h.WriteString(`<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">`)
	h.WriteString(`<h1 style="font-size:18px;margin:0 0 16px">Restablece tu contrase&ntilde;a</h1>`)
	h.WriteString(`<p style="font-size:14px;line-height:1.5;margin:0 0 16px">Recibimos una solicitud para restablecer tu contrase&ntilde;a de KiramoPay. Us&aacute; este c&oacute;digo:</p>`)
	h.WriteString(`<p style="font-size:15px;font-weight:600;letter-spacing:0.02em;background:#f1f5f9;border-radius:8px;padding:12px 16px;word-break:break-all;margin:0 0 16px">` + esc + `</p>`)
	if link != "" {
		safeLink := html.EscapeString(link)
		h.WriteString(`<p style="margin:0 0 16px"><a href="` + safeLink + `" style="display:inline-block;background:#0A84FF;color:#fff;text-decoration:none;font-size:14px;font-weight:600;border-radius:8px;padding:12px 20px">Restablecer contrase&ntilde;a</a></p>`)
	}
	h.WriteString(`<p style="font-size:12px;line-height:1.5;color:#64748b;margin:0">El c&oacute;digo vence en 15 minutos y solo puede usarse una vez. Si no solicitaste este cambio, ignora este mensaje: tu contrase&ntilde;a sigue igual.</p>`)
	h.WriteString(`</div>`)

	return subject, text.String(), h.String()
}
