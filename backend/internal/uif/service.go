package uif

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"

	"github.com/kiramopay/backend/internal/audit"
)

type Service struct {
	repo         *Repository
	thresholds   Thresholds
	auditLogger  *audit.Logger
	tipoDeCambio func(ctx context.Context, moneda string) (float64, error)
}

type Options struct {
	Thresholds  *Thresholds
	AuditLogger *audit.Logger
	// TipoDeCambio dice cuantas unidades de la moneda vale un dolar, con el
	// tipo de cambio oficial. El dolar no lo necesita. Sin el (nil o con error),
	// un movimiento en otra moneda no se puede comparar con el umbral y se abre
	// un caso manual: nunca se deja pasar en silencio.
	TipoDeCambio func(ctx context.Context, moneda string) (float64, error)
}

func NewService(repo *Repository, opts *Options) *Service {
	if opts == nil {
		opts = &Options{}
	}
	th := DefaultThresholds()
	if opts.Thresholds != nil {
		th = opts.Thresholds.conLosDeLey()
	}
	return &Service{repo: repo, thresholds: th, auditLogger: opts.AuditLogger, tipoDeCambio: opts.TipoDeCambio}
}

// errSinTipoDeCambio: no hay tipo de cambio para la moneda, o el que hay no
// sirve (cero o negativo).
var errSinTipoDeCambio = errors.New("sin tipo de cambio")

// conversion lleva las cuentas en dolares de UNA evaluacion. Consulta el tipo
// de cambio de cada moneda una sola vez: consultandolo para cada suma, una
// falla pasajera entre la primera consulta y la siguiente dejaba fuera del
// total la moneda del propio movimiento, y nadie se enteraba.
type conversion struct {
	s      *Service
	ctx    context.Context
	userID string
	tasas  map[string]float64
	fallas map[string]error
}

func (s *Service) nuevaConversion(ctx context.Context, userID string) *conversion {
	return &conversion{s: s, ctx: ctx, userID: userID, tasas: map[string]float64{}, fallas: map[string]error{}}
}

// aDolares da el equivalente en centavos de dolar y el tipo de cambio usado
// (1 para el dolar).
func (c *conversion) aDolares(moneda string, minor int64) (int64, float64, error) {
	if moneda == "USD" {
		return minor, 1, nil
	}
	if err, ya := c.fallas[moneda]; ya {
		return 0, 0, err
	}
	tasa, ya := c.tasas[moneda]
	if !ya {
		var err error
		if tasa, err = c.consultar(moneda); err != nil {
			// Error y no Warn: sin tipo de cambio el control de cumplimiento no
			// puede comparar, y lo que toque esa moneda termina en la cola
			// manual. El motivo de origen (una tabla sin la fila, un corte de la
			// base) solo queda aqui.
			slog.Error("uif: sin tipo de cambio", "user", c.userID, "moneda", moneda, "err", err.Error())
			c.fallas[moneda] = err
			return 0, 0, err
		}
		c.tasas[moneda] = tasa
	}
	return enCentavosDeDolar(minor, tasa), tasa, nil
}

func (c *conversion) consultar(moneda string) (float64, error) {
	if c.s.tipoDeCambio == nil {
		return 0, errSinTipoDeCambio
	}
	tasa, err := c.s.tipoDeCambio(c.ctx, moneda)
	if err != nil {
		return 0, fmt.Errorf("%w: %v", errSinTipoDeCambio, err)
	}
	if tasa <= 0 {
		return 0, fmt.Errorf("%w: %v %s por dolar", errSinTipoDeCambio, tasa, moneda)
	}
	return tasa, nil
}

// total es lo que salio en una ventana (el dia o los 30 dias), en dolares.
type total struct {
	usd int64
	// faltan son las monedas que no se pudieron convertir: el total va sin
	// ellas, y por eso no sirve para decir que NO cruzo.
	faltan []string
	// partes dice de que esta hecho, moneda por moneda, para la razon del caso.
	partes []string
}

func (c *conversion) sumar(porMoneda map[string]int64) total {
	monedas := make([]string, 0, len(porMoneda))
	for m := range porMoneda {
		monedas = append(monedas, m)
	}
	sort.Strings(monedas)
	var t total
	for _, m := range monedas {
		minor := porMoneda[m]
		usd, tasa, err := c.aDolares(m, minor)
		if err != nil {
			t.faltan = append(t.faltan, m)
			continue
		}
		t.usd += usd
		if m == "USD" {
			t.partes = append(t.partes, "US$"+dolares(minor))
		} else {
			t.partes = append(t.partes, fmt.Sprintf("%s %s = US$%s a %s %s por dolar",
				dolares(minor), m, dolares(usd), tasaLegible(tasa), m))
		}
	}
	return t
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

// Report implements transaction.UIFReporter. It is called best-effort AFTER an
// outgoing transaction is posted; the running same-day total already includes
// this transaction, so the prior total is (daily - amount). Failures are logged,
// never propagated — UIF recording must not roll back a settled payment, but a
// failure to record is a compliance gap worth surfacing.
//
// Todo se compara en dolares: el movimiento y los agregados (todas las monedas
// juntas) por su equivalente con el tipo de cambio oficial. El caso guarda el
// monto y los totales en la moneda del movimiento, como siempre, y la razon
// dice a cuantos dolares y con que tipo de cambio se comparo.
func (s *Service) Report(ctx context.Context, userID, txID, currency string, amountMinor int64) {
	conv := s.nuevaConversion(ctx, userID)
	amountUSD, tasa, err := conv.aDolares(currency, amountMinor)
	if err != nil {
		// Nunca silencio: si no se puede comparar con el umbral, lo decide una
		// persona.
		s.crearCaso(ctx, &Report{
			UserID:      userID,
			TxID:        txID,
			ReportType:  TypeManual,
			AmountMinor: amountMinor,
			Currency:    currency,
			Reason: fmt.Sprintf("no hay tipo de cambio oficial para %s: el movimiento de %s %s no se pudo "+
				"comparar con el umbral de US$%s. Revisarlo a mano.", currency, dolares(amountMinor), currency,
				dolares(s.thresholds.SingleUSD)),
			Status: StatusPending,
		})
		return
	}

	delDia, err := s.repo.SalidasDelDiaPorMoneda(ctx, userID)
	if err != nil {
		slog.Warn("uif: daily total query failed", "user", userID, "err", err.Error())
		return
	}
	dailyTotal := delDia[currency]
	dia := conv.sumar(delDia)
	res := s.thresholds.Evaluate(amountUSD, previo(dia, amountUSD))
	ventana := dia
	if !res.Reportable && len(dia.faltan) > 0 {
		s.casoPorTotalIncompleto(ctx, userID, txID, currency, amountMinor, "del dia", dia, s.thresholds.DailyUSD,
			dailyTotal, 0)
		return
	}

	// Si ni el movimiento ni el dia cruzan el umbral, se mira el MES. Con los
	// topes diarios de KYC las dos primeras reglas no pueden dispararse; esta
	// si. Va despues porque un caso por movimiento alcanza: si el dia ya
	// disparo, ese caso es mas especifico que el del mes.
	var acumulado int64
	if !res.Reportable {
		de30, err := s.repo.SalidasDe30DiasPorMoneda(ctx, userID)
		if err != nil {
			slog.Warn("uif: acumulado de 30 dias fallo", "user", userID, "err", err.Error())
			return
		}
		treinta := conv.sumar(de30)
		res = s.thresholds.EvaluateAcumulado(amountUSD, previo(treinta, amountUSD))
		acumulado = de30[currency]
		ventana = treinta
		if !res.Reportable && len(treinta.faltan) > 0 {
			s.casoPorTotalIncompleto(ctx, userID, txID, currency, amountMinor, "de los ultimos 30 dias", treinta,
				s.thresholds.Acumulado30USD, dailyTotal, acumulado)
			return
		}
	}
	if !res.Reportable {
		return
	}
	razon := res.Reason
	// Si disparo un total, de que esta hecho: las columnas del caso guardan
	// solo la moneda del movimiento, y sin esto el oficial no podia rehacer la
	// cuenta de un total que junta dolares y colones.
	if res.Type != TypeSingleThreshold {
		razon += "; el total: " + strings.Join(ventana.partes, " + ")
		if len(ventana.faltan) > 0 {
			razon += "; sin contar " + strings.Join(ventana.faltan, ", ") + ", que no tiene tipo de cambio oficial"
		}
	}
	if currency != "USD" {
		razon += fmt.Sprintf("; el movimiento: %s %s = US$%s al tipo de cambio oficial de %s %s por dolar",
			dolares(amountMinor), currency, dolares(amountUSD), tasaLegible(tasa), currency)
	}

	rep := &Report{
		UserID:           userID,
		TxID:             txID,
		ReportType:       res.Type,
		AmountMinor:      amountMinor,
		Currency:         currency,
		DailyTotalMinor:  dailyTotal,
		Acumulado30Minor: acumulado,
		Reason:           razon,
		Status:           StatusPending,
	}
	s.crearCaso(ctx, rep)
}

// casoPorTotalIncompleto abre un caso manual cuando un total no cruza el umbral
// pero le falta una moneda que no se pudo convertir. Un total que no se pudo
// sumar entero no dice que no cruzo: hoy salieron ₡500.000 sin tipo de cambio
// para el colon y despues US$9.900, y el servicio solo veia los US$9.900.
func (s *Service) casoPorTotalIncompleto(ctx context.Context, userID, txID, currency string, amountMinor int64,
	cual string, t total, umbral, dailyTotal, acumulado int64) {
	sin := "nada"
	if len(t.partes) > 0 {
		sin = strings.Join(t.partes, " + ")
	}
	s.crearCaso(ctx, &Report{
		UserID:           userID,
		TxID:             txID,
		ReportType:       TypeManual,
		AmountMinor:      amountMinor,
		Currency:         currency,
		DailyTotalMinor:  dailyTotal,
		Acumulado30Minor: acumulado,
		Reason: fmt.Sprintf("las salidas %s no se pudieron sumar enteras: no hay tipo de cambio oficial para %s. "+
			"Sin esa moneda suman US$%s (%s), y el umbral es US$%s. Revisarlo a mano.",
			cual, strings.Join(t.faltan, ", "), dolares(t.usd), sin, dolares(umbral)),
		Status: StatusPending,
	})
}

// crearCaso guarda el caso pendiente y deja la huella en la auditoria.
func (s *Service) crearCaso(ctx context.Context, rep *Report) {
	userID, txID := rep.UserID, rep.TxID
	if err := s.repo.CreateReport(ctx, rep); err != nil {
		slog.Warn("uif: create report failed", "user", userID, "tx", txID, "err", err.Error())
		return
	}
	if s.auditLogger != nil {
		s.auditLogger.Log(audit.Event{
			UserID:       userID,
			Action:       "uif_report_created",
			ResourceType: "uif_report",
			ResourceID:   rep.ID,
			RiskLevel:    "high",
		})
	}
}

func (s *Service) ListReports(ctx context.Context, status string) ([]Report, error) {
	return s.repo.ListByStatus(ctx, status, 100)
}

func (s *Service) ReviewReport(ctx context.Context, id, reviewerID string, req *ReviewRequest) error {
	switch req.Status {
	case StatusSubmitted, StatusDismissed, StatusReviewed:
	default:
		return fmt.Errorf("invalid review status %q", req.Status)
	}
	if err := s.repo.Review(ctx, id, reviewerID, req.Status, req.Notes); err != nil {
		return err
	}
	if s.auditLogger != nil {
		s.auditLogger.Log(audit.Event{
			UserID:       reviewerID,
			Action:       "uif_report_" + req.Status,
			ResourceType: "uif_report",
			ResourceID:   id,
			RiskLevel:    "medium",
		})
	}
	return nil
}
