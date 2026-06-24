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

// TestVerifyTOTP_Lockout verifies that repeated wrong codes lock out TOTP
// verification (brute-force protection), and that a valid code is rejected
// while locked.
func TestVerifyTOTP_Lockout(t *testing.T) {
	pool := testutil.TestDB(t)
	userID := testutil.SeedTestUser(t, pool, "702650930", "x")
	svc := NewService(pool, &Config{TOTPEncryptionKey: []byte("test-totp-key")})
	ctx := context.Background()

	secret, err := generateTOTPSecret()
	if err != nil {
		t.Fatalf("generate secret: %v", err)
	}
	enc, err := svc.encryptSecret(secret)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO user_totp (user_id, secret_enc, enabled, last_used_step, failed_attempts)
		 VALUES ($1::uuid, $2, TRUE, 0, 0)`, userID, enc); err != nil {
		t.Fatalf("insert totp: %v", err)
	}

	decoded, _ := decodeTOTPSecret(secret)
	valid := hotp(decoded, uint64(time.Now().Unix()/30))
	wrong := []byte(valid)
	if wrong[0] == '0' {
		wrong[0] = '1'
	} else {
		wrong[0] = '0'
	}
	if _, ok := validateTOTP(secret, string(wrong), time.Now()); ok {
		t.Skip("rare: flipped code is itself valid; rerun")
	}

	// maxTOTPAttempts consecutive failures lock the account.
	for i := 0; i < maxTOTPAttempts; i++ {
		if ok, err := svc.VerifyTOTP(ctx, userID, "high_value_tx", string(wrong)); err != nil || ok {
			t.Fatalf("wrong attempt %d: ok=%v err=%v, want (false,nil)", i, ok, err)
		}
	}
	var lockedUntil *time.Time
	if err := pool.QueryRow(ctx,
		`SELECT locked_until FROM user_totp WHERE user_id=$1::uuid`, userID).Scan(&lockedUntil); err != nil {
		t.Fatalf("read lock: %v", err)
	}
	if lockedUntil == nil || !lockedUntil.After(time.Now()) {
		t.Fatalf("expected lockout after %d failures, locked_until=%v", maxTOTPAttempts, lockedUntil)
	}

	// Even the correct code is rejected while locked out.
	if ok, _ := svc.VerifyTOTP(ctx, userID, "high_value_tx", valid); ok {
		t.Error("valid code accepted while locked out")
	}
}
