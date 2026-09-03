package mfa

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Errors surfaced by the TOTP flow.
var (
	ErrTOTPNotConfigured = errors.New("totp: encryption key not configured")
	ErrTOTPAlreadyOn     = errors.New("totp: already enrolled and enabled")
	ErrTOTPNotEnrolled   = errors.New("totp: no pending or active enrollment")
	ErrTOTPBadCode       = errors.New("totp: invalid code")
)

const recoveryCodeCount = 10

// Brute-force lockout for TOTP / recovery-code verification: after this many
// consecutive failures, verification is locked for the window.
const (
	maxTOTPAttempts   = 5
	totpLockoutWindow = 15 * time.Minute
)

// TOTPEnabled reports whether the user has an active authenticator enrollment.
func (s *Service) TOTPEnabled(ctx context.Context, userID string) (bool, error) {
	var enabled bool
	err := s.db.QueryRow(ctx,
		`SELECT enabled FROM user_totp WHERE user_id = $1::uuid`, userID,
	).Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return enabled, nil
}

// EnrollTOTP creates (or replaces) a pending enrollment and returns the base32
// secret plus the otpauth:// provisioning URI for QR display. The enrollment is
// inactive until ConfirmTOTP succeeds. account is a user-facing label.
//
// Enrolling again opens a NEW cycle, so it clears the previous one's dates: the
// row describes the current enrollment and when it changed, not the account's
// whole history. That history lives in audit_logs (mfa_totp_enabled /
// mfa_totp_disabled), which is append-only and nothing here can rewrite.
func (s *Service) EnrollTOTP(ctx context.Context, userID, account string) (secretB32, otpauth string, err error) {
	if s.totpAEAD == nil {
		return "", "", ErrTOTPNotConfigured
	}
	enabled, err := s.TOTPEnabled(ctx, userID)
	if err != nil {
		return "", "", err
	}
	if enabled {
		return "", "", ErrTOTPAlreadyOn
	}
	secretB32, err = generateTOTPSecret()
	if err != nil {
		return "", "", err
	}
	enc, err := s.encryptSecret(secretB32)
	if err != nil {
		return "", "", err
	}
	_, err = s.db.Exec(ctx,
		`INSERT INTO user_totp (user_id, secret_enc, enabled, last_used_step, confirmed_at, updated_at)
		 VALUES ($1::uuid, $2, FALSE, 0, NULL, NOW())
		 ON CONFLICT (user_id) DO UPDATE
		   SET secret_enc = EXCLUDED.secret_enc,
		       enabled = FALSE, last_used_step = 0, confirmed_at = NULL,
		       disabled_at = NULL, updated_at = NOW()`,
		userID, enc,
	)
	if err != nil {
		return "", "", fmt.Errorf("store enrollment: %w", err)
	}
	if account == "" {
		account = userID
	}
	return secretB32, otpauthURL(secretB32, account), nil
}

// ConfirmTOTP verifies the first code against the pending secret, activates the
// enrollment, and issues a fresh set of single-use recovery codes (returned in
// plaintext exactly once).
func (s *Service) ConfirmTOTP(ctx context.Context, userID, code string) ([]string, error) {
	if s.totpAEAD == nil {
		return nil, ErrTOTPNotConfigured
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var enc []byte
	var enabled bool
	err = tx.QueryRow(ctx,
		`SELECT secret_enc, enabled FROM user_totp WHERE user_id = $1::uuid FOR UPDATE`,
		userID,
	).Scan(&enc, &enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrTOTPNotEnrolled
	}
	if err != nil {
		return nil, err
	}
	if enabled {
		return nil, ErrTOTPAlreadyOn
	}
	secret, err := s.decryptSecret(enc)
	if err != nil {
		return nil, err
	}
	step, ok := validateTOTP(secret, code, time.Now())
	if !ok {
		return nil, ErrTOTPBadCode
	}
	if _, err := tx.Exec(ctx,
		`UPDATE user_totp SET enabled = TRUE, confirmed_at = NOW(),
		        last_used_step = $2, updated_at = NOW()
		 WHERE user_id = $1::uuid`,
		userID, step,
	); err != nil {
		return nil, err
	}

	codes, err := s.replaceRecoveryCodes(ctx, tx, userID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	// La otra mitad del rastro: sin el evento de encendido no se puede saber
	// desde cuando la cuenta estuvo protegida, solo cuando dejo de estarlo.
	s.audita(userID, "mfa_totp_enabled", "medium")
	return codes, nil
}

// VerifyTOTP checks a TOTP (or recovery) code for an enabled enrollment. On
// success it records a verified mfa_challenges row for (user, purpose) so the
// existing HasVerifiedMFA gate accepts the factor uniformly. Replay is blocked
// via the monotonic last_used_step.
func (s *Service) VerifyTOTP(ctx context.Context, userID, purpose, code string) (bool, error) {
	if s.totpAEAD == nil {
		return false, ErrTOTPNotConfigured
	}
	if purpose == "" {
		purpose = "high_value_tx"
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var enc []byte
	var enabled bool
	var lastStep int64
	var failedAttempts int
	var lockedUntil *time.Time
	err = tx.QueryRow(ctx,
		`SELECT secret_enc, enabled, last_used_step, failed_attempts, locked_until
		 FROM user_totp WHERE user_id = $1::uuid FOR UPDATE`,
		userID,
	).Scan(&enc, &enabled, &lastStep, &failedAttempts, &lockedUntil)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrTOTPNotEnrolled
	}
	if err != nil {
		return false, err
	}
	if !enabled {
		return false, ErrTOTPNotEnrolled
	}
	// Locked out by repeated failures — reject without consuming an attempt.
	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		return false, tx.Commit(ctx)
	}

	secret, derr := s.decryptSecret(enc)
	if derr != nil {
		return false, derr
	}

	matched := false
	if step, ok := validateTOTP(secret, code, time.Now()); ok && step > lastStep {
		// Valid, non-replayed TOTP code (a replayed step <= lastStep stays
		// matched=false and counts as a failure below).
		if _, err := tx.Exec(ctx,
			`UPDATE user_totp SET last_used_step = $2, updated_at = NOW() WHERE user_id = $1::uuid`,
			userID, step,
		); err != nil {
			return false, err
		}
		matched = true
	} else if !ok {
		// Not a TOTP code — fall back to a single-use recovery code.
		used, rerr := s.consumeRecoveryCode(ctx, tx, userID, code)
		if rerr != nil {
			return false, rerr
		}
		matched = used
	}

	if matched {
		if _, err := tx.Exec(ctx,
			`UPDATE user_totp SET failed_attempts = 0, locked_until = NULL, updated_at = NOW()
			 WHERE user_id = $1::uuid`, userID,
		); err != nil {
			return false, err
		}
		if err := s.markChallengeVerified(ctx, tx, userID, purpose); err != nil {
			return false, err
		}
		return true, tx.Commit(ctx)
	}

	// Failure: count it; lock verification after too many consecutive failures.
	if newFailed := failedAttempts + 1; newFailed >= maxTOTPAttempts {
		if _, err := tx.Exec(ctx,
			`UPDATE user_totp SET failed_attempts = 0,
			        locked_until = NOW() + make_interval(secs => $2),
			        updated_at = NOW() WHERE user_id = $1::uuid`,
			userID, totpLockoutWindow.Seconds(),
		); err != nil {
			return false, err
		}
	} else if _, err := tx.Exec(ctx,
		`UPDATE user_totp SET failed_attempts = $2, updated_at = NOW() WHERE user_id = $1::uuid`,
		userID, newFailed,
	); err != nil {
		return false, err
	}
	return false, tx.Commit(ctx)
}

// DisableTOTP turns off authenticator MFA after re-verifying a current code
// (TOTP or recovery).
//
// It MARKS the enrollment instead of deleting it. Turning the second factor off
// weakens a control on the account, and the row is the only place that records
// that the account ever had one, from when to when — precisely what has to be
// reconstructible after an account takeover. Same shape as
// user_sessions.revoked_at: the row stays, a timestamp says it is over.
//
// What does NOT stay is the credential: the secret is overwritten and the live
// recovery codes are invalidated, so nothing that could still authenticate
// survives the disable. VerifyTOTP refuses on `enabled` before it ever reads
// the secret, so the emptied blob is never decrypted.
//
// Both writes go in one transaction: a half-disabled second factor (secret gone
// but codes alive, or the reverse) is worse than either end state.
func (s *Service) DisableTOTP(ctx context.Context, userID, code string) error {
	if s.totpAEAD == nil {
		return ErrTOTPNotConfigured
	}
	enabled, err := s.TOTPEnabled(ctx, userID)
	if err != nil {
		return err
	}
	if !enabled {
		return ErrTOTPNotEnrolled
	}
	ok, err := s.VerifyTOTP(ctx, userID, "totp_disable", code)
	if err != nil {
		return err
	}
	if !ok {
		return ErrTOTPBadCode
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	if _, err := tx.Exec(ctx,
		`UPDATE user_totp
		    SET enabled = FALSE, secret_enc = ''::bytea, last_used_step = 0,
		        disabled_at = NOW(), updated_at = NOW()
		  WHERE user_id = $1::uuid`, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE totp_recovery_codes SET invalidated_at = NOW()
		  WHERE user_id = $1::uuid AND used_at IS NULL AND invalidated_at IS NULL`,
		userID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.audita(userID, "mfa_totp_disabled", "high")
	return nil
}

// markChallengeVerified writes a pre-verified challenge so HasVerifiedMFA picks
// up the TOTP factor for the (user, purpose) tuple within the verify window.
func (s *Service) markChallengeVerified(ctx context.Context, tx pgx.Tx, userID, purpose string) error {
	id := uuid.New().String()
	// Synthetic non-recoverable hash — this row is already verified.
	marker := sha256.Sum256([]byte(id + ":totp"))
	_, err := tx.Exec(ctx,
		`INSERT INTO mfa_challenges (id, user_id, purpose, code_hash, metadata, verified_at, expires_at)
		 VALUES ($1::uuid, $2::uuid, $3, $4, '{"factor":"totp"}'::jsonb, NOW(), NOW() + interval '5 minutes')`,
		id, userID, purpose, hex.EncodeToString(marker[:]),
	)
	return err
}

// replaceRecoveryCodes retires any live codes and issues a fresh batch,
// returning the plaintext codes (shown to the user once).
//
// The old batch is invalidated, not deleted: a code that stops working without
// anyone using it is part of the account's history, and invalidated_at keeps it
// apart from used_at, which means someone actually spent it.
func (s *Service) replaceRecoveryCodes(ctx context.Context, tx pgx.Tx, userID string) ([]string, error) {
	if _, err := tx.Exec(ctx,
		`UPDATE totp_recovery_codes SET invalidated_at = NOW()
		  WHERE user_id = $1::uuid AND used_at IS NULL AND invalidated_at IS NULL`,
		userID); err != nil {
		return nil, err
	}
	codes := make([]string, 0, recoveryCodeCount)
	for i := 0; i < recoveryCodeCount; i++ {
		c, err := randomRecoveryCode()
		if err != nil {
			return nil, err
		}
		h := sha256.Sum256([]byte(normalizeRecovery(c)))
		if _, err := tx.Exec(ctx,
			`INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES ($1::uuid, $2)`,
			userID, hex.EncodeToString(h[:]),
		); err != nil {
			return nil, err
		}
		codes = append(codes, c)
	}
	return codes, nil
}

// consumeRecoveryCode atomically marks a matching live code as used. A code
// that was invalidated (the batch was replaced, or MFA was turned off) is no
// longer live even though it was never used.
func (s *Service) consumeRecoveryCode(ctx context.Context, tx pgx.Tx, userID, code string) (bool, error) {
	h := sha256.Sum256([]byte(normalizeRecovery(code)))
	ct, err := tx.Exec(ctx,
		`UPDATE totp_recovery_codes SET used_at = NOW()
		 WHERE user_id = $1::uuid AND code_hash = $2
		   AND used_at IS NULL AND invalidated_at IS NULL`,
		userID, hex.EncodeToString(h[:]),
	)
	if err != nil {
		return false, err
	}
	return ct.RowsAffected() == 1, nil
}

// --- secret encryption (AES-256-GCM) -------------------------------------

func (s *Service) encryptSecret(plain string) ([]byte, error) {
	nonce := make([]byte, s.totpAEAD.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return s.totpAEAD.Seal(nonce, nonce, []byte(plain), nil), nil
}

func (s *Service) decryptSecret(blob []byte) (string, error) {
	ns := s.totpAEAD.NonceSize()
	if len(blob) < ns {
		return "", errors.New("totp: ciphertext too short")
	}
	nonce, ct := blob[:ns], blob[ns:]
	plain, err := s.totpAEAD.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", fmt.Errorf("totp: decrypt secret: %w", err)
	}
	return string(plain), nil
}

// --- recovery code formatting --------------------------------------------

const recoveryAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no ambiguous 0/O/1/I

// randomRecoveryCode returns a human-friendly "XXXX-XXXX" code.
func randomRecoveryCode() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, 0, 9)
	for i, v := range b {
		if i == 4 {
			out = append(out, '-')
		}
		out = append(out, recoveryAlphabet[int(v)%len(recoveryAlphabet)])
	}
	return string(out), nil
}

func normalizeRecovery(code string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(code), "-", ""))
}
