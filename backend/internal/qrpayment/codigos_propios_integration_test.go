package qrpayment_test

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

// segundoFactorDePrueba exige el segundo factor en cualquier monto; `verificado`
// decide si la persona ya lo verifico.
type segundoFactorDePrueba struct {
	verificado *bool
}

func (s segundoFactorDePrueba) IsMFARequired(int64, string) bool { return true }

func (s segundoFactorDePrueba) HasVerifiedMFA(context.Context, string, string) (bool, error) {
	return *s.verificado, nil
}

// peticion arma lo que el router y el middleware real le dan al handler: el
// usuario autenticado y, si hace falta, el {id} de la ruta.
func peticion(method, url, cuerpo, userID, id string) *http.Request {
	r := httptest.NewRequest(method, url, strings.NewReader(cuerpo))
	ctx := context.WithValue(r.Context(), middleware.UserIDKey, userID)
	if id != "" {
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("id", id)
		ctx = context.WithValue(ctx, chi.RouteCtxKey, rctx)
	}
	return r.WithContext(ctx)
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

// Pagar por QR por encima del umbral del segundo factor era imposible: 400
// PAYMENT_FAILED con "qr payment transfer: mfa challenge required" y ninguna
// forma de verificar. Ahora responde lo mismo que SINPE, no mueve dinero, y la
// MISMA peticion pasa despues de verificar.
func TestScanAndPay_SegundoFactorResponde428YElReintentoPaga(t *testing.T) {
	pool := testutil.TestDB(t)
	verificado := false
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l,
		&transaction.Options{MFA: segundoFactorDePrueba{verificado: &verificado}})
	svc := qrpayment.NewService(qrpayment.NewRepository(pool), txSvc, user.NewRepository(pool), nil)
	pinHash, _ := hash.HashPin("Kiramopay2024!")
	payer := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	owner := testutil.SeedTestUser2(t, pool)

	const monto int64 = 100_000
	qr := verifiedMerchantQR(t, svc, owner, monto)
	h := qrpayment.NewHandler(svc)
	cuerpo := `{"qr_data":"` + qr.QRData + `","currency":"CRC"}`
	saldo0 := walletCRC(t, pool, payer)

	rec := httptest.NewRecorder()
	h.ScanAndPay(rec, peticion(http.MethodPost, "/api/v1/qr/pay", cuerpo, payer, ""))
	if rec.Code != http.StatusPreconditionRequired || codigoDeError(t, rec) != "MFA_REQUIRED" {
		t.Fatalf("sin segundo factor: %d %s, se esperaba 428 MFA_REQUIRED", rec.Code, rec.Body.String())
	}
	if got := walletCRC(t, pool, payer); got != saldo0 {
		t.Fatalf("se movio dinero sin segundo factor: %d -> %d", saldo0, got)
	}

	verificado = true
	rec = httptest.NewRecorder()
	h.ScanAndPay(rec, peticion(http.MethodPost, "/api/v1/qr/pay", cuerpo, payer, ""))
	if rec.Code != http.StatusCreated {
		t.Fatalf("reintento tras verificar: %d %s, se esperaba 201", rec.Code, rec.Body.String())
	}
	if got := walletCRC(t, pool, payer); got != saldo0-monto {
		t.Fatalf("saldo tras pagar = %d, se esperaba %d", got, saldo0-monto)
	}
}

// Un cobro con monto cero o negativo respondia "amount must be positive" en
// ingles, bajo el PAYMENT_FAILED generico.
func TestCreateCharge_MontoNoPositivoTieneCodigoPropio(t *testing.T) {
	svc, _, _, owner := setupQR(t)
	ctx := context.Background()
	codigo, err := svc.GetOrCreateMyCode(ctx, owner, "CRC")
	if err != nil {
		t.Fatalf("codigo permanente: %v", err)
	}

	for _, monto := range []int64{0, -500} {
		if _, err := svc.CreateCharge(ctx, owner, &qrpayment.CreateChargeRequest{
			QRCodeID: codigo.ID, Amount: monto,
		}); !errors.Is(err, qrpayment.ErrMontoInvalido) {
			t.Fatalf("monto %d: err = %v, se esperaba ErrMontoInvalido", monto, err)
		}
	}

	h := qrpayment.NewHandler(svc)
	rec := httptest.NewRecorder()
	h.CreateCharge(rec, peticion(http.MethodPost, "/api/v1/qr/charges",
		`{"qr_code_id":"`+codigo.ID+`","amount":0}`, owner, ""))
	if rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "MONTO_INVALIDO" {
		t.Fatalf("POST /qr/charges con monto 0: %d %s, se esperaba 400 MONTO_INVALIDO", rec.Code, rec.Body.String())
	}
}

// Sumar al equipo una cedula sin cuenta mostraba "no KiramoPay user with that
// cedula" en ingles, con el mismo ADD_STAFF_FAILED que un rol invalido.
func TestAddStaff_CedulaSinCuentaTieneCodigoPropio(t *testing.T) {
	svc, _, _, owner := setupQR(t)
	ctx := context.Background()
	qr := verifiedMerchantQR(t, svc, owner, 1000)

	if _, err := svc.AddStaff(ctx, qr.MerchantID, owner, &qrpayment.AddStaffRequest{
		Cedula: "999999999", Role: "cashier",
	}); !errors.Is(err, qrpayment.ErrCedulaSinCuenta) {
		t.Fatalf("cedula sin cuenta: err = %v, se esperaba ErrCedulaSinCuenta", err)
	}

	h := qrpayment.NewHandler(svc)
	url := "/api/v1/qr/merchants/" + qr.MerchantID + "/staff"
	rec := httptest.NewRecorder()
	h.AddStaff(rec, peticion(http.MethodPost, url, `{"cedula":"999999999","role":"cashier"}`, owner, qr.MerchantID))
	if rec.Code != http.StatusUnprocessableEntity || codigoDeError(t, rec) != "STAFF_CEDULA_NOT_FOUND" {
		t.Fatalf("cedula sin cuenta: %d %s, se esperaba 422 STAFF_CEDULA_NOT_FOUND", rec.Code, rec.Body.String())
	}

	// Un rol invalido conserva el codigo de siempre.
	rec = httptest.NewRecorder()
	h.AddStaff(rec, peticion(http.MethodPost, url, `{"cedula":"999999999","role":"boss"}`, owner, qr.MerchantID))
	if rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "ADD_STAFF_FAILED" {
		t.Fatalf("rol invalido: %d %s, se esperaba 400 ADD_STAFF_FAILED", rec.Code, rec.Body.String())
	}
}
