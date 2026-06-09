package loyalty

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"

	"github.com/google/uuid"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) GetAccount(ctx context.Context, userID string) (*PointsAccount, error) {
	return s.repo.GetOrCreateAccount(ctx, userID)
}

func (s *Service) GetTransactions(ctx context.Context, userID string) ([]PointsTransaction, error) {
	return s.repo.GetTransactions(ctx, userID, 100)
}

// EarnPoints calculates and awards points based on a transaction amount and category.
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

	// Deduct points
	if err := s.repo.DeductPoints(ctx, userID, reward.PointsCost); err != nil {
		return nil, err
	}

	// Decrement stock if not unlimited
	if reward.Stock > 0 {
		if err := s.repo.DecrementRewardStock(ctx, req.RewardID); err != nil {
			return nil, err
		}
	}

	// Generate voucher code
	code := generateVoucherCode()

	redemption := &Redemption{
		ID:       uuid.New().String(),
		UserID:   userID,
		RewardID: req.RewardID,
		Points:   reward.PointsCost,
		Status:   "completed",
		Code:     code,
	}

	if err := s.repo.CreateRedemption(ctx, redemption); err != nil {
		return nil, err
	}

	// Record points deduction
	ptx := &PointsTransaction{
		ID:          uuid.New().String(),
		UserID:      userID,
		Type:        "redeem",
		Points:      -reward.PointsCost,
		Description: fmt.Sprintf("Canje: %s", reward.Name),
		RefType:     "redemption",
		RefID:       redemption.ID,
	}
	_ = s.repo.RecordTransaction(ctx, ptx) // best-effort points ledger record

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

func generateVoucherCode() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b) // crypto/rand.Read does not fail in practice
	return "KP-" + hex.EncodeToString(b)
}
