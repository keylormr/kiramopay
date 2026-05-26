package wallet

import (
	"context"
	"fmt"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) GetWallet(ctx context.Context, userID string) (*WalletRecord, error) {
	w, err := s.repo.FindByUserID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("wallet not found")
	}
	return w, nil
}

func (s *Service) GetBalance(ctx context.Context, userID string) (*BalanceResponse, error) {
	w, err := s.repo.FindByUserID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("wallet not found")
	}

	return &BalanceResponse{
		CRC:          w.BalanceCRC,
		USD:          w.BalanceUSD,
		CRCFormatted: formatCRC(w.BalanceCRC),
		USDFormatted: formatUSD(w.BalanceUSD),
	}, nil
}

func formatCRC(centimos int64) string {
	colones := centimos / 100
	cents := centimos % 100
	return fmt.Sprintf("₡%d.%02d", colones, cents)
}

func formatUSD(cents int64) string {
	dollars := cents / 100
	c := cents % 100
	return fmt.Sprintf("$%d.%02d", dollars, c)
}
