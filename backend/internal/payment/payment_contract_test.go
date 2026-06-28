package payment_test

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/routers"
	"github.com/kiramopay/backend/internal/contract"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/payment"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

func setupPaymentHandler(t *testing.T) (*payment.Handler, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l, nil)
	svc := payment.NewService(payment.NewRepository(pool), txSvc)

	pinHash, _ := hash.HashPin("Kiramopay2024!")
	user := testutil.SeedTestUser(t, pool, "702650930", pinHash)

	// PayBill resolves an active provider by code.
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO service_providers (code, name, category, is_active)
		 VALUES ('ICE', 'ICE', 'electricity', true) ON CONFLICT (code) DO NOTHING`); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	return payment.NewHandler(svc), user
}

func contractRouter(t *testing.T) routers.Router {
	t.Helper()
	doc, err := contract.LoadSpec("../../docs/openapi.yaml")
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	router, err := contract.NewRouter(doc)
	if err != nil {
		t.Fatalf("router: %v", err)
	}
	return router
}

// drive posts body to handler as user and returns the unwrapped {success, data}.
func drive(t *testing.T, handler http.HandlerFunc, url, body, user string) interface{} {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, url, strings.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, user))
	rec := httptest.NewRecorder()
	handler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("handler returned %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var env struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if !env.Success {
		t.Fatalf("expected success envelope, got: %s", rec.Body.String())
	}
	var data interface{}
	if err := json.Unmarshal(env.Data, &data); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	return data
}

// TestPayBillResponseContract drives a real bill payment through the handler and
// asserts its `data` conforms to the PayBillResponse schema in openapi.yaml.
func TestPayBillResponseContract(t *testing.T) {
	h, user := setupPaymentHandler(t)
	router := contractRouter(t)

	const url = "http://localhost:8080/api/v1/services/pay-bill"
	body := `{"provider_code":"ICE","client_id":"123456","amount":2500000}`
	data := drive(t, h.PayBill, url, body, user)

	if err := contract.ValidateData(router, http.MethodPost, url, http.StatusOK, data); err != nil {
		t.Errorf("pay-bill response violates the PayBillResponse schema: %v", err)
	}
}

// TestRechargeResponseContract drives a real phone recharge through the handler
// and asserts its `data` conforms to the RechargeResponse schema in openapi.yaml.
func TestRechargeResponseContract(t *testing.T) {
	h, user := setupPaymentHandler(t)
	router := contractRouter(t)

	const url = "http://localhost:8080/api/v1/services/recharge"
	body := `{"operator":"kolbi","phone":"+50688887777","amount":500000}`
	data := drive(t, h.Recharge, url, body, user)

	if err := contract.ValidateData(router, http.MethodPost, url, http.StatusOK, data); err != nil {
		t.Errorf("recharge response violates the RechargeResponse schema: %v", err)
	}
}
