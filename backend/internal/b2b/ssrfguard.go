package b2b

import (
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"syscall"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// ErrBlockedURL is returned for webhook URLs that do not target a public host.
var ErrBlockedURL = errors.New("b2b: webhook url must target a public https/http host")

// privateWebhookTargetsAllowed relaxes the SSRF guard to permit loopback/private
// destinations. It is OFF by default and only ever enabled by integration tests
// that deliver to a local httptest server (via t.Setenv). Production must never
// set this variable.
func privateWebhookTargetsAllowed() bool {
	return os.Getenv("B2B_ALLOW_PRIVATE_WEBHOOK_TARGETS") == "1"
}

// validateWebhookURL parses rawURL and rejects anything that is not an http(s)
// URL to a publicly-routable host. It resolves the host and rejects if ANY
// resolved IP is loopback, private, link-local, unspecified, multicast, or
// CGNAT — closing SSRF to internal infrastructure and cloud metadata
// (169.254.169.254). Returns the normalized URL string on success.
//
// This is the first of two layers; the dispatcher's dialer re-checks the
// connected IP (safeDialControl) to defeat DNS-rebinding between registration
// and delivery.
func validateWebhookURL(rawURL string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Host == "" {
		return "", ErrBlockedURL
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return "", ErrBlockedURL
	}
	if u.User != nil { // no embedded credentials
		return "", ErrBlockedURL
	}
	if privateWebhookTargetsAllowed() {
		return u.String(), nil
	}
	ips, err := net.LookupIP(u.Hostname())
	if err != nil || len(ips) == 0 {
		return "", ErrBlockedURL
	}
	for _, ip := range ips {
		if !isPublicIP(ip) {
			return "", ErrBlockedURL
		}
	}
	return u.String(), nil
}

// isPublicIP reports whether ip is a globally-routable unicast address.
func isPublicIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
		ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return false
	}
	// Block CGNAT 100.64.0.0/10 (not covered by IsPrivate).
	if ip4 := ip.To4(); ip4 != nil && ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
		return false
	}
	return true
}

// safeDialControl is a net.Dialer.Control hook that re-checks the resolved
// address at connect time. The registration-time check can be bypassed if DNS
// later resolves the host to a private IP (DNS-rebinding); this closes that gap
// by inspecting the actual address the dialer is about to connect to.
func safeDialControl(_, address string, _ syscall.RawConn) error {
	if privateWebhookTargetsAllowed() {
		return nil
	}
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	if ip := net.ParseIP(host); ip == nil || !isPublicIP(ip) {
		return ErrBlockedURL
	}
	return nil
}

// newWebhookClient builds the dispatcher's HTTP client: OpenTelemetry-traced,
// SSRF-guarded at dial time, and configured NOT to follow redirects (a 30x to
// an internal host would otherwise bypass the URL validation).
func newWebhookClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second, Control: safeDialControl}
	base := &http.Transport{
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: otelhttp.NewTransport(base),
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse // do not follow redirects
		},
	}
}
