// Package b2b implements the merchant API platform: API keys that
// authenticate programmatic access (mounted under /api/b2b/v1), and webhooks
// that push event notifications (escrow lifecycle) to merchant endpoints,
// HMAC-SHA256 signed and retried with exponential backoff.
package b2b

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

// keyPrefix marks every KiramoPay API key; the random part is 24 bytes hex.
const keyPrefix = "kp_live_"

// APIKey is the stored (hashed) form of a merchant credential.
type APIKey struct {
	ID         string     `json:"id"`
	UserID     string     `json:"-"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"` // displayable identifier, e.g. "kp_live_a1b2c3"
	Scopes     string     `json:"scopes"` // comma-separated allowlist
	Status     string     `json:"status"` // active | revoked
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
}

// Known scopes for the merchant API.
const (
	ScopeEscrowRead  = "escrow:read"
	ScopeEscrowWrite = "escrow:write"
	ScopePayoutRead  = "payout:read"
	ScopePayoutWrite = "payout:write"
)

// AllScopes is the valid-scope allowlist (also the default for new keys).
// Existing keys keep their stored scope set; only keys created with an empty
// scope list (the v1 "grant everything" default) pick up newly added scopes.
var AllScopes = []string{ScopeEscrowRead, ScopeEscrowWrite, ScopePayoutRead, ScopePayoutWrite}

// NormalizeScopes validates and canonicalizes a comma-separated scope list.
// Empty input grants every scope (sensible default for v1 keys).
func NormalizeScopes(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return strings.Join(AllScopes, ","), nil
	}
	valid := make(map[string]bool, len(AllScopes))
	for _, s := range AllScopes {
		valid[s] = true
	}
	var out []string
	seen := map[string]bool{}
	for _, s := range strings.Split(raw, ",") {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		if !valid[s] {
			return "", ErrInvalid
		}
		seen[s] = true
		out = append(out, s)
	}
	if len(out) == 0 {
		return "", ErrInvalid
	}
	return strings.Join(out, ","), nil
}

// HasScope reports whether a canonical scope list contains the scope.
func HasScope(scopes, scope string) bool {
	for _, s := range strings.Split(scopes, ",") {
		if strings.TrimSpace(s) == scope {
			return true
		}
	}
	return false
}

// WebhookEndpoint is a merchant-registered notification target.
type WebhookEndpoint struct {
	ID        string    `json:"id"`
	UserID    string    `json:"-"`
	URL       string    `json:"url"`
	Secret    string    `json:"-"` // returned once at creation, then hidden
	Events    string    `json:"events"`
	Status    string    `json:"status"` // active | disabled
	CreatedAt time.Time `json:"created_at"`
}

// Delivery is one webhook outbox row.
type Delivery struct {
	ID            string     `json:"id"`
	EndpointID    string     `json:"endpoint_id"`
	EventType     string     `json:"event_type"`
	Payload       []byte     `json:"payload"`
	Status        string     `json:"status"`
	Attempts      int        `json:"attempts"`
	NextAttemptAt time.Time  `json:"next_attempt_at"`
	ResponseCode  *int       `json:"response_code,omitempty"`
	LastError     string     `json:"last_error,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	DeliveredAt   *time.Time `json:"delivered_at,omitempty"`
}

// Domain errors.
var (
	ErrNotFound   = errors.New("b2b: not found")
	ErrInvalidKey = errors.New("b2b: invalid or revoked API key")
	ErrInvalid    = errors.New("b2b: invalid request")
)

// GenerateKey mints a fresh API key. It returns the FULL key (shown to the
// merchant exactly once), the display prefix, and the sha-256 hash to store.
func GenerateKey() (full, prefix, hash string, err error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", "", "", err
	}
	full = keyPrefix + hex.EncodeToString(b)
	prefix = full[:len(keyPrefix)+6]
	hash = HashKey(full)
	return full, prefix, hash, nil
}

// HashKey is the storage/lookup transform for API keys.
func HashKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

// LooksLikeKey is a cheap pre-filter before hitting the DB.
func LooksLikeKey(s string) bool {
	return strings.HasPrefix(s, keyPrefix) && len(s) > len(keyPrefix)+12
}

// GenerateSecret mints a webhook signing secret (hex, 32 bytes entropy).
func GenerateSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "whsec_" + hex.EncodeToString(b)[:48], nil
}

// Sign computes the signature header value for a webhook body:
// hex(HMAC-SHA256(secret, body)). Merchants recompute it to verify origin.
func Sign(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// SignWithTimestamp binds the signature to a point in time by signing
// "<unix_ts>.<body>" (Stripe-style). The timestamp is also sent in the
// X-Kiramopay-Timestamp header so receivers can reject deliveries outside a
// tolerance window and thereby detect replays of captured (body, signature)
// pairs (the body-only Sign has no expiry).
func SignWithTimestamp(secret, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// EventMatches reports whether an endpoint subscribed to `events` (comma
// separated list, or "*") should receive eventType.
func EventMatches(events, eventType string) bool {
	events = strings.TrimSpace(events)
	if events == "" || events == "*" {
		return true
	}
	for _, e := range strings.Split(events, ",") {
		if strings.TrimSpace(e) == eventType {
			return true
		}
	}
	return false
}

// Backoff returns the delay before the next delivery attempt (1-indexed):
// 30s, 1m, 2m, 4m, … capped at 1h.
func Backoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	d := 30 * time.Second << (attempt - 1)
	if d > time.Hour {
		return time.Hour
	}
	return d
}

// MaxAttempts is how many times a delivery is tried before being failed.
const MaxAttempts = 8
