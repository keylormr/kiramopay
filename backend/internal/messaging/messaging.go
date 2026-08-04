// Package messaging delivers one-time codes and account emails over real
// providers (Telnyx for SMS, an SMTP relay for email). Every sender is
// optional: when the relevant provider is not configured the constructor
// returns a nil interface, and callers treat nil as "no delivery channel" and
// fall back to the dev-mode echo. This mirrors the no-op gating used for the
// assistant (no API key) and web push (no VAPID keys), so the service runs
// identically with no messaging provider in dev/CI.
package messaging

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
)

// SMSSender delivers a short text message to an E.164 phone number.
type SMSSender interface {
	SendSMS(ctx context.Context, toE164, body string) error
}

// EmailSender delivers a transactional email. htmlBody may be empty, in which
// case a text/plain message is sent.
type EmailSender interface {
	SendEmail(ctx context.Context, to, subject, textBody, htmlBody string) error
}

// SMSConfig configures the SMS provider. Only Telnyx is supported today.
type SMSConfig struct {
	Provider           string // "telnyx" (empty disables SMS)
	TelnyxAPIKey       string
	TelnyxFrom         string // E.164 sender number, e.g. +15550001111
	MessagingProfileID string // alternative to a fixed From (Telnyx routes the number)
}

// Enabled reports whether the SMS provider has enough config to send.
func (c SMSConfig) Enabled() bool {
	if strings.ToLower(c.Provider) != "telnyx" {
		return false
	}
	return c.TelnyxAPIKey != "" && (c.TelnyxFrom != "" || c.MessagingProfileID != "")
}

// EmailConfig configures the email provider. Every supported provider is spoken
// over plain SMTP+STARTTLS, so the same fields cover all of them: switching
// providers is a change of credentials, not of code.
type EmailConfig struct {
	Provider     string // see emailProviderHosts (empty disables email)
	SMTPHost     string // e.g. smtp.resend.com
	SMTPPort     int    // 587 (STARTTLS)
	SMTPUser     string // SMTP username ("resend" for Resend, the SMTP user for SES)
	SMTPPassword string // SMTP password (the API key for Resend)
	From         string // verified sender, e.g. "KiramoPay <no-reply@kiramopay.com>"
}

// emailProviderHosts lists the accepted EMAIL_PROVIDER values mapped to the
// SMTP host used when none is given explicitly. "smtp" is the generic relay and
// always requires SMTP_HOST.
var emailProviderHosts = map[string]string{
	"ses":      "email-smtp.us-east-1.amazonaws.com",
	"resend":   "smtp.resend.com",
	"postmark": "smtp.postmarkapp.com",
	"brevo":    "smtp-relay.brevo.com",
	"smtp":     "",
}

// Enabled reports whether the email provider has enough config to send.
func (c EmailConfig) Enabled() bool {
	if _, ok := emailProviderHosts[strings.ToLower(c.Provider)]; !ok {
		return false
	}
	return c.SMTPHost != "" && c.SMTPUser != "" && c.SMTPPassword != "" && c.From != ""
}

// Config is the full messaging configuration, loaded from the environment.
type Config struct {
	SMS   SMSConfig
	Email EmailConfig
	// PublicAppURL is the frontend origin used to build links in emails
	// (e.g. the password-reset entry point). Empty omits the link.
	PublicAppURL string
}

// LoadConfig reads messaging configuration from the environment. All values are
// optional; unset providers stay disabled.
func LoadConfig() Config {
	emailProvider := os.Getenv("EMAIL_PROVIDER")
	port, _ := strconv.Atoi(firstenv("587", "SMTP_PORT", "SES_SMTP_PORT"))
	return Config{
		SMS: SMSConfig{
			Provider:           os.Getenv("SMS_PROVIDER"),
			TelnyxAPIKey:       os.Getenv("TELNYX_API_KEY"),
			TelnyxFrom:         os.Getenv("TELNYX_FROM"),
			MessagingProfileID: os.Getenv("TELNYX_MESSAGING_PROFILE_ID"),
		},
		Email: EmailConfig{
			Provider:     emailProvider,
			SMTPHost:     firstenv(emailProviderHosts[strings.ToLower(emailProvider)], "SMTP_HOST", "SES_SMTP_HOST"),
			SMTPPort:     port,
			SMTPUser:     firstenv("", "SMTP_USER", "SES_SMTP_USER"),
			SMTPPassword: firstenv("", "SMTP_PASSWORD", "SES_SMTP_PASSWORD"),
			From:         os.Getenv("EMAIL_FROM"),
		},
		PublicAppURL: strings.TrimRight(os.Getenv("PUBLIC_APP_URL"), "/"),
	}
}

// NewSMSSender returns a live SMS sender, or nil when SMS is not configured.
// Returning a true nil (never a typed-nil interface) lets callers gate delivery
// with a plain `if sender != nil`.
func NewSMSSender(cfg SMSConfig) SMSSender {
	if !cfg.Enabled() {
		return nil
	}
	return newTelnyxSMS(cfg)
}

// NewEmailSender returns a live email sender, or nil when email is not
// configured.
func NewEmailSender(cfg EmailConfig) EmailSender {
	if !cfg.Enabled() {
		return nil
	}
	return newSMTPEmail(cfg)
}

// EmailMisconfigured reports why email delivery is off despite EMAIL_PROVIDER
// being set, and returns an empty string when email is either usable or
// deliberately left unconfigured. Leaving the provider unset is a legitimate
// dev/CI setup; setting it and getting it wrong is not, and it fails silently:
// the service boots and password-reset mail simply stops going out.
func EmailMisconfigured(cfg EmailConfig) string {
	if cfg.Provider == "" || cfg.Enabled() {
		return ""
	}
	if _, ok := emailProviderHosts[strings.ToLower(cfg.Provider)]; !ok {
		known := make([]string, 0, len(emailProviderHosts))
		for name := range emailProviderHosts {
			known = append(known, name)
		}
		sort.Strings(known)
		return fmt.Sprintf("EMAIL_PROVIDER=%q is not a supported provider (expected one of: %s)",
			cfg.Provider, strings.Join(known, ", "))
	}
	var falta []string
	if cfg.SMTPHost == "" {
		falta = append(falta, "SMTP_HOST")
	}
	if cfg.SMTPUser == "" {
		falta = append(falta, "SMTP_USER")
	}
	if cfg.SMTPPassword == "" {
		falta = append(falta, "SMTP_PASSWORD")
	}
	if cfg.From == "" {
		falta = append(falta, "EMAIL_FROM")
	}
	return fmt.Sprintf("EMAIL_PROVIDER=%q is set but these are missing: %s",
		cfg.Provider, strings.Join(falta, ", "))
}

// firstenv returns the first non-empty value among keys, or fallback. It lets
// the generic SMTP_* variables take precedence while the older SES_* ones keep
// working, so a deployment configured for SES keeps sending after this change.
func firstenv(fallback string, keys ...string) string {
	for _, k := range keys {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return fallback
}
