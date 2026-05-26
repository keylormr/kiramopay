package crypto

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

type Service struct {
	repo   *Repository
	prices *PriceService
}

func NewService(repo *Repository, prices *PriceService) *Service {
	return &Service{repo: repo, prices: prices}
}

func (s *Service) GetAssets(ctx context.Context, userID string) ([]AssetRecord, error) {
	return s.repo.GetAssets(ctx, userID)
}

func (s *Service) GetTransactions(ctx context.Context, userID string) ([]TransactionRecord, error) {
	return s.repo.GetTransactions(ctx, userID, 50)
}

func (s *Service) Buy(ctx context.Context, userID string, req *BuyRequest) (*TransactionRecord, error) {
	if req.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}

	// Get asset name from symbol
	assetName := getAssetName(req.Asset)

	// Update user's crypto balance
	if err := s.repo.UpsertAsset(ctx, userID, req.Asset, assetName, req.Amount, req.Price); err != nil {
		return nil, fmt.Errorf("update asset balance: %w", err)
	}

	// Record transaction
	tx := &TransactionRecord{
		ID:       uuid.New().String(),
		UserID:   userID,
		Type:     "buy",
		Asset:    req.Asset,
		Amount:   req.Amount,
		Price:    req.Price,
		Total:    req.FromAmount,
		Currency: req.FromCurrency,
		Fee:      req.FromAmount * 0.005, // 0.5% fee
		Status:   "completed",
	}
	if err := s.repo.AddTransaction(ctx, tx); err != nil {
		return nil, fmt.Errorf("record transaction: %w", err)
	}

	return tx, nil
}

func (s *Service) Sell(ctx context.Context, userID string, req *SellRequest) (*TransactionRecord, error) {
	if req.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}

	// Check balance
	asset, err := s.repo.GetAsset(ctx, userID, req.Asset)
	if err != nil || asset.Balance < req.Amount {
		return nil, fmt.Errorf("insufficient %s balance", req.Asset)
	}

	// Deduct from balance
	if err := s.repo.UpsertAsset(ctx, userID, req.Asset, asset.Name, -req.Amount, 0); err != nil {
		return nil, fmt.Errorf("update asset balance: %w", err)
	}

	tx := &TransactionRecord{
		ID:       uuid.New().String(),
		UserID:   userID,
		Type:     "sell",
		Asset:    req.Asset,
		Amount:   req.Amount,
		Price:    req.Price,
		Total:    req.ToAmount,
		Currency: req.ToCurrency,
		Fee:      req.ToAmount * 0.005,
		Status:   "completed",
	}
	if err := s.repo.AddTransaction(ctx, tx); err != nil {
		return nil, fmt.Errorf("record transaction: %w", err)
	}

	return tx, nil
}

func (s *Service) Convert(ctx context.Context, userID string, req *ConvertRequest) (*TransactionRecord, error) {
	if req.FromAmount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}

	// Check from-asset balance
	fromAsset, err := s.repo.GetAsset(ctx, userID, req.FromAsset)
	if err != nil || fromAsset.Balance < req.FromAmount {
		return nil, fmt.Errorf("insufficient %s balance", req.FromAsset)
	}

	// Deduct from, add to
	toName := getAssetName(req.ToAsset)
	if err := s.repo.UpsertAsset(ctx, userID, req.FromAsset, fromAsset.Name, -req.FromAmount, 0); err != nil {
		return nil, err
	}
	if err := s.repo.UpsertAsset(ctx, userID, req.ToAsset, toName, req.ToAmount, req.Price); err != nil {
		return nil, err
	}

	tx := &TransactionRecord{
		ID:       uuid.New().String(),
		UserID:   userID,
		Type:     "convert",
		Asset:    fmt.Sprintf("%s→%s", req.FromAsset, req.ToAsset),
		Amount:   req.FromAmount,
		Price:    req.Price,
		Total:    req.ToAmount,
		Currency: req.ToAsset,
		Status:   "completed",
	}
	_ = s.repo.AddTransaction(ctx, tx)

	return tx, nil
}

func (s *Service) GetStakingPositions(ctx context.Context, userID string) ([]StakingRecord, error) {
	return s.repo.GetStakingPositions(ctx, userID)
}

func (s *Service) Stake(ctx context.Context, userID string, req *StakeRequest) (*StakingRecord, error) {
	if req.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}

	// Check balance
	asset, err := s.repo.GetAsset(ctx, userID, req.Asset)
	if err != nil || asset.Balance < req.Amount {
		return nil, fmt.Errorf("insufficient %s balance for staking", req.Asset)
	}

	// Deduct from balance (locked in staking)
	if err := s.repo.UpsertAsset(ctx, userID, req.Asset, asset.Name, -req.Amount, 0); err != nil {
		return nil, err
	}

	record := &StakingRecord{
		UserID:    userID,
		Asset:     req.Asset,
		Amount:    req.Amount,
		APY:       req.APY,
		StartDate: time.Now(),
		Locked:    req.Locked,
		LockDays:  req.LockDays,
		Earned:    0,
		Status:    "active",
	}
	if err := s.repo.AddStaking(ctx, record); err != nil {
		return nil, err
	}

	return record, nil
}

func (s *Service) Unstake(ctx context.Context, userID, positionID string) error {
	return s.repo.UpdateStakingStatus(ctx, positionID, "completed")
}

func (s *Service) GetPriceAlerts(ctx context.Context, userID string) ([]PriceAlertRecord, error) {
	return s.repo.GetPriceAlerts(ctx, userID)
}

func (s *Service) AddPriceAlert(ctx context.Context, userID string, alert *PriceAlertRecord) (*PriceAlertRecord, error) {
	alert.UserID = userID
	if err := s.repo.AddPriceAlert(ctx, alert); err != nil {
		return nil, err
	}
	return alert, nil
}

func (s *Service) RemovePriceAlert(ctx context.Context, alertID string) error {
	return s.repo.DeactivatePriceAlert(ctx, alertID)
}

func (s *Service) GetPrices(symbols []string) (map[string]*PriceData, error) {
	return s.prices.GetPrices(symbols)
}

func getAssetName(symbol string) string {
	names := map[string]string{
		"BTC":   "Bitcoin",
		"ETH":   "Ethereum",
		"SOL":   "Solana",
		"ADA":   "Cardano",
		"DOT":   "Polkadot",
		"AVAX":  "Avalanche",
		"LINK":  "Chainlink",
		"MATIC": "Polygon",
		"UNI":   "Uniswap",
		"ATOM":  "Cosmos",
	}
	if name, ok := names[symbol]; ok {
		return name
	}
	return symbol
}
