package kyc_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/kyc"
	"github.com/kiramopay/backend/internal/middleware"
)

// Desde el PR 295 administra una cuenta personal, con su propia billetera y su
// propia verificacion. Quien decide una verificacion no puede ser la persona
// verificada: ni para aprobarla (subirse los topes) ni para rechazarla. La ruta
// responde 403 ADMIN_IS_AFFECTED_PARTY y la verificacion queda pendiente para
// otro administrador.

func decisionPor(adminID, verificationID, cuerpo string) *http.Request {
	r := httptest.NewRequest(http.MethodPost, "/api/v1/admin/kyc/"+verificationID+"/decision", strings.NewReader(cuerpo))
	ctx := context.WithValue(r.Context(), middleware.UserIDKey, adminID)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", verificationID)
	return r.WithContext(context.WithValue(ctx, chi.RouteCtxKey, rctx))
}

func codigoDeError(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var sobre struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("respuesta ilegible: %v (%s)", err, rec.Body.String())
	}
	return sobre.Error.Code
}

func TestKYC_UnAdministradorNoDecideSuPropiaVerificacion(t *testing.T) {
	svc, pool, userID, adminID := setupKYC(t)
	ctx := context.Background()
	h := kyc.NewHandler(svc)

	v, err := svc.Submit(ctx, userID, &kyc.SubmitRequest{
		LevelRequested: kyc.LevelComplete,
		FullLegalName:  "Test User",
		DocumentType:   "national_id",
		DocumentNumber: "702650930",
	}, "127.0.0.1")
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	antes, err := svc.GetStatus(ctx, userID)
	if err != nil {
		t.Fatalf("GetStatus: %v", err)
	}

	for nombre, cuerpo := range map[string]string{
		"aprobarse":  `{"approve":true}`,
		"rechazarse": `{"approve":false,"notes":"me rechazo"}`,
	} {
		rec := httptest.NewRecorder()
		h.Decide(rec, decisionPor(userID, v.ID, cuerpo))
		if rec.Code != http.StatusForbidden || codigoDeError(t, rec) != "ADMIN_IS_AFFECTED_PARTY" {
			t.Errorf("%s: %d %s, se esperaba 403 ADMIN_IS_AFFECTED_PARTY", nombre, rec.Code, rec.Body.String())
		}
	}

	var estado, revisor string
	if err := pool.QueryRow(ctx,
		`SELECT status, COALESCE(decided_by::text, '') FROM kyc_verifications WHERE id = $1::uuid`, v.ID,
	).Scan(&estado, &revisor); err != nil {
		t.Fatalf("leer la verificacion: %v", err)
	}
	if estado != kyc.StatusPending || revisor != "" {
		t.Fatalf("la verificacion quedo %s, revisada por %q: se decidio sobre si misma", estado, revisor)
	}
	despues, err := svc.GetStatus(ctx, userID)
	if err != nil {
		t.Fatalf("GetStatus: %v", err)
	}
	if despues.KYCLevel != antes.KYCLevel || despues.Limits.DailyMinor != antes.Limits.DailyMinor {
		t.Fatalf("nivel %d -> %d, tope %d -> %d: se subio los topes", antes.KYCLevel, despues.KYCLevel,
			antes.Limits.DailyMinor, despues.Limits.DailyMinor)
	}

	// Otro administrador si la decide.
	rec := httptest.NewRecorder()
	h.Decide(rec, decisionPor(adminID, v.ID, `{"approve":true}`))
	if rec.Code != http.StatusOK {
		t.Fatalf("otro administrador: %d %s", rec.Code, rec.Body.String())
	}
}
