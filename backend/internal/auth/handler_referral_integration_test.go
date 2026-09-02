package auth_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
)

// postRegister manda un registro completo y valido salvo por el codigo de
// invitacion dado, y devuelve el codigo de error de la respuesta (si lo hay).
func postRegister(t *testing.T, h *auth.Handler, referralCode string) (int, string) {
	t.Helper()
	body := `{"cedula":"702650930","phone":"+50688881234","first_name":"Keilor","last_name":"Martinez",` +
		`"password":"Kiramopay2024!","referral_code":"` + referralCode + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.Register(rec, req)

	var resp struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("la respuesta no es JSON (%d): %s", rec.Code, rec.Body.String())
	}
	return rec.Code, resp.Error.Code
}

// Un codigo de invitacion mal formado se rechaza en el handler con 400
// REFERRAL_CODE_INVALID antes de tocar el servicio: el cliente lo distingue
// del 409 generico del registro y deja corregirlo o borrarlo.
func TestRegisterHandler_ReferralCodeFormatoInvalido(t *testing.T) {
	svc, _ := setupAuthService(t)
	h := auth.NewHandler(svc, auth.CookieConfig{Secure: true}, false)

	status, code := postRegister(t, h, "abc")
	if status != http.StatusBadRequest {
		t.Fatalf("register returned %d, want 400", status)
	}
	if code != "REFERRAL_CODE_INVALID" {
		t.Fatalf("error.code = %q, want REFERRAL_CODE_INVALID", code)
	}
}

// Un codigo con buena forma pero sin cuenta activa detras llega al servicio y
// vuelve con el MISMO 400 (mapeo de auth.ErrReferralCodeInvalid); nada se crea.
func TestRegisterHandler_ReferralCodeInexistente(t *testing.T) {
	svc, _ := setupAuthService(t)
	pool := testutil.TestDB(t)
	h := auth.NewHandler(svc, auth.CookieConfig{Secure: true}, false)

	status, code := postRegister(t, h, "ZZZZZZ22")
	if status != http.StatusBadRequest {
		t.Fatalf("register returned %d, want 400", status)
	}
	if code != "REFERRAL_CODE_INVALID" {
		t.Fatalf("error.code = %q, want REFERRAL_CODE_INVALID", code)
	}
	if u, _ := user.NewRepository(pool).FindByCedula(context.Background(), "702650930"); u != nil {
		t.Fatal("un codigo inexistente no debia dejar la cuenta creada")
	}
}
