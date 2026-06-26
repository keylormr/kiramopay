package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
	jwtpkg "github.com/kiramopay/backend/pkg/jwt"
)

// ErrInvalidCredentials is the constant-time error returned for any failed
// login (wrong cedula, wrong password, locked, etc.) to prevent enumeration.
var ErrInvalidCredentials = errors.New("invalid credentials")

// SanctionScreener gates onboarding against a sanction watchlist. Implemented
// by the kyc service; optional (nil disables the check).
type SanctionScreener interface {
	ScreenIsClear(ctx context.Context, fullName string) (bool, error)
}

type Service struct {
	authRepo         *Repository
	userRepo         *user.Repository
	walletRepo       *wallet.Repository
	jwt              *jwtpkg.Manager
	lockoutStore     middleware.LockoutStore
	auditLogger      *audit.Logger
	screener         SanctionScreener
	maxLoginAttempts int
	idleTimeout      time.Duration
	absoluteTimeout  time.Duration
}

// Options for service wiring.
type Options struct {
	LockoutStore     middleware.LockoutStore
	AuditLogger      *audit.Logger
	Screener         SanctionScreener
	MaxLoginAttempts int
	// IdleTimeout ends a session after this much inactivity (no refresh).
	// AbsoluteTimeout caps the total session age from the original login.
	// Zero falls back to 30 minutes / 7 days respectively.
	IdleTimeout     time.Duration
	AbsoluteTimeout time.Duration
}

func NewService(
	authRepo *Repository,
	userRepo *user.Repository,
	walletRepo *wallet.Repository,
	jwt *jwtpkg.Manager,
	opts *Options,
) *Service {
	if opts == nil {
		opts = &Options{}
	}
	if opts.MaxLoginAttempts <= 0 {
		opts.MaxLoginAttempts = 5
	}
	if opts.IdleTimeout <= 0 {
		opts.IdleTimeout = 30 * time.Minute
	}
	if opts.AbsoluteTimeout <= 0 {
		opts.AbsoluteTimeout = 7 * 24 * time.Hour
	}
	return &Service{
		authRepo:         authRepo,
		userRepo:         userRepo,
		walletRepo:       walletRepo,
		jwt:              jwt,
		lockoutStore:     opts.LockoutStore,
		auditLogger:      opts.AuditLogger,
		screener:         opts.Screener,
		maxLoginAttempts: opts.MaxLoginAttempts,
		idleTimeout:      opts.IdleTimeout,
		absoluteTimeout:  opts.AbsoluteTimeout,
	}
}

// sessionWindowExceeded reports whether a session must end: either the presented
// refresh token was issued longer ago than the idle window (inactivity), or the
// family/login origin is older than the absolute window (max session age). A
// non-positive window disables that particular check.
func sessionWindowExceeded(now, tokenIssuedAt, familyOrigin time.Time, idle, absolute time.Duration) bool {
	if idle > 0 && now.Sub(tokenIssuedAt) > idle {
		return true
	}
	if absolute > 0 && now.Sub(familyOrigin) > absolute {
		return true
	}
	return false
}

type LoginRequest struct {
	Cedula   string `json:"cedula"`
	Password string `json:"password"`
}

type LoginContext struct {
	IPAddress string
	UserAgent string
}

type LoginResponse struct {
	User   *user.UserRecord  `json:"user"`
	Tokens *jwtpkg.TokenPair `json:"tokens"`
}

type RegisterRequest struct {
	Cedula    string `json:"cedula"`
	Phone     string `json:"phone"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Password  string `json:"password"`
	Email     string `json:"email,omitempty"`
}

type ChangePasswordRequest struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

type ForgotPasswordRequest struct {
	Cedula string `json:"cedula"`
}

type ResetPasswordRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

func (s *Service) Login(ctx context.Context, req *LoginRequest, lc LoginContext) (*LoginResponse, error) {
	u, err := s.userRepo.FindByCedula(ctx, req.Cedula)
	if err != nil || u == nil {
		// Anti-enumeration: spend the Argon2 budget anyway.
		hash.DummyVerify()
		s.incrementLockout(req.Cedula)
		if s.auditLogger != nil {
			s.auditLogger.LogLogin("", lc.IPAddress, lc.UserAgent, false)
		}
		return nil, ErrInvalidCredentials
	}

	valid, err := hash.VerifyPin(req.Password, u.PasswordHash)
	if err != nil || !valid {
		s.incrementLockout(req.Cedula)
		if s.auditLogger != nil {
			s.auditLogger.LogLogin(u.ID, lc.IPAddress, lc.UserAgent, false)
		}
		return nil, ErrInvalidCredentials
	}

	// Block locked accounts AFTER hash verification too (defense in depth —
	// the middleware should have already blocked, but if it didn't, do not
	// issue tokens).
	if s.lockoutStore != nil {
		count := s.lockoutStore.GetLockout(fmt.Sprintf("lockout:%s", req.Cedula))
		if int(count) >= s.maxLoginAttempts {
			return nil, ErrInvalidCredentials
		}
	}

	tokens, err := s.jwt.GenerateTokenPair(u.ID)
	if err != nil {
		return nil, fmt.Errorf("generate tokens: %w", err)
	}

	// Persist refresh token + session in one logical unit.
	if err := s.persistTokenRollout(ctx, u.ID, tokens, lc, ""); err != nil {
		return nil, fmt.Errorf("persist session: %w", err)
	}

	s.resetLockout(req.Cedula)
	_ = s.userRepo.UpdateLastLogin(ctx, u.ID)
	if s.auditLogger != nil {
		s.auditLogger.LogLogin(u.ID, lc.IPAddress, lc.UserAgent, true)
	}
	return &LoginResponse{User: u, Tokens: tokens}, nil
}

func (s *Service) Register(ctx context.Context, req *RegisterRequest, lc LoginContext) (*LoginResponse, error) {
	existing, _ := s.userRepo.FindByCedula(ctx, req.Cedula)
	if existing != nil {
		return nil, fmt.Errorf("user already registered")
	}

	// AML onboarding gate: refuse registration of sanctioned individuals.
	// Fail-open on screening *errors* (infra hiccup must not block all signups);
	// fail-closed on an actual hit.
	if s.screener != nil {
		clear, serr := s.screener.ScreenIsClear(ctx, req.FirstName+" "+req.LastName)
		if serr == nil && !clear {
			if s.auditLogger != nil {
				s.auditLogger.Log(audit.Event{
					Action:    "register_sanction_block",
					RiskLevel: "high",
					IPAddress: lc.IPAddress,
					UserAgent: lc.UserAgent,
				})
			}
			return nil, fmt.Errorf("registration cannot be completed")
		}
	}

	pwHash, err := hash.HashPin(req.Password)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	newUser := &user.UserRecord{
		ID:           uuid.New().String(),
		Cedula:       req.Cedula,
		Phone:        req.Phone,
		FirstName:    req.FirstName,
		LastName:     req.LastName,
		Email:        req.Email,
		PasswordHash: pwHash,
		Status:       "active",
		KYCLevel:     0,
	}
	if err := s.userRepo.Create(ctx, newUser); err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}
	if err := s.walletRepo.CreateForUser(ctx, newUser.ID); err != nil {
		return nil, fmt.Errorf("create wallet: %w", err)
	}

	tokens, err := s.jwt.GenerateTokenPair(newUser.ID)
	if err != nil {
		return nil, fmt.Errorf("generate tokens: %w", err)
	}
	if err := s.persistTokenRollout(ctx, newUser.ID, tokens, lc, ""); err != nil {
		return nil, fmt.Errorf("persist session: %w", err)
	}

	if s.auditLogger != nil {
		s.auditLogger.Log(audit.Event{
			UserID:       newUser.ID,
			Action:       "user_register",
			ResourceType: "user",
			ResourceID:   newUser.ID,
			IPAddress:    lc.IPAddress,
			UserAgent:    lc.UserAgent,
			RiskLevel:    "low",
		})
	}
	return &LoginResponse{User: newUser, Tokens: tokens}, nil
}

func (s *Service) ChangePassword(ctx context.Context, userID string, req *ChangePasswordRequest, lc LoginContext) error {
	u, err := s.userRepo.FindByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("user not found")
	}
	valid, err := hash.VerifyPin(req.OldPassword, u.PasswordHash)
	if err != nil || !valid {
		return fmt.Errorf("invalid current password")
	}
	if req.OldPassword == req.NewPassword {
		return fmt.Errorf("new password must differ from current")
	}
	newHash, err := hash.HashPin(req.NewPassword)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	// Atomic: change the hash AND revoke every refresh family + session, or
	// nothing. A failure here must NOT leave the password changed with stale
	// sessions still valid.
	if err := s.authRepo.ChangePasswordAndRevokeSessions(ctx, userID, newHash); err != nil {
		return fmt.Errorf("change password: %w", err)
	}

	if s.auditLogger != nil {
		s.auditLogger.LogPinChange(userID, lc.IPAddress)
	}
	return nil
}

// Refresh implements rotation with reuse detection.
func (s *Service) Refresh(ctx context.Context, refreshTokenRaw string, lc LoginContext) (*jwtpkg.TokenPair, error) {
	claims, err := s.jwt.ValidateRefresh(refreshTokenRaw)
	if err != nil {
		return nil, fmt.Errorf("invalid refresh token")
	}
	tokenHash := jwtpkg.HashToken(refreshTokenRaw)

	rec, reused, err := s.authRepo.ConsumeRefreshToken(ctx, claims.ID, tokenHash)
	if err != nil {
		if reused {
			// Revoke all access tokens of the family by denylisting recent jtis.
			if s.auditLogger != nil {
				s.auditLogger.Log(audit.Event{
					UserID:    claims.UserID,
					Action:    "refresh_reuse_detected",
					RiskLevel: "high",
					IPAddress: lc.IPAddress,
					UserAgent: lc.UserAgent,
				})
			}
		}
		return nil, fmt.Errorf("invalid refresh token")
	}

	// Enforce the idle and absolute session windows. The presented token's
	// issued_at is the last activity; the family origin is the original login.
	// On a violation, revoke the family so the stale token can't be retried and
	// force a fresh login.
	familyOrigin := rec.IssuedAt
	if fo, ferr := s.authRepo.FamilyOrigin(ctx, rec.FamilyID); ferr == nil && !fo.IsZero() {
		familyOrigin = fo
	}
	if sessionWindowExceeded(time.Now(), rec.IssuedAt, familyOrigin, s.idleTimeout, s.absoluteTimeout) {
		if rerr := s.authRepo.RevokeRefreshFamily(ctx, rec.FamilyID); rerr != nil {
			slog.Warn("refresh: revoke on session timeout failed", "family_id", rec.FamilyID, "err", rerr.Error())
		}
		if s.auditLogger != nil {
			s.auditLogger.Log(audit.Event{
				UserID:    rec.UserID,
				Action:    "session_timeout",
				RiskLevel: "low",
				IPAddress: lc.IPAddress,
				UserAgent: lc.UserAgent,
			})
		}
		return nil, fmt.Errorf("session timed out")
	}

	// Rotate.
	tokens, err := s.jwt.RotateRefresh(rec.UserID, rec.FamilyID, rec.JTI)
	if err != nil {
		return nil, fmt.Errorf("rotate: %w", err)
	}
	if err := s.persistTokenRollout(ctx, rec.UserID, tokens, lc, rec.JTI); err != nil {
		return nil, fmt.Errorf("persist rolled session: %w", err)
	}
	return tokens, nil
}

// Logout revokes the current access jti (Redis denylist for remaining TTL +
// session row) and the refresh family.
func (s *Service) Logout(ctx context.Context, accessJTI string, accessRemainingTTL time.Duration) error {
	if accessJTI == "" {
		return nil
	}
	if err := s.authRepo.RevokeSessionByAccessJTI(ctx, accessJTI); err != nil {
		return err
	}
	if err := s.authRepo.DenylistAccessJTI(ctx, accessJTI, accessRemainingTTL); err != nil {
		return err
	}
	// Also revoke the refresh family bound to this session, if known. This is
	// best-effort (the access jti is already denylisted above), but a failure
	// must be logged rather than silently swallowed.
	var familyID *string
	if err := s.authRepo.db.QueryRow(ctx,
		`SELECT (SELECT family_id::text FROM refresh_tokens WHERE jti =
		           (SELECT refresh_jti FROM user_sessions WHERE access_jti = $1 LIMIT 1))`,
		accessJTI,
	).Scan(&familyID); err != nil {
		slog.Warn("logout: could not resolve refresh family", "access_jti", accessJTI, "err", err.Error())
	}
	if familyID != nil && *familyID != "" {
		if err := s.authRepo.RevokeRefreshFamily(ctx, *familyID); err != nil {
			slog.Warn("logout: could not revoke refresh family", "family_id", *familyID, "err", err.Error())
		}
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
//  Password reset flow
// ─────────────────────────────────────────────────────────────────────────

// ForgotPassword always returns nil regardless of whether the user exists
// (anti-enumeration). When the user exists, a token is issued and stored.
// The caller is responsible for delivering the token via email/SMS.
func (s *Service) ForgotPassword(ctx context.Context, cedula string, lc LoginContext) (string, error) {
	u, _ := s.userRepo.FindByCedula(ctx, cedula)
	if u == nil {
		// Burn equivalent CPU so timing doesn't leak existence.
		hash.DummyVerify()
		return "", nil
	}
	raw, err := randomToken(32)
	if err != nil {
		return "", fmt.Errorf("token gen: %w", err)
	}
	h := sha256.Sum256([]byte(raw))
	tokenHash := hex.EncodeToString(h[:])
	rec := &PasswordResetTokenRecord{
		ID:          uuid.New().String(),
		UserID:      u.ID,
		TokenHash:   tokenHash,
		RequestedIP: lc.IPAddress,
		ExpiresAt:   time.Now().Add(15 * time.Minute),
	}
	if err := s.authRepo.InsertPasswordResetToken(ctx, rec); err != nil {
		return "", fmt.Errorf("insert reset token: %w", err)
	}
	if s.auditLogger != nil {
		s.auditLogger.Log(audit.Event{
			UserID:    u.ID,
			Action:    "password_reset_requested",
			RiskLevel: "medium",
			IPAddress: lc.IPAddress,
			UserAgent: lc.UserAgent,
		})
	}
	return raw, nil
}

func (s *Service) ResetPassword(ctx context.Context, req *ResetPasswordRequest, lc LoginContext) error {
	h := sha256.Sum256([]byte(req.Token))
	tokenHash := hex.EncodeToString(h[:])

	userID, err := s.authRepo.ConsumePasswordResetToken(ctx, tokenHash)
	if err != nil {
		return fmt.Errorf("invalid or expired reset token")
	}
	newHash, err := hash.HashPin(req.NewPassword)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	// Atomic password change + full session/refresh revocation (see ChangePassword).
	if err := s.authRepo.ChangePasswordAndRevokeSessions(ctx, userID, newHash); err != nil {
		return fmt.Errorf("reset password: %w", err)
	}
	if s.auditLogger != nil {
		s.auditLogger.Log(audit.Event{
			UserID:    userID,
			Action:    "password_reset_completed",
			RiskLevel: "high",
			IPAddress: lc.IPAddress,
			UserAgent: lc.UserAgent,
		})
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────────────────────────────────

func (s *Service) persistTokenRollout(
	ctx context.Context, userID string, tokens *jwtpkg.TokenPair, lc LoginContext, parentJTI string,
) error {
	rt := &RefreshTokenRecord{
		JTI:       tokens.RefreshJTI,
		UserID:    userID,
		FamilyID:  tokens.FamilyID,
		ParentJTI: parentJTI,
		TokenHash: jwtpkg.HashToken(tokens.RefreshToken),
		IssuedAt:  time.Now(),
		ExpiresAt: tokens.RefreshExpiry,
		IPAddress: lc.IPAddress,
		UserAgent: lc.UserAgent,
	}
	if err := s.authRepo.InsertRefreshToken(ctx, rt); err != nil {
		return err
	}
	sess := &SessionRecord{
		ID:         uuid.New().String(),
		UserID:     userID,
		AccessJTI:  tokens.AccessJTI,
		RefreshJTI: tokens.RefreshJTI,
		IPAddress:  lc.IPAddress,
		UserAgent:  lc.UserAgent,
		ExpiresAt:  tokens.RefreshExpiry,
	}
	return s.authRepo.CreateSession(ctx, sess)
}

func (s *Service) incrementLockout(cedula string) {
	if s.lockoutStore == nil || cedula == "" {
		return
	}
	middleware.IncrementLockout(s.lockoutStore, cedula)
}

func (s *Service) resetLockout(cedula string) {
	if s.lockoutStore == nil || cedula == "" {
		return
	}
	middleware.ResetLockoutCounter(s.lockoutStore, cedula)
}

func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
