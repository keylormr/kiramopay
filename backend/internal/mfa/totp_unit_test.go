package mfa

import (
	"testing"
	"time"
)

func TestTOTPRoundTrip(t *testing.T) {
	secret, err := generateTOTPSecret()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	now := time.Now()

	// Derive the current code the same way the validator does, then verify it.
	b, err := decodeTOTPSecret(secret)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	step := now.Unix() / totpPeriod
	code := hotp(b, uint64(step))

	gotStep, ok := validateTOTP(secret, code, now)
	if !ok {
		t.Fatalf("expected code %q to validate", code)
	}
	if gotStep != step {
		t.Errorf("expected step %d, got %d", step, gotStep)
	}
}

func TestTOTPSkewWindow(t *testing.T) {
	secret, _ := generateTOTPSecret()
	b, _ := decodeTOTPSecret(secret)
	now := time.Now()
	step := now.Unix() / totpPeriod

	// Code from the previous step must still validate (±1 skew).
	prev := hotp(b, uint64(step-1))
	if _, ok := validateTOTP(secret, prev, now); !ok {
		t.Errorf("previous-step code should validate within skew window")
	}

	// Code two steps in the past must NOT validate.
	old := hotp(b, uint64(step-3))
	if _, ok := validateTOTP(secret, old, now); ok {
		t.Errorf("3-steps-old code should be outside skew window")
	}
}

func TestTOTPRejectsGarbage(t *testing.T) {
	secret, _ := generateTOTPSecret()
	for _, bad := range []string{"", "123", "abcdef", "12345", "1234567"} {
		if _, ok := validateTOTP(secret, bad, time.Now()); ok {
			t.Errorf("expected %q to be rejected", bad)
		}
	}
}

func TestEncryptDecryptSecret(t *testing.T) {
	s := NewService(nil, &Config{TOTPEncryptionKey: []byte("a-test-key-for-totp-secrets-xx")})
	if s.totpAEAD == nil {
		t.Fatal("expected AEAD configured")
	}
	plain := "JBSWY3DPEHPK3PXP"
	blob, err := s.encryptSecret(plain)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if string(blob) == plain {
		t.Fatal("ciphertext must differ from plaintext")
	}
	got, err := s.decryptSecret(blob)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got != plain {
		t.Errorf("round-trip mismatch: got %q want %q", got, plain)
	}
}

func TestTOTPDisabledWithoutKey(t *testing.T) {
	s := NewService(nil, &Config{}) // no key
	if s.totpAEAD != nil {
		t.Fatal("expected TOTP disabled without key")
	}
}

func TestRecoveryCodeFormat(t *testing.T) {
	c, err := randomRecoveryCode()
	if err != nil {
		t.Fatalf("gen: %v", err)
	}
	if len(c) != 9 || c[4] != '-' {
		t.Errorf("expected XXXX-XXXX format, got %q", c)
	}
	// Normalization strips the dash and uppercases for hashing/lookup.
	if normalizeRecovery("ab12-cd34") != "AB12CD34" {
		t.Errorf("normalizeRecovery wrong: %q", normalizeRecovery("ab12-cd34"))
	}
}

func TestOtpauthURL(t *testing.T) {
	uri := otpauthURL("JBSWY3DPEHPK3PXP", "702650930")
	for _, want := range []string{"otpauth://totp/", "secret=JBSWY3DPEHPK3PXP", "issuer=KiramoPay", "digits=6", "period=30"} {
		if !contains(uri, want) {
			t.Errorf("otpauth URL missing %q: %s", want, uri)
		}
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
