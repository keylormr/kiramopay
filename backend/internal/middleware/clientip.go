package middleware

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// RequestIP returns the client IP in a form that is safe to persist in a
// Postgres `inet` column: either a syntactically valid address, or the empty
// string when none can be determined.
//
// Every caller used to read X-Forwarded-For by hand and pass the result
// straight into an `::inet` cast, which failed on two shapes that occur in the
// wild:
//
//   - the whole header with several hops ("1.2.3.4, 5.6.7.8"), which lost the
//     audit event because the INSERT itself errored;
//   - a non-address token such as "unknown", which some corporate proxies emit
//     verbatim and which broke session creation — and therefore login — with a
//     misleading "invalid credentials" response.
//
// Validating here means a malformed header degrades to the peer address, and a
// malformed peer address degrades to NULL, instead of failing the write.
//
// NOTE ON TRUST: this keeps the historical source of truth — the leftmost
// X-Forwarded-For entry — which is client-controlled and therefore spoofable.
// It is not a security boundary and must not be treated as one; choosing a
// trusted-proxy boundary requires knowing how many hops sit in front of this
// service, which is a deployment question, not a code one.
func RequestIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if ip := parseIP(strings.SplitN(xff, ",", 2)[0]); ip != "" {
			return ip
		}
	}
	return PeerIP(r)
}

// PeerIP returns the address of the TCP peer — the only value no client can
// forge, and the proxy's address when one sits in front. Empty when it cannot
// be parsed.
func PeerIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		// RemoteAddr is not always host:port (httptest leaves it bare).
		host = r.RemoteAddr
	}
	return parseIP(host)
}

// parseIP normalises one candidate: trims spaces, drops the brackets of an
// IPv6 literal and the zone of a link-local address (`inet` rejects zones), and
// returns "" when the result is not an address.
func parseIP(raw string) string {
	s := strings.TrimSpace(raw)
	s = strings.TrimPrefix(s, "[")
	s = strings.TrimSuffix(s, "]")
	if s == "" {
		return ""
	}
	addr, err := netip.ParseAddr(s)
	if err != nil {
		return ""
	}
	return addr.WithZone("").String()
}
