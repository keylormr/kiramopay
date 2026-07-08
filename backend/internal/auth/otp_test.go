package auth

import "testing"

func TestGenerateNumericOTP(t *testing.T) {
	code, err := generateNumericOTP(6)
	if err != nil {
		t.Fatalf("generateNumericOTP: %v", err)
	}
	if len(code) != 6 {
		t.Fatalf("want 6 digits, got %d (%q)", len(code), code)
	}
	for _, c := range code {
		if c < '0' || c > '9' {
			t.Fatalf("non-digit in code %q", code)
		}
	}
	// Sanity that the generator is not returning a constant. Two independent
	// draws colliding is ~1e-6; retry once to keep this from being flaky.
	if other, _ := generateNumericOTP(6); code == other {
		if again, _ := generateNumericOTP(6); code == again {
			t.Errorf("codes look constant: %q", code)
		}
	}
}

func TestHashOTP(t *testing.T) {
	first, second := hashOTP("123456"), hashOTP("123456")
	if first != second {
		t.Error("hashOTP is not stable for the same code")
	}
	if hashOTP("123456") == hashOTP("654321") {
		t.Error("different codes produced the same hash")
	}
	if got := len(hashOTP("123456")); got != 64 { // sha256 hex
		t.Errorf("unexpected hash length %d, want 64", got)
	}
}
