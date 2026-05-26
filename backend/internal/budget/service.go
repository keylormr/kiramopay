package budget

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

func (s *Service) List(ctx context.Context, userID string) ([]BudgetRecord, error) {
	return s.repo.FindByUserID(ctx, userID)
}

func (s *Service) Create(ctx context.Context, userID string, req *CreateBudgetRequest) (*BudgetRecord, error) {
	if req.Label == "" {
		return nil, fmt.Errorf("label is required")
	}
	if req.AmountLimit <= 0 {
		return nil, fmt.Errorf("amount_limit must be positive")
	}
	if req.Currency == "" {
		req.Currency = "CRC"
	}
	if req.Period == "" {
		req.Period = "monthly"
	}

	b := &BudgetRecord{
		UserID:      userID,
		Label:       req.Label,
		AmountLimit: req.AmountLimit,
		Currency:    req.Currency,
		Icon:        req.Icon,
		Color:       req.Color,
		Period:      req.Period,
	}

	if err := s.repo.Create(ctx, b); err != nil {
		return nil, err
	}
	return b, nil
}

func (s *Service) Update(ctx context.Context, id, userID string, req *UpdateBudgetRequest) error {
	return s.repo.Update(ctx, id, userID, req)
}

func (s *Service) Delete(ctx context.Context, id, userID string) error {
	return s.repo.Delete(ctx, id, userID)
}

func (s *Service) ResetAll(ctx context.Context, userID string) error {
	return s.repo.ResetAllSpent(ctx, userID)
}
