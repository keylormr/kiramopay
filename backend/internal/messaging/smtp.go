package messaging

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
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

// smtpEmail sends transactional email over SMTP+STARTTLS. Resend, Amazon SES,
// Postmark and Brevo all expose a standard SMTP endpoint on port 587, so this
// one client covers every provider: only host and credentials change.
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
// multipart/alternative (text + HTML); otherwise it is text/plain.
//
// Both bodies are base64-encoded, which is what makes accented Spanish safe to
// write in the templates. Declaring charset=UTF-8 without a transfer encoding
// implies 7bit, so raw multi-byte characters were only surviving on the good
// will of 8BITMIME servers; base64 also wraps at 76 columns, keeping the HTML
// under the 998-character line ceiling that RFC 5322 imposes — our one-line
// markup blew past it and could be mangled or rejected in transit.
func buildMessage(from, to, subject, textBody, htmlBody string) ([]byte, error) {
	var b strings.Builder
	b.WriteString("From: " + from + "\r\n")
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + mime.BEncoding.Encode("UTF-8", subject) + "\r\n")
	b.WriteString("Date: " + time.Now().Format(time.RFC1123Z) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")

	if htmlBody == "" {
		b.WriteString("Content-Type: text/plain; charset=\"UTF-8\"\r\n")
		b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
		b.WriteString(base64Body(textBody))
		return []byte(b.String()), nil
	}

	boundary, err := randomBoundary()
	if err != nil {
		return nil, err
	}
	b.WriteString("Content-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n\r\n")

	// Plain text first: multipart/alternative is ordered least- to
	// most-preferred, so a client that shows the last part it understands
	// lands on the HTML.
	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/plain; charset=\"UTF-8\"\r\n")
	b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
	b.WriteString(base64Body(textBody) + "\r\n")

	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/html; charset=\"UTF-8\"\r\n")
	b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
	b.WriteString(base64Body(htmlBody) + "\r\n")

	b.WriteString("--" + boundary + "--\r\n")
	return []byte(b.String()), nil
}

// base64MaxLine is the column at which base64 bodies wrap. RFC 2045 caps
// encoded lines at 76 characters.
const base64MaxLine = 76

// base64Body encodes a body and folds it into CRLF-terminated 76-column lines.
func base64Body(s string) string {
	enc := base64.StdEncoding.EncodeToString([]byte(normalizeCRLF(s)))
	var b strings.Builder
	for len(enc) > base64MaxLine {
		b.WriteString(enc[:base64MaxLine] + "\r\n")
		enc = enc[base64MaxLine:]
	}
	b.WriteString(enc + "\r\n")
	return b.String()
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
