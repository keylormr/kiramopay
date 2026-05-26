package jwt

import (
	"testing"
	"time"
)

func TestGenerateAndValidateToken(t *testing.T) {
	mgr := NewManager("test-secret", 15*time.Minute, 7*24*time.Hour)

	pair, err := mgr.GenerateTokenPair("user-123")
	if err != nil {
		t.Fatalf("GenerateTokenPair() error: %v", err)
	}

	if pair.AccessToken == "" {
		t.Fatal("access token should not be empty")
	}
	if pair.RefreshToken == "" {
		t.Fatal("refresh token should not be empty")
	}
	if pair.AccessExpiresAt == 0 {
		t.Fatal("access_expires_at should not be zero")
	}
	if pair.FamilyID == "" {
		t.Fatal("family id should be set")
	}
	if pair.AccessJTI == "" || pair.RefreshJTI == "" {
		t.Fatal("jti must be set")
	}
	if pair.AccessJTI == pair.RefreshJTI {
		t.Fatal("access and refresh jti must differ")
	}

	claims, err := mgr.ValidateAccess(pair.AccessToken)
	if err != nil {
		t.Fatalf("ValidateAccess() error: %v", err)
	}
	if claims.UserID != "user-123" {
		t.Fatalf("expected user_id 'user-123', got %q", claims.UserID)
	}
	if claims.Type != TypeAccess {
		t.Fatalf("expected access type, got %q", claims.Type)
	}
	if claims.Issuer != "kiramopay" {
		t.Fatalf("expected issuer 'kiramopay', got %q", claims.Issuer)
	}

	rc, err := mgr.ValidateRefresh(pair.RefreshToken)
	if err != nil {
		t.Fatalf("ValidateRefresh() error: %v", err)
	}
	if rc.Type != TypeRefresh {
		t.Fatalf("expected refresh type, got %q", rc.Type)
	}
	if rc.FamilyID != pair.FamilyID {
		t.Fatalf("family id mismatch")
	}
}

func TestAccessTokenCannotBeUsedAsRefresh(t *testing.T) {
	mgr := NewManager("test-secret", 15*time.Minute, 7*24*time.Hour)
	pair, _ := mgr.GenerateTokenPair("user-123")
	if _, err := mgr.ValidateRefresh(pair.AccessToken); err == nil {
		t.Fatal("access token must NOT validate as refresh")
	}
}

func TestRefreshTokenCannotBeUsedAsAccess(t *testing.T) {
	mgr := NewManager("test-secret", 15*time.Minute, 7*24*time.Hour)
	pair, _ := mgr.GenerateTokenPair("user-123")
	if _, err := mgr.ValidateAccess(pair.RefreshToken); err == nil {
		t.Fatal("refresh token must NOT validate as access")
	}
}

func TestRotateRefreshKeepsFamily(t *testing.T) {
	mgr := NewManager("test-secret", 15*time.Minute, 7*24*time.Hour)
	pair, _ := mgr.GenerateTokenPair("user-123")
	rotated, err := mgr.RotateRefresh("user-123", pair.FamilyID, pair.RefreshJTI)
	if err != nil {
		t.Fatalf("RotateRefresh error: %v", err)
	}
	if rotated.FamilyID != pair.FamilyID {
		t.Fatalf("family must be preserved across rotations")
	}
	rc, _ := mgr.ValidateRefresh(rotated.RefreshToken)
	if rc.ParentJTI != pair.RefreshJTI {
		t.Fatalf("rotated token must reference parent jti")
	}
}

func TestInvalidToken(t *testing.T) {
	mgr := NewManager("test-secret", 15*time.Minute, 7*24*time.Hour)
	if _, err := mgr.ValidateAccess("invalid-token"); err == nil {
		t.Fatal("ValidateAccess() should error on invalid token")
	}
}

func TestWrongSecret(t *testing.T) {
	mgr1 := NewManager("secret-1", 15*time.Minute, 7*24*time.Hour)
	mgr2 := NewManager("secret-2", 15*time.Minute, 7*24*time.Hour)
	pair, _ := mgr1.GenerateTokenPair("user-123")
	if _, err := mgr2.ValidateAccess(pair.AccessToken); err == nil {
		t.Fatal("ValidateAccess() should error with wrong secret")
	}
}

func TestExpiredToken(t *testing.T) {
	mgr := NewManager("test-secret", -1*time.Second, -1*time.Second)
	pair, err := mgr.GenerateTokenPair("user-123")
	if err != nil {
		t.Fatalf("GenerateTokenPair() error: %v", err)
	}
	if _, err := mgr.ValidateAccess(pair.AccessToken); err == nil {
		t.Fatal("ValidateAccess() should error on expired token")
	}
}

func TestHashTokenDeterministic(t *testing.T) {
	a := HashToken("abc")
	b := HashToken("abc")
	if a != b {
		t.Fatalf("HashToken must be deterministic")
	}
	if HashToken("abc") == HashToken("abcd") {
		t.Fatalf("HashToken must vary by input")
	}
}
