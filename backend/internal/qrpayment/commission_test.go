package qrpayment

import "testing"

func TestCommissionFee(t *testing.T) {
	cases := []struct {
		name   string
		amount int64
		bps    int
		want   int64
	}{
		{"half percent on 100 colones", 10000, 50, 50},   // 0.50% of ₡100.00 = ₡0.50
		{"half percent on 1000 colones", 100000, 50, 500}, // ₡1000.00 -> ₡5.00
		{"floors sub-centimo to zero", 199, 50, 0},        // 199*50/10000 = 0.995 -> 0
		{"exactly one centimo", 200, 50, 1},               // 200*50/10000 = 1
		{"floors, not rounds", 12345, 50, 61},             // 12345*50/10000 = 61.725 -> 61
		{"one percent", 100000, 100, 1000},
		{"zero bps", 100000, 0, 0},
		{"zero amount", 0, 50, 0},
		{"negative amount", -100, 50, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := commissionFee(c.amount, c.bps); got != c.want {
				t.Fatalf("commissionFee(%d, %d) = %d, want %d", c.amount, c.bps, got, c.want)
			}
		})
	}
}
