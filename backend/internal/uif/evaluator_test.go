package uif

import "testing"

func TestThresholds_Evaluate(t *testing.T) {
	th := DefaultThresholds() // USD single/daily = 1_000_000 cents

	cases := []struct {
		name       string
		currency   string
		amount     int64
		priorDaily int64
		wantReport bool
		wantType   string
	}{
		{"single at threshold", "USD", 1_000_000, 0, true, TypeSingleThreshold},
		{"single above threshold", "USD", 1_500_000, 0, true, TypeSingleThreshold},
		{"single below threshold", "USD", 999_999, 0, false, ""},
		{"structuring crosses with this tx", "USD", 400_000, 700_000, true, TypeStructuring},
		{"structuring exactly crosses", "USD", 1, 999_999, true, TypeStructuring},
		{"below even with prior", "USD", 100_000, 200_000, false, ""},
		{"already above daily — no duplicate", "USD", 100_000, 1_000_000, false, ""},
		{"unknown currency — not reportable", "EUR", 9_999_999, 0, false, ""},
		{"single takes precedence over structuring", "USD", 1_200_000, 900_000, true, TypeSingleThreshold},
		{"CRC single threshold", "CRC", 550_000_000, 0, true, TypeSingleThreshold},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := th.Evaluate(c.currency, c.amount, c.priorDaily)
			if got.Reportable != c.wantReport {
				t.Fatalf("Reportable = %v, want %v (reason: %q)", got.Reportable, c.wantReport, got.Reason)
			}
			if c.wantReport && got.Type != c.wantType {
				t.Fatalf("Type = %q, want %q", got.Type, c.wantType)
			}
			if c.wantReport && got.Reason == "" {
				t.Fatal("reportable result must carry a reason")
			}
		})
	}
}
