package auth_test

import (
	"context"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
	jwtpkg "github.com/kiramopay/backend/pkg/jwt"
)

func setupAuthService(t *testing.T) (*auth.Service, *auth.Repository) {
	t.Helper()
	pool := testutil.TestDB(t)
	redis := testutil.TestRedis(t)

	authRepo := auth.NewRepository(pool, redis)
	userRepo := user.NewRepository(pool)
	walletRepo := wallet.NewRepository(pool)
	jwtMgr := jwtpkg.NewManager("test-secret-key", 15*time.Minute, 7*24*time.Hour)
	lockoutStore := middleware.NewRedisLockoutStore(redis, time.Minute)

	svc := auth.NewService(authRepo, userRepo, walletRepo, jwtMgr, &auth.Options{
		LockoutStore: lockoutStore,
	})
	return svc, authRepo
}

var emptyCtx = auth.LoginContext{}

func TestRegister_Success(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()

	resp, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula:    "702650930",
		Phone:     "+50688881234",
		FirstName: "Keilor",
		LastName:  "Martinez",
		Password:  "Kiramopay2024!",
	}, emptyCtx)
	if err != nil {
		t.Fatalf("Register() error: %v", err)
	}
	if resp == nil || resp.User == nil || resp.Tokens == nil {
		t.Fatal("Register() returned nil pieces")
	}
	if resp.User.Cedula != "702650930" {
		t.Fatalf("expected cedula 702650930, got %s", resp.User.Cedula)
	}
	if resp.Tokens.AccessToken == "" || resp.Tokens.RefreshToken == "" {
		t.Fatal("tokens missing")
	}
	if resp.Tokens.FamilyID == "" {
		t.Fatal("family id missing")
	}
}

func TestRegister_DuplicateCedula(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()

	if _, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "702650930", Phone: "+50688881234",
		FirstName: "Keilor", LastName: "Martinez", Password: "Kiramopay2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("first register: %v", err)
	}
	if _, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "702650930", Phone: "+50688885678",
		FirstName: "Otro", LastName: "Usuario", Password: "Other2024!",
	}, emptyCtx); err == nil {
		t.Fatal("expected error for duplicate cedula")
	}
}

func TestLogin_Success(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()

	if _, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "702650930", Phone: "+50688881234",
		FirstName: "Keilor", LastName: "Martinez", Password: "Kiramopay2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("register: %v", err)
	}
	resp, err := svc.Login(ctx, &auth.LoginRequest{
		Cedula:   "702650930",
		Password: "Kiramopay2024!",
	}, emptyCtx)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if resp.Tokens.AccessToken == "" {
		t.Fatal("empty access token")
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()

	if _, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "702650930", Phone: "+50688881234",
		FirstName: "Keilor", LastName: "Martinez", Password: "Kiramopay2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("register: %v", err)
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Cedula: "702650930", Password: "WrongPass2024!",
	}, emptyCtx); err == nil {
		t.Fatal("expected error")
	}
}

func TestLogin_NonExistentUser(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Cedula: "999999999", Password: "Kiramopay2024!",
	}, emptyCtx); err == nil {
		t.Fatal("expected error")
	}
}

func TestChangePassword_Success(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()
	resp, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "702650930", Phone: "+50688881234",
		FirstName: "Keilor", LastName: "Martinez", Password: "Kiramopay2024!",
	}, emptyCtx)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if err := svc.ChangePassword(ctx, resp.User.ID, &auth.ChangePasswordRequest{
		OldPassword: "Kiramopay2024!",
		NewPassword: "NewPass2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("change password: %v", err)
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Cedula: "702650930", Password: "NewPass2024!",
	}, emptyCtx); err != nil {
		t.Fatalf("login w/ new password: %v", err)
	}
	if _, err := svc.Login(ctx, &auth.LoginRequest{
		Cedula: "702650930", Password: "Kiramopay2024!",
	}, emptyCtx); err == nil {
		t.Fatal("old password must NOT work")
	}
}

func TestRefreshTokenRotation(t *testing.T) {
	svc, _ := setupAuthService(t)
	ctx := context.Background()
	resp, err := svc.Register(ctx, &auth.RegisterRequest{
		Cedula: "702650930", Phone: "+50688881234",
		FirstName: "Keilor", LastName: "Martinez", Password: "Kiramopay2024!",
	}, emptyCtx)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	tokens, err := svc.Refresh(ctx, resp.Tokens.RefreshToken, emptyCtx)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if tokens.AccessToken == resp.Tokens.AccessToken {
		t.Fatal("refresh must yield a fresh access token")
	}
	if tokens.RefreshToken == resp.Tokens.RefreshToken {
		t.Fatal("refresh must rotate the refresh token")
	}
	// Reusing the original refresh token now must fail (and revoke family).
	if _, err := svc.Refresh(ctx, resp.Tokens.RefreshToken, emptyCtx); err == nil {
		t.Fatal("reusing original refresh token must fail")
	}
	// The newly issued one must ALSO be invalid now (family revoked).
	if _, err := svc.Refresh(ctx, tokens.RefreshToken, emptyCtx); err == nil {
		t.Fatal("after reuse-detection, all tokens in family must be invalid")
	}
}
