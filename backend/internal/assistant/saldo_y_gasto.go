package assistant

import (
	"context"
	"math"
	"sort"
	"time"

	"github.com/kiramopay/backend/internal/country"
	"github.com/kiramopay/backend/internal/transaction"
)

// monedaBase es la moneda en que el Inicio expresa el total. Hoy es siempre
// colones: el servidor no guarda una moneda base por persona, y el front arranca
// en CRC y solo la cambia si la cuenta base deja de existir.
const monedaBase = "CRC"

// Periodos que acepta spending_by_period.
const (
	PeriodThisMonth = "this_month"
	PeriodLastMonth = "last_month"
)

// ── saldo ─────────────────────────────────────────────────────────────────────

// getBalance entrega cada cuenta con su moneda y, aparte, el total llevado a la
// moneda base con el mismo calculo del Inicio (src/utils/saldoTotal.ts).
//
// Antes devolvia {"crc": 15000, "usd": 50}: dos numeros sueltos que el modelo
// leia como uno solo y a veces sumaba o igualaba ("2,475,319.20 colones (about
// $445.00 USD)"), sin coincidir con el total que la persona ve en pantalla. Un
// total que no se puede calcular va como null y con la razon en la nota: no se
// adivina un tipo de cambio.
func (t *Tools) getBalance(ctx context.Context, userID string) (any, error) {
	if t.wallet == nil {
		return nil, ErrUnknownTool
	}
	b, err := t.wallet.GetBalance(ctx, userID)
	if err != nil {
		return nil, err
	}

	tasa, hayTasa := t.usdAColones(ctx)
	enBase, enUsd := totalesDeSaldo(b.CRC, b.USD, tasa, hayTasa)

	res := map[string]any{
		"accounts": []map[string]any{
			{"currency": "CRC", "balance": minorToMajor(b.CRC), "is_base_currency": true},
			{"currency": "USD", "balance": minorToMajor(b.USD)},
		},
		"base_currency":          monedaBase,
		"total_in_base_currency": nuloSiNo(enBase),
		"total_in_usd":           nuloSiNo(enUsd),
		"usd_to_crc_rate":        nil,
	}
	if hayTasa {
		res["usd_to_crc_rate"] = tasa
	}

	nota := "Each account is in its own currency: CRC is colones and USD is US dollars. Never add the accounts together " +
		"or present one as the equivalent of the other. For a combined figure quote total_in_base_currency (in colones) " +
		"or total_in_usd, which are the same totals the Home screen shows."
	if enBase == nil || enUsd == nil {
		nota += " One or both combined totals are null because the USD/CRC exchange rate is not available right now: " +
			"give each account separately with its currency, and say the combined total cannot be calculated at the moment."
	}
	res["note"] = nota
	return res, nil
}

// nuloSiNo pasa un total opcional a un valor que viaja como null cuando falta.
func nuloSiNo(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}

// usdAColones lee del servicio de tipos de cambio cuantos colones vale un
// dolar. false: no hay un valor que se pueda usar.
func (t *Tools) usdAColones(ctx context.Context) (float64, bool) {
	if t.tasas == nil {
		return 0, false
	}
	rates, err := t.tasas.GetExchangeRates(ctx)
	if err != nil {
		return 0, false
	}
	return usdAColonesDe(rates)
}

// usdAColonesDe elige la tasa como lo hace el front (services/fxRate.ts): la fila
// USD a CRC si es valida; si no, la inversa, CRC a USD, invertida.
func usdAColonesDe(rates []country.ExchangeRate) (float64, bool) {
	valida := func(r float64) bool { return r > 0 && !math.IsInf(r, 0) && !math.IsNaN(r) }
	for _, r := range rates {
		if r.FromCurrency == "USD" && r.ToCurrency == "CRC" {
			if valida(r.Rate) {
				return r.Rate, true
			}
			break
		}
	}
	for _, r := range rates {
		if r.FromCurrency == "CRC" && r.ToCurrency == "USD" {
			if valida(r.Rate) && valida(1/r.Rate) {
				return 1 / r.Rate, true
			}
			break
		}
	}
	return 0, false
}

// totalesDeSaldo lleva las dos cuentas a colones y a dolares, como saldoTotal.ts:
// una cuenta en cero no aporta nada y por eso no necesita tasa; una con saldo y
// sin tasa deja el total en nil. La moneda base no se convierte.
func totalesDeSaldo(crcMinor, usdMinor int64, usdAColones float64, hayTasa bool) (enBase, enUsd *float64) {
	crc, usd := minorToMajor(crcMinor), minorToMajor(usdMinor)

	if usdMinor == 0 {
		enBase = ptr(redondear(crc))
	} else if hayTasa {
		enBase = ptr(redondear(crc + usd*usdAColones))
	}

	if crcMinor == 0 {
		enUsd = ptr(redondear(usd))
	} else if hayTasa {
		enUsd = ptr(redondear(usd + crc/usdAColones))
	}
	return enBase, enUsd
}

func ptr(v float64) *float64 { return &v }

// redondear deja un monto en dos decimales, como se muestra.
func redondear(v float64) float64 { return math.Round(v*100) / 100 }

// ── gasto ─────────────────────────────────────────────────────────────────────

// ahora es el reloj de las herramientas.
func (t *Tools) ahora() time.Time {
	if t.now == nil {
		return time.Now()
	}
	return t.now()
}

// descripcionDeResumenReciente es lo que el modelo lee para decidir entre este
// resumen y el del mes. Si la herramienta del mes no se ofrece, no se nombra.
func (t *Tools) descripcionDeResumenReciente() string {
	d := "Summarize the user's outgoing spending over the last N transactions, totalled by currency and by transaction type. " +
		"It covers only the most recent movements, NOT a calendar period"
	if t.resumen != nil {
		d += "; for spending in a month use spending_by_period"
	}
	return d + "."
}

// spendingByPeriod contesta "cuanto gaste este mes?": el mes calendario de Costa
// Rica, con los movimientos completados que el Inicio cuenta como gasto (todo lo
// que no es ingreso), cada moneda por separado.
//
// Antes la pregunta caia en spending_summary, que sumaba los ultimos N
// movimientos sin importar la fecha: con 38 movimientos el "mes" eran todos
// ellos y el Inicio decia 0,00.
func (t *Tools) spendingByPeriod(ctx context.Context, userID string, args map[string]any) (any, error) {
	if t.resumen == nil {
		return nil, ErrUnknownTool
	}
	periodo := argString(args, "period")
	var mesesAtras int
	switch periodo {
	case "", PeriodThisMonth:
		periodo = PeriodThisMonth
	case PeriodLastMonth:
		mesesAtras = 1
	default:
		return nil, ErrInvalidRequest
	}

	rango, err := transaction.RangoDelMes(t.ahora(), mesesAtras)
	if err != nil {
		return nil, err
	}
	resumen, err := t.resumen.Resumen(ctx, userID, rango)
	if err != nil {
		return nil, err
	}

	gastos := newGastoPorMoneda()
	for _, g := range resumen.Groups {
		if transaction.EsIngresoEnPantalla(g.Type) {
			continue
		}
		gastos.sumar(g.Currency, g.Type, g.Count, g.Amount)
	}

	filas := make([]map[string]any, 0, 2)
	for _, f := range gastos.filas() {
		filas = append(filas, map[string]any{
			"currency":     f.moneda,
			"spent":        minorToMajor(f.centimos),
			"transactions": f.cuenta,
			"by_type":      porTipoEnMapas(f.porTipo),
		})
	}

	// "to" se le dice al modelo como el ultimo dia del mes; el resumen lo pide
	// exclusivo.
	ultimoDia := rango.Hasta
	if h, perr := time.Parse(time.DateOnly, rango.Hasta); perr == nil {
		ultimoDia = h.AddDate(0, 0, -1).Format(time.DateOnly)
	}
	return map[string]any{
		"period":        periodo,
		"from":          rango.Desde,
		"to":            ultimoDia,
		"timezone":      transaction.ZonaResumen,
		"base_currency": monedaBase,
		"by_currency":   filas,
		"note": "Counts completed movements only; every movement that is not an incoming one (receipts, deposits, refunds) " +
			"counts as spending, the same as \"Spent this month\" on the Home screen. Each currency is separate: never add them " +
			"together. The colones figure is the one Home shows. A spent value of 0 means nothing was spent in that period.",
	}, nil
}

// gastoPorMoneda acumula gasto en centimos por moneda y, dentro de cada una, por
// tipo de movimiento.
type gastoPorMoneda struct {
	monedas map[string]*gastoDeMoneda
}

type gastoDeMoneda struct {
	centimos int64
	cuenta   int
	porTipo  map[string]int64
}

type tipoDeGasto struct {
	tipo     string
	centimos int64
}

type filaDeGasto struct {
	moneda   string
	centimos int64
	cuenta   int
	porTipo  []tipoDeGasto
}

func newGastoPorMoneda() *gastoPorMoneda {
	return &gastoPorMoneda{monedas: map[string]*gastoDeMoneda{}}
}

// sumar agrega cuantos movimientos de un tipo, por un monto en centimos. Una
// moneda vacia es colones, como en el front; el monto cuenta por su magnitud.
func (g *gastoPorMoneda) sumar(moneda, tipo string, cuantos int, centimos int64) {
	if moneda == "" {
		moneda = monedaBase
	}
	if centimos < 0 {
		centimos = -centimos
	}
	m := g.monedas[moneda]
	if m == nil {
		m = &gastoDeMoneda{porTipo: map[string]int64{}}
		g.monedas[moneda] = m
	}
	m.centimos += centimos
	m.cuenta += cuantos
	m.porTipo[tipo] += centimos
}

// filas devuelve una fila por moneda: la base siempre, aunque sea en cero, para
// que "no gaste nada" sea un dato y no una lista vacia; despues las demas por
// orden alfabetico.
func (g *gastoPorMoneda) filas() []filaDeGasto {
	nombres := make([]string, 0, len(g.monedas)+1)
	for n := range g.monedas {
		if n != monedaBase {
			nombres = append(nombres, n)
		}
	}
	sort.Strings(nombres)
	nombres = append([]string{monedaBase}, nombres...)

	filas := make([]filaDeGasto, 0, len(nombres))
	for _, n := range nombres {
		fila := filaDeGasto{moneda: n}
		if m := g.monedas[n]; m != nil {
			fila.centimos, fila.cuenta = m.centimos, m.cuenta
			for tipo, c := range m.porTipo {
				fila.porTipo = append(fila.porTipo, tipoDeGasto{tipo: tipo, centimos: c})
			}
			// Mayor primero; el tipo desempata para que el orden no dependa del mapa.
			sort.Slice(fila.porTipo, func(i, j int) bool {
				a, b := fila.porTipo[i], fila.porTipo[j]
				if a.centimos != b.centimos {
					return a.centimos > b.centimos
				}
				return a.tipo < b.tipo
			})
		}
		filas = append(filas, fila)
	}
	return filas
}

func porTipoEnMapas(tipos []tipoDeGasto) []map[string]any {
	salida := make([]map[string]any, 0, len(tipos))
	for _, t := range tipos {
		salida = append(salida, map[string]any{"type": t.tipo, "total": minorToMajor(t.centimos)})
	}
	return salida
}
