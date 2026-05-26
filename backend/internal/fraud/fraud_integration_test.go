package fraud_test

import (
	"context"
	"testing"

	"github.com/kiramopay/backend/internal/fraud"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/pkg/hash"
)

func setupFraudService(t *testing.T) (*fraud.Service, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	repo := fraud.NewRepository(pool)
	svc := fraud.NewService(repo)

	pinHash, _ := hash.HashPin("1234")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)

	return svc, userID
}

func TestAssessTransaction_LowRisk(t *testing.T) {
	svc, userID := setupFraudService(t)
	ctx := context.Background()

	assessment, err := svc.AssessTransaction(ctx, &fraud.AssessRequest{
		UserID:   userID,
		TxType:   "sinpe_send",
		Amount:   5000000, // 50,000 CRC — low amount
		Currency: "CRC",
	})
	if err != nil {
		t.Fatalf("AssessTransaction() error: %v", err)
	}
	if assessment.RiskLevel != "low" {
		t.Fatalf("expected low risk for small transaction, got %s (score: %d)", assessment.RiskLevel, assessment.RiskScore)
	}
	if assessment.Action != "allow" {
		t.Fatalf("expected action allow, got %s", assessment.Action)
	}
}

func TestAssessTransaction_HighAmount(t *testing.T) {
	svc, userID := setupFraudService(t)
	ctx := context.Background()

	assessment, err := svc.AssessTransaction(ctx, &fraud.AssessRequest{
		UserID:   userID,
		TxType:   "sinpe_send",
		Amount:   75000000, // 750,000 CRC — high amount
		Currency: "CRC",
	})
	if err != nil {
		t.Fatalf("AssessTransaction() error: %v", err)
	}
	// High amount should increase risk score
	if assessment.RiskScore < 25 {
		t.Fatalf("expected risk score >= 25 for high amount, got %d", assessment.RiskScore)
	}
}

func TestGetUserRiskProfile_NewUser(t *testing.T) {
	svc, userID := setupFraudService(t)
	ctx := context.Background()

	profile, err := svc.GetUserRiskProfile(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserRiskProfile() error: %v", err)
	}
	if profile.UserID != userID {
		t.Fatalf("expected user_id %s, got %s", userID, profile.UserID)
	}
	if profile.IsRestricted {
		t.Fatal("new user should not be restricted")
	}
}

func TestRestrictUser(t *testing.T) {
	svc, userID := setupFraudService(t)
	ctx := context.Background()

	// Ensure profile exists
	_, err := svc.GetUserRiskProfile(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserRiskProfile() error: %v", err)
	}

	// Restrict
	err = svc.RestrictUser(ctx, userID, true)
	if err != nil {
		t.Fatalf("RestrictUser(true) error: %v", err)
	}

	profile, err := svc.GetUserRiskProfile(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserRiskProfile() after restrict error: %v", err)
	}
	if !profile.IsRestricted {
		t.Fatal("expected user to be restricted")
	}

	// Unrestrict
	err = svc.RestrictUser(ctx, userID, false)
	if err != nil {
		t.Fatalf("RestrictUser(false) error: %v", err)
	}

	profile, err = svc.GetUserRiskProfile(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserRiskProfile() after unrestrict error: %v", err)
	}
	if profile.IsRestricted {
		t.Fatal("expected user to not be restricted")
	}
}

func TestGetOpenAlerts_Empty(t *testing.T) {
	svc, _ := setupFraudService(t)
	ctx := context.Background()

	alerts, err := svc.GetOpenAlerts(ctx)
	if err != nil {
		t.Fatalf("GetOpenAlerts() error: %v", err)
	}
	if len(alerts) != 0 {
		t.Fatalf("expected 0 alerts for fresh DB, got %d", len(alerts))
	}
}

func TestGetUserAssessments_AfterAssessment(t *testing.T) {
	svc, userID := setupFraudService(t)
	ctx := context.Background()

	// Create an assessment
	_, err := svc.AssessTransaction(ctx, &fraud.AssessRequest{
		UserID:   userID,
		TxType:   "deposit",
		Amount:   10000000,
		Currency: "CRC",
	})
	if err != nil {
		t.Fatalf("AssessTransaction() error: %v", err)
	}

	assessments, err := svc.GetUserAssessments(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserAssessments() error: %v", err)
	}
	if len(assessments) < 1 {
		t.Fatal("expected at least 1 assessment")
	}
}
