package auth

import (
	"testing"
	"time"
)

func TestSessionWindowExceeded(t *testing.T) {
	now := time.Now()
	const idle = 30 * time.Minute
	const absolute = 7 * 24 * time.Hour

	cases := []struct {
		name   string
		issued time.Time // when the presented refresh token was issued (last activity)
		origin time.Time // when the family/login started
		want   bool
	}{
		{"fresh session", now.Add(-1 * time.Minute), now.Add(-1 * time.Minute), false},
		{"active within both windows", now.Add(-10 * time.Minute), now.Add(-3 * 24 * time.Hour), false},
		{"idle window exceeded", now.Add(-31 * time.Minute), now.Add(-31 * time.Minute), true},
		{"absolute window exceeded", now.Add(-1 * time.Minute), now.Add(-8 * 24 * time.Hour), true},
		{"idle ok but absolute exceeded", now.Add(-5 * time.Minute), now.Add(-7*24*time.Hour - time.Hour), true},
	}
	for _, c := range cases {
		if got := sessionWindowExceeded(now, c.issued, c.origin, idle, absolute); got != c.want {
			t.Errorf("%s: sessionWindowExceeded = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestSessionWindowDisabledWhenZero(t *testing.T) {
	now := time.Now()
	// Non-positive windows disable the respective checks.
	if sessionWindowExceeded(now, now.Add(-100*time.Hour), now.Add(-100*time.Hour), 0, 0) {
		t.Error("zero idle+absolute should disable both checks")
	}
	if sessionWindowExceeded(now, now.Add(-100*time.Hour), now, 0, 7*24*time.Hour) {
		t.Error("zero idle should disable the idle check")
	}
}
