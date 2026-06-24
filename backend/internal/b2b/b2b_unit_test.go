package b2b

import (
	"strings"
	"testing"
	"time"
)

func TestGenerateKeyShape(t *testing.T) {
	full, prefix, hash, err := GenerateKey()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if !strings.HasPrefix(full, "kp_live_") {
		t.Errorf("key missing prefix: %q", full)
	}
	if len(full) != len("kp_live_")+48 {
		t.Errorf("unexpected key length: %d", len(full))
	}
	if !strings.HasPrefix(full, prefix) {
		t.Errorf("prefix %q is not a prefix of the key", prefix)
	}
	if HashKey(full) != hash {
		t.Error("hash mismatch with HashKey")
	}
	if !LooksLikeKey(full) {
		t.Error("generated key should pass LooksLikeKey")
	}
	for _, bad := range []string{"", "kp_live_", "sk_live_abc", "Bearer x"} {
		if LooksLikeKey(bad) {
			t.Errorf("%q should not look like a key", bad)
		}
	}
}

func TestSignIsDeterministicAndSecretBound(t *testing.T) {
	body := []byte(`{"event":"escrow.funded"}`)
	s1 := Sign("whsec_aaa", body)
	s2 := Sign("whsec_aaa", body)
	s3 := Sign("whsec_bbb", body)
	if s1 != s2 {
		t.Error("same secret+body must produce the same signature")
	}
	if s1 == s3 {
		t.Error("different secrets must produce different signatures")
	}
	if !strings.HasPrefix(s1, "sha256=") {
		t.Errorf("signature missing scheme prefix: %q", s1)
	}
}

func TestEventMatches(t *testing.T) {
	cases := []struct {
		events, event string
		want          bool
	}{
		{"*", "escrow.funded", true},
		{"", "escrow.funded", true},
		{"escrow.funded", "escrow.funded", true},
		{"escrow.funded, escrow.released", "escrow.released", true},
		{"escrow.funded", "escrow.released", false},
		{"escrow.*", "escrow.funded", false}, // no glob support (yet) — exact only
	}
	for _, c := range cases {
		if got := EventMatches(c.events, c.event); got != c.want {
			t.Errorf("EventMatches(%q, %q) = %v, want %v", c.events, c.event, got, c.want)
		}
	}
}

func TestCipherRoundTripAndLegacy(t *testing.T) {
	c := NewCipher([]byte("some-key-material"))
	enc, err := c.Encrypt("whsec_abc123")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if !strings.HasPrefix(enc, "enc:") {
		t.Errorf("expected enc: prefix, got %q", enc)
	}
	dec, err := c.Decrypt(enc)
	if err != nil || dec != "whsec_abc123" {
		t.Fatalf("decrypt round-trip: got (%q, %v)", dec, err)
	}

	// Legacy plaintext rows pass through untouched.
	if got, err := c.Decrypt("whsec_legacy_plaintext"); err != nil || got != "whsec_legacy_plaintext" {
		t.Errorf("legacy passthrough: got (%q, %v)", got, err)
	}

	// Wrong key fails closed.
	other := NewCipher([]byte("a-different-key"))
	if _, err := other.Decrypt(enc); err == nil {
		t.Error("decrypt with wrong key must fail")
	}

	// Nil-key cipher is a transparent no-op.
	noop := NewCipher(nil)
	if got, _ := noop.Encrypt("plain"); got != "plain" {
		t.Errorf("noop encrypt: got %q", got)
	}
}

func TestNormalizeScopes(t *testing.T) {
	cases := []struct {
		in, want string
		wantErr  bool
	}{
		{"", "escrow:read,escrow:write,payout:read,payout:write", false}, // empty = all scopes
		{"escrow:read", "escrow:read", false},
		{" escrow:write , escrow:read ", "escrow:write,escrow:read", false},
		{"escrow:read,escrow:read", "escrow:read", false}, // dedup
		{"payout:write", "payout:write", false},
		{"admin:everything", "", true},
		{",,,", "", true},
	}
	for _, c := range cases {
		got, err := NormalizeScopes(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("NormalizeScopes(%q): expected error, got %q", c.in, got)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("NormalizeScopes(%q) = (%q, %v), want %q", c.in, got, err, c.want)
		}
	}
	if !HasScope("escrow:read,escrow:write", "escrow:write") {
		t.Error("HasScope should find escrow:write")
	}
	if HasScope("escrow:read", "escrow:write") {
		t.Error("HasScope must not find missing scope")
	}
}

func TestBackoffProgression(t *testing.T) {
	if Backoff(1) != 30*time.Second {
		t.Errorf("attempt 1: got %s", Backoff(1))
	}
	if Backoff(2) != time.Minute {
		t.Errorf("attempt 2: got %s", Backoff(2))
	}
	if Backoff(5) != 8*time.Minute {
		t.Errorf("attempt 5: got %s", Backoff(5))
	}
	if Backoff(20) != time.Hour {
		t.Errorf("attempt 20 should cap at 1h: got %s", Backoff(20))
	}
	if Backoff(0) != 30*time.Second {
		t.Errorf("attempt 0 clamps to first step: got %s", Backoff(0))
	}
}

func TestValidateWebhookURL_BlocksSSRF(t *testing.T) {
	// All use literal IPs / bad schemes so no DNS resolution is needed.
	blocked := []string{
		"http://169.254.169.254/latest/meta-data/", // cloud metadata
		"http://127.0.0.1/admin",                   // loopback
		"http://10.0.0.5:6379/",                    // private (RFC1918)
		"http://192.168.1.1/",                      // private
		"http://[::1]:8080/",                       // IPv6 loopback
		"http://100.64.0.1/",                       // CGNAT
		"http://0.0.0.0/",                          // unspecified
		"ftp://8.8.8.8/x",                          // non-http scheme
		"http://user:pass@8.8.8.8/",                // embedded credentials
		"not a url",
		"",
	}
	for _, raw := range blocked {
		if _, err := validateWebhookURL(raw); err == nil {
			t.Errorf("expected %q to be rejected by the SSRF guard", raw)
		}
	}

	// A literal public IP is accepted (no DNS lookup required).
	if _, err := validateWebhookURL("https://8.8.8.8/hook"); err != nil {
		t.Errorf("public host should be accepted, got %v", err)
	}
}

func TestPrivateWebhookTargetsAllowed_BypassesGuard(t *testing.T) {
	t.Setenv("B2B_ALLOW_PRIVATE_WEBHOOK_TARGETS", "1")
	if _, err := validateWebhookURL("http://127.0.0.1:9000/hook"); err != nil {
		t.Errorf("loopback should be allowed when the test bypass is set, got %v", err)
	}
}
