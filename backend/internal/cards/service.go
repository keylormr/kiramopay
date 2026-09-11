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

	// El numero es DECORATIVO y no puede ser el de nadie. Ver numeroDecorativo.
	cardNumber := numeroDecorativo()
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
		// No es VISA ni ninguna otra red: es una tarjeta de KiramoPay que no
		// sirve fuera de la app. Rotularla VISA prometia lo que no es.
		Brand:        MarcaKiramoPay,
		Type:         cardType,
		Currency:     req.Currency,
		Status:       "active",
		DailyLimit:   DefaultDailyLimit,
		MonthlyLimit: DefaultMonthlyLimit,
		AtmLimit:     DefaultATMLimit,
		CreatedAt:    time.Now(),
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

// La tarjeta imprimia el numero de otra persona.
//
// La funcion anterior armaba 16 digitos que empezaban en 4 y les calculaba el
// digito verificador de Luhn: eso no es "un numero de ejemplo", es un numero de
// tarjeta VISA sintacticamente valido, que puede coincidir con el de alguien
// real que no es usuario de la aplicacion y no tiene forma de enterarse. Quien
// lo copiara de la pantalla tenia en la mano, potencialmente, la tarjeta de un
// tercero.
//
// numeroDecorativo lo hace imposible por dos lados a la vez:
//   - empieza en 8, que no es el prefijo de ninguna red de tarjetas de pago
//     (4 es VISA, 5 y 2 Mastercard, 3 American Express y Diners, 6 Discover);
//   - y su digito verificador es INCORRECTO a proposito. Todas las tarjetas
//     del mundo pasan la verificacion de Luhn y todo procesador la comprueba
//     antes de cualquier otra cosa: un numero que la falla no puede ser una
//     tarjeta, y ningun comercio lo acepta.
//
// Con uno solo de los dos bastaria; van los dos para que ninguno dependa del
// otro.
func numeroDecorativo() string {
	num := prefijoDecorativo
	for len(num) < 15 {
		n, _ := rand.Int(rand.Reader, big.NewInt(10))
		num += fmt.Sprintf("%d", n.Int64())
	}
	// Cualquier digito distinto del correcto hace fallar Luhn; se usa el
	// siguiente para que sea determinista dado el cuerpo.
	return num + fmt.Sprintf("%d", (luhnCheckDigit(num)+1)%10)
}

// prefijoDecorativo no es el de ninguna red de pago.
const prefijoDecorativo = "8"

// pasaLuhn dice si un numero pasa la verificacion de Luhn, que es lo primero
// que comprueba cualquier procesador de tarjetas.
func pasaLuhn(numero string) bool {
	if len(numero) < 2 {
		return false
	}
	cuerpo, verificador := numero[:len(numero)-1], int(numero[len(numero)-1]-'0')
	return luhnCheckDigit(cuerpo) == verificador
}

func generateCVV() string {
	cvv := ""
	for i := 0; i < 3; i++ {
		n, _ := rand.Int(rand.Reader, big.NewInt(10))
		cvv += fmt.Sprintf("%d", n.Int64())
	}
	return cvv
}

// luhnCheckDigit devuelve el digito verificador de Luhn para `cuerpo`, el
// numero SIN su ultimo digito.
//
// La version anterior duplicaba con la paridad invertida: usaba la regla de
// VALIDAR un numero completo (donde el ultimo digito no se duplica) para
// CALCULAR el digito que falta (donde el ultimo digito del cuerpo si se
// duplica). El resultado solo coincidia con el correcto por casualidad, mas o
// menos una vez de cada diez. Lo delato una prueba contra numeros de tarjeta
// publicos: la anterior comparaba esta funcion contra si misma y no podia
// verlo.
func luhnCheckDigit(cuerpo string) int {
	suma := 0
	duplicar := true // el digito de mas a la derecha del cuerpo se duplica
	for i := len(cuerpo) - 1; i >= 0; i-- {
		d := int(cuerpo[i] - '0')
		if duplicar {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		suma += d
		duplicar = !duplicar
	}
	return (10 - suma%10) % 10
}
