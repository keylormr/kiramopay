// Package mfa enforces multi-factor challenges for high-risk operations.
// The frontend issues a code via biometric/OTP path, the backend verifies
// the code's hash against an active mfa_challenges row. The transaction
// service consults Service.HasVerifiedMFA before posting movements above
// the threshold.
package mfa

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the MFA orchestrator: issue + verify challenges, enforce
// thresholds.
type Service struct {
	db            *pgxpool.Pool
	thresholdCRC  int64
	thresholdUSD  int64
	verifyWindow  time.Duration
}

// Config knobs.
type Config struct {
	ThresholdCRCMinor int64         // default 10,000,000 centimos (100,000 CRC)
	ThresholdUSDMinor int64         // default 20,000 cents (200 USD)
	VerifyWindow      time.Duration // how long a verified challenge stays valid
}

func NewService(db *pgxpool.Pool, cfg *Config) *Service {
	if cfg == nil {
		cfg = &Config{}
	}
	if cfg.ThresholdCRCMinor <= 0 {
		cfg.ThresholdCRCMinor = 10_000_000
	}
	if cfg.ThresholdUSDMinor <= 0 {
		cfg.ThresholdUSDMinor = 20_000
	}
	if cfg.VerifyWindow <= 0 {
		cfg.VerifyWindow = 5 * time.Minute
	}
	return &Service{
		db:           db,
		thresholdCRC: cfg.ThresholdCRCMinor,
		thresholdUSD: cfg.ThresholdUSDMinor,
		verifyWindow: cfg.VerifyWindow,
	}
}

// IsMFARequired implements transaction.MFAEnforcer.
func (s *Service) IsMFARequired(amountMinor int64, currency string) bool {
	switch currency {
	case "CRC":
		return amountMinor >= s.thresholdCRC
	case "USD":
		return amountMinor >= s.thresholdUSD
	default:
		return amountMinor >= s.thresholdCRC
	}
}

// HasVerifiedMFA returns true if there is a recently-verified challenge for
// the (user, purpose) tuple still within the verify window.
func (s *Service) HasVerifiedMFA(ctx context.Context, userID, purpose string) (bool, error) {
	var verifiedAt *time.Time
	err := s.db.QueryRow(ctx,
		`SELECT verified_at FROM mfa_challenges
		 WHERE user_id = $1::uuid
		   AND purpose = $2
		   AND verified_at IS NOT NULL
		 ORDER BY verified_at DESC
		 LIMIT 1`,
		userID, purpose,
	).Scan(&verifiedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if verifiedAt == nil {
		return false, nil
	}
	return time.Since(*verifiedAt) <= s.verifyWindow, nil
}

// IssueChallenge generates a 6-digit code and stores the hash. The plaintext
// code is returned ONCE to the caller, which must deliver it OOB
// (push notification / biometric assertion / SMS). Code lives for 5 minutes.
func (s *Service) IssueChallenge(ctx context.Context, userID, purpose string, metadata string) (string, error) {
	code, err := randomSixDigit()
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256([]byte(code))
	id := uuid.New().String()
	if metadata == "" {
		metadata = "{}"
	}
	_, err = s.db.Exec(ctx,
		`INSERT INTO mfa_challenges (id, user_id, purpose, code_hash, metadata, expires_at)
		 VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6)`,
		id, userID, purpose, hex.EncodeToString(hash[:]), metadata, time.Now().Add(5*time.Minute),
	)
	if err != nil {
		return "", fmt.Errorf("insert challenge: %w", err)
	}
	return code, nil
}

// VerifyChallenge checks the supplied code for an active challenge.
func (s *Service) VerifyChallenge(ctx context.Context, userID, purpose, code string) (bool, error) {
	hash := sha256.Sum256([]byte(code))
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var (
		id           string
		storedHash   string
		attempts     int
		maxAttempts  int
	)
	err = tx.QueryRow(ctx,
		`SELECT id::text, code_hash, attempts, max_attempts
		 FROM mfa_challenges
		 WHERE user_id = $1::uuid AND purpose = $2
		   AND verified_at IS NULL AND expires_at > NOW()
		 ORDER BY created_at DESC
		 LIMIT 1
		 FOR UPDATE`,
		userID, purpose,
	).Scan(&id, &storedHash, &attempts, &maxAttempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	supplied := hex.EncodeToString(hash[:])
	if storedHash == supplied {
		_, err = tx.Exec(ctx,
			`UPDATE mfa_challenges SET verified_at = NOW() WHERE id = $1::uuid`, id)
		if err != nil {
			return false, err
		}
		return true, tx.Commit(ctx)
	}
	newAttempts := attempts + 1
	if newAttempts >= maxAttempts {
		_, _ = tx.Exec(ctx,
			`UPDATE mfa_challenges SET attempts = $2, expires_at = NOW() WHERE id = $1::uuid`,
			id, newAttempts)
	} else {
		_, _ = tx.Exec(ctx,
			`UPDATE mfa_challenges SET attempts = $2 WHERE id = $1::uuid`, id, newAttempts)
	}
	return false, tx.Commit(ctx)
}

func randomSixDigit() (string, error) {
	b := make([]byte, 3)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	// Map 3 bytes (24 bits) into 0..999999 by taking modulo. Slight bias
	// (negligible for 6 digits) — fine for OTP not security key material.
	n := uint32(b[0])<<16 | uint32(b[1])<<8 | uint32(b[2])
	return fmt.Sprintf("%06d", n%1_000_000), nil
}

// Pkg-level helper to base64-encode arbitrary bytes if a non-numeric code is
// preferred in the future.
func base64URL(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
