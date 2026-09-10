package country

import (
	"context"
	"errors"
	"fmt"
	"math"

	"github.com/google/uuid"
)

// ErrSinCorresponsal se devuelve al intentar mandar una remesa a otro pais sin
// corresponsal que la entregue del otro lado.
//
// La transferencia se creaba con estado 'processing' y cumplimiento 'approved',
// y tres renglones despues se marcaba 'completed'. No tocaba el libro, no
// debitaba y no habia nadie recibiendo: al remitente se le decia que su plata
// cruzo la frontera y no salio nada. Es la misma politica que este repositorio
// ya aplica en payment.ErrSinConvenio (recibos y recargas),
// marketplace.ErrSinIntegracion (viajes y pedidos) y sinpe.Send (no se envia a
// quien no es usuario): si no hay quien entregue, se dice que no.
var ErrSinCorresponsal = errors.New("sin corresponsal en el pais de destino: la remesa no se puede entregar")

type Service struct {
	repo *Repository
	// corresponsal habilita la remesa. Falso mientras no exista un socio que
	// la entregue; se enciende por entorno igual que los convenios de recibos y
	// los cobros del marketplace, para que las demos fuera de produccion sigan
	// funcionando.
	corresponsal bool
}

// Options configura el servicio. CorresponsalActivo solo debe ser verdadero
// donde exista un socio que de verdad entregue el dinero al destinatario.
type Options struct {
	CorresponsalActivo bool
}

func NewService(repo *Repository, opts *Options) *Service {
	s := &Service{repo: repo}
	if opts != nil {
		s.corresponsal = opts.CorresponsalActivo
	}
	return s
}

func (s *Service) GetCountries(ctx context.Context) ([]Country, error) {
	return s.repo.GetCountries(ctx)
}

func (s *Service) GetExchangeRates(ctx context.Context) ([]ExchangeRate, error) {
	return s.repo.GetAllRates(ctx)
}

func (s *Service) ConvertCurrency(ctx context.Context, req *ConvertCurrencyRequest) (int64, float64, error) {
	rate, err := s.repo.GetExchangeRate(ctx, req.FromCurrency, req.ToCurrency)
	if err != nil {
		return 0, 0, fmt.Errorf("exchange rate not available for %s → %s", req.FromCurrency, req.ToCurrency)
	}

	converted := int64(math.Round(float64(req.Amount) * rate.Rate))
	return converted, rate.Rate, nil
}

func (s *Service) GetUserWallets(ctx context.Context, userID string) ([]RegionalWallet, error) {
	return s.repo.GetUserWallets(ctx, userID)
}

func (s *Service) CreateWallet(ctx context.Context, userID, countryCode string) (*RegionalWallet, error) {
	country, err := s.repo.GetCountryByCode(ctx, countryCode)
	if err != nil {
		return nil, fmt.Errorf("country not found: %s", countryCode)
	}
	if !country.Active {
		return nil, fmt.Errorf("country %s is not yet available", countryCode)
	}

	return s.repo.GetOrCreateWallet(ctx, userID, countryCode, country.Currency)
}

// SendCrossBorder initiates a cross-border transfer between countries.
func (s *Service) SendCrossBorder(ctx context.Context, senderID string, req *CrossBorderRequest) (*CrossBorderTransfer, error) {
	// Antes de leer nada: sin corresponsal no hay entrega, y esta funcion
	// termina afirmando que la hubo.
	if !s.corresponsal {
		return nil, ErrSinCorresponsal
	}
	if req.ReceiverPhone == "" {
		return nil, fmt.Errorf("receiver phone is required")
	}
	if req.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}

	// Determine sender country from currency
	senderCountry := currencyToCountry(req.Currency)
	if senderCountry == "" {
		return nil, fmt.Errorf("unsupported currency: %s", req.Currency)
	}

	receiverCountry, err := s.repo.GetCountryByCode(ctx, req.ToCountry)
	if err != nil {
		return nil, fmt.Errorf("destination country not found")
	}

	// Get exchange rate
	rate, err := s.repo.GetExchangeRate(ctx, req.Currency, receiverCountry.Currency)
	if err != nil {
		return nil, fmt.Errorf("exchange rate unavailable for %s → %s", req.Currency, receiverCountry.Currency)
	}

	// Calculate fee
	fee := int64(math.Round(float64(req.Amount) * TransferFeePercent / 100))
	if fee < MinTransferFee {
		fee = MinTransferFee
	}

	// Calculate received amount
	toAmount := int64(math.Round(float64(req.Amount-fee) * rate.Rate))

	transfer := &CrossBorderTransfer{
		ID:               uuid.New().String(),
		SenderID:         senderID,
		ReceiverPhone:    req.ReceiverPhone,
		FromCountry:      senderCountry,
		ToCountry:        req.ToCountry,
		FromCurrency:     req.Currency,
		ToCurrency:       receiverCountry.Currency,
		FromAmount:       req.Amount,
		ToAmount:         toAmount,
		ExchangeRate:     rate.Rate,
		Fee:              fee,
		Status:           "processing",
		ComplianceStatus: "approved", // simplified — real system does AML check
	}

	if err := s.repo.CreateTransfer(ctx, transfer); err != nil {
		return nil, err
	}

	// Auto-complete for now (real system would be async)
	_ = s.repo.UpdateTransferStatus(ctx, transfer.ID, "completed") // best-effort
	transfer.Status = "completed"

	return transfer, nil
}

func (s *Service) GetTransferHistory(ctx context.Context, userID string) ([]CrossBorderTransfer, error) {
	return s.repo.ListUserTransfers(ctx, userID, 50)
}

func (s *Service) GetTransfer(ctx context.Context, transferID string) (*CrossBorderTransfer, error) {
	return s.repo.GetTransfer(ctx, transferID)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func currencyToCountry(currency string) string {
	m := map[string]string{
		"CRC": "CR",
		"PAB": "PA",
		"USD": "PA", // default USD to Panama since PAB=USD
		"GTQ": "GT",
	}
	return m[currency]
}
