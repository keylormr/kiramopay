package capital_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/capital"
)

// El capital propio de KiramoPay puede quedar en negativo: la compra y la venta
// de cripto mueven plata entre la reserva y el capital, las comisiones entran al
// capital y las promociones salen de el, y el capital no tiene piso (decision del
// dueno: "Permitir y avisar"). Las operaciones siguen funcionando; lo que se
// pide es que el panel de administracion diga cuanto falta, por moneda, para
// saber cuanto habria que depositar con dinero real.
//
// Estas pruebas no necesitan base de datos: el handler recibe un lector. El SQL
// contra el libro se prueba en capital_integration_test.go.

// lectorFalso devuelve lo que se le diga.
type lectorFalso struct {
	saldos []capital.Saldo
	err    error
}

func (l lectorFalso) SaldosDelCapital(context.Context) ([]capital.Saldo, error) {
	return l.saldos, l.err
}

type monedaJSON struct {
	Currency       string `json:"currency"`
	BalanceMinor   int64  `json:"balance_minor"`
	ShortfallMinor int64  `json:"shortfall_minor"`
	Negative       bool   `json:"negative"`
}

type sobreJSON struct {
	Success bool `json:"success"`
	Data    struct {
		Currencies []monedaJSON `json:"currencies"`
		AsOf       string       `json:"as_of"`
	} `json:"data"`
	Error struct {
		Code string `json:"code"`
	} `json:"error"`
}

func pedir(t *testing.T, h *capital.Handler) (int, sobreJSON, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/capital", nil)
	rec := httptest.NewRecorder()
	h.Saldos(rec, req)
	var sobre sobreJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("respuesta ilegible: %v: %s", err, rec.Body.String())
	}
	return rec.Code, sobre, rec.Body.String()
}

func TestSaldos_ElFaltanteEsLoQueFaltaParaLlegarACero(t *testing.T) {
	casos := []struct {
		nombre   string
		saldo    int64
		faltante int64
		negativo bool
	}{
		{"negativo, el caso real de produccion (colones)", -19_670, 19_670, true},
		{"un centimo en contra", -1, 1, true},
		{"justo en cero", 0, 0, false},
		{"positivo", 500_000, 0, false},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			h := capital.NewHandler(lectorFalso{saldos: []capital.Saldo{{Moneda: "CRC", SaldoMinor: c.saldo}}})
			estado, sobre, _ := pedir(t, h)
			if estado != http.StatusOK || !sobre.Success || len(sobre.Data.Currencies) != 1 {
				t.Fatalf("respuesta = %d %+v", estado, sobre)
			}
			m := sobre.Data.Currencies[0]
			if m.Currency != "CRC" || m.BalanceMinor != c.saldo || m.ShortfallMinor != c.faltante || m.Negative != c.negativo {
				t.Fatalf("moneda = %+v, se esperaba saldo %d, faltante %d, negativo %v", m, c.saldo, c.faltante, c.negativo)
			}
		})
	}
}

// Cada moneda lleva su propio saldo: el faltante de una no se compensa con lo
// que sobra en la otra.
func TestSaldos_CadaMonedaVaPorSuLado(t *testing.T) {
	h := capital.NewHandler(lectorFalso{saldos: []capital.Saldo{
		{Moneda: "CRC", SaldoMinor: -19_670},
		{Moneda: "USD", SaldoMinor: 90_000},
	}})
	_, sobre, _ := pedir(t, h)
	if len(sobre.Data.Currencies) != 2 {
		t.Fatalf("monedas = %+v", sobre.Data.Currencies)
	}
	crc, usd := sobre.Data.Currencies[0], sobre.Data.Currencies[1]
	if !crc.Negative || crc.ShortfallMinor != 19_670 {
		t.Errorf("CRC = %+v, se esperaba negativo con faltante 19670", crc)
	}
	if usd.Negative || usd.ShortfallMinor != 0 || usd.BalanceMinor != 90_000 {
		t.Errorf("USD = %+v, se esperaba positivo y sin faltante", usd)
	}
}

// Un saldo que no se pudo leer NO es un saldo en cero: el panel tiene que poder
// decir "no cargo". Un 503 sin monedas, y sin el detalle del fallo.
func TestSaldos_UnaLecturaQueFallaNoDevuelveCeros(t *testing.T) {
	h := capital.NewHandler(lectorFalso{err: errors.New("pq: relation secreta no existe")})
	estado, sobre, cuerpo := pedir(t, h)

	if estado != http.StatusServiceUnavailable || sobre.Success || sobre.Error.Code != "CAPITAL_UNAVAILABLE" {
		t.Fatalf("respuesta = %d %q, se esperaba 503 CAPITAL_UNAVAILABLE", estado, sobre.Error.Code)
	}
	if len(sobre.Data.Currencies) != 0 || strings.Contains(cuerpo, "currencies") {
		t.Fatalf("un fallo no puede traer monedas (un cero seria una afirmacion): %s", cuerpo)
	}
	if strings.Contains(cuerpo, "secreta") {
		t.Fatalf("el fallo filtro el detalle interno: %s", cuerpo)
	}
}

// Sin cuentas de capital la lista sale vacia, nunca `null`: la pantalla la
// recorre.
func TestSaldos_SinCuentasLaListaSaleVacia(t *testing.T) {
	h := capital.NewHandler(lectorFalso{})
	estado, _, cuerpo := pedir(t, h)
	if estado != http.StatusOK || !strings.Contains(cuerpo, `"currencies":[]`) {
		t.Fatalf("respuesta = %d %s, se esperaba 200 con currencies []", estado, cuerpo)
	}
}

func TestSaldos_DiceDeCuandoEsElDato(t *testing.T) {
	h := capital.NewHandler(lectorFalso{saldos: []capital.Saldo{{Moneda: "CRC"}}})
	_, sobre, _ := pedir(t, h)
	if sobre.Data.AsOf == "" || sobre.Data.AsOf == "now" {
		t.Fatalf("as_of = %q, se esperaba una fecha", sobre.Data.AsOf)
	}
}
