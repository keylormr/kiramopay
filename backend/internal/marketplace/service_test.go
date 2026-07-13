package marketplace

import "testing"

func TestParseEtaMinutes(t *testing.T) {
	cases := map[string]int{
		"30 min":    30,
		"25-35 min": 25, // leading integer only
		"":          30, // fallback
		"soon":      30, // no digits -> fallback
		"0 min":     30, // n<1 -> clamped to fallback
		"5 minutos": 5,
		"120 min":   120,
	}
	for in, want := range cases {
		if got := parseEtaMinutes(in); got != want {
			t.Errorf("parseEtaMinutes(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestDeriveFoodStatus(t *testing.T) {
	// 30 min ETA = 1800s: ready at 0.40 (720s), on_the_way at 0.75 (1350s),
	// delivered at 1.00 (1800s).
	cases := []struct {
		elapsed int64
		want    string
	}{
		{0, "preparing"},
		{700, "preparing"},
		{720, "ready"},
		{1000, "ready"},
		{1350, "on_the_way"},
		{1700, "on_the_way"},
		{1800, "delivered"},
		{5000, "delivered"},
	}
	for _, c := range cases {
		o := &FoodOrderRecord{Status: "preparing", EstimatedDelivery: "30 min", ElapsedSeconds: c.elapsed}
		if got := deriveFoodStatus(o); got != c.want {
			t.Errorf("elapsed=%ds: got %s, want %s", c.elapsed, got, c.want)
		}
	}

	// Persisted terminal states are returned verbatim, never resurrected.
	if got := deriveFoodStatus(&FoodOrderRecord{Status: "cancelled", EstimatedDelivery: "30 min", ElapsedSeconds: 99999}); got != "cancelled" {
		t.Errorf("cancelled resurrected to %s", got)
	}
	if got := deriveFoodStatus(&FoodOrderRecord{Status: "delivered", EstimatedDelivery: "30 min", ElapsedSeconds: 0}); got != "delivered" {
		t.Errorf("delivered changed to %s", got)
	}
}

func TestApplyLiveStatusMinutesRemaining(t *testing.T) {
	o := &FoodOrderRecord{Status: "preparing", EstimatedDelivery: "30 min", ElapsedSeconds: 600} // 10 min in
	applyLiveStatus(o)
	if o.Status != "preparing" {
		t.Fatalf("status = %s, want preparing", o.Status)
	}
	if o.MinutesRemaining != 20 {
		t.Fatalf("minutes remaining = %d, want 20", o.MinutesRemaining)
	}

	// Delivered clamps remaining to 0.
	d := &FoodOrderRecord{Status: "preparing", EstimatedDelivery: "30 min", ElapsedSeconds: 3600}
	applyLiveStatus(d)
	if d.Status != "delivered" || d.MinutesRemaining != 0 {
		t.Fatalf("delivered: status=%s remaining=%d", d.Status, d.MinutesRemaining)
	}
}

func TestDeriveCourierDeterministic(t *testing.T) {
	id := "order-abc-123"
	first := deriveCourier(id)
	for i := 0; i < 50; i++ {
		if deriveCourier(id) != first {
			t.Fatal("deriveCourier is not deterministic for a fixed id")
		}
	}
	if first.Name == "" || first.Plate == "" {
		t.Fatalf("courier not populated: %+v", first)
	}
}

func TestDeriveRideStatus(t *testing.T) {
	// 20 min ETA = 1200s: in_progress at 0.15 (180s), completed at 1.00 (1200s).
	cases := []struct {
		status  string
		elapsed int64
		want    string
	}{
		{"confirmed", 0, "arriving"},
		{"confirmed", 100, "arriving"},
		{"confirmed", 180, "in_progress"},
		{"confirmed", 600, "in_progress"},
		{"confirmed", 1200, "completed"},
		{"in_progress", 5000, "completed"},
	}
	for _, c := range cases {
		r := &RideRequestRecord{Status: c.status, EstimatedTime: "20 min", ElapsedSeconds: c.elapsed}
		if got := deriveRideStatus(r); got != c.want {
			t.Errorf("status=%s elapsed=%ds: got %s, want %s", c.status, c.elapsed, got, c.want)
		}
	}

	// searching (unconfirmed) never progresses; terminal states are verbatim.
	if got := deriveRideStatus(&RideRequestRecord{Status: "searching", EstimatedTime: "20 min", ElapsedSeconds: 99999}); got != "searching" {
		t.Errorf("searching progressed to %s", got)
	}
	if got := deriveRideStatus(&RideRequestRecord{Status: "cancelled", EstimatedTime: "20 min", ElapsedSeconds: 99999}); got != "cancelled" {
		t.Errorf("cancelled changed to %s", got)
	}
	if got := deriveRideStatus(&RideRequestRecord{Status: "completed", EstimatedTime: "20 min", ElapsedSeconds: 0}); got != "completed" {
		t.Errorf("completed changed to %s", got)
	}
}

func TestApplyLiveRideStatusMinutesRemaining(t *testing.T) {
	r := &RideRequestRecord{Status: "confirmed", EstimatedTime: "20 min", ElapsedSeconds: 300} // 5 min in
	applyLiveRideStatus(r)
	if r.Status != "in_progress" {
		t.Fatalf("status = %s, want in_progress", r.Status)
	}
	if r.MinutesRemaining != 15 {
		t.Fatalf("minutes remaining = %d, want 15", r.MinutesRemaining)
	}

	// An unconfirmed ride does not progress and exposes no countdown.
	s := &RideRequestRecord{Status: "searching", EstimatedTime: "20 min", ElapsedSeconds: 300}
	applyLiveRideStatus(s)
	if s.Status != "searching" || s.MinutesRemaining != 0 {
		t.Fatalf("searching: status=%s remaining=%d", s.Status, s.MinutesRemaining)
	}
}

func TestCourierForVisibility(t *testing.T) {
	s := &Service{}
	for _, st := range []string{"preparing", "ready"} {
		if s.CourierFor("order-x", st) != nil {
			t.Errorf("courier should be hidden while %s", st)
		}
	}
	for _, st := range []string{"on_the_way", "delivered"} {
		if s.CourierFor("order-x", st) == nil {
			t.Errorf("courier should be visible while %s", st)
		}
	}
}
