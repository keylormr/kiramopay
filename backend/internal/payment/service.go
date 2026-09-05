package payment

import (
	"context"
	"errors"
	"fmt"

	"github.com/kiramopay/backend/internal/transaction"
)

// ErrSinConvenio se devuelve cuando se intenta pagar un recibo o recargar un
// telefono y no hay integracion con la empresa ni con el operador.
//
// Sin convenio, cobrar es debitar la billetera de verdad y dejar la plata en
// SYSTEM:EXTERNAL: nadie la recibe, el recibo que se emite no vale nada y no
// hay camino de reverso. Es exactamente el caso que este repositorio ya
// rechaza en otros dos lugares —sinpe.Send se niega a enviar a quien no es
// usuario ("tomar la plata y mostrar pendiente para siempre es peor que decir
// que no") y cmd/api/main.go se niega a registrar el riel de prueba de payouts
// en produccion porque "debita la billetera real pero nunca desembolsa"—.
// Estas dos rutas se habian saltado esa politica.
var ErrSinConvenio = errors.New("sin convenio con el proveedor: el cobro no se puede entregar")

type Service struct {
	repo      *Repository
	txService *transaction.Service
	// convenios habilita el cobro. Falso mientras no exista integracion real;
	// se enciende por entorno igual que el registro de rieles de payouts, para
	// que las demos fuera de produccion sigan funcionando.
	convenios bool
}

// Options configura el servicio. ConveniosActivos solo debe ser verdadero
// donde exista una integracion que de verdad entregue el pago.
type Options struct {
	ConveniosActivos bool
}

func NewService(repo *Repository, txService *transaction.Service, opts *Options) *Service {
	s := &Service{repo: repo, txService: txService}
	if opts != nil {
		s.convenios = opts.ConveniosActivos
	}
	return s
}

func (s *Service) PayBill(ctx context.Context, userID string, req *PayBillRequest) (*PayBillResponse, error) {
	if !s.convenios {
		return nil, ErrSinConvenio
	}
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
		Internal:         true,
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
	if !s.convenios {
		return nil, ErrSinConvenio
	}
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
		Internal:          true,
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
