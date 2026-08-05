package messaging

import (
	"encoding/base64"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
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

// parseParts reads a built message the way a mail client would: headers via
// net/mail, bodies decoded according to their declared transfer encoding. It
// returns the decoded body of each part keyed by media type. Asserting on
// decoded output is what proves the message is actually readable — string
// matching on the raw bytes passed even while the encoding was wrong.
func parseParts(t *testing.T, raw []byte) (hdr mail.Header, parts map[string]string) {
	t.Helper()
	m, err := mail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatalf("el mensaje no parsea como RFC 5322: %v", err)
	}
	parts = map[string]string{}

	mediaType, params, err := mime.ParseMediaType(m.Header.Get("Content-Type"))
	if err != nil {
		t.Fatalf("Content-Type inválido: %v", err)
	}
	if !strings.HasPrefix(mediaType, "multipart/") {
		parts[mediaType] = decodeBody(t, m.Header.Get("Content-Transfer-Encoding"), m.Body)
		return m.Header, parts
	}

	mr := multipart.NewReader(m.Body, params["boundary"])
	for {
		p, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("parte multipart inválida: %v", err)
		}
		mt, _, err := mime.ParseMediaType(p.Header.Get("Content-Type"))
		if err != nil {
			t.Fatalf("Content-Type de parte inválido: %v", err)
		}
		parts[mt] = decodeBody(t, p.Header.Get("Content-Transfer-Encoding"), p)
	}
	return m.Header, parts
}

func decodeBody(t *testing.T, encoding string, r io.Reader) string {
	t.Helper()
	raw, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("lectura del cuerpo: %v", err)
	}
	if !strings.EqualFold(strings.TrimSpace(encoding), "base64") {
		return string(raw)
	}
	// base64 va plegado en líneas de 76 columnas; se quitan los saltos antes de
	// decodificar.
	limpio := strings.NewReplacer("\r", "", "\n", "").Replace(string(raw))
	dec, err := base64.StdEncoding.DecodeString(limpio)
	if err != nil {
		t.Fatalf("el cuerpo no decodifica como base64: %v", err)
	}
	return string(dec)
}

func TestBuildMessagePlainText(t *testing.T) {
	msg, err := buildMessage("a@x.com", "b@y.com", "Código de acceso", "linea uno\nlinea dos", "")
	if err != nil {
		t.Fatalf("buildMessage error: %v", err)
	}
	hdr, parts := parseParts(t, msg)

	if got := hdr.Get("From"); got != "a@x.com" {
		t.Errorf("From = %q", got)
	}
	if got := hdr.Get("To"); got != "b@y.com" {
		t.Errorf("To = %q", got)
	}
	// El asunto acentuado viaja codificado, pero debe DECODIFICAR al original.
	raw := hdr.Get("Subject")
	if strings.Contains(raw, "Código") {
		t.Error("el asunto debía ir codificado, no en UTF-8 crudo")
	}
	subject, err := new(mime.WordDecoder).DecodeHeader(raw)
	if err != nil {
		t.Fatalf("decodificación del asunto: %v", err)
	}
	if subject != "Código de acceso" {
		t.Errorf("asunto decodificado = %q", subject)
	}

	if body := parts["text/plain"]; !strings.Contains(body, "linea uno\r\nlinea dos") {
		t.Errorf("cuerpo = %q, se esperaba CRLF entre líneas", body)
	}
	if _, ok := parts["text/html"]; ok {
		t.Error("un mensaje solo-texto no debe traer parte HTML")
	}
}

func TestBuildMessageMultipart(t *testing.T) {
	msg, err := buildMessage("a@x.com", "b@y.com", "Hola", "texto", "<p>html</p>")
	if err != nil {
		t.Fatalf("buildMessage error: %v", err)
	}
	_, parts := parseParts(t, msg)

	if got := parts["text/plain"]; strings.TrimSpace(got) != "texto" {
		t.Errorf("parte de texto = %q", got)
	}
	if got := parts["text/html"]; strings.TrimSpace(got) != "<p>html</p>" {
		t.Errorf("parte HTML = %q", got)
	}
}

// Las tildes tienen que sobrevivir el viaje. Antes las partes se declaraban
// UTF-8 sin codificación de transferencia, o sea 7 bits, y los caracteres
// multibyte solo pasaban por buena voluntad del servidor; por eso las
// plantillas escribían "contrasena".
func TestBuildMessageConservaLasTildes(t *testing.T) {
	texto := "Tu código de restablecimiento. Ignorá este mensaje si no fuiste vos."
	htmlCuerpo := `<p>Restablecé tu contraseña</p>`

	msg, err := buildMessage("a@x.com", "b@y.com", "Contraseña", texto, htmlCuerpo)
	if err != nil {
		t.Fatalf("buildMessage error: %v", err)
	}
	_, parts := parseParts(t, msg)

	if got := strings.TrimSpace(parts["text/plain"]); got != texto {
		t.Errorf("texto = %q, se esperaba %q", got, texto)
	}
	if got := strings.TrimSpace(parts["text/html"]); got != htmlCuerpo {
		t.Errorf("html = %q, se esperaba %q", got, htmlCuerpo)
	}
}

// RFC 5322 limita cada línea a 998 caracteres. El HTML de las plantillas se
// arma en una sola línea de varios miles, así que sin plegado el mensaje podía
// ser rechazado o mutilado en tránsito.
func TestBuildMessagePliegaLineasLargas(t *testing.T) {
	htmlLargo := "<div>" + strings.Repeat("a", 5000) + "</div>"

	msg, err := buildMessage("a@x.com", "b@y.com", "Hola", "texto", htmlLargo)
	if err != nil {
		t.Fatalf("buildMessage error: %v", err)
	}

	for i, linea := range strings.Split(string(msg), "\r\n") {
		if len(linea) > 998 {
			t.Fatalf("la línea %d mide %d caracteres, el máximo del RFC 5322 es 998", i+1, len(linea))
		}
	}

	// Y pese al plegado, el contenido debe reconstruirse intacto.
	_, parts := parseParts(t, msg)
	if got := strings.TrimSpace(parts["text/html"]); got != htmlLargo {
		t.Errorf("el HTML no sobrevivió el plegado: %d caracteres, se esperaban %d", len(got), len(htmlLargo))
	}
}
