package uif

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/kiramopay/backend/internal/audit"
)

type Service struct {
	repo        *Repository
	thresholds  Thresholds
	auditLogger *audit.Logger
}

type Options struct {
	Thresholds  *Thresholds
	AuditLogger *audit.Logger
}

func NewService(repo *Repository, opts *Options) *Service {
	if opts == nil {
		opts = &Options{}
	}
	th := DefaultThresholds()
	if opts.Thresholds != nil {
		th = *opts.Thresholds
	}
	return &Service{repo: repo, thresholds: th, auditLogger: opts.AuditLogger}
}

// Report implements transaction.UIFReporter. It is called best-effort AFTER an
// outgoing transaction is posted; the running same-day total already includes
// this transaction, so the prior total is (daily - amount). Failures are logged,
// never propagated — UIF recording must not roll back a settled payment, but a
// failure to record is a compliance gap worth surfacing.
func (s *Service) Report(ctx context.Context, userID, txID, currency string, amountMinor int64) {
	dailyTotal, err := s.repo.GetUserDailyOutgoingTotal(ctx, userID, currency)
	if err != nil {
		slog.Warn("uif: daily total query failed", "user", userID, "err", err.Error())
		return
	}
	prior := dailyTotal - amountMinor
	if prior < 0 {
		prior = 0
	}

	res := s.thresholds.Evaluate(currency, amountMinor, prior)
	if !res.Reportable {
		return
	}

	rep := &Report{
		UserID:          userID,
		TxID:            txID,
		ReportType:      res.Type,
		AmountMinor:     amountMinor,
		Currency:        currency,
		DailyTotalMinor: dailyTotal,
		Reason:          res.Reason,
		Status:          StatusPending,
	}
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
