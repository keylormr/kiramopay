package messaging

import (
	"strings"
	"testing"
)

func TestNewSMTPEmailParsesEnvelope(t *testing.T) {
	e := newSMTPEmail(EmailConfig{From: "KiramoPay <no-reply@kiramopay.com>"})
	if e.envelope != "no-reply@kiramopay.com" {
		t.Fatalf("envelope = %q, want no-reply@kiramopay.com", e.envelope)
	}
	if e.from != "KiramoPay <no-reply@kiramopay.com>" {
		t.Fatalf("from header = %q", e.from)
	}

	bare := newSMTPEmail(EmailConfig{From: "no-reply@kiramopay.com"})
	if bare.envelope != "no-reply@kiramopay.com" {
		t.Fatalf("bare envelope = %q", bare.envelope)
	}
}

func TestBuildMessagePlainText(t *testing.T) {
	msg, err := buildMessage("a@x.com", "b@y.com", "Código de acceso", "linea uno\nlinea dos", "")
	if err != nil {
		t.Fatalf("buildMessage error: %v", err)
	}
	s := string(msg)
	if !strings.Contains(s, "From: a@x.com\r\n") {
		t.Error("missing From header")
	}
	if !strings.Contains(s, "To: b@y.com\r\n") {
		t.Error("missing To header")
	}
	// Accented subject must be RFC 2047 encoded, not raw UTF-8.
	if strings.Contains(s, "Subject: Código") {
		t.Error("subject should be encoded, not raw")
	}
	if !strings.Contains(s, "Subject: =?UTF-8?b?") && !strings.Contains(s, "Subject: =?UTF-8?B?") {
		t.Errorf("subject not B-encoded: %q", s)
	}
	if !strings.Contains(s, "Content-Type: text/plain; charset=\"UTF-8\"") {
		t.Error("missing text/plain content type")
	}
	// Body LFs normalized to CRLF.
	if !strings.Contains(s, "linea uno\r\nlinea dos") {
		t.Error("body not CRLF-normalized")
	}
	if strings.Contains(s, "multipart") {
		t.Error("plain message should not be multipart")
	}
}

func TestBuildMessageMultipart(t *testing.T) {
	msg, err := buildMessage("a@x.com", "b@y.com", "Hola", "texto", "<p>html</p>")
	if err != nil {
		t.Fatalf("buildMessage error: %v", err)
	}
	s := string(msg)
	if !strings.Contains(s, "Content-Type: multipart/alternative; boundary=\"kiramopay_") {
		t.Error("missing multipart boundary")
	}
	if !strings.Contains(s, "Content-Type: text/plain; charset=\"UTF-8\"") {
		t.Error("missing text part")
	}
	if !strings.Contains(s, "Content-Type: text/html; charset=\"UTF-8\"") {
		t.Error("missing html part")
	}
	if !strings.Contains(s, "<p>html</p>") {
		t.Error("missing html body")
	}
	// Closing boundary present.
	if !strings.Contains(s, "--\r\n") {
		t.Error("missing closing boundary marker")
	}
}
