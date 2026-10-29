package transparency_test

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/transparency"
	"github.com/kiramopay/backend/internal/wallet"
)

// La prueba de reservas publica tiene que decir la cifra EXACTA. Antes
// publicaba un porcentaje que la pantalla redondeaba a "100,0 %" y que escondia
// un faltante de 1.720,50 colones: el dato que importa no es el cociente sino
// la diferencia, en centimos, entre lo que hay y lo que se debe.

type filaPublica struct {
	Currency             string  `json:"currency"`
	UserLiabilitiesMinor int64   `json:"user_liabilities_minor"`
	ReserveBalanceMinor  int64   `json:"reserve_balance_minor"`
	DifferenceMinor      *int64  `json:"difference_minor"`
	FullyBacked          *bool   `json:"fully_backed"`
	RatioPct             float64 `json:"ratio_pct"`
}

func consultar(t *testing.T, h *transparency.Handler) map[string]filaPublica {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ProofOfReserves(rec, httptest.NewRequest(http.MethodGet, "/api/v1/transparency/proof-of-reserves", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("estado = %d: %s", rec.Code, rec.Body.String())
	}
	var cuerpo struct {
		Data struct {
			Currencies []filaPublica `json:"currencies"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &cuerpo); err != nil {
		t.Fatalf("la respuesta no es JSON: %v: %s", err, rec.Body.String())
	}
	porMoneda := map[string]filaPublica{}
	for _, f := range cuerpo.Data.Currencies {
		porMoneda[f.Currency] = f
	}
	return porMoneda
}

func montar(t *testing.T) (*transparency.Handler, *transaction.Service, *ledger.Engine, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	eng := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	tx := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), eng, nil)
	user := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	return transparency.NewHandler(pool), tx, eng, user
}

// Despues de una salida al exterior la cifra publicada sigue siendo exacta: la
// reserva baja lo mismo que el pasivo, y la respuesta lo dice con la diferencia
// en centimos (cero) y una marca de cobertura total.
func TestPruebaDeReservas_TrasUnRetiroEsExacta(t *testing.T) {
	h, tx, _, user := montar(t)

	if _, err := tx.CreateTransaction(context.Background(), user, &transaction.CreateTransactionRequest{
		Type: transaction.TypeWithdrawal, Amount: 10_000, Currency: "CRC", Internal: true,
		IdempotencyKey: "pub:retiro",
	}); err != nil {
		t.Fatalf("retiro: %v", err)
	}

	crc, hay := consultar(t, h)["CRC"]
	if !hay {
		t.Fatal("la respuesta no trae colones")
	}
	if crc.ReserveBalanceMinor != crc.UserLiabilitiesMinor {
		t.Fatalf("reserva %d, pasivo %d: la cifra publicada no es exacta",
			crc.ReserveBalanceMinor, crc.UserLiabilitiesMinor)
	}
	if crc.DifferenceMinor == nil || *crc.DifferenceMinor != 0 {
		t.Fatalf("difference_minor = %v, se esperaba 0", crc.DifferenceMinor)
	}
	if crc.FullyBacked == nil || !*crc.FullyBacked {
		t.Fatalf("fully_backed = %v, se esperaba true", crc.FullyBacked)
	}
}

// Un faltante chico se muestra tal cual. 1.720,50 colones sobre un pasivo de
// millones es el 99,93 %: a un decimal se lee "99,9" y con un pasivo mayor se
// lee "100,0". La respuesta trae la diferencia exacta, en centimos y con signo
// (negativa si falta), y NUNCA marca cobertura total si falta un centimo.
func TestPruebaDeReservas_UnFaltanteSeMuestraExacto(t *testing.T) {
	h, _, eng, user := montar(t)

	// Se acredita plata a una persona sin que la reserva la respalde: el
	// pasivo sube 1.720,50 colones y la reserva se queda igual.
	if _, err := eng.Post(context.Background(), &ledger.Posting{
		Description: "TEST_FALTANTE",
		CreatedBy:   user,
		Entries: []ledger.Entry{
			{Account: ledger.Account{SystemCode: ledger.SystemSuspenseCRC}, Side: ledger.Debit, AmountMinor: 172_050, Currency: "CRC"},
			{Account: ledger.Account{UserID: user}, Side: ledger.Credit, AmountMinor: 172_050, Currency: "CRC"},
		},
	}); err != nil {
		t.Fatalf("crear el faltante: %v", err)
	}

	crc := consultar(t, h)["CRC"]
	if crc.UserLiabilitiesMinor-crc.ReserveBalanceMinor != 172_050 {
		t.Fatalf("pasivo %d menos reserva %d, se esperaba un faltante de 172050",
			crc.UserLiabilitiesMinor, crc.ReserveBalanceMinor)
	}
	if crc.DifferenceMinor == nil || *crc.DifferenceMinor != -172_050 {
		t.Fatalf("difference_minor = %v, se esperaba -172050", crc.DifferenceMinor)
	}
	if crc.FullyBacked == nil || *crc.FullyBacked {
		t.Fatalf("fully_backed = %v, con un faltante tiene que ser false", crc.FullyBacked)
	}
	if crc.RatioPct >= 100 {
		t.Fatalf("ratio_pct = %v, con un faltante tiene que quedar por debajo de 100", crc.RatioPct)
	}
}
