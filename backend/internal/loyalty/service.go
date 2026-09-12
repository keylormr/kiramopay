package loyalty

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/ledger"
)

type Service struct {
	repo          *Repository
	referralBonus int
	// ledger paga el cashback desde la cuenta de promociones. Sin el, ningun
	// premio se puede entregar y ninguno se canjea.
	ledger      *ledger.Engine
	history     HistoryRecorder
	auditLogger *audit.Logger
}

// Options tunes the points program. nil is tolerated (referrals off).
type Options struct {
	// ReferralBonusPoints por invitado registrado; 0 = no acreditar.
	ReferralBonusPoints int
	// Ledger paga el cashback. Ver cashback.go.
	Ledger *ledger.Engine
	// AuditLogger deja rastro de cada fondeo de la cuenta de promociones.
	AuditLogger *audit.Logger
}

func NewService(repo *Repository, opts *Options) *Service {
	s := &Service{repo: repo}
	if opts != nil {
		if opts.ReferralBonusPoints > 0 {
			s.referralBonus = opts.ReferralBonusPoints
		}
		s.ledger = opts.Ledger
		s.auditLogger = opts.AuditLogger
	}
	return s
}

// RewardReferral acredita el bono de referido al referidor por el registro del
// invitado. Idempotente por invitado (uq_loyalty_tx_referral). Ignora
// referrerID == invitedUserID. Devuelve (false, nil) si ya estaba acreditado o
// si el programa esta apagado.
func (s *Service) RewardReferral(ctx context.Context, referrerID, invitedUserID string) (bool, error) {
	if referrerID == "" || invitedUserID == "" || referrerID == invitedUserID || s.referralBonus <= 0 {
		return false, nil
	}
	if _, err := s.repo.GetOrCreateAccount(ctx, referrerID); err != nil {
		return false, err
	}
	granted, err := s.repo.GrantBonusOnce(ctx, &PointsTransaction{
		ID:          uuid.New().String(),
		UserID:      referrerID,
		Type:        "bonus",
		Points:      int64(s.referralBonus),
		Description: "Invitado registrado",
		RefType:     "referral",
		RefID:       invitedUserID,
	})
	if err != nil {
		return false, err
	}
	if granted {
		s.checkTierUpgrade(ctx, referrerID)
	}
	return granted, nil
}

// GetReferralSummary returns the user's code, invited count, points earned and
// the bonus the program currently promises (0 when it is off).
func (s *Service) GetReferralSummary(ctx context.Context, userID string) (*ReferralSummary, error) {
	summary, err := s.repo.ReferralSummary(ctx, userID)
	if err != nil {
		return nil, err
	}
	summary.BonusPoints = s.referralBonus
	return summary, nil
}

func (s *Service) GetAccount(ctx context.Context, userID string) (*PointsAccount, error) {
	return s.repo.GetOrCreateAccount(ctx, userID)
}

func (s *Service) GetTransactions(ctx context.Context, userID string) ([]PointsTransaction, error) {
	return s.repo.GetTransactions(ctx, userID, 100)
}

// EarnPoints calculates and awards points based on a transaction amount and category.
// INTERNAL ONLY: not exposed over HTTP. The amount must come from a server-side
// money path (it is trusted here), so points stay funded by real captured margin;
// a client-reported amount would allow self-crediting redeemable points.
func (s *Service) EarnPoints(ctx context.Context, userID string, req *EarnPointsRequest) (*PointsTransaction, error) {
	// Ensure account exists
	acct, err := s.repo.GetOrCreateAccount(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Get applicable cashback rule
	rules, err := s.repo.GetCashbackRules(ctx)
	if err != nil {
		return nil, err
	}

	var matchedRule *CashbackRule
	for _, rule := range rules {
		if rule.Category == req.RefType {
			r := rule
			matchedRule = &r
			break
		}
	}

	if matchedRule == nil {
		// Default: 0.5% for unknown categories
		matchedRule = &CashbackRule{Percentage: 0.5, MaxPoints: 200}
	}

	// Calculate points: amount (centimos) / 100 * percentage / 100
	// Simplified: amount * percentage / 10000
	points := int64(float64(req.Amount) * matchedRule.Percentage / 10000)
	if points < 1 {
		points = 1
	}
	if points > matchedRule.MaxPoints {
		points = matchedRule.MaxPoints
	}

	// Apply tier bonus
	tierMultiplier := getTierMultiplier(acct.Tier)
	points = int64(float64(points) * tierMultiplier)

	// Record transaction
	ptx := &PointsTransaction{
		ID:          uuid.New().String(),
		UserID:      userID,
		Type:        "earn",
		Points:      points,
		Description: fmt.Sprintf("Cashback por %s", req.RefType),
		RefType:     req.RefType,
		RefID:       req.RefID,
	}

	if err := s.repo.RecordTransaction(ctx, ptx); err != nil {
		return nil, err
	}

	if err := s.repo.UpdatePoints(ctx, userID, points); err != nil {
		return nil, err
	}

	// Check tier upgrade
	s.checkTierUpgrade(ctx, userID)

	return ptx, nil
}

// GetRewards returns available rewards catalog.
func (s *Service) GetRewards(ctx context.Context) ([]Reward, error) {
	return s.repo.GetAvailableRewards(ctx)
}

// RedeemReward exchanges points for a reward.
func (s *Service) RedeemReward(ctx context.Context, userID string, req *RedeemRewardRequest) (*Redemption, error) {
	reward, err := s.repo.GetReward(ctx, req.RewardID)
	if err != nil {
		return nil, fmt.Errorf("reward not found")
	}

	if !reward.Active {
		return nil, fmt.Errorf("reward is no longer available")
	}

	// Un premio sin entrega no se canjea aunque este activo: descontar puntos
	// a cambio de un codigo que nadie lee es lo que corrigio la migracion 060.
	if reward.CashbackMinor <= 0 {
		return nil, ErrPremioSinEntrega
	}

	if reward.Stock == 0 {
		return nil, fmt.Errorf("reward is out of stock")
	}

	// Check sufficient points
	acct, err := s.repo.GetOrCreateAccount(ctx, userID)
	if err != nil {
		return nil, err
	}
	if acct.AvailablePoints < reward.PointsCost {
		return nil, fmt.Errorf("insufficient points: need %d, have %d", reward.PointsCost, acct.AvailablePoints)
	}

	// El canje ES el asiento: sale de la cuenta de promociones y entra a la
	// billetera, y en la misma transaccion se descuentan los puntos, se
	// escribe la redencion y se anota el movimiento. Si la cuenta de
	// promociones no alcanza, no pasa nada de eso.
	redemption, ptx := nuevaRedencion(userID, reward)
	if err := s.canjearCashback(ctx, reward, redemption, ptx); err != nil {
		return nil, err
	}
	redemption.CashbackMinor = reward.CashbackMinor
	return redemption, nil
}

func (s *Service) GetRedemptions(ctx context.Context, userID string) ([]Redemption, error) {
	return s.repo.GetUserRedemptions(ctx, userID)
}

func (s *Service) GetCashbackRules(ctx context.Context) ([]CashbackRule, error) {
	return s.repo.GetCashbackRules(ctx)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func getTierMultiplier(tier string) float64 {
	switch tier {
	case TierSilver:
		return 1.25
	case TierGold:
		return 1.50
	case TierPlatinum:
		return 2.0
	default:
		return 1.0
	}
}

func (s *Service) checkTierUpgrade(ctx context.Context, userID string) {
	acct, err := s.repo.GetOrCreateAccount(ctx, userID)
	if err != nil {
		return
	}

	newTier := TierBronze
	if acct.LifetimePoints >= PlatinumThreshold {
		newTier = TierPlatinum
	} else if acct.LifetimePoints >= GoldThreshold {
		newTier = TierGold
	} else if acct.LifetimePoints >= SilverThreshold {
		newTier = TierSilver
	}

	if newTier != acct.Tier {
		_ = s.repo.UpdateTier(ctx, userID, newTier) // best-effort tier upgrade
	}
}
