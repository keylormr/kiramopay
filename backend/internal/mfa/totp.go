package mfa

// RFC 6238 (TOTP) / RFC 4226 (HOTP) implemented in-house to avoid pulling a
// third-party dependency. SHA-1 / 6 digits / 30s period — the defaults every
// authenticator app (Google Authenticator, Authy, 1Password) assumes.

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" // #nosec G505 -- HMAC-SHA1 is the RFC 6238 standard for TOTP, not used as a plain hash
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const (
	totpDigits      = 6
	totpPeriod      = 30 // seconds per step
	totpSecretBytes = 20 // 160-bit secret (RFC 4226 §4 recommendation)
	totpSkew        = 1  // accept ±1 step (±30s) for clock drift
	totpIssuer      = "KiramoPay"
)

var totpEnc = base32.StdEncoding.WithPadding(base32.NoPadding)

// generateTOTPSecret returns a random base32 (unpadded, uppercase) secret
// suitable for an otpauth:// URI and authenticator-app entry.
func generateTOTPSecret() (string, error) {
	b := make([]byte, totpSecretBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return totpEnc.EncodeToString(b), nil
}

// otpauthURL builds the provisioning URI an authenticator app scans as a QR.
// account is the user-facing label (e.g. the cédula or email).
func otpauthURL(secretB32, account string) string {
	label := url.PathEscape(totpIssuer + ":" + account)
	q := url.Values{}
	q.Set("secret", secretB32)
	q.Set("issuer", totpIssuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", fmt.Sprintf("%d", totpDigits))
	q.Set("period", fmt.Sprintf("%d", totpPeriod))
	return "otpauth://totp/" + label + "?" + q.Encode()
}

// hotp computes the RFC 4226 HOTP value for a counter.
func hotp(secret []byte, counter uint64) string {
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)
	mac := hmac.New(sha1.New, secret)
	mac.Write(buf[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := (uint32(sum[offset]&0x7f) << 24) |
		(uint32(sum[offset+1]) << 16) |
		(uint32(sum[offset+2]) << 8) |
		uint32(sum[offset+3])
	mod := uint32(1)
	for i := 0; i < totpDigits; i++ {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", totpDigits, value%mod)
}

// decodeTOTPSecret tolerates lowercase, spaces and optional padding the way
// users paste secrets.
func decodeTOTPSecret(s string) ([]byte, error) {
	s = strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(s), " ", ""))
	if b, err := totpEnc.DecodeString(s); err == nil {
		return b, nil
	}
	return base32.StdEncoding.DecodeString(s)
}

// validateTOTP checks code against the secret around time `at`, accepting
// ±totpSkew steps. On a match it returns the matched step (for replay
// prevention) and true. Comparison is constant-time.
func validateTOTP(secretB32, code string, at time.Time) (int64, bool) {
	code = strings.TrimSpace(code)
	if len(code) != totpDigits {
		return 0, false
	}
	secret, err := decodeTOTPSecret(secretB32)
	if err != nil || len(secret) == 0 {
		return 0, false
	}
	step := at.Unix() / totpPeriod
	for i := -totpSkew; i <= totpSkew; i++ {
		s := step + int64(i)
		if s < 0 {
			continue
		}
		candidate := hotp(secret, uint64(s))
		if subtle.ConstantTimeCompare([]byte(candidate), []byte(code)) == 1 {
			return s, true
		}
	}
	return 0, false
}
