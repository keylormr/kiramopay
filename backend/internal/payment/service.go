package payment

import (
	"context"
	"fmt"

	"github.com/kiramopay/backend/internal/transaction"
)

type Service struct {
	repo      *Repository
	txService *transaction.Service
}

func NewService(repo *Repository, txService *transaction.Service) *Service {
	return &Service{repo: repo, txService: txService}
}

func (s *Service) PayBill(ctx context.Context, userID string, req *PayBillRequest) (*PayBillResponse, error) {
	if req.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}

	// Resolve provider
	_, providerName, err := s.repo.GetProviderByCode(ctx, req.ProviderCode)
	if err != nil {
		return nil, fmt.Errorf("invalid provider: %s", req.ProviderCode)
	}

	// Create transaction via transaction service
	txRecord, err := s.txService.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type:             transaction.TypeBillPayment,
		Amount:           req.Amount,
		Currency:         "CRC",
		Fee:              0,
		CounterpartyType: "service",
		CounterpartyName: providerName,
		Description:      fmt.Sprintf("Pago %s - Cliente %s", providerName, req.ClientID),
	})
	if err != nil {
		return nil, fmt.Errorf("process payment: %w", err)
	}

	// Record in payment history
	_ = s.repo.AddPaymentHistory(ctx, &PaymentHistoryRecord{
		UserID:       userID,
		Type:         "bill",
		ProviderCode: req.ProviderCode,
		ProviderName: providerName,
		ClientID:     req.ClientID,
		Amount:       req.Amount,
		Status:       "completed",
	})

	return &PayBillResponse{
		TransactionID: txRecord.ID,
		ReceiptNumber: fmt.Sprintf("RCP-%s", txRecord.ID[:8]),
		ProviderName:  providerName,
		Amount:        req.Amount,
		Status:        "completed",
	}, nil
}

func (s *Service) Recharge(ctx context.Context, userID string, req *RechargeRequest) (*RechargeResponse, error) {
	if req.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}

	// Map operator to display name
	operatorNames := map[string]string{
		"kolbi":    "Kölbi (ICE)",
		"claro":    "Claro",
		"movistar": "Movistar",
	}
	operatorName, ok := operatorNames[req.Operator]
	if !ok {
		return nil, fmt.Errorf("invalid operator: %s", req.Operator)
	}

	// Create transaction
	txRecord, err := s.txService.CreateTransaction(ctx, userID, &transaction.CreateTransactionRequest{
		Type:              transaction.TypeRecharge,
		Amount:            req.Amount,
		Currency:          "CRC",
		Fee:               0,
		CounterpartyType:  "service",
		CounterpartyName:  operatorName,
		CounterpartyPhone: req.Phone,
		Description:       fmt.Sprintf("Recarga %s %s", operatorName, req.Phone),
	})
	if err != nil {
		return nil, fmt.Errorf("process recharge: %w", err)
	}

	// Record in payment history
	_ = s.repo.AddPaymentHistory(ctx, &PaymentHistoryRecord{
		UserID:       userID,
		Type:         "recharge",
		ProviderCode: req.Operator,
		ProviderName: operatorName,
		ClientID:     req.Phone,
		Amount:       req.Amount,
		Status:       "completed",
	})

	return &RechargeResponse{
		TransactionID: txRecord.ID,
		Operator:      operatorName,
		Phone:         req.Phone,
		Amount:        req.Amount,
		Status:        "completed",
	}, nil
}

func (s *Service) GetSavedServices(ctx context.Context, userID string) ([]SavedServiceRecord, error) {
	return s.repo.GetSavedServices(ctx, userID)
}

func (s *Service) AddSavedService(ctx context.Context, userID, providerCode, clientID, nickname string) (*SavedServiceRecord, error) {
	providerID, providerName, err := s.repo.GetProviderByCode(ctx, providerCode)
	if err != nil {
		return nil, fmt.Errorf("provider not found")
	}

	record, err := s.repo.AddSavedService(ctx, userID, providerID, clientID, nickname)
	if err != nil {
		return nil, err
	}
	record.ProviderCode = providerCode
	record.ProviderName = providerName
	return record, nil
}

func (s *Service) GetPaymentHistory(ctx context.Context, userID string) ([]PaymentHistoryRecord, error) {
	return s.repo.GetPaymentHistory(ctx, userID, 50)
}
