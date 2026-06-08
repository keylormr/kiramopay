package sinpe

import "testing"

func TestValidCRMobile(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"88885678", true},      // 8-digit mobile starting with 8
		{"+50688885678", true},  // +506 prefix
		{"50688885678", true},   // 506 prefix, no +
		{"6123 4567", true},     // spaces ignored, starts with 6
		{"71234567", true},      // starts with 7
		{"21234567", false},     // landline prefix (2) not allowed
		{"1234567", false},      // 7 digits
		{"881234567", false},    // 9 digits
		{"", false},             // empty
		{"abcd1234", false},     // too few digits after stripping
		{"+50621234567", false}, // valid length but landline prefix
	}
	for _, c := range cases {
		if got := validCRMobile(c.in); got != c.want {
			t.Errorf("validCRMobile(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}
