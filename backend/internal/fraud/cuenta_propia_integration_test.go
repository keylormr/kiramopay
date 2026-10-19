package fraud_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/fraud"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/testutil"
)

// Desde el PR 295 administra una cuenta personal, con su propio perfil de
// riesgo. Un administrador no resuelve una alerta de fraude sobre su propia
// cuenta (la daria por falso positivo) ni se pone o se quita la restriccion a
// si mismo. Las dos rutas responden 403 ADMIN_IS_AFFECTED_PARTY.

func pedidoDe(quien, metodo, ruta, cuerpo, param, valor string) *http.Request {
	r := httptest.NewRequest(metodo, ruta, strings.NewReader(cuerpo))
	ctx := context.WithValue(r.Context(), middleware.UserIDKey, quien)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(param, valor)
	return r.WithContext(context.WithValue(ctx, chi.RouteCtxKey, rctx))
}

func codigoDe(rec *httptest.ResponseRecorder) string {
	var sobre struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &sobre)
	return sobre.Error.Code
}

func TestFraude_UnAdministradorNoResuelveSuPropiaAlerta(t *testing.T) {
	svc, pool, userID := setupFraudConPool(t)
	ctx := context.Background()
	h := fraud.NewHandler(svc)
	repo := fraud.NewRepository(pool)

	evaluacion := &fraud.RiskAssessment{
		ID: uuid.NewString(), UserID: userID, TxType: "sinpe_send", TxID: uuid.NewString(),
		Amount: 100_000_000, RiskScore: 80, RiskLevel: "high", Factors: []string{"prueba"}, Action: "review",
	}
	if err := repo.CreateAssessment(ctx, evaluacion); err != nil {
		t.Fatalf("CreateAssessment: %v", err)
	}
	alerta := &fraud.FraudAlert{
		ID: uuid.NewString(), UserID: userID, AssessmentID: evaluacion.ID,
		Type: "suspicious_tx", Severity: "high", Message: "prueba", Status: "open",
	}
	if err := repo.CreateAlert(ctx, alerta); err != nil {
		t.Fatalf("CreateAlert: %v", err)
	}

	ruta := "/api/v1/admin/fraud/alerts/" + alerta.ID
	for _, estado := range []string{"false_positive", "resolved", "investigating"} {
		rec := httptest.NewRecorder()
		h.ResolveAlert(rec, pedidoDe(userID, http.MethodPatch, ruta, `{"status":"`+estado+`"}`, "id", alerta.ID))
		if rec.Code != http.StatusForbidden || codigoDe(rec) != "ADMIN_IS_AFFECTED_PARTY" {
			t.Errorf("resolver su propia alerta como %s: %d %s, se esperaba 403 ADMIN_IS_AFFECTED_PARTY",
				estado, rec.Code, rec.Body.String())
		}
	}
	var estado, quien string
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(status, ''), COALESCE(resolved_by, '') FROM fraud_alerts WHERE id = $1::uuid`, alerta.ID,
	).Scan(&estado, &quien); err != nil {
		t.Fatalf("leer la alerta: %v", err)
	}
	if estado != "open" || quien != "" {
		t.Fatalf("la alerta quedo %s, resuelta por %q", estado, quien)
	}

	// Otro administrador si la resuelve.
	otro := testutil.SeedTestUser2(t, pool)
	rec := httptest.NewRecorder()
	h.ResolveAlert(rec, pedidoDe(otro, http.MethodPatch, ruta, `{"status":"resolved"}`, "id", alerta.ID))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("otro administrador: %d %s", rec.Code, rec.Body.String())
	}
}

func TestFraude_UnAdministradorNoSeRestringeNiSeLiberaASiMismo(t *testing.T) {
	svc, pool, userID := setupFraudConPool(t)
	ctx := context.Background()
	h := fraud.NewHandler(svc)

	if _, err := svc.GetUserRiskProfile(ctx, userID); err != nil {
		t.Fatalf("GetUserRiskProfile: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE user_risk_profiles SET is_restricted = TRUE WHERE user_id = $1::uuid`, userID); err != nil {
		t.Fatalf("restringir la cuenta: %v", err)
	}

	ruta := "/api/v1/admin/fraud/restrict/" + userID
	for _, cuerpo := range []string{`{"restricted":false}`, `{"restricted":true}`} {
		rec := httptest.NewRecorder()
		h.RestrictUser(rec, pedidoDe(userID, http.MethodPost, ruta, cuerpo, "userId", userID))
		if rec.Code != http.StatusForbidden || codigoDe(rec) != "ADMIN_IS_AFFECTED_PARTY" {
			t.Errorf("%s sobre si mismo: %d %s, se esperaba 403 ADMIN_IS_AFFECTED_PARTY", cuerpo, rec.Code, rec.Body.String())
		}
	}
	perfil, err := svc.GetUserRiskProfile(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserRiskProfile: %v", err)
	}
	if !perfil.IsRestricted {
		t.Fatal("la cuenta se quito su propia restriccion")
	}

	// Otro administrador si la libera.
	otro := testutil.SeedTestUser2(t, pool)
	rec := httptest.NewRecorder()
	h.RestrictUser(rec, pedidoDe(otro, http.MethodPost, ruta, `{"restricted":false}`, "userId", userID))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("otro administrador: %d %s", rec.Code, rec.Body.String())
	}
}
