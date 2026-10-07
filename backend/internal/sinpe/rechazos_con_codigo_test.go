package sinpe_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/sinpe"
)

// Cada rechazo del envio sale con su propio codigo, para que la pantalla lo
// diga en el idioma de la persona. Salian como 400 SINPE_FAILED con el texto
// del error tal cual ("create transaction: insufficient balance"), y la
// pantalla mostraba esa frase en ingles.

type errorDelHandler struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func rechazoDelEnvio(t *testing.T, svc *sinpe.Service, userID string, monto int64, llave string) (int, errorDelHandler) {
	t.Helper()
	cuerpo := fmt.Sprintf(`{"phone":%q,"amount":%d,"idempotency_key":%q}`, destinoSinpe, monto, llave)
	rec := enviarPorElHandler(t, sinpe.NewHandler(svc), userID, cuerpo)
	var env errorDelHandler
	if rec.Code != http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode %d: %v: %s", rec.Code, err, rec.Body.String())
		}
	}
	return rec.Code, env
}

// topeDiarioBajo deja el tope diario de la billetera por debajo de montoSinpe,
// con el cupo SINPE y el saldo de sobra: el rechazo es el del tope.
func topeDiarioBajo(t *testing.T, pool *pgxpool.Pool, userID string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE wallets SET daily_limit = $2 WHERE user_id = $1::uuid`, userID, montoSinpe/2); err != nil {
		t.Fatalf("bajar el tope diario: %v", err)
	}
}

func TestHandlerSend_CadaRechazoSaleConSuCodigo(t *testing.T) {
	casos := []struct {
		nombre   string
		preparar func(*testing.T, *pgxpool.Pool, string)
		monto    int64
		codigo   string
	}{
		{"sin saldo", vaciarBilletera, montoSinpe, "INSUFFICIENT_BALANCE"},
		{"sobre el maximo por envio", nil, sinpe.MaxSinglePaymentCRC + 1, "SINGLE_PAYMENT_LIMIT_EXCEEDED"},
		{"sin cupo SINPE del dia", llenarCupoDelDia, montoSinpe, "SINPE_DAILY_LIMIT_EXCEEDED"},
		{"sobre el tope diario de la billetera", topeDiarioBajo, montoSinpe, "DAILY_LIMIT_EXCEEDED"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			svc, emisor, _, pool := sinpeConAvisos(t, nil)
			if c.preparar != nil {
				c.preparar(t, pool, emisor)
			}
			estado, env := rechazoDelEnvio(t, svc, emisor, c.monto, "rechazo:"+c.codigo)
			if estado != http.StatusUnprocessableEntity || env.Error.Code != c.codigo {
				t.Fatalf("= %d %q (%q), se esperaba 422 %s", estado, env.Error.Code, env.Error.Message, c.codigo)
			}
			// El texto es el del rechazo, sin los prefijos internos con que
			// el error sube por las capas.
			if strings.Contains(env.Error.Message, ":") {
				t.Fatalf("el texto lleva los prefijos internos: %q", env.Error.Message)
			}
		})
	}
}
