package uif

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"

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
		th = *opts.Thresholds
	}
	return &Service{repo: repo, thresholds: th, auditLogger: opts.AuditLogger, tipoDeCambio: opts.TipoDeCambio}
}

// errSinTipoDeCambio: no hay tipo de cambio para la moneda, o el que hay no
// sirve (cero o negativo).
var errSinTipoDeCambio = errors.New("sin tipo de cambio")

// enDolares da el equivalente en centavos de dolar y el tipo de cambio usado
// (1 para el dolar).
func (s *Service) enDolares(ctx context.Context, moneda string, minor int64) (int64, float64, error) {
	if moneda == "USD" {
		return minor, 1, nil
	}
	if s.tipoDeCambio == nil {
		return 0, 0, errSinTipoDeCambio
	}
	tasa, err := s.tipoDeCambio(ctx, moneda)
	if err != nil {
		return 0, 0, fmt.Errorf("%w: %v", errSinTipoDeCambio, err)
	}
	if tasa <= 0 {
		return 0, 0, errSinTipoDeCambio
	}
	return enCentavosDeDolar(minor, tasa), tasa, nil
}

// totalEnDolares suma las salidas de cada moneda por su equivalente. Una moneda
// sin tipo de cambio no se puede sumar: su movimiento ya abrio un caso manual
// cuando se hizo, y aqui se registra que el total va sin ella.
func (s *Service) totalEnDolares(ctx context.Context, userID string, porMoneda map[string]int64) int64 {
	monedas := make([]string, 0, len(porMoneda))
	for m := range porMoneda {
		monedas = append(monedas, m)
	}
	sort.Strings(monedas)
	var total int64
	for _, m := range monedas {
		usd, _, err := s.enDolares(ctx, m, porMoneda[m])
		if err != nil {
			slog.Warn("uif: una moneda sin tipo de cambio queda fuera del agregado", "user", userID, "moneda", m)
			continue
		}
		total += usd
	}
	return total
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
	amountUSD, tasa, err := s.enDolares(ctx, currency, amountMinor)
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
	prior := s.totalEnDolares(ctx, userID, delDia) - amountUSD
	if prior < 0 {
		prior = 0
	}

	res := s.thresholds.Evaluate(amountUSD, prior)

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
		prior30 := s.totalEnDolares(ctx, userID, de30) - amountUSD
		if prior30 < 0 {
			prior30 = 0
		}
		res = s.thresholds.EvaluateAcumulado(amountUSD, prior30)
		acumulado = de30[currency]
	}
	if !res.Reportable {
		return
	}
	razon := res.Reason
	if currency != "USD" {
		razon += fmt.Sprintf("; el movimiento: %s %s = US$%s al tipo de cambio oficial de %.2f %s por dolar",
			dolares(amountMinor), currency, dolares(amountUSD), tasa, currency)
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
