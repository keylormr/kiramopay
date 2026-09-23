package fraud_test

import (
	"context"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/fraud"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/pkg/hash"
)

func setupFraudService(t *testing.T) (*fraud.Service, string) {
	t.Helper()
	svc, _, userID := setupFraudConPool(t)
	return svc, userID
}

func setupFraudConPool(t *testing.T) (*fraud.Service, *pgxpool.Pool, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	repo := fraud.NewRepository(pool)
	svc := fraud.NewService(repo)

	pinHash, _ := hash.HashPin("1234")
	userID := testutil.SeedTestUser(t, pool, "702650930", pinHash)

	return svc, pool, userID
}

// envejecerCuenta corre la fecha de alta de la cuenta tantos dias atras.
func envejecerCuenta(t *testing.T, pool *pgxpool.Pool, userID string, dias int) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET created_at = NOW() - make_interval(days => $2::int) WHERE id = $1`,
		userID, dias,
	); err != nil {
		t.Fatalf("envejecer cuenta: %v", err)
	}
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

// Solo la regla 1: la cuenta tiene 30 dias (la regla 4 no aplica) y no hay
// movimientos previos (la 2, la 3 y la 5 tampoco). Antes pedia "al menos 25" y
// pasaba aunque se borrara la regla 1: la cuenta, que el motor veia siempre
// nueva, ya sumaba 45 por su lado.
func TestAssessTransaction_HighAmount(t *testing.T) {
	svc, pool, userID := setupFraudConPool(t)
	envejecerCuenta(t, pool, userID, 30)

	assessment, err := svc.AssessTransaction(context.Background(), &fraud.AssessRequest{
		UserID:   userID,
		TxType:   "sinpe_send",
		Amount:   75000000, // 750,000 CRC — high amount
		Currency: "CRC",
	})
	if err != nil {
		t.Fatalf("AssessTransaction() error: %v", err)
	}
	if assessment.RiskScore != 30 {
		t.Fatalf("puntaje = %d, want 30 (solo monto alto); factores: %v", assessment.RiskScore, assessment.Factors)
	}
	if len(assessment.Factors) != 1 || assessment.Factors[0] != "High amount: 75000000 centimos" {
		t.Fatalf("factores = %v, want solo el de monto alto", assessment.Factors)
	}
}

// La regla 4 sigue valiendo para una cuenta que de verdad es nueva.
func TestAssessTransaction_CuentaNuevaConMontoAlto(t *testing.T) {
	svc, userID := setupFraudService(t)

	assessment, err := svc.AssessTransaction(context.Background(), &fraud.AssessRequest{
		UserID:   userID,
		TxType:   "sinpe_send",
		Amount:   15000000, // 150,000 CRC: mas del tope de cuenta nueva, menos del de monto alto
		Currency: "CRC",
	})
	if err != nil {
		t.Fatalf("AssessTransaction() error: %v", err)
	}
	if assessment.RiskScore != 45 || !slices.Contains(assessment.Factors, "New account with high-value transaction") {
		t.Fatalf("puntaje = %d, factores = %v; want 45 por cuenta nueva", assessment.RiskScore, assessment.Factors)
	}
}

// El caso de produccion: una cuenta de tres meses que suele mover 50.000
// colones paga 600.000. Monto alto (30) mas fuera de su promedio (25) da 55:
// se revisa y pasa. Con la antiguedad sin calcular, el motor la veia nueva,
// sumaba 45 mas, llegaba a 100 y la salida se bloqueaba.
func TestEvaluarSalida_UnaCuentaViejaNoSeBloqueaPorNueva(t *testing.T) {
	svc, pool, userID := setupFraudConPool(t)
	ctx := context.Background()
	envejecerCuenta(t, pool, userID, 90)
	if _, err := pool.Exec(ctx,
		`INSERT INTO user_risk_profiles (user_id, avg_tx_amount) VALUES ($1, 5000000)`, userID,
	); err != nil {
		t.Fatalf("perfil con promedio: %v", err)
	}

	accion, err := svc.EvaluarSalida(ctx, userID, "sinpe_send", "", 60000000, "CRC")
	if err != nil {
		t.Fatalf("EvaluarSalida() error: %v", err)
	}
	if accion != fraud.ActionReview {
		t.Fatalf("accion = %q, want %q (55 puntos: monto alto y fuera de promedio)", accion, fraud.ActionReview)
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
