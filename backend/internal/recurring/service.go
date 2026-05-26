package recurring

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

func (s *Service) List(ctx context.Context, userID string) ([]RecurringPaymentRecord, error) {
	return s.repo.FindByUserID(ctx, userID)
}

func (s *Service) Create(ctx context.Context, userID string, req *CreateRecurringRequest) (*RecurringPaymentRecord, error) {
	if req.Label == "" {
		return nil, fmt.Errorf("label is required")
	}
	if req.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}
	validTypes := map[string]bool{"service": true, "sinpe": true, "recharge": true}
	if !validTypes[req.Type] {
		return nil, fmt.Errorf("invalid type: must be service, sinpe, or recharge")
	}
	validFreqs := map[string]bool{"weekly": true, "biweekly": true, "monthly": true}
	if !validFreqs[req.Frequency] {
		return nil, fmt.Errorf("invalid frequency: must be weekly, biweekly, or monthly")
	}
	if req.NextDate == "" {
		return nil, fmt.Errorf("next_date is required")
	}
	if req.Currency == "" {
		req.Currency = "CRC"
	}

	p := &RecurringPaymentRecord{
		UserID:            userID,
		Label:             req.Label,
		Type:              req.Type,
		Amount:            req.Amount,
		Currency:          req.Currency,
		Frequency:         req.Frequency,
		NextDate:          req.NextDate,
		RecipientPhone:    req.RecipientPhone,
		RecipientName:     req.RecipientName,
		ServiceProviderID: req.ServiceProviderID,
		ClientID:          req.ClientID,
		Enabled:           true,
	}

	if err := s.repo.Create(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

func (s *Service) Update(ctx context.Context, id, userID string, req *UpdateRecurringRequest) error {
	return s.repo.Update(ctx, id, userID, req)
}

func (s *Service) Delete(ctx context.Context, id, userID string) error {
	return s.repo.Delete(ctx, id, userID)
}

func (s *Service) Toggle(ctx context.Context, id, userID string) (bool, error) {
	return s.repo.ToggleEnabled(ctx, id, userID)
}

func (s *Service) MarkPaid(ctx context.Context, id, userID string) (*RecurringPaymentRecord, error) {
	return s.repo.MarkPaid(ctx, id, userID)
}
