package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/country"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
)

// El asistente contesto "2,475,319.20 colones (about $445.00 USD)" a "cual es mi
// saldo?": mezclo la cuenta en colones con la de dolares como si fueran
// equivalentes y no coincidia con el total del Inicio (2.677.887,65). Y a "cuanto
// gaste este mes?" contesto con una suma de los ultimos movimientos, cuando el
// Inicio decia 0,00. Estas pruebas fijan que cada cuenta llega con su moneda, que
// el total sale de la misma cuenta que el Inicio y que el gasto del mes es el del
// mes calendario, con los mismos movimientos que cuenta el Inicio.

// ── fakes ─────────────────────────────────────────────────────────────────────

type walletConSaldos struct{ crc, usd int64 }

func (w walletConSaldos) GetBalance(_ context.Context, _ string) (*wallet.BalanceResponse, error) {
	return &wallet.BalanceResponse{CRC: w.crc, USD: w.usd}, nil
}

type tasasFalsas struct {
	rates []country.ExchangeRate
	err   error
}

func (f *tasasFalsas) GetExchangeRates(_ context.Context) ([]country.ExchangeRate, error) {
	return f.rates, f.err
}

func tasa(de, a string, valor float64) country.ExchangeRate {
	return country.ExchangeRate{FromCurrency: de, ToCurrency: a, Rate: valor}
}

type resumenFalso struct {
	grupos []transaction.GrupoResumen
	err    error
	rangos []transaction.RangoResumen
}

func (f *resumenFalso) Resumen(_ context.Context, _ string, rango transaction.RangoResumen) (*transaction.Resumen, error) {
	f.rangos = append(f.rangos, rango)
	if f.err != nil {
		return nil, f.err
	}
	return &transaction.Resumen{From: rango.Desde, To: rango.Hasta, Groups: f.grupos}, nil
}

func grupo(tipo, moneda string, cuantos int, centimos int64) transaction.GrupoResumen {
	return transaction.GrupoResumen{Fecha: "2026-10-12", Type: tipo, Currency: moneda, Count: cuantos, Amount: centimos}
}

// ── get_balance ───────────────────────────────────────────────────────────────

func saldoDe(t *testing.T, w walletConSaldos, tasas ExchangeRateReader) map[string]any {
	t.Helper()
	tools := NewTools(w, &fakeTx{}, &fakeBudget{}, &fakeSaved{}, WithTipoDeCambio(tasas))
	out, _, err := tools.Invoke(context.Background(), "u1", "get_balance", nil)
	if err != nil {
		t.Fatalf("get_balance: %v", err)
	}
	return out.(map[string]any)
}

func cuentasDe(t *testing.T, m map[string]any) map[string]float64 {
	t.Helper()
	lista, ok := m["accounts"].([]map[string]any)
	if !ok {
		t.Fatalf("accounts no es una lista de cuentas: %#v", m["accounts"])
	}
	porMoneda := map[string]float64{}
	for _, c := range lista {
		moneda, _ := c["currency"].(string)
		saldo, _ := c["balance"].(float64)
		if moneda == "" {
			t.Fatalf("una cuenta sin moneda: %#v", c)
		}
		porMoneda[moneda] = saldo
	}
	return porMoneda
}

func casiIgual(a, b float64) bool { return math.Abs(a-b) < 0.005 }

func numero(t *testing.T, m map[string]any, clave string) float64 {
	t.Helper()
	v, ok := m[clave].(float64)
	if !ok {
		t.Fatalf("%s = %#v, quiero un numero", clave, m[clave])
	}
	return v
}

// Cada cuenta lleva su moneda dentro. Antes eran dos numeros sueltos, "crc" y
// "usd", y el modelo los leia como una sola cantidad.
func TestSaldo_CadaCuentaVaConSuMoneda(t *testing.T) {
	m := saldoDe(t, walletConSaldos{crc: 247_531_920, usd: 44_500}, &tasasFalsas{rates: []country.ExchangeRate{tasa("USD", "CRC", 455.21)}})

	cuentas := cuentasDe(t, m)
	if len(cuentas) != 2 || !casiIgual(cuentas["CRC"], 2_475_319.20) || !casiIgual(cuentas["USD"], 445) {
		t.Errorf("cuentas = %v", cuentas)
	}
	for _, suelta := range []string{"crc", "usd"} {
		if _, hay := m[suelta]; hay {
			t.Errorf("sobra la clave suelta %q: un numero sin moneda es lo que se confunde", suelta)
		}
	}
	if m["base_currency"] != "CRC" {
		t.Errorf("base_currency = %v", m["base_currency"])
	}
}

// Los numeros del caso real: 2.475.319,20 colones y 445,00 dolares con el
// dolar a 455,21 son 2.677.887,65 colones, que es lo que dice el Inicio.
func TestSaldo_ElTotalEsElDelInicio(t *testing.T) {
	m := saldoDe(t, walletConSaldos{crc: 247_531_920, usd: 44_500}, &tasasFalsas{rates: []country.ExchangeRate{tasa("USD", "CRC", 455.21)}})

	if got := numero(t, m, "total_in_base_currency"); !casiIgual(got, 2_677_887.65) {
		t.Errorf("total_in_base_currency = %v, el Inicio dice 2677887.65", got)
	}
	// El equivalente en dolares que muestra el Inicio debajo del total.
	if got := numero(t, m, "total_in_usd"); !casiIgual(got, 5_882.75) {
		t.Errorf("total_in_usd = %v, quiero 5882.75", got)
	}
	if got := numero(t, m, "usd_to_crc_rate"); !casiIgual(got, 455.21) {
		t.Errorf("usd_to_crc_rate = %v", got)
	}
}

// El dolar a cero no necesita tipo de cambio: el total en colones es la cuenta
// en colones. Es lo mismo que hace el Inicio, que no pide tasa para una cuenta
// vacia. En dolares si hace falta, porque los colones hay que convertirlos.
func TestSaldo_UnaCuentaEnCeroNoNecesitaTasa(t *testing.T) {
	m := saldoDe(t, walletConSaldos{crc: 1_500_000, usd: 0}, &tasasFalsas{err: errors.New("sin red")})

	if got := numero(t, m, "total_in_base_currency"); !casiIgual(got, 15_000) {
		t.Errorf("total_in_base_currency = %v, quiero 15000", got)
	}
	if m["total_in_usd"] != nil {
		t.Errorf("total_in_usd = %v: sin tasa no se puede llevar a dolares", m["total_in_usd"])
	}
}

func TestSaldo_SoloDolaresSeConvierteALaBase(t *testing.T) {
	m := saldoDe(t, walletConSaldos{crc: 0, usd: 10_000}, &tasasFalsas{rates: []country.ExchangeRate{tasa("USD", "CRC", 500)}})

	if got := numero(t, m, "total_in_base_currency"); !casiIgual(got, 50_000) {
		t.Errorf("total_in_base_currency = %v, quiero 50000", got)
	}
	if got := numero(t, m, "total_in_usd"); !casiIgual(got, 100) {
		t.Errorf("total_in_usd = %v, quiero 100", got)
	}
}

// Sin tasa no hay total: se entrega cada cuenta y se dice que falta. Contar la
// tasa como 1 es justo el error que se arreglo en el Inicio (colones como si
// fueran dolares, unas 455 veces de mas).
func TestSaldo_SinTasaNoSeAdivinaElTotal(t *testing.T) {
	casos := map[string]ExchangeRateReader{
		"la tabla no trae el par":   &tasasFalsas{rates: []country.ExchangeRate{tasa("EUR", "USD", 1.08)}},
		"la tasa es cero":           &tasasFalsas{rates: []country.ExchangeRate{tasa("USD", "CRC", 0)}},
		"la tasa es negativa":       &tasasFalsas{rates: []country.ExchangeRate{tasa("USD", "CRC", -455)}},
		"la consulta falla":         &tasasFalsas{err: errors.New("db caida")},
		"no hay fuente de tasas":    nil,
		"la tabla esta vacia":       &tasasFalsas{},
		"el reciproco no es valido": &tasasFalsas{rates: []country.ExchangeRate{tasa("CRC", "USD", 0)}},
	}
	for nombre, tasas := range casos {
		t.Run(nombre, func(t *testing.T) {
			m := saldoDe(t, walletConSaldos{crc: 1_500_000, usd: 5_000}, tasas)

			for _, clave := range []string{"total_in_base_currency", "total_in_usd", "usd_to_crc_rate"} {
				valor, hay := m[clave]
				if !hay {
					t.Errorf("falta la clave %s: tiene que estar y valer null", clave)
				} else if valor != nil {
					t.Errorf("%s = %v, sin tasa tiene que ser null", clave, valor)
				}
			}
			// Las cuentas siguen ahi, cada una con lo suyo.
			cuentas := cuentasDe(t, m)
			if !casiIgual(cuentas["CRC"], 15_000) || !casiIgual(cuentas["USD"], 50) {
				t.Errorf("cuentas = %v", cuentas)
			}
			if nota, _ := m["note"].(string); nota == "" {
				t.Error("sin la nota, el modelo no sabe por que no hay total")
			}
			// Y la respuesta viaja como JSON: el null tiene que llegar como null.
			crudo, err := json.Marshal(m)
			if err != nil {
				t.Fatalf("json: %v", err)
			}
			if !strings.Contains(string(crudo), `"total_in_base_currency":null`) {
				t.Errorf("el JSON no lleva el null explicito: %s", crudo)
			}
		})
	}
}

// La tasa se lee igual que el Inicio (services/fxRate.ts): la fila USD a CRC si
// es valida; si no, la inversa CRC a USD.
func TestSaldo_LaTasaSeLeeComoElInicio(t *testing.T) {
	casos := []struct {
		nombre string
		tasas  []country.ExchangeRate
		quiero float64
	}{
		{"la directa", []country.ExchangeRate{tasa("USD", "CRC", 455.21)}, 455.21},
		{"la inversa", []country.ExchangeRate{tasa("CRC", "USD", 0.002)}, 500},
		{"la directa gana a la inversa", []country.ExchangeRate{tasa("CRC", "USD", 0.002), tasa("USD", "CRC", 455.21)}, 455.21},
		{"una directa invalida cae a la inversa", []country.ExchangeRate{tasa("USD", "CRC", 0), tasa("CRC", "USD", 0.002)}, 500},
		{"entre otros pares", []country.ExchangeRate{tasa("EUR", "USD", 1.08), tasa("USD", "CRC", 455.21), tasa("USD", "MXN", 17)}, 455.21},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			m := saldoDe(t, walletConSaldos{crc: 0, usd: 10_000}, &tasasFalsas{rates: c.tasas})
			if got := numero(t, m, "usd_to_crc_rate"); !casiIgual(got, c.quiero) {
				t.Errorf("usd_to_crc_rate = %v, quiero %v", got, c.quiero)
			}
			if got := numero(t, m, "total_in_base_currency"); !casiIgual(got, 100*c.quiero) {
				t.Errorf("total_in_base_currency = %v, quiero %v", got, 100*c.quiero)
			}
		})
	}
}

// ── spending_by_period ────────────────────────────────────────────────────────

func gastoDe(t *testing.T, f *resumenFalso, ahora time.Time, args map[string]any) (map[string]any, error) {
	t.Helper()
	tools := NewTools(walletConSaldos{}, &fakeTx{}, &fakeBudget{}, &fakeSaved{},
		WithResumen(f), WithReloj(func() time.Time { return ahora }))
	out, _, err := tools.Invoke(context.Background(), "u1", "spending_by_period", args)
	if err != nil {
		return nil, err
	}
	return out.(map[string]any), nil
}

func filasDe(t *testing.T, m map[string]any) []map[string]any {
	t.Helper()
	filas, ok := m["by_currency"].([]map[string]any)
	if !ok {
		t.Fatalf("by_currency = %#v, quiero una lista", m["by_currency"])
	}
	return filas
}

// Una herramienta que no se puede atender no se ofrece: sin la fuente del
// resumen, el modelo no la ve ni puede invocarla.
func TestGastoPorPeriodo_SoloSeOfreceSiHayDeDondeSacarlo(t *testing.T) {
	sin := newTestTools(&fakeWallet{}, &fakeTx{})
	for _, d := range sin.Declarations() {
		if d.Name == "spending_by_period" {
			t.Fatal("se ofrece spending_by_period sin fuente del resumen")
		}
	}
	if _, _, err := sin.Invoke(context.Background(), "u1", "spending_by_period", nil); !errors.Is(err, ErrUnknownTool) {
		t.Errorf("sin fuente: err = %v, quiero ErrUnknownTool", err)
	}

	con := NewTools(&fakeWallet{}, &fakeTx{}, &fakeBudget{}, &fakeSaved{}, WithResumen(&resumenFalso{}))
	var encontrada bool
	for _, d := range con.Declarations() {
		if d.Name != "spending_by_period" {
			continue
		}
		encontrada = true
		props, _ := d.Parameters["properties"].(map[string]any)
		periodo, _ := props["period"].(map[string]any)
		if periodo == nil {
			t.Fatalf("spending_by_period sin parametro period: %#v", d.Parameters)
		}
		if enum, _ := periodo["enum"].([]any); len(enum) != 2 {
			t.Errorf("period.enum = %v, quiero this_month y last_month", periodo["enum"])
		}
	}
	if !encontrada {
		t.Error("con fuente del resumen no se ofrece spending_by_period")
	}
}

// "Este mes" es el mes calendario de Costa Rica: el reloj del servidor corre en
// UTC y a las 8 p. m. del 31 de octubre en Costa Rica ya es noviembre en UTC.
func TestGastoPorPeriodo_PideElMesCalendarioDeCostaRica(t *testing.T) {
	casos := []struct {
		nombre string
		ahora  time.Time
		args   map[string]any
		desde  string
		hasta  string // exclusivo, como lo pide el resumen
		hasta2 string // el ultimo dia, como se le dice al modelo
	}{
		{"sin parametros es este mes", time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC), nil, "2026-10-01", "2026-11-01", "2026-10-31"},
		{"this_month", time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC), map[string]any{"period": "this_month"}, "2026-10-01", "2026-11-01", "2026-10-31"},
		{"las 8 p. m. del ultimo dia", time.Date(2026, 11, 1, 2, 0, 0, 0, time.UTC), nil, "2026-10-01", "2026-11-01", "2026-10-31"},
		{"last_month", time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC), map[string]any{"period": "last_month"}, "2026-09-01", "2026-10-01", "2026-09-30"},
		{"last_month en enero", time.Date(2026, 1, 5, 15, 0, 0, 0, time.UTC), map[string]any{"period": "last_month"}, "2025-12-01", "2026-01-01", "2025-12-31"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			f := &resumenFalso{}
			m, err := gastoDe(t, f, c.ahora, c.args)
			if err != nil {
				t.Fatalf("spending_by_period: %v", err)
			}
			if len(f.rangos) != 1 || f.rangos[0].Desde != c.desde || f.rangos[0].Hasta != c.hasta {
				t.Errorf("rango pedido = %+v, quiero %s a %s", f.rangos, c.desde, c.hasta)
			}
			if m["from"] != c.desde || m["to"] != c.hasta2 {
				t.Errorf("from/to = %v / %v, quiero %s / %s", m["from"], m["to"], c.desde, c.hasta2)
			}
			if m["timezone"] != "America/Costa_Rica" {
				t.Errorf("timezone = %v", m["timezone"])
			}
		})
	}
}

func TestGastoPorPeriodo_UnPeriodoQueNoExisteEsInvalido(t *testing.T) {
	f := &resumenFalso{}
	_, err := gastoDe(t, f, time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC), map[string]any{"period": "next_week"})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("err = %v, quiero ErrInvalidRequest", err)
	}
	if len(f.rangos) != 0 {
		t.Error("un periodo invalido no tiene que llegar a la base")
	}
}

// Se cuenta lo mismo que la tarjeta "Gastado este mes" del Inicio: todo lo que
// no es ingreso, en la moneda en que se hizo, sin sumar monedas distintas.
func TestGastoPorPeriodo_CuentaLoMismoQueInicio(t *testing.T) {
	f := &resumenFalso{grupos: []transaction.GrupoResumen{
		grupo("sinpe_send", "CRC", 2, 300_000),
		grupo("qr_payment", "CRC", 1, 100_000),
		grupo("savings_deposit", "CRC", 1, 50_000), // el Inicio lo cuenta como gasto
		grupo("sinpe_receive", "CRC", 4, 999_000),  // ingreso: no cuenta
		grupo("loyalty_cashback", "CRC", 1, 5_000), // ingreso: no cuenta
		grupo("savings_withdraw", "CRC", 1, 7_000), // ingreso: no cuenta
		grupo("crypto_buy", "USD", 1, 2_500),
		grupo("deposit", "USD", 1, 80_000), // ingreso: no cuenta
	}}
	m, err := gastoDe(t, f, time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC), nil)
	if err != nil {
		t.Fatalf("spending_by_period: %v", err)
	}

	filas := filasDe(t, m)
	if len(filas) != 2 {
		t.Fatalf("by_currency = %v, quiero CRC y USD por separado", filas)
	}
	// La moneda base va primero.
	if filas[0]["currency"] != "CRC" || filas[1]["currency"] != "USD" {
		t.Errorf("orden de monedas = %v, %v", filas[0]["currency"], filas[1]["currency"])
	}
	if got := numero(t, filas[0], "spent"); !casiIgual(got, 4_500) { // 3000 + 1000 + 500
		t.Errorf("CRC spent = %v, quiero 4500", got)
	}
	if filas[0]["transactions"] != 4 {
		t.Errorf("CRC transactions = %v, quiero 4", filas[0]["transactions"])
	}
	if got := numero(t, filas[1], "spent"); !casiIgual(got, 25) {
		t.Errorf("USD spent = %v, quiero 25", got)
	}

	// El desglose por tipo no trae los ingresos.
	tipos, _ := filas[0]["by_type"].([]map[string]any)
	if len(tipos) != 3 {
		t.Fatalf("CRC by_type = %v, quiero 3 tipos de gasto", tipos)
	}
	for _, tp := range tipos {
		if transaction.EsIngresoEnPantalla(tp["type"].(string)) {
			t.Errorf("by_type trae el ingreso %v", tp["type"])
		}
	}

	// Ninguna cifra suelta que mezcle monedas.
	for _, clave := range []string{"spent", "total", "total_outgoing", "total_spent"} {
		if _, hay := m[clave]; hay {
			t.Errorf("hay una cifra suelta %q a nivel del periodo: mezcla monedas", clave)
		}
	}
}

// Un mes sin gastos dice cero en la moneda base, con todas las letras: el modelo
// no tiene que deducirlo de una lista vacia. Es la respuesta correcta cuando el
// Inicio dice 0,00.
func TestGastoPorPeriodo_UnMesSinGastosDiceCero(t *testing.T) {
	casos := map[string][]transaction.GrupoResumen{
		"sin movimientos":     nil,
		"solo ingresos":       {grupo("sinpe_receive", "CRC", 3, 1_500_000)},
		"ingresos en dolares": {grupo("deposit", "USD", 1, 10_000)},
	}
	for nombre, grupos := range casos {
		t.Run(nombre, func(t *testing.T) {
			m, err := gastoDe(t, &resumenFalso{grupos: grupos}, time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC), nil)
			if err != nil {
				t.Fatalf("spending_by_period: %v", err)
			}
			filas := filasDe(t, m)
			if len(filas) != 1 || filas[0]["currency"] != "CRC" {
				t.Fatalf("by_currency = %v, quiero una sola fila en CRC", filas)
			}
			if got := numero(t, filas[0], "spent"); got != 0 {
				t.Errorf("spent = %v, quiero 0", got)
			}
			if filas[0]["transactions"] != 0 {
				t.Errorf("transactions = %v, quiero 0", filas[0]["transactions"])
			}
		})
	}
}

// Si el resumen falla no se contesta cero: el cero es un dato, y el fallo no lo
// es. El servicio le pasa el error al modelo para que diga que no pudo.
func TestGastoPorPeriodo_UnFalloNoSeConvierteEnCero(t *testing.T) {
	_, err := gastoDe(t, &resumenFalso{err: errors.New("base caida")}, time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC), nil)
	if err == nil {
		t.Fatal("un resumen que falla tiene que devolver el error")
	}
}

// ── spending_summary (los ultimos N movimientos) ──────────────────────────────

// La suma de los ultimos movimientos mezclaba colones con dolares en un solo
// total. Se separa por moneda y la descripcion deja claro que no es un periodo.
func TestResumenReciente_NoMezclaMonedas(t *testing.T) {
	tx := &fakeTx{records: []transaction.TransactionRecord{
		{Type: "sinpe_send", Amount: 300_000, Currency: "CRC", Status: "completed"},
		{Type: "qr_payment", Amount: 100_000, Currency: "CRC", Status: "completed"},
		{Type: "crypto_buy", Amount: 2_500, Currency: "USD", Status: "completed"},
		{Type: "sinpe_receive", Amount: 999_000, Currency: "CRC", Status: "completed"}, // ingreso
		{Type: "qr_payment", Amount: 50_000, Currency: "CRC", Status: "pending"},       // no completado
	}}
	out, _, err := newTestTools(&fakeWallet{}, tx).Invoke(context.Background(), "u1", "spending_summary", nil)
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	m := out.(map[string]any)
	if _, hay := m["total_outgoing"]; hay {
		t.Error("sigue habiendo un total_outgoing unico que mezcla monedas")
	}
	filas, _ := m["by_currency"].([]map[string]any)
	totales := map[string]float64{}
	for _, f := range filas {
		moneda, _ := f["currency"].(string)
		totales[moneda], _ = f["total_outgoing"].(float64)
	}
	if len(totales) != 2 || !casiIgual(totales["CRC"], 4_000) || !casiIgual(totales["USD"], 25) {
		t.Errorf("totales por moneda = %v, quiero CRC 4000 y USD 25", totales)
	}
}

func TestResumenReciente_LaDescripcionDiceQueNoEsUnPeriodo(t *testing.T) {
	tools := NewTools(&fakeWallet{}, &fakeTx{}, &fakeBudget{}, &fakeSaved{}, WithResumen(&resumenFalso{}))
	for _, d := range tools.Declarations() {
		if d.Name != "spending_summary" {
			continue
		}
		if !strings.Contains(d.Description, "spending_by_period") {
			t.Errorf("la descripcion no manda al modelo a spending_by_period para un mes: %q", d.Description)
		}
		return
	}
	t.Fatal("no se declara spending_summary")
}

// ── la instruccion de sistema ─────────────────────────────────────────────────

func TestInstruccion_NoMezclaMonedasYUsaLaHerramientaDelMes(t *testing.T) {
	llm := &fakeLLM{}
	svc := NewService(llm, newTestTools(&fakeWallet{}, &fakeTx{}), nil, nil)
	if _, err := svc.Chat(context.Background(), "u1", &ChatRequest{Message: "hola"}); err != nil {
		t.Fatalf("chat: %v", err)
	}
	for _, regla := range []string{"different currencies", "spending_by_period", "total_in_base_currency"} {
		if !strings.Contains(llm.lastSystem, regla) {
			t.Errorf("la instruccion de sistema no trae %q", regla)
		}
	}
}
