package uif

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Cotizacion es el tipo de cambio con que se dolariza un monto: cuantas
// unidades de la moneda vale un dolar, de que dia es y de donde salio.
//
// La norma remite a la venta de referencia del BCCR (Lin. 20.3 de SUGEF 13-19,
// que remite al art. 12 del RIF, CONASSIF 6-18), y no le fija antiguedad maxima:
// se usa la ultima publicada y, si tiene mas de DiasDeAlarma, se avisa.
type Cotizacion struct {
	PorDolar float64
	// Fecha es el dia de la publicacion, como fecha civil (ver diaCR).
	Fecha  time.Time
	Fuente string
}

const (
	// FuenteDolar: el monto ya esta en dolares.
	FuenteDolar = "dolar"
	// FuentePrecioDeEjecucion: cripto, valuada en dolares al precio al que se
	// ejecuto la operacion.
	FuentePrecioDeEjecucion = "precio_ejecucion"
	// FuenteHistorial: no habia venta del dia guardada y se uso la tasa vigente
	// en el historial de exchange_rates (ver VentaDeReferencia).
	FuenteHistorial = "exchange_rates"
	// fuenteFija: la de Options.TipoDeCambio, que solo usan las pruebas.
	fuenteFija = "tipo_de_cambio_fijo"

	// DiasDeAlarma: con mas de estos dias naturales entre la fecha de la tasa y
	// el dia que se dolariza, se da la alarma. No bloquea: ninguna norma fija un
	// maximo, y sin tasa el movimiento iria a revision manual.
	DiasDeAlarma = 6
)

// errSinTipoDeCambio: no hay tipo de cambio para la moneda, o el que hay no
// sirve (cero o negativo).
var errSinTipoDeCambio = errors.New("sin tipo de cambio")

type claveTasa struct {
	moneda string
	dia    time.Time
}

// conversion lleva las cuentas en dolares de UNA evaluacion. Consulta la
// cotizacion de cada moneda y dia una sola vez: consultandola para cada suma,
// una falla pasajera entre la primera consulta y la siguiente dejaba fuera del
// total la moneda del propio movimiento, y nadie se enteraba.
type conversion struct {
	s      *Service
	ctx    context.Context
	userID string
	cots   map[claveTasa]Cotizacion
	fallas map[claveTasa]error
}

func (s *Service) nuevaConversion(ctx context.Context, userID string) *conversion {
	return &conversion{s: s, ctx: ctx, userID: userID,
		cots: map[claveTasa]Cotizacion{}, fallas: map[claveTasa]error{}}
}

// cotizar da la cotizacion de una moneda para un dia (fecha civil).
func (c *conversion) cotizar(moneda string, dia time.Time) (Cotizacion, error) {
	if moneda == "USD" {
		return Cotizacion{PorDolar: 1, Fecha: dia, Fuente: FuenteDolar}, nil
	}
	k := claveTasa{moneda: moneda, dia: dia}
	if c.s.tipoDeCambio != nil {
		// La fija es la misma para todos los dias: se consulta una vez.
		k.dia = time.Time{}
	}
	if err, ya := c.fallas[k]; ya {
		return Cotizacion{}, err
	}
	if cot, ya := c.cots[k]; ya {
		if c.s.tipoDeCambio != nil {
			cot.Fecha = dia
		}
		return cot, nil
	}
	cot, err := c.consultar(moneda, dia)
	if err != nil {
		// Error y no Warn: sin tipo de cambio el control de cumplimiento no
		// puede comparar, y lo que toque esa moneda termina en la cola manual.
		// El motivo de origen (una tabla sin la fila, un corte de la base) solo
		// queda aqui.
		slog.Error("uif: sin tipo de cambio", "user", c.userID, "moneda", moneda, "dia", fecha(dia), "err", err.Error())
		c.fallas[k] = err
		return Cotizacion{}, err
	}
	c.cots[k] = cot
	return cot, nil
}

func (c *conversion) consultar(moneda string, dia time.Time) (Cotizacion, error) {
	var cot Cotizacion
	var err error
	if c.s.tipoDeCambio != nil {
		cot = Cotizacion{Fecha: dia, Fuente: fuenteFija}
		cot.PorDolar, err = c.s.tipoDeCambio(c.ctx, moneda)
	} else {
		cot, err = c.s.repo.VentaDeReferencia(c.ctx, moneda, dia)
	}
	if err != nil {
		return Cotizacion{}, fmt.Errorf("%w: %v", errSinTipoDeCambio, err)
	}
	if cot.PorDolar <= 0 {
		return Cotizacion{}, fmt.Errorf("%w: %v %s por dolar", errSinTipoDeCambio, cot.PorDolar, moneda)
	}
	return cot, nil
}

// aDolares da el equivalente en centavos de dolar de un monto de un dia, y la
// cotizacion con que se convirtio.
func (c *conversion) aDolares(moneda string, minor int64, dia time.Time) (int64, Cotizacion, error) {
	cot, err := c.cotizar(moneda, dia)
	if err != nil {
		return 0, Cotizacion{}, err
	}
	return enCentavosDeDolar(minor, cot.PorDolar), cot, nil
}

// alarmarSiEsVieja da la alarma cuando la tasa con que se dolariza un dia tiene
// mas de DiasDeAlarma dias naturales. Se usa la tasa igual.
func alarmarSiEsVieja(userID, moneda string, cot Cotizacion, dia time.Time) {
	if cot.Fuente == FuenteDolar || cot.Fuente == FuentePrecioDeEjecucion {
		return
	}
	if n := diasEntre(cot.Fecha, dia); n > DiasDeAlarma {
		slog.Error("uif: tipo de cambio viejo: se usa igual, pero la fuente no publica hace dias",
			"user", userID, "moneda", moneda, "fecha_tasa", fecha(cot.Fecha), "dia", fecha(dia),
			"dias", n, "fuente", cot.Fuente)
	}
}

// total es lo que se movio en una ventana, en dolares.
type total struct {
	usd int64
	// faltan son las monedas que no se pudieron convertir (de algun dia): el
	// total va sin ellas, y por eso no sirve para decir que NO cruzo.
	faltan []string
	// partes dice de que esta hecho, moneda por moneda, para la razon del caso.
	partes []string
}

// sumar convierte lo que se movio, cada dia con su cotizacion, y lo junta por
// moneda para la razon.
func (c *conversion) sumar(filas []sumaDia) total {
	type deMoneda struct {
		minor, usd int64
		tasas      []float64
		falta      bool
	}
	porMoneda := map[string]*deMoneda{}
	var monedas []string
	sort.Slice(filas, func(i, j int) bool {
		if filas[i].moneda != filas[j].moneda {
			return filas[i].moneda < filas[j].moneda
		}
		return filas[i].dia.Before(filas[j].dia)
	})
	for _, f := range filas {
		m := porMoneda[f.moneda]
		if m == nil {
			m = &deMoneda{}
			porMoneda[f.moneda] = m
			monedas = append(monedas, f.moneda)
		}
		usd, cot, err := c.aDolares(f.moneda, f.monto, f.dia)
		if err != nil {
			m.falta = true
			continue
		}
		m.minor += f.monto
		m.usd += usd
		m.tasas = append(m.tasas, cot.PorDolar)
	}
	var t total
	for _, moneda := range monedas {
		m := porMoneda[moneda]
		if m.falta {
			t.faltan = append(t.faltan, moneda)
		}
		if len(m.tasas) == 0 {
			continue
		}
		t.usd += m.usd
		switch {
		case moneda == "USD":
			t.partes = append(t.partes, "US$"+dolares(m.minor))
		case todasIguales(m.tasas):
			t.partes = append(t.partes, fmt.Sprintf("%s %s = US$%s a %s %s por dolar",
				dolares(m.minor), moneda, dolares(m.usd), tasaLegible(m.tasas[0]), moneda))
		default:
			lo, hi := extremos(m.tasas)
			t.partes = append(t.partes, fmt.Sprintf("%s %s = US$%s con la venta de cada dia (de %s a %s %s por dolar)",
				dolares(m.minor), moneda, dolares(m.usd), tasaLegible(lo), tasaLegible(hi), moneda))
		}
	}
	return t
}

// delDia arma las filas de un solo dia a partir de los totales por moneda.
func delDia(porMoneda map[string]int64, dia time.Time) []sumaDia {
	filas := make([]sumaDia, 0, len(porMoneda))
	for m, minor := range porMoneda {
		filas = append(filas, sumaDia{sentido: sentidoSalida, moneda: m, dia: dia, monto: minor})
	}
	return filas
}

func soloSentido(filas []sumaDia, sentido string) []sumaDia {
	var out []sumaDia
	for _, f := range filas {
		if f.sentido == sentido {
			out = append(out, f)
		}
	}
	return out
}

func montoEn(filas []sumaDia, moneda string) int64 {
	var n int64
	for _, f := range filas {
		if f.moneda == moneda {
			n += f.monto
		}
	}
	return n
}

func todasIguales(v []float64) bool {
	for _, x := range v[1:] {
		if x != v[0] {
			return false
		}
	}
	return true
}

func extremos(v []float64) (float64, float64) {
	lo, hi := v[0], v[0]
	for _, x := range v[1:] {
		lo, hi = min(lo, x), max(hi, x)
	}
	return lo, hi
}

// previo es el total de la ventana SIN este movimiento.
func previo(t total, amountUSD int64) int64 {
	if p := t.usd - amountUSD; p > 0 {
		return p
	}
	return 0
}

// tasaLegible escribe el tipo de cambio entero, con al menos dos decimales: con
// "%.2f" una tasa de mas decimales salia redondeada y la cuenta no se podia
// rehacer a mano.
func tasaLegible(tasa float64) string {
	s := strconv.FormatFloat(tasa, 'f', -1, 64)
	punto := strings.IndexByte(s, '.')
	if punto < 0 || len(s)-punto-1 < 2 {
		return fmt.Sprintf("%.2f", tasa)
	}
	return s
}

// unirFaltan junta las monedas sin tipo de cambio de varios totales, sin
// repetir.
func unirFaltan(ts ...total) []string {
	vistas := map[string]bool{}
	var out []string
	for _, t := range ts {
		for _, m := range t.faltan {
			if !vistas[m] {
				vistas[m] = true
				out = append(out, m)
			}
		}
	}
	sort.Strings(out)
	return out
}
