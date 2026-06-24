package mfa

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/testutil"
)

// TestHasVerifiedMFA_SingleUse verifies the high-value money gate against a real
// Postgres: a verified challenge authorizes exactly ONE high-value action
// (consumed atomically), respects the verify window, and is siloed by purpose.
func TestHasVerifiedMFA_SingleUse(t *testing.T) {
	pool := testutil.TestDB(t)
	userID := testutil.SeedTestUser(t, pool, "702650930", "x")
	svc := NewService(pool, &Config{VerifyWindow: 5 * time.Minute})
	ctx := context.Background()

	insertVerified := func(purpose string, age time.Duration) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO mfa_challenges (id, user_id, purpose, code_hash, verified_at, expires_at)
			 VALUES ($1::uuid, $2::uuid, $3, 'x',
			         NOW() - make_interval(secs => $4::double precision),
			         NOW() + interval '5 minutes')`,
			uuid.New().String(), userID, purpose, age.Seconds()); err != nil {
			t.Fatalf("insert verified challenge: %v", err)
		}
	}

	// One verification → first check consumes it (true), second is false.
	insertVerified("high_value_tx", 0)
	if ok, err := svc.HasVerifiedMFA(ctx, userID, "high_value_tx"); err != nil || !ok {
		t.Fatalf("first HasVerifiedMFA = (%v,%v), want (true,nil)", ok, err)
	}
	if ok, err := svc.HasVerifiedMFA(ctx, userID, "high_value_tx"); err != nil || ok {
		t.Fatalf("second HasVerifiedMFA = (%v,%v), want (false,nil) — verification must be single-use", ok, err)
	}

	// An out-of-window verification is rejected.
	insertVerified("high_value_tx", 10*time.Minute)
	if ok, err := svc.HasVerifiedMFA(ctx, userID, "high_value_tx"); err != nil || ok {
		t.Fatalf("stale HasVerifiedMFA = (%v,%v), want (false,nil)", ok, err)
	}

	// A verification for another purpose does not satisfy the money gate.
	insertVerified("totp_disable", 0)
	if ok, err := svc.HasVerifiedMFA(ctx, userID, "high_value_tx"); err != nil || ok {
		t.Fatalf("cross-purpose HasVerifiedMFA = (%v,%v), want (false,nil)", ok, err)
	}
}
