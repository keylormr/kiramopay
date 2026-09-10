package fraud

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// EvaluarSalida es el punto por donde el motor de riesgo entra al camino del
// dinero. Hasta ahora AssessTransaction solo era alcanzable por
// POST /fraud/assess —el propio usuario preguntando por su transaccion— y
// ningun servicio de dinero lo llamaba: el motor existia y no frenaba nada. La
// consecuencia mas fea era que POST /admin/fraud/restrict/{userId} le decia al
// administrador que habia frenado una cuenta, y la cuenta seguia moviendo plata.
//
// La politica de fallos esta partida a proposito, porque las dos mitades no
// merecen el mismo trato:
//
//   - La RESTRICCION es una decision explicita de una persona. Se lee primero y
//     por separado, y si no se puede leer se BLOQUEA: no puede quedar sin
//     efecto porque el motor de puntaje tenga un mal dia.
//   - El PUNTAJE es una heuristica. Si no se puede calcular o anotar, se deja
//     pasar y quien llama lo registra: un pago legitimo no se vuelve riesgoso
//     porque no se pudo archivar el papeleo.
func (s *Service) EvaluarSalida(
	ctx context.Context, userID, txType, txID string, amountMinor int64, currency string,
) (string, error) {
	perfil, err := s.repo.GetOrCreateProfile(ctx, userID)
	if err != nil {
		return ActionBlock, fmt.Errorf("perfil de riesgo: %w", err)
	}
	if perfil.IsRestricted {
		return ActionBlock, nil
	}

	ev, err := s.AssessTransaction(ctx, &AssessRequest{
		UserID:   userID,
		TxType:   txType,
		TxID:     txID,
		Amount:   amountMinor,
		Currency: currency,
	})
	if err != nil {
		return ActionAllow, fmt.Errorf("evaluacion de riesgo: %w", err)
	}
	return ev.Action, nil
}

// AssessTransaction performs real-time risk assessment on a transaction.
func (s *Service) AssessTransaction(ctx context.Context, req *AssessRequest) (*RiskAssessment, error) {
	profile, err := s.repo.GetOrCreateProfile(ctx, req.UserID)
	if err != nil {
		return nil, err
	}

	// Check if user is restricted
	if profile.IsRestricted {
		return &RiskAssessment{
			RiskScore: 100,
			RiskLevel: "critical",
			Action:    ActionBlock,
			Factors:   []string{"Account is restricted"},
		}, nil
	}

	var factors []string
	riskScore := 0

	// ── Rule 1: Amount check ─────────────────────────────────────────────
	if req.Amount > 50000000 { // > 500K CRC
		riskScore += 30
		factors = append(factors, fmt.Sprintf("High amount: %d centimos", req.Amount))
	}

	// ── Rule 2: Velocity check (transactions in last 10 minutes) ─────────
	recentCount, _ := s.repo.CountRecentTransactions(ctx, req.UserID, 10)
	if recentCount > 5 {
		riskScore += 40
		factors = append(factors, fmt.Sprintf("High velocity: %d transactions in 10 min", recentCount))
	}

	// ── Rule 3: Volume check (24h total) ─────────────────────────────────
	volume24h, _ := s.repo.SumRecentAmounts(ctx, req.UserID, 24)
	if volume24h+req.Amount > 200000000 { // > 2M CRC
		riskScore += 35
		factors = append(factors, fmt.Sprintf("High 24h volume: %d centimos", volume24h+req.Amount))
	}

	// ── Rule 4: New account high value ───────────────────────────────────
	if profile.AccountAge < 7 && req.Amount > 10000000 { // < 7 days old + > 100K CRC
		riskScore += 45
		factors = append(factors, "New account with high-value transaction")
	}

	// ── Rule 5: Amount anomaly (3x average) ──────────────────────────────
	if profile.AvgTxAmount > 0 && req.Amount > profile.AvgTxAmount*3 {
		riskScore += 25
		factors = append(factors, fmt.Sprintf("Amount %.1fx above average", float64(req.Amount)/float64(profile.AvgTxAmount)))
	}

	// Cap at 100
	if riskScore > 100 {
		riskScore = 100
	}

	// Determine risk level and action
	riskLevel, action := classifyRisk(riskScore)

	assessment := &RiskAssessment{
		ID:        uuid.New().String(),
		UserID:    req.UserID,
		TxType:    req.TxType,
		TxID:      req.TxID,
		Amount:    req.Amount,
		RiskScore: riskScore,
		RiskLevel: riskLevel,
		Factors:   factors,
		Action:    action,
	}

	if err := s.repo.CreateAssessment(ctx, assessment); err != nil {
		return nil, err
	}

	// Create alert for high-risk transactions
	if riskScore >= HighThreshold {
		alert := &FraudAlert{
			ID:           uuid.New().String(),
			UserID:       req.UserID,
			AssessmentID: assessment.ID,
			Type:         "suspicious_tx",
			Severity:     riskLevel,
			Message:      fmt.Sprintf("High-risk %s of %d centimos (score: %d)", req.TxType, req.Amount, riskScore),
			Status:       "open",
		}
		_ = s.repo.CreateAlert(ctx, alert)
	}

	// Update user risk profile
	newTotal := profile.TotalTransactions + 1
	newFlagged := profile.TotalFlagged
	if riskScore >= MediumThreshold {
		newFlagged++
	}
	newAvg := (profile.AvgTxAmount*profile.TotalTransactions + req.Amount) / newTotal
	newMax := profile.MaxTxAmount
	if req.Amount > newMax {
		newMax = req.Amount
	}
	newScore := (profile.OverallRiskScore*(int(profile.TotalTransactions)) + riskScore) / int(newTotal)
	_ = s.repo.UpdateProfile(ctx, req.UserID, newTotal, newFlagged, newAvg, newMax, newScore)

	return assessment, nil
}

func (s *Service) GetUserRiskProfile(ctx context.Context, userID string) (*UserRiskProfile, error) {
	return s.repo.GetOrCreateProfile(ctx, userID)
}

func (s *Service) GetOpenAlerts(ctx context.Context) ([]FraudAlert, error) {
	return s.repo.GetOpenAlerts(ctx)
}

func (s *Service) ResolveAlert(ctx context.Context, alertID, resolvedBy, status string) error {
	validStatuses := map[string]bool{
		"resolved": true, "false_positive": true, "investigating": true,
	}
	if !validStatuses[status] {
		return fmt.Errorf("invalid status: %s", status)
	}
	return s.repo.ResolveAlert(ctx, alertID, resolvedBy, status)
}

func (s *Service) GetUserAssessments(ctx context.Context, userID string) ([]RiskAssessment, error) {
	return s.repo.ListUserAssessments(ctx, userID, 50)
}

func (s *Service) RestrictUser(ctx context.Context, userID string, restricted bool) error {
	return s.repo.RestrictUser(ctx, userID, restricted)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func classifyRisk(score int) (string, string) {
	switch {
	case score >= CriticalThreshold:
		return "critical", ActionBlock
	case score >= HighThreshold:
		return "high", ActionReview
	case score >= MediumThreshold:
		return "medium", ActionReview
	default:
		return "low", ActionAllow
	}
}
