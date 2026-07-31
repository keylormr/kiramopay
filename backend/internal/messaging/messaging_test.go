package messaging

import (
	"strings"
	"testing"
)

func TestSMSConfigEnabled(t *testing.T) {
	cases := []struct {
		name string
		cfg  SMSConfig
		want bool
	}{
		{"empty", SMSConfig{}, false},
		{"wrong provider", SMSConfig{Provider: "twilio", TelnyxAPIKey: "k", TelnyxFrom: "+1"}, false},
		{"telnyx no key", SMSConfig{Provider: "telnyx", TelnyxFrom: "+1"}, false},
		{"telnyx no from or profile", SMSConfig{Provider: "telnyx", TelnyxAPIKey: "k"}, false},
		{"telnyx with from", SMSConfig{Provider: "telnyx", TelnyxAPIKey: "k", TelnyxFrom: "+1"}, true},
		{"telnyx with profile", SMSConfig{Provider: "telnyx", TelnyxAPIKey: "k", MessagingProfileID: "p"}, true},
		{"case-insensitive provider", SMSConfig{Provider: "Telnyx", TelnyxAPIKey: "k", TelnyxFrom: "+1"}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.cfg.Enabled(); got != c.want {
				t.Fatalf("Enabled() = %v, want %v", got, c.want)
			}
		})
	}
}

func TestEmailConfigEnabled(t *testing.T) {
	full := EmailConfig{Provider: "ses", SMTPHost: "h", SMTPUser: "u", SMTPPassword: "p", From: "a@b.c"}
	if !full.Enabled() {
		t.Fatal("fully configured SES should be enabled")
	}
	partials := []EmailConfig{
		{},
		{Provider: "ses"},
		{Provider: "ses", SMTPHost: "h"},
		{Provider: "ses", SMTPHost: "h", SMTPUser: "u"},
		{Provider: "ses", SMTPHost: "h", SMTPUser: "u", SMTPPassword: "p"}, // missing From
		{Provider: "sendgrid", SMTPHost: "h", SMTPUser: "u", SMTPPassword: "p", From: "a@b.c"},
	}
	for i, c := range partials {
		if c.Enabled() {
			t.Fatalf("partial config #%d should be disabled", i)
		}
	}
}

func TestEmailConfigEnabledAcceptsEverySMTPProvider(t *testing.T) {
	for provider := range emailProviderHosts {
		cfg := EmailConfig{Provider: provider, SMTPHost: "h", SMTPUser: "u", SMTPPassword: "p", From: "a@b.c"}
		if !cfg.Enabled() {
			t.Fatalf("provider %q should be enabled when fully configured", provider)
		}
	}
	upper := EmailConfig{Provider: "Resend", SMTPHost: "h", SMTPUser: "u", SMTPPassword: "p", From: "a@b.c"}
	if !upper.Enabled() {
		t.Fatal("provider matching should be case-insensitive")
	}
}

func TestLoadConfigEmailProviderHostAndAliases(t *testing.T) {
	// Resend without an explicit host falls back to its SMTP endpoint, and the
	// generic SMTP_* variables feed the credentials.
	t.Setenv("EMAIL_PROVIDER", "resend")
	t.Setenv("SMTP_USER", "resend")
	t.Setenv("SMTP_PASSWORD", "re_key")
	t.Setenv("EMAIL_FROM", "KiramoPay <soporte@kiramopay.com>")
	cfg := LoadConfig().Email
	if cfg.SMTPHost != "smtp.resend.com" {
		t.Fatalf("host = %q, want the Resend endpoint", cfg.SMTPHost)
	}
	if cfg.SMTPPort != 587 || !cfg.Enabled() {
		t.Fatalf("port = %d, enabled = %v; want 587 and enabled", cfg.SMTPPort, cfg.Enabled())
	}

	// A deployment still configured with the older SES_* variables keeps working.
	t.Setenv("EMAIL_PROVIDER", "ses")
	t.Setenv("SMTP_USER", "")
	t.Setenv("SMTP_PASSWORD", "")
	t.Setenv("SES_SMTP_USER", "AKIAUSER")
	t.Setenv("SES_SMTP_PASSWORD", "sespass")
	ses := LoadConfig().Email
	if ses.SMTPHost != "email-smtp.us-east-1.amazonaws.com" || ses.SMTPUser != "AKIAUSER" || !ses.Enabled() {
		t.Fatalf("SES fallback broken: %+v", ses)
	}

	// An explicit host always wins over the per-provider default.
	t.Setenv("SMTP_HOST", "smtp.example.test")
	if got := LoadConfig().Email.SMTPHost; got != "smtp.example.test" {
		t.Fatalf("host = %q, want the explicit SMTP_HOST", got)
	}
}

func TestEmailMisconfigured(t *testing.T) {
	// Deliberately unconfigured: silence, because that is the dev/CI setup.
	if got := EmailMisconfigured(EmailConfig{}); got != "" {
		t.Fatalf("an unset provider should not warn, got %q", got)
	}
	// Fully configured: silence.
	ok := EmailConfig{Provider: "resend", SMTPHost: "h", SMTPUser: "u", SMTPPassword: "p", From: "a@b.c"}
	if got := EmailMisconfigured(ok); got != "" {
		t.Fatalf("a usable config should not warn, got %q", got)
	}
	// Typo in the provider name: the whole point of the check.
	typo := EmailConfig{Provider: "resendd", SMTPHost: "h", SMTPUser: "u", SMTPPassword: "p", From: "a@b.c"}
	got := EmailMisconfigured(typo)
	if !strings.Contains(got, "resendd") || !strings.Contains(got, "resend") {
		t.Fatalf("the warning should name the bad value and the supported ones, got %q", got)
	}
	// Right provider, missing credentials: the warning names the variables.
	incompleta := EmailConfig{Provider: "resend", SMTPHost: "h"}
	got = EmailMisconfigured(incompleta)
	for _, want := range []string{"SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM"} {
		if !strings.Contains(got, want) {
			t.Fatalf("the warning should mention %s, got %q", want, got)
		}
	}
	if strings.Contains(got, "SMTP_HOST") {
		t.Fatalf("SMTP_HOST is set, it should not be listed as missing: %q", got)
	}
}

func TestConstructorsReturnNilWhenDisabled(t *testing.T) {
	if s := NewSMSSender(SMSConfig{}); s != nil {
		t.Fatal("NewSMSSender should return a true nil when disabled")
	}
	if e := NewEmailSender(EmailConfig{}); e != nil {
		t.Fatal("NewEmailSender should return a true nil when disabled")
	}
}

func TestConstructorsReturnSenderWhenConfigured(t *testing.T) {
	if s := NewSMSSender(SMSConfig{Provider: "telnyx", TelnyxAPIKey: "k", TelnyxFrom: "+1"}); s == nil {
		t.Fatal("NewSMSSender should return a sender when configured")
	}
	if e := NewEmailSender(EmailConfig{Provider: "ses", SMTPHost: "h", SMTPUser: "u", SMTPPassword: "p", From: "a@b.c"}); e == nil {
		t.Fatal("NewEmailSender should return a sender when configured")
	}
}

func TestTemplates(t *testing.T) {
	if got := VerificationSMS("123456"); !strings.Contains(got, "123456") {
		t.Fatalf("VerificationSMS missing code: %q", got)
	}
	if got := StepUpSMS("654321"); !strings.Contains(got, "654321") {
		t.Fatalf("StepUpSMS missing code: %q", got)
	}

	subject, text, html := PasswordResetEmail("TOKEN123", "https://app.example.com")
	if subject == "" {
		t.Fatal("subject should not be empty")
	}
	if !strings.Contains(text, "TOKEN123") || !strings.Contains(html, "TOKEN123") {
		t.Fatal("reset bodies should contain the token")
	}
	if !strings.Contains(text, "https://app.example.com/?reset_token=TOKEN123") {
		t.Fatalf("reset text should contain the link, got:\n%s", text)
	}

	// Without an app URL, no link is embedded but the token still is.
	_, textNoURL, _ := PasswordResetEmail("TOKEN123", "")
	if strings.Contains(textNoURL, "reset_token=") {
		t.Fatal("no link should be present when appURL is empty")
	}
	if !strings.Contains(textNoURL, "TOKEN123") {
		t.Fatal("token should still be present without appURL")
	}
}
