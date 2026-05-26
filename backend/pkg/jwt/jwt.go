package jwt

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// TokenType distinguishes access from refresh JWTs so they cannot be used
// interchangeably. A leaked access token must NOT be replayable as a refresh.
type TokenType string

const (
	TypeAccess  TokenType = "access"
	TypeRefresh TokenType = "refresh"
)

type Claims struct {
	UserID    string    `json:"user_id"`
	Role      string    `json:"role,omitempty"`
	Type      TokenType `json:"typ"`
	FamilyID  string    `json:"fid,omitempty"` // refresh-chain identifier
	ParentJTI string    `json:"pjti,omitempty"`
	jwt.RegisteredClaims
}

type TokenPair struct {
	AccessToken     string    `json:"access_token"`
	AccessJTI       string    `json:"-"`
	AccessExpiresAt int64     `json:"expires_at"`
	RefreshToken    string    `json:"refresh_token"`
	RefreshJTI      string    `json:"-"`
	RefreshExpiry   time.Time `json:"-"`
	FamilyID        string    `json:"-"`
}

type Manager struct {
	secret          []byte
	accessDuration  time.Duration
	refreshDuration time.Duration
}

func NewManager(secret string, accessDuration, refreshDuration time.Duration) *Manager {
	return &Manager{
		secret:          []byte(secret),
		accessDuration:  accessDuration,
		refreshDuration: refreshDuration,
	}
}

// GenerateTokenPair issues a new access + refresh pair, opening a fresh refresh family.
func (m *Manager) GenerateTokenPair(userID string) (*TokenPair, error) {
	familyID := uuid.New().String()
	return m.generatePair(userID, familyID, "")
}

// RotateRefresh issues a new pair within the same family, recording the parent jti.
func (m *Manager) RotateRefresh(userID, familyID, parentJTI string) (*TokenPair, error) {
	if familyID == "" {
		return nil, fmt.Errorf("family id required for rotation")
	}
	return m.generatePair(userID, familyID, parentJTI)
}

func (m *Manager) generatePair(userID, familyID, parentJTI string) (*TokenPair, error) {
	accessJTI := uuid.New().String()
	access, accessExp, err := m.signToken(userID, accessJTI, TypeAccess, "", "", m.accessDuration)
	if err != nil {
		return nil, fmt.Errorf("generate access token: %w", err)
	}

	refreshJTI := uuid.New().String()
	refresh, refreshExp, err := m.signToken(userID, refreshJTI, TypeRefresh, familyID, parentJTI, m.refreshDuration)
	if err != nil {
		return nil, fmt.Errorf("generate refresh token: %w", err)
	}

	return &TokenPair{
		AccessToken:     access,
		AccessJTI:       accessJTI,
		AccessExpiresAt: accessExp.Unix(),
		RefreshToken:    refresh,
		RefreshJTI:      refreshJTI,
		RefreshExpiry:   refreshExp,
		FamilyID:        familyID,
	}, nil
}

// ValidateAccess parses and validates an access token. Refresh tokens are rejected.
func (m *Manager) ValidateAccess(tokenString string) (*Claims, error) {
	c, err := m.parse(tokenString)
	if err != nil {
		return nil, err
	}
	if c.Type != TypeAccess {
		return nil, fmt.Errorf("expected access token, got %q", c.Type)
	}
	return c, nil
}

// ValidateRefresh parses and validates a refresh token. Access tokens are rejected.
func (m *Manager) ValidateRefresh(tokenString string) (*Claims, error) {
	c, err := m.parse(tokenString)
	if err != nil {
		return nil, err
	}
	if c.Type != TypeRefresh {
		return nil, fmt.Errorf("expected refresh token, got %q", c.Type)
	}
	if c.FamilyID == "" {
		return nil, fmt.Errorf("refresh token missing family id")
	}
	return c, nil
}

// ValidateToken (legacy) — kept for code that doesn't yet differentiate.
// Deprecated: prefer ValidateAccess / ValidateRefresh.
func (m *Manager) ValidateToken(tokenString string) (*Claims, error) {
	return m.parse(tokenString)
}

func (m *Manager) parse(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}
	if claims.UserID == "" {
		return nil, fmt.Errorf("token missing user_id")
	}
	if claims.ID == "" {
		return nil, fmt.Errorf("token missing jti")
	}
	return claims, nil
}

func (m *Manager) signToken(userID, jti string, typ TokenType, familyID, parentJTI string, duration time.Duration) (string, time.Time, error) {
	now := time.Now()
	expiresAt := now.Add(duration)

	claims := &Claims{
		UserID:    userID,
		Type:      typ,
		FamilyID:  familyID,
		ParentJTI: parentJTI,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			Issuer:    "kiramopay",
			Subject:   userID,
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(m.secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, expiresAt, nil
}

// HashToken returns the sha-256 hex digest of a raw JWT string. Used to store
// a deterministic, irreversible fingerprint of the refresh token in the DB so
// we can detect re-use without retaining the bearer credential itself.
func HashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func (m *Manager) RefreshDuration() time.Duration { return m.refreshDuration }
func (m *Manager) AccessDuration() time.Duration  { return m.accessDuration }
