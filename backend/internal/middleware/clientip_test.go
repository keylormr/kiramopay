package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func requestWith(xff, remote string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = remote
	if xff != "" {
		r.Header.Set("X-Forwarded-For", xff)
	}
	return r
}

func TestRequestIP(t *testing.T) {
	cases := []struct {
		name   string
		xff    string
		remote string
		want   string
	}{
		{"sin cabecera usa el peer", "", "203.0.113.7:5555", "203.0.113.7"},
		{"un solo salto", "198.51.100.9", "10.0.0.1:443", "198.51.100.9"},
		{"varios saltos toma el primero", "198.51.100.9, 10.0.0.1, 10.0.0.2", "10.0.0.3:443", "198.51.100.9"},
		{"espacios alrededor", "  198.51.100.9  ", "10.0.0.1:443", "198.51.100.9"},
		{"IPv6 entre corchetes", "[2001:db8::1]", "10.0.0.1:443", "2001:db8::1"},
		{"IPv6 en el peer", "", "[2001:db8::2]:8443", "2001:db8::2"},

		// Los dos casos que rompían escrituras en columnas inet.
		{"cabecera no parseable cae al peer", "unknown", "203.0.113.7:5555", "203.0.113.7"},
		{"cabecera con basura cae al peer", "not-an-ip, 10.0.0.1", "203.0.113.7:5555", "203.0.113.7"},

		{"nada parseable devuelve vacio", "unknown", "también-basura", ""},
		{"peer sin puerto", "", "203.0.113.7", "203.0.113.7"},
		{"zona de enlace local descartada", "", "fe80::1%eth0", "fe80::1"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := RequestIP(requestWith(c.xff, c.remote)); got != c.want {
				t.Fatalf("RequestIP() = %q, se esperaba %q", got, c.want)
			}
		})
	}
}

// El valor debe poder guardarse tal cual en una columna inet: sin comas, sin
// espacios, sin corchetes y sin zona. Es lo que fallaba antes.
func TestRequestIPEsApteParaInet(t *testing.T) {
	entradas := []struct{ xff, remote string }{
		{"1.2.3.4, 5.6.7.8", "10.0.0.1:443"},
		{"unknown", "10.0.0.1:443"},
		{"[2001:db8::1]", "10.0.0.1:443"},
		{"", "fe80::1%eth0"},
		{"", "basura"},
	}
	for _, e := range entradas {
		got := RequestIP(requestWith(e.xff, e.remote))
		if got == "" {
			continue // vacío se guarda como NULL, que es válido
		}
		if parseIP(got) != got {
			t.Fatalf("RequestIP() devolvió %q, que no vuelve a parsear como IP", got)
		}
	}
}

func TestPeerIPIgnoraLaCabecera(t *testing.T) {
	r := requestWith("1.2.3.4", "203.0.113.7:5555")
	if got := PeerIP(r); got != "203.0.113.7" {
		t.Fatalf("PeerIP() = %q, se esperaba el peer TCP y no la cabecera", got)
	}
}

// withSource configura la fuente de IP para un test y la restaura al default
// al terminar, para que los tests no se contaminen entre sí.
func withSource(t *testing.T, source string) {
	t.Helper()
	if err := ConfigureClientIP(source); err != nil {
		t.Fatalf("ConfigureClientIP(%q) devolvió error: %v", source, err)
	}
	t.Cleanup(func() { clientIPSource = sourceXFFLeftmost })
}

func TestConfigureClientIPRechazaValoresDesconocidos(t *testing.T) {
	if err := ConfigureClientIP("nginx"); err == nil {
		t.Fatal("ConfigureClientIP(\"nginx\") debía devolver error y no lo hizo")
	}
	for _, v := range []string{"", "xff-leftmost", "xff-rightmost", "cf-connecting-ip", "true-client-ip", "x-real-ip", "peer", " XFF-Rightmost "} {
		if err := ConfigureClientIP(v); err != nil {
			t.Fatalf("ConfigureClientIP(%q) devolvió error inesperado: %v", v, err)
		}
	}
	clientIPSource = sourceXFFLeftmost
}

func TestRequestIPRightmost(t *testing.T) {
	withSource(t, "xff-rightmost")
	cases := []struct {
		name   string
		xff    string
		remote string
		want   string
	}{
		// El cliente puede anteponer entradas falsas, pero no desplazar la que
		// agrega el proxy al final.
		{"toma la ultima entrada", "6.6.6.6, 203.0.113.7", "10.0.0.1:443", "203.0.113.7"},
		{"una sola entrada", "198.51.100.9", "10.0.0.1:443", "198.51.100.9"},
		{"basura al final salta a la anterior", "198.51.100.9, unknown", "10.0.0.1:443", "198.51.100.9"},
		{"todo basura cae al peer", "unknown, tampoco", "203.0.113.7:5555", "203.0.113.7"},
		{"sin cabecera usa el peer", "", "203.0.113.7:5555", "203.0.113.7"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := RequestIP(requestWith(c.xff, c.remote)); got != c.want {
				t.Fatalf("RequestIP() = %q, se esperaba %q", got, c.want)
			}
		})
	}
}

func TestRequestIPCabecerasDeProxyConfiable(t *testing.T) {
	cases := []struct {
		source string
		header string
	}{
		{"cf-connecting-ip", "CF-Connecting-IP"},
		{"true-client-ip", "True-Client-IP"},
	}
	for _, c := range cases {
		t.Run(c.source, func(t *testing.T) {
			withSource(t, c.source)

			r := requestWith("6.6.6.6", "10.0.0.1:443")
			r.Header.Set(c.header, "203.0.113.7")
			if got := RequestIP(r); got != "203.0.113.7" {
				t.Fatalf("RequestIP() = %q, se esperaba la cabecera %s y no X-Forwarded-For", got, c.header)
			}

			// Sin la cabecera (o con basura) cae al peer, nunca a X-Forwarded-For.
			r2 := requestWith("6.6.6.6", "203.0.113.9:443")
			if got := RequestIP(r2); got != "203.0.113.9" {
				t.Fatalf("RequestIP() sin %s = %q, se esperaba el peer", c.header, got)
			}
			r3 := requestWith("6.6.6.6", "203.0.113.9:443")
			r3.Header.Set(c.header, "unknown")
			if got := RequestIP(r3); got != "203.0.113.9" {
				t.Fatalf("RequestIP() con %s basura = %q, se esperaba el peer", c.header, got)
			}
		})
	}
}

func TestRequestIPSoloPeer(t *testing.T) {
	withSource(t, "peer")
	r := requestWith("6.6.6.6", "203.0.113.7:5555")
	r.Header.Set("CF-Connecting-IP", "7.7.7.7")
	if got := RequestIP(r); got != "203.0.113.7" {
		t.Fatalf("RequestIP() = %q, se esperaba solo el peer TCP", got)
	}
}

// Ninguna cabecera que el cliente pueda escribir debe poder desplazar al peer
// TCP en modo "peer". La garantía se rompía porque chimw.RealIP sobrescribía
// r.RemoteAddr con True-Client-IP / X-Real-IP / el XFF más a la izquierda; ese
// middleware ya no se registra (ver cmd/api/main.go). Si alguien lo reintroduce,
// el modo "peer" vuelve a ser falsificable y con él la clave del rate limit.
func TestPeerNoSeFalsificaConCabeceras(t *testing.T) {
	withSource(t, "peer")
	for _, h := range []string{"X-Forwarded-For", "X-Real-IP", "True-Client-IP", "CF-Connecting-IP", "Forwarded"} {
		t.Run(h, func(t *testing.T) {
			r := requestWith("", "203.0.113.7:5555")
			r.Header.Set(h, "6.6.6.6")
			if got := RequestIP(r); got != "203.0.113.7" {
				t.Fatalf("con %s: RequestIP() = %q, la cabecera desplazó al peer TCP", h, got)
			}
		})
	}
}

// Cada request de un atacante que varía la cabecera debe seguir cayendo en la
// MISMA clave de rate limit; si cada una produjera una clave distinta, el
// contador nunca acumularía y el límite no dispararía nunca.
func TestClaveDeRateLimitEstableBajoCabecerasVariables(t *testing.T) {
	withSource(t, "peer")
	claves := map[string]bool{}
	for _, forjada := range []string{"6.6.6.1", "6.6.6.2", "6.6.6.3"} {
		r := requestWith(forjada, "203.0.113.7:5555")
		r.Header.Set("X-Real-IP", forjada)
		r.Header.Set("True-Client-IP", forjada)
		claves[limiterIP(r)] = true
	}
	if len(claves) != 1 {
		t.Fatalf("se generaron %d claves distintas (%v); el rate limit nunca acumularía", len(claves), claves)
	}
}

func TestRequestIPXRealIP(t *testing.T) {
	withSource(t, "x-real-ip")
	r := requestWith("6.6.6.6", "10.0.0.1:443")
	r.Header.Set("X-Real-IP", "203.0.113.7")
	if got := RequestIP(r); got != "203.0.113.7" {
		t.Fatalf("RequestIP() = %q, se esperaba X-Real-IP", got)
	}
	// Sin la cabecera cae al peer, nunca a X-Forwarded-For.
	if got := RequestIP(requestWith("6.6.6.6", "203.0.113.9:443")); got != "203.0.113.9" {
		t.Fatalf("RequestIP() sin X-Real-IP = %q, se esperaba el peer", got)
	}
}
