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
