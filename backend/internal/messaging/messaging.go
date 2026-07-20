// Package messaging delivers one-time codes and account emails over real
// providers (Telnyx for SMS, Amazon SES over SMTP for email). Every sender is
// optional: when the relevant provider is not configured the constructor
// returns a nil interface, and callers treat nil as "no delivery channel" and
// fall back to the dev-mode echo. This mirrors the no-op gating used for the
// assistant (no API key) and web push (no VAPID keys), so the service runs
// identically with no messaging provider in dev/CI.
package messaging

import (
	"context"
	"os"
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

// EmailConfig configures the email provider. Amazon SES is spoken over plain
// SMTP+STARTTLS, so any SES-compatible SMTP relay works with the same fields.
type EmailConfig struct {
	Provider     string // "ses" (empty disables email)
	SMTPHost     string // e.g. email-smtp.us-east-1.amazonaws.com
	SMTPPort     int    // 587 (STARTTLS)
	SMTPUser     string // SES SMTP username
	SMTPPassword string // SES SMTP password
	From         string // verified sender, e.g. "KiramoPay <no-reply@kiramopay.com>"
}

// Enabled reports whether the email provider has enough config to send.
func (c EmailConfig) Enabled() bool {
	if strings.ToLower(c.Provider) != "ses" {
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
	port, _ := strconv.Atoi(getenv("SES_SMTP_PORT", "587"))
	return Config{
		SMS: SMSConfig{
			Provider:           os.Getenv("SMS_PROVIDER"),
			TelnyxAPIKey:       os.Getenv("TELNYX_API_KEY"),
			TelnyxFrom:         os.Getenv("TELNYX_FROM"),
			MessagingProfileID: os.Getenv("TELNYX_MESSAGING_PROFILE_ID"),
		},
		Email: EmailConfig{
			Provider:     os.Getenv("EMAIL_PROVIDER"),
			SMTPHost:     getenv("SES_SMTP_HOST", "email-smtp.us-east-1.amazonaws.com"),
			SMTPPort:     port,
			SMTPUser:     os.Getenv("SES_SMTP_USER"),
			SMTPPassword: os.Getenv("SES_SMTP_PASSWORD"),
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

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
