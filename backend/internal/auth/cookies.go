package auth

import (
	"net/http"
	"time"
)

// CookieConfig controls the session refresh cookie.
//
// Secure must be true in production (the cookie is sent over HTTPS only) and it
// also gates the __Host- cookie name prefix, which the browser only accepts on
// Secure cookies with Path=/ and no Domain. In local development over plain
// HTTP, Secure is false and a plain cookie name is used so the cookie still
// works.
type CookieConfig struct {
	// Secure marks the cookie Secure and selects the __Host- name. Set from the
	// deployment environment (production => true).
	Secure bool
}

const (
	// refreshCookieSecureName is used in production. The __Host- prefix binds the
	// cookie to Secure + Path=/ + no Domain at the browser level (OWASP).
	refreshCookieSecureName = "__Host-kp_refresh"
	// refreshCookieDevName is used over plain HTTP, where __Host- is rejected.
	refreshCookieDevName = "kp_refresh"
)

// refreshCookieName returns the cookie name for the current Secure mode. The
// same process always uses one name, so reads and writes stay consistent.
func (c CookieConfig) refreshCookieName() string {
	if c.Secure {
		return refreshCookieSecureName
	}
	return refreshCookieDevName
}

// setRefreshCookie writes the refresh token as a cookie the browser stores but
// JavaScript cannot read (HttpOnly), so an XSS cannot exfiltrate it. SameSite=
// Strict is the CSRF control: the browser never sends the cookie on cross-site
// requests, so a forged cross-site call to /auth/refresh carries no token.
func (c CookieConfig) setRefreshCookie(w http.ResponseWriter, token string, expires time.Time) {
	// #nosec G124 -- Secure is intentionally config-driven: true in production
	// (HTTPS), false only in local dev over plain HTTP. HttpOnly and
	// SameSite=Strict are always set.
	http.SetCookie(w, &http.Cookie{
		Name:     c.refreshCookieName(),
		Value:    token,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		Secure:   c.Secure,
		SameSite: http.SameSiteStrictMode,
	})
}

// clearRefreshCookie expires the refresh cookie (used on logout and on a failed
// refresh from a cookie, so a stale/invalid token does not linger).
func (c CookieConfig) clearRefreshCookie(w http.ResponseWriter) {
	// #nosec G124 -- see setRefreshCookie: Secure is config-driven; this only
	// expires the cookie (empty value, negative MaxAge).
	http.SetCookie(w, &http.Cookie{
		Name:     c.refreshCookieName(),
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   c.Secure,
		SameSite: http.SameSiteStrictMode,
	})
}

// refreshTokenFromCookie returns the refresh token carried in the cookie, or ""
// if there is none.
func (c CookieConfig) refreshTokenFromCookie(r *http.Request) string {
	if ck, err := r.Cookie(c.refreshCookieName()); err == nil {
		return ck.Value
	}
	return ""
}
