package uif_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/uif"
)

// Desde el PR 295 administra una cuenta personal, con movimientos que pueden
// abrir un caso UIF. Quien revisa un caso no puede ser la persona del caso: se
// lo descartaria a si misma. La ruta responde 403 ADMIN_IS_AFFECTED_PARTY y el
// caso sigue pendiente para otro oficial.
func TestUIF_NadieRevisaSuPropioCaso(t *testing.T) {
	svc, _, pool, userID := setupUIF(t)
	ctx := context.Background()
	h := uif.NewHandler(svc)

	caso := &uif.Report{
		UserID: userID, ReportType: uif.TypeManual, AmountMinor: 600_000_000,
		Currency: "CRC", Reason: "caso de prueba",
	}
	if _, err := uif.NewRepository(pool).CreateReport(ctx, caso); err != nil {
		t.Fatalf("abrir el caso: %v", err)
	}

	revisar := func(quien, cuerpo string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/api/v1/admin/uif/reports/"+caso.ID+"/review", strings.NewReader(cuerpo))
		c := context.WithValue(r.Context(), middleware.UserIDKey, quien)
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("id", caso.ID)
		rec := httptest.NewRecorder()
		h.Review(rec, r.WithContext(context.WithValue(c, chi.RouteCtxKey, rctx)))
		return rec
	}

	for _, estado := range []string{uif.StatusDismissed, uif.StatusReviewed, uif.StatusSubmitted} {
		rec := revisar(userID, `{"status":"`+estado+`"}`)
		var sobre struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &sobre)
		if rec.Code != http.StatusForbidden || sobre.Error.Code != "ADMIN_IS_AFFECTED_PARTY" {
			t.Errorf("revisar su propio caso como %s: %d %s, se esperaba 403 ADMIN_IS_AFFECTED_PARTY",
				estado, rec.Code, rec.Body.String())
		}
	}

	var estado, revisor string
	if err := pool.QueryRow(ctx,
		`SELECT status, COALESCE(reviewer_id::text, '') FROM uif_reports WHERE id = $1::uuid`, caso.ID,
	).Scan(&estado, &revisor); err != nil {
		t.Fatalf("leer el caso: %v", err)
	}
	if estado != uif.StatusPending || revisor != "" {
		t.Fatalf("el caso quedo %s, revisado por %q: la persona reviso su propio caso", estado, revisor)
	}

	// Otro oficial si lo revisa.
	oficial := testutil.SeedTestUser2(t, pool)
	if rec := revisar(oficial, `{"status":"reviewed"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("otro oficial: %d %s", rec.Code, rec.Body.String())
	}
}
