package middleware

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// ipSource selects where RequestIP reads the client address from. It is set
// once at boot via ConfigureClientIP and never changes afterwards, so reads
// need no synchronisation.
type ipSource int

const (
	// sourceXFFLeftmost is the historical behaviour: leftmost X-Forwarded-For
	// entry, falling back to the TCP peer. Client-controlled and therefore
	// spoofable — kept as the default so a deploy without the new env var
	// changes nothing.
	sourceXFFLeftmost ipSource = iota
	// sourceXFFRightmost takes the RIGHTMOST syntactically valid entry: the one
	// appended by the last proxy before us, which a client cannot displace as
	// long as exactly one trusted proxy fronts the service.
	sourceXFFRightmost
	// sourceCFConnectingIP reads CF-Connecting-IP, which Cloudflare overwrites
	// on every request it proxies. Only trustworthy when ALL traffic enters
	// through Cloudflare (Render fronts services with it).
	sourceCFConnectingIP
	// sourceTrueClientIP reads True-Client-IP (Cloudflare Enterprise / Akamai).
	sourceTrueClientIP
	// sourceXRealIP reads X-Real-IP, which the nginx in this repo sets from
	// $remote_addr (nginx.conf, nginx/default.conf). Trustworthy only when that
	// nginx is the sole entry point.
	sourceXRealIP
	// sourcePeer trusts only the TCP peer address. This is the genuine TCP
	// peer: chimw.RealIP, which used to overwrite r.RemoteAddr from
	// client-controlled headers, is no longer registered (see cmd/api/main.go).
	sourcePeer
)

var clientIPSource = sourceXFFLeftmost

// ConfigureClientIP selects the trust boundary for RequestIP from the
// CLIENT_IP_SOURCE environment value. Empty keeps the historical default
// (leftmost X-Forwarded-For). An unknown value is a boot error: silently
// falling back would leave the rate limiter keyed on a spoofable value while
// the operator believes otherwise.
func ConfigureClientIP(source string) error {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "", "xff-leftmost":
		clientIPSource = sourceXFFLeftmost
	case "xff-rightmost":
		clientIPSource = sourceXFFRightmost
	case "cf-connecting-ip":
		clientIPSource = sourceCFConnectingIP
	case "true-client-ip":
		clientIPSource = sourceTrueClientIP
	case "x-real-ip":
		clientIPSource = sourceXRealIP
	case "peer":
		clientIPSource = sourcePeer
	default:
		return fmt.Errorf("CLIENT_IP_SOURCE %q no es válido (opciones: xff-leftmost, xff-rightmost, cf-connecting-ip, true-client-ip, x-real-ip, peer)", source)
	}
	return nil
}

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
// TRUST: which value is authoritative depends on what sits in front of the
// service, so it is chosen at deploy time via CLIENT_IP_SOURCE (see
// ConfigureClientIP). The default remains the leftmost X-Forwarded-For entry,
// which is client-controlled and spoofable; it must not be treated as a
// security boundary until the operator verifies the real header layout (the
// /metrics/client-ip endpoint echoes it) and switches the source.
func RequestIP(r *http.Request) string {
	switch clientIPSource {
	case sourceXFFRightmost:
		if ip := rightmostXFF(r); ip != "" {
			return ip
		}
	case sourceCFConnectingIP:
		if ip := parseIP(r.Header.Get("CF-Connecting-IP")); ip != "" {
			return ip
		}
	case sourceTrueClientIP:
		if ip := parseIP(r.Header.Get("True-Client-IP")); ip != "" {
			return ip
		}
	case sourceXRealIP:
		if ip := parseIP(r.Header.Get("X-Real-IP")); ip != "" {
			return ip
		}
	case sourcePeer:
		// fall through to PeerIP below
	default: // sourceXFFLeftmost
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			if ip := parseIP(strings.SplitN(xff, ",", 2)[0]); ip != "" {
				return ip
			}
		}
	}
	return PeerIP(r)
}

// rightmostXFF returns the rightmost syntactically valid X-Forwarded-For
// entry — the one written by the proxy closest to us.
func rightmostXFF(r *http.Request) string {
	xff := r.Header.Get("X-Forwarded-For")
	if xff == "" {
		return ""
	}
	parts := strings.Split(xff, ",")
	for i := len(parts) - 1; i >= 0; i-- {
		if ip := parseIP(parts[i]); ip != "" {
			return ip
		}
	}
	return ""
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
