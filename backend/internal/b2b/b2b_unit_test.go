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
