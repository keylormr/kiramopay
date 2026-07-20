package messaging

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// smtpEmail sends transactional email over SMTP+STARTTLS. Amazon SES exposes a
// standard SMTP endpoint (email-smtp.<region>.amazonaws.com:587), so this speaks
// plain SMTP and works with SES or any compatible relay.
type smtpEmail struct {
	host     string
	port     int
	user     string
	password string
	from     string // header From (may be "Name <addr>")
	envelope string // bare address for MAIL FROM
}

func newSMTPEmail(cfg EmailConfig) *smtpEmail {
	envelope := cfg.From
	if addr, err := mail.ParseAddress(cfg.From); err == nil {
		envelope = addr.Address
	}
	return &smtpEmail{
		host:     cfg.SMTPHost,
		port:     cfg.SMTPPort,
		user:     cfg.SMTPUser,
		password: cfg.SMTPPassword,
		from:     cfg.From,
		envelope: envelope,
	}
}

func (s *smtpEmail) SendEmail(ctx context.Context, to, subject, textBody, htmlBody string) error {
	msg, err := buildMessage(s.from, to, subject, textBody, htmlBody)
	if err != nil {
		return fmt.Errorf("build message: %w", err)
	}

	addr := net.JoinHostPort(s.host, strconv.Itoa(s.port))
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("dial smtp: %w", err)
	}

	c, err := smtp.NewClient(conn, s.host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("smtp client: %w", err)
	}
	defer c.Close() //nolint:errcheck

	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(&tls.Config{ServerName: s.host, MinVersion: tls.VersionTLS12}); err != nil {
			return fmt.Errorf("starttls: %w", err)
		}
	}

	auth := smtp.PlainAuth("", s.user, s.password, s.host)
	if err := c.Auth(auth); err != nil {
		return fmt.Errorf("smtp auth: %w", err)
	}
	if err := c.Mail(s.envelope); err != nil {
		return fmt.Errorf("smtp mail from: %w", err)
	}
	if err := c.Rcpt(to); err != nil {
		return fmt.Errorf("smtp rcpt: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		_ = w.Close()
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp close data: %w", err)
	}
	return c.Quit()
}

// buildMessage assembles an RFC 5322 message. Subject is RFC 2047 encoded so
// accented Spanish renders correctly. When htmlBody is set the message is
// multipart/alternative (text + HTML); otherwise it is text/plain. Lines are
// CRLF-terminated as SMTP requires.
func buildMessage(from, to, subject, textBody, htmlBody string) ([]byte, error) {
	var b strings.Builder
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + mime.BEncoding.Encode("UTF-8", subject) + "\r\n")
	b.WriteString("Date: " + time.Now().Format(time.RFC1123Z) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")

	if htmlBody == "" {
		b.WriteString("Content-Type: text/plain; charset=\"UTF-8\"\r\n\r\n")
		b.WriteString(normalizeCRLF(textBody))
		return []byte(b.String()), nil
	}

	boundary, err := randomBoundary()
	if err != nil {
		return nil, err
	}
	b.WriteString("Content-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n\r\n")

	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/plain; charset=\"UTF-8\"\r\n\r\n")
	b.WriteString(normalizeCRLF(textBody) + "\r\n")

	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/html; charset=\"UTF-8\"\r\n\r\n")
	b.WriteString(normalizeCRLF(htmlBody) + "\r\n")

	b.WriteString("--" + boundary + "--\r\n")
	return []byte(b.String()), nil
}

// normalizeCRLF converts bare LFs to CRLF so the body is SMTP-safe regardless of
// how the template was written.
func normalizeCRLF(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.ReplaceAll(s, "\n", "\r\n")
}

func randomBoundary() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "kiramopay_" + hex.EncodeToString(buf), nil
}
