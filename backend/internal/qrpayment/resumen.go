package qrpayment

import (
	"context"
	"fmt"
	"sort"
	"time"
)

// ── Tipos ────────────────────────────────────────────────────────────────────

// ResumenMoneda son las ventas de un periodo en UNA moneda, en centimos. Con el
// plan analitica trae ademas el periodo anterior y la variacion.
type ResumenMoneda struct {
	Currency string        `json:"currency"`
	Gross    int64         `json:"gross"`
	Fee      int64         `json:"fee"`
	Net      int64         `json:"net"`
	Count    int           `json:"count"`
	Previous *ReportBucket `json:"previous,omitempty"`
	Delta    *ReportDelta  `json:"delta,omitempty"`
}

// ResumenDelPeriodo son las ventas de un periodo, moneda por moneda. Currencies
// va vacia (no ausente) cuando no hubo ventas: el servidor lo conto, y un cero
// asi es un dato.
type ResumenDelPeriodo struct {
	Period Periodo `json:"period"`
	// From y To son el primero y el ultimo dia del periodo (YYYY-MM-DD en la zona
	// del cliente).
	From string `json:"from"`
	To   string `json:"to"`
	// PreviousFrom y PreviousTo, solo con el plan analitica.
	PreviousFrom string          `json:"previous_from,omitempty"`
	PreviousTo   string          `json:"previous_to,omitempty"`
	Currencies   []ResumenMoneda `json:"currencies"`
}

// ResumenDelComercio es lo que muestra el inicio del negocio: las ventas de hoy,
// de los ultimos 7 dias, de lo que va del mes y del mes anterior.
type ResumenDelComercio struct {
	// Plan del comercio. La comparacion con el periodo anterior es del plan
	// analitica, igual que en el reporte.
	Plan    string              `json:"plan"`
	Periods []ResumenDelPeriodo `json:"periods"`
}

// TotalDelDia son las ventas de un dia en una moneda, para el total de cada dia
// en la lista de movimientos.
type TotalDelDia struct {
	Date     string `json:"date"` // YYYY-MM-DD en la zona del cliente
	Currency string `json:"currency"`
	Gross    int64  `json:"gross"`
	Fee      int64  `json:"fee"`
	Net      int64  `json:"net"`
	Count    int    `json:"count"`
}

// RetiroDelComercio es un retiro del saldo del negocio hacia la cuenta del
// dueno. Es un movimiento del comercio, aunque no sea una venta.
type RetiroDelComercio struct {
	ID       string `json:"id"`
	Amount   int64  `json:"amount"` // centimos
	Currency string `json:"currency"`
	Status   string `json:"status"`
	// WithdrawnByName es quien lo retiro; vacio si no se pudo resolver.
	WithdrawnByName string    `json:"withdrawn_by_name,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

// ── Combinar el periodo con el anterior ──────────────────────────────────────

// combinarMonedas junta lo del periodo con lo del periodo anterior, moneda por
// moneda. Sin comparacion solo trae las monedas del periodo. Con ella trae
// tambien las que solo vendieron antes, con el periodo actual en cero: sin eso
// la pantalla no podria decir que bajo contra el periodo anterior.
func combinarMonedas(actual, anterior []totalMoneda, conComparacion bool) []ResumenMoneda {
	ahora := make(map[string]totalMoneda, len(actual))
	antes := make(map[string]totalMoneda, len(anterior))
	monedas := make(map[string]bool, len(actual)+len(anterior))
	for _, t := range actual {
		ahora[t.Currency] = t
		monedas[t.Currency] = true
	}
	for _, t := range anterior {
		antes[t.Currency] = t
		if conComparacion {
			monedas[t.Currency] = true
		}
	}

	claves := make([]string, 0, len(monedas))
	for m := range monedas {
		claves = append(claves, m)
	}
	sort.Strings(claves)

	out := make([]ResumenMoneda, 0, len(claves))
	for _, moneda := range claves {
		a := ahora[moneda]
		r := ResumenMoneda{Currency: moneda, Gross: a.Gross, Fee: a.Fee, Net: a.Gross - a.Fee, Count: a.Count}
		if conComparacion {
			p := antes[moneda]
			previo := ReportBucket{Gross: p.Gross, Fee: p.Fee, Net: p.Gross - p.Fee, Count: p.Count}
			actualB := ReportBucket{Gross: r.Gross, Fee: r.Fee, Net: r.Net, Count: r.Count}
			r.Previous = &previo
			r.Delta = &ReportDelta{
				Gross:    actualB.Gross - previo.Gross,
				Fee:      actualB.Fee - previo.Fee,
				Net:      actualB.Net - previo.Net,
				Count:    actualB.Count - previo.Count,
				GrossPct: variacionPct(actualB.Gross, previo.Gross),
				NetPct:   variacionPct(actualB.Net, previo.Net),
				CountPct: variacionPct(int64(actualB.Count), int64(previo.Count)),
			}
		}
		out = append(out, r)
	}
	return out
}

// ── Servicio ─────────────────────────────────────────────────────────────────

// ResumenDelComercio arma el resumen por periodo. Lo lee todo el equipo, pero:
//
//   - un cajero recibe solo "hoy", lo mismo que ya veia en su inicio: las cifras
//     del negocio de la semana y del mes no son suyas, como el reporte;
//   - la comparacion con el periodo anterior es del plan analitica.
//
// El dueno de un comercio cerrado tambien lo lee; sus periodos se cuentan desde
// el dia que cerro.
func (s *Service) ResumenDelComercio(ctx context.Context, merchantID, userID string, tzOffsetMin int, ahora time.Time) (*ResumenDelComercio, error) {
	role, m, err := s.rolParaLeer(ctx, merchantID, userID)
	if err != nil || role == "" || m == nil {
		return nil, ErrComercioNoEncontrado
	}
	ahora = anclarAhora(m, ahora)
	tz := sanearDesfase(tzOffsetMin)

	periodos := periodosDelResumen
	conComparacion := m.Plan == PlanComercioAnalitica
	if role == RoleCashier {
		periodos = []Periodo{PeriodoHoy}
		conComparacion = false
	}

	res := &ResumenDelComercio{Plan: m.Plan, Periods: make([]ResumenDelPeriodo, 0, len(periodos))}
	for _, p := range periodos {
		v := calcularVentanaDePeriodo(ahora, p, tz)
		actual, err := s.repo.TotalesPorMoneda(ctx, m.ID, v.desde.UTC(), v.hasta.UTC())
		if err != nil {
			return nil, fmt.Errorf("resumen %s: %w", p, err)
		}
		var anterior []totalMoneda
		if conComparacion {
			anterior, err = s.repo.TotalesPorMoneda(ctx, m.ID, v.anteriorDesde.UTC(), v.anteriorHasta.UTC())
			if err != nil {
				return nil, fmt.Errorf("resumen %s anterior: %w", p, err)
			}
		}
		item := ResumenDelPeriodo{
			Period:     p,
			From:       v.primerDia(),
			To:         v.ultimoDia(),
			Currencies: combinarMonedas(actual, anterior, conComparacion),
		}
		if conComparacion {
			item.PreviousFrom = v.primerDiaAnterior()
			item.PreviousTo = v.ultimoDiaAnterior()
		}
		res.Periods = append(res.Periods, item)
	}
	return res, nil
}

// VentasDelComercioEnPeriodo es el feed de ventas del comercio dentro de un
// periodo, por paginas (limit, antesDe), la mas reciente primero. Lo lee todo el
// equipo, como VentasDelComercio. Incluye las devueltas: son movimientos, aunque
// no cuenten como ventas.
func (s *Service) VentasDelComercioEnPeriodo(
	ctx context.Context, merchantID, userID string, p Periodo, tzOffsetMin, limit int, antesDe string, ahora time.Time,
) ([]QRPaymentRecord, error) {
	role, m, err := s.rolParaLeer(ctx, merchantID, userID)
	if err != nil || role == "" || m == nil {
		return nil, ErrComercioNoEncontrado
	}
	if limit <= 0 {
		limit = 50
	} else if limit > 200 {
		limit = 200
	}
	v := calcularVentanaDePeriodo(anclarAhora(m, ahora), p, tzOffsetMin)
	desde, hasta := v.desde.UTC(), v.hasta.UTC()
	return s.repo.GetMerchantPaymentsEnVentana(ctx, m.ID, limit, antesDe, &desde, &hasta)
}

// TotalesPorDia son las ventas de cada dia del periodo, por moneda. Los dias de
// la lista de movimientos llevan estos totales: calcularlos con las filas que la
// pantalla ya tiene daria un total falso para un dia que la pagina corto a la
// mitad.
func (s *Service) TotalesPorDia(
	ctx context.Context, merchantID, userID string, p Periodo, tzOffsetMin int, ahora time.Time,
) ([]TotalDelDia, error) {
	role, m, err := s.rolParaLeer(ctx, merchantID, userID)
	if err != nil || role == "" || m == nil {
		return nil, ErrComercioNoEncontrado
	}
	tz := sanearDesfase(tzOffsetMin)
	v := calcularVentanaDePeriodo(anclarAhora(m, ahora), p, tz)
	return s.repo.TotalesPorDiaYMoneda(ctx, m.ID, v.desde.UTC(), v.hasta.UTC(), tz)
}

// RetirosDelComercio son los retiros del saldo del negocio dentro de un periodo.
// Solo el dueno y el encargado, que son quienes ven el saldo.
func (s *Service) RetirosDelComercio(
	ctx context.Context, merchantID, userID string, p Periodo, tzOffsetMin int, ahora time.Time,
) ([]RetiroDelComercio, error) {
	role, m, err := s.rolParaLeer(ctx, merchantID, userID)
	if err != nil || m == nil || (role != RoleOwner && role != RoleManager) {
		return nil, ErrComercioNoEncontrado
	}
	v := calcularVentanaDePeriodo(anclarAhora(m, ahora), p, tzOffsetMin)
	return s.repo.RetirosDelComercio(ctx, m.ID, v.desde.UTC(), v.hasta.UTC())
}

// MerchantReportDelPeriodo es el reporte de un periodo (hoy, 7 dias, este mes o
// el mes anterior) en vez de "los ultimos N dias". Mismo acceso que el reporte.
func (s *Service) MerchantReportDelPeriodo(
	ctx context.Context, merchantID, userID string, p Periodo, tzOffsetMin int, ahora time.Time,
) (*MerchantReport, error) {
	m, err := s.requireRoleParaLeer(ctx, merchantID, userID, RoleOwner, RoleManager)
	if err != nil {
		return nil, err
	}
	v := calcularVentanaDePeriodo(anclarAhora(m, ahora), p, tzOffsetMin)
	return s.armarReporte(ctx, m, v.comoVentanaDeReporte(), tzOffsetMin)
}

// ReporteExportableDelPeriodo es el reporte de un periodo para exportarlo en
// CSV: mismo acceso que MerchantReportDelPeriodo y, ademas, el plan analitica
// (un comercio cerrado se exporta con cualquier plan). El rol se comprueba
// antes que el plan.
func (s *Service) ReporteExportableDelPeriodo(
	ctx context.Context, merchantID, userID string, p Periodo, tzOffsetMin int, ahora time.Time,
) (*MerchantReport, error) {
	m, err := s.requireRoleParaLeer(ctx, merchantID, userID, RoleOwner, RoleManager)
	if err != nil {
		return nil, err
	}
	if m.Plan != PlanComercioAnalitica && m.ClosedAt == nil {
		return nil, ErrPlanAnaliticaRequerido
	}
	v := calcularVentanaDePeriodo(anclarAhora(m, ahora), p, tzOffsetMin)
	return s.armarReporte(ctx, m, v.comoVentanaDeReporte(), tzOffsetMin)
}
