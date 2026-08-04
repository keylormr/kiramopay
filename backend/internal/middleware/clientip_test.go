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
