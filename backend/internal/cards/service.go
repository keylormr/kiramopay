package cards

import (
	"context"
	"crypto/rand"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) CreateCard(ctx context.Context, userID, cardholderName string, req *CreateCardRequest) (*VirtualCard, error) {
	// Check max cards
	count, err := s.repo.CountUserCards(ctx, userID)
	if err != nil {
		return nil, err
	}
	if count >= MaxCardsPerUser {
		return nil, fmt.Errorf("maximum %d cards allowed", MaxCardsPerUser)
	}

	if req.Currency == "" {
		req.Currency = "CRC"
	}

	cardType := req.Type
	if cardType == "" {
		cardType = "virtual"
	}

	// Generate card number (simulated — real implementation uses Stripe/Marqeta)
	cardNumber := generateCardNumber()
	last4 := cardNumber[len(cardNumber)-4:]
	cvv := generateCVV()
	expiryMonth := int(time.Now().Month())
	expiryYear := time.Now().Year() + 3

	card := &VirtualCard{
		ID:             uuid.New().String(),
		UserID:         userID,
		CardNumber:     cardNumber,
		Last4:          last4,
		ExpiryMonth:    expiryMonth,
		ExpiryYear:     expiryYear,
		CVV:            cvv,
		CardholderName: cardholderName,
		Brand:          "visa",
		Type:           cardType,
		Currency:       req.Currency,
		Status:         "active",
		DailyLimit:     DefaultDailyLimit,
		MonthlyLimit:   DefaultMonthlyLimit,
		AtmLimit:       DefaultATMLimit,
		CreatedAt:      time.Now(),
	}

	if err := s.repo.CreateCard(ctx, card); err != nil {
		return nil, err
	}

	return card, nil
}

func (s *Service) GetCards(ctx context.Context, userID string) ([]VirtualCard, error) {
	cards, err := s.repo.GetUserCards(ctx, userID)
	if err != nil {
		return nil, err
	}
	// Mask card numbers for list view
	for i := range cards {
		cards[i].CardNumber = "•••• •••• •••• " + cards[i].Last4
		cards[i].CVV = ""
	}
	return cards, nil
}

func (s *Service) GetCard(ctx context.Context, cardID, userID string) (*VirtualCard, error) {
	card, err := s.repo.GetCard(ctx, cardID)
	if err != nil {
		return nil, fmt.Errorf("card not found")
	}
	if card.UserID != userID {
		return nil, fmt.Errorf("unauthorized")
	}
	card.CardNumber = "•••• •••• •••• " + card.Last4
	card.CVV = ""
	return card, nil
}

func (s *Service) FreezeCard(ctx context.Context, cardID, userID string, frozen bool) error {
	card, err := s.repo.GetCard(ctx, cardID)
	if err != nil {
		return fmt.Errorf("card not found")
	}
	if card.UserID != userID {
		return fmt.Errorf("unauthorized")
	}

	if frozen {
		return s.repo.UpdateCardStatus(ctx, cardID, "frozen")
	}
	return s.repo.UpdateCardStatus(ctx, cardID, "active")
}

func (s *Service) CancelCard(ctx context.Context, cardID, userID string) error {
	card, err := s.repo.GetCard(ctx, cardID)
	if err != nil {
		return fmt.Errorf("card not found")
	}
	if card.UserID != userID {
		return fmt.Errorf("unauthorized")
	}
	return s.repo.UpdateCardStatus(ctx, cardID, "cancelled")
}

func (s *Service) UpdateLimits(ctx context.Context, cardID, userID string, req *UpdateLimitsRequest) error {
	card, err := s.repo.GetCard(ctx, cardID)
	if err != nil {
		return fmt.Errorf("card not found")
	}
	if card.UserID != userID {
		return fmt.Errorf("unauthorized")
	}

	return s.repo.UpdateLimits(ctx, cardID, req.DailyLimit, req.MonthlyLimit, req.AtmLimit)
}

func (s *Service) GetCardTransactions(ctx context.Context, cardID, userID string) ([]CardTransaction, error) {
	card, err := s.repo.GetCard(ctx, cardID)
	if err != nil {
		return nil, fmt.Errorf("card not found")
	}
	if card.UserID != userID {
		return nil, fmt.Errorf("unauthorized")
	}
	return s.repo.GetCardTransactions(ctx, cardID, 50)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func generateCardNumber() string {
	// Simulated VISA: starts with 4, 16 digits, passes Luhn check
	prefix := "4"
	num := prefix
	for len(num) < 15 {
		n, _ := rand.Int(rand.Reader, big.NewInt(10))
		num += fmt.Sprintf("%d", n.Int64())
	}
	// Calculate Luhn check digit
	checkDigit := luhnCheckDigit(num)
	return num + fmt.Sprintf("%d", checkDigit)
}

func generateCVV() string {
	cvv := ""
	for i := 0; i < 3; i++ {
		n, _ := rand.Int(rand.Reader, big.NewInt(10))
		cvv += fmt.Sprintf("%d", n.Int64())
	}
	return cvv
}

func luhnCheckDigit(number string) int {
	sum := 0
	nDigits := len(number)
	parity := nDigits % 2
	for i := 0; i < nDigits; i++ {
		digit := int(number[i] - '0')
		if i%2 == parity {
			digit *= 2
			if digit > 9 {
				digit -= 9
			}
		}
		sum += digit
	}
	return (10 - (sum % 10)) % 10
}
