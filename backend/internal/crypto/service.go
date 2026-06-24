package crypto

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/shopspring/decimal"
)

type Service struct {
	repo   *Repository
	prices *PriceService
	tx     *transaction.Service
}

func NewService(repo *Repository, prices *PriceService, tx *transaction.Service) *Service {
	return &Service{repo: repo, prices: prices, tx: tx}
}

// toMinor converts a fiat amount (CRC/USD, 2 decimals) to integer centimos,
// exactly (no float round-trip).
func toMinor(v decimal.Decimal) int64 {
	return v.Mul(decimal.NewFromInt(100)).Round(0).IntPart()
}

func (s *Service) GetAssets(ctx context.Context, userID string) ([]AssetRecord, error) {
	return s.repo.GetAssets(ctx, userID)
}

func (s *Service) GetTransactions(ctx context.Context, userID string) ([]TransactionRecord, error) {
	return s.repo.GetTransactions(ctx, userID, 50)
}

func (s *Service) Buy(ctx context.Context, userID string, req *BuyRequest) (*TransactionRecord, error) {
	if !req.Amount.IsPositive() {
		return nil, fmt.Errorf("amount must be positive")
	}
	if !req.FromAmount.IsPositive() {
		return nil, fmt.Errorf("from_amount must be positive")
	}
	currency := req.FromCurrency
	if currency == "" {
		currency = "CRC"
	}
	fiatMinor := toMinor(req.FromAmount)
	if fiatMinor <= 0 {
		return nil, fmt.Errorf("from_amount too small")
	}

	idem := req.IdempotencyKey
	if idem == "" {
		idem = "crypto:buy:" + uuid.New().String()
	}

	// 1. Debit fiat THROUGH THE LEDGER. Balance check, MFA gating and
	//    idempotency all live inside the transaction service — no crypto is
	//    credited unless the fiat actually leaves the wallet.
	if _, err := s.tx.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type:             transaction.TypeCryptoBuy,
		Amount:           fiatMinor,
		Currency:         currency,
		Fee:              0,
		CounterpartyType: "crypto",
		CounterpartyName: req.Asset,
		Description:      fmt.Sprintf("Buy %s", req.Asset),
		IdempotencyKey:   idem,
	}); err != nil {
		return nil, fmt.Errorf("debit fiat: %w", err)
	}

	// 2. Credit the crypto asset. If this fails after the fiat debit, the
	//    fiat movement is already recorded in the transactions table + journal
	//    and is caught by reconciliation (ref = idempotency key).
	assetName := getAssetName(req.Asset)
	if err := s.repo.UpsertAsset(ctx, userID, req.Asset, assetName, req.Amount, req.Price); err != nil {
		return nil, fmt.Errorf("credit crypto asset (fiat already debited, ref %s): %w", idem, err)
	}

	tx := &TransactionRecord{
		ID:       uuid.New().String(),
		UserID:   userID,
		Type:     "buy",
		Asset:    req.Asset,
		Amount:   req.Amount,
		Price:    req.Price,
		Total:    req.FromAmount,
		Currency: currency,
		Fee:      decimal.Zero,
		Status:   "completed",
	}
	if err := s.repo.AddTransaction(ctx, tx); err != nil {
		return nil, fmt.Errorf("record transaction: %w", err)
	}

	return tx, nil
}

func (s *Service) Sell(ctx context.Context, userID string, req *SellRequest) (*TransactionRecord, error) {
	if !req.Amount.IsPositive() {
		return nil, fmt.Errorf("amount must be positive")
	}
	if !req.ToAmount.IsPositive() {
		return nil, fmt.Errorf("to_amount must be positive")
	}
	currency := req.ToCurrency
	if currency == "" {
		currency = "CRC"
	}
	fiatMinor := toMinor(req.ToAmount)
	if fiatMinor <= 0 {
		return nil, fmt.Errorf("to_amount too small")
	}

	// Check balance
	asset, err := s.repo.GetAsset(ctx, userID, req.Asset)
	if err != nil || asset.Balance.LessThan(req.Amount) {
		return nil, fmt.Errorf("insufficient %s balance", req.Asset)
	}

	idem := req.IdempotencyKey
	if idem == "" {
		idem = "crypto:sell:" + uuid.New().String()
	}

	// 1. Debit the crypto asset first.
	if err := s.repo.UpsertAsset(ctx, userID, req.Asset, asset.Name, req.Amount.Neg(), decimal.Zero); err != nil {
		return nil, fmt.Errorf("debit crypto asset: %w", err)
	}

	// 2. Credit fiat THROUGH THE LEDGER. If this fails, compensate by
	//    re-crediting the crypto so the user is never left short.
	if _, err := s.tx.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type:             transaction.TypeCryptoSell,
		Amount:           fiatMinor,
		Currency:         currency,
		Fee:              0,
		CounterpartyType: "crypto",
		CounterpartyName: req.Asset,
		Description:      fmt.Sprintf("Sell %s", req.Asset),
		IdempotencyKey:   idem,
	}); err != nil {
		if cerr := s.repo.UpsertAsset(ctx, userID, req.Asset, asset.Name, req.Amount, decimal.Zero); cerr != nil {
			return nil, fmt.Errorf("credit fiat failed (%v) AND crypto compensation failed (%v) ref %s", err, cerr, idem)
		}
		return nil, fmt.Errorf("credit fiat: %w", err)
	}

	tx := &TransactionRecord{
		ID:       uuid.New().String(),
		UserID:   userID,
		Type:     "sell",
		Asset:    req.Asset,
		Amount:   req.Amount,
		Price:    req.Price,
		Total:    req.ToAmount,
		Currency: currency,
		Fee:      decimal.Zero,
		Status:   "completed",
	}
	if err := s.repo.AddTransaction(ctx, tx); err != nil {
		return nil, fmt.Errorf("record transaction: %w", err)
	}

	return tx, nil
}

func (s *Service) Convert(ctx context.Context, userID string, req *ConvertRequest) (*TransactionRecord, error) {
	if !req.FromAmount.IsPositive() {
		return nil, fmt.Errorf("amount must be positive")
	}

	// Check from-asset balance
	fromAsset, err := s.repo.GetAsset(ctx, userID, req.FromAsset)
	if err != nil || fromAsset.Balance.LessThan(req.FromAmount) {
		return nil, fmt.Errorf("insufficient %s balance", req.FromAsset)
	}

	// Deduct from, add to
	toName := getAssetName(req.ToAsset)
	if err := s.repo.UpsertAsset(ctx, userID, req.FromAsset, fromAsset.Name, req.FromAmount.Neg(), decimal.Zero); err != nil {
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
	if !req.Amount.IsPositive() {
		return nil, fmt.Errorf("amount must be positive")
	}

	// Check balance
	asset, err := s.repo.GetAsset(ctx, userID, req.Asset)
	if err != nil || asset.Balance.LessThan(req.Amount) {
		return nil, fmt.Errorf("insufficient %s balance for staking", req.Asset)
	}

	// Deduct from balance (locked in staking)
	if err := s.repo.UpsertAsset(ctx, userID, req.Asset, asset.Name, req.Amount.Neg(), decimal.Zero); err != nil {
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
		Earned:    decimal.Zero,
		Status:    "active",
	}
	if err := s.repo.AddStaking(ctx, record); err != nil {
		return nil, err
	}

	return record, nil
}

func (s *Service) Unstake(ctx context.Context, userID, positionID string) error {
	return s.repo.UpdateStakingStatus(ctx, positionID, userID, "completed")
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

func (s *Service) RemovePriceAlert(ctx context.Context, userID, alertID string) error {
	return s.repo.DeactivatePriceAlert(ctx, alertID, userID)
}

func (s *Service) GetPrices(ctx context.Context, symbols []string) (map[string]*PriceData, error) {
	return s.prices.GetPrices(ctx, symbols)
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
