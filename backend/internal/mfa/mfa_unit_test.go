package mfa

import (
	"testing"
	"time"
)

func TestIsMFARequired(t *testing.T) {
	s := NewService(nil, &Config{
		ThresholdCRCMinor: 10_000_000,
		ThresholdUSDMinor: 20_000,
		VerifyWindow:      5 * time.Minute,
	})
	cases := []struct {
		amount   int64
		currency string
		want     bool
	}{
		{9_999_999, "CRC", false},
		{10_000_000, "CRC", true},
		{20_000_001, "CRC", true},
		{19_999, "USD", false},
		{20_000, "USD", true},
		{1, "GTQ", false},        // falls back to CRC threshold
		{99_999_999, "GTQ", true}, // way over CRC threshold
	}
	for _, tc := range cases {
		if got := s.IsMFARequired(tc.amount, tc.currency); got != tc.want {
			t.Errorf("IsMFARequired(%d, %s) = %v, want %v",
				tc.amount, tc.currency, got, tc.want)
		}
	}
}

func TestRandomSixDigit(t *testing.T) {
	for i := 0; i < 20; i++ {
		c, err := randomSixDigit()
		if err != nil {
			t.Fatalf("rand: %v", err)
		}
		if len(c) != 6 {
			t.Errorf("length not 6: %q", c)
		}
		for _, r := range c {
			if r < '0' || r > '9' {
				t.Errorf("non-digit in %q", c)
			}
		}
	}
}
