package budget

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Rechazos del modulo. Antes todos salian como CREATE_FAILED/UPDATE_FAILED con
// el texto de fmt.Errorf, y los que llegaban a la base (un nombre de 101
// caracteres, una moneda de cuatro letras) respondian con el error crudo de
// Postgres. Cada uno tiene ahora su codigo en el handler.
var (
	ErrNoEncontrado    = errors.New("budget: not found")
	ErrNombreRequerido = errors.New("budget: label is required")
	ErrNombreMuyLargo  = errors.New("budget: label is too long")
	ErrTopeInvalido    = errors.New("budget: amount_limit must be positive")
	ErrGastadoInvalido = errors.New("budget: amount_spent cannot be negative")
	ErrCampoInvalido   = errors.New("budget: invalid currency, period, icon or color")
)

// Los largos de la tabla budgets (migracion 016).
const (
	largoMaximoNombre = 100
	largoMaximoIcono  = 50
	largoMaximoColor  = 20
)

// El presupuesto es una lista que la persona lleva a mano: el tope lo pone
// ella y lo gastado lo anota ella (PATCH amount_spent). Ningun movimiento del
// libro lo actualiza, y "monthly" es solo la etiqueta del periodo: nada lo
// reinicia solo; POST /budgets/reset lo pone en cero cuando la persona decide.
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
	label, err := validarNombre(req.Label)
	if err != nil {
		return nil, err
	}
	if req.AmountLimit <= 0 {
		return nil, ErrTopeInvalido
	}
	if req.Currency == "" {
		req.Currency = "CRC"
	}
	if req.Currency != "CRC" && req.Currency != "USD" {
		return nil, ErrCampoInvalido
	}
	if req.Period == "" {
		req.Period = "monthly"
	}
	if req.Period != "monthly" {
		return nil, ErrCampoInvalido
	}
	if err := validarEstilo(&req.Icon, &req.Color); err != nil {
		return nil, err
	}

	b := &BudgetRecord{
		UserID:      userID,
		Label:       label,
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
	if !idValido(id) {
		return ErrNoEncontrado
	}
	if req.Label != nil {
		label, err := validarNombre(*req.Label)
		if err != nil {
			return err
		}
		req.Label = &label
	}
	if req.AmountLimit != nil && *req.AmountLimit <= 0 {
		return ErrTopeInvalido
	}
	if req.AmountSpent != nil && *req.AmountSpent < 0 {
		return ErrGastadoInvalido
	}
	if err := validarEstilo(req.Icon, req.Color); err != nil {
		return err
	}
	return s.repo.Update(ctx, id, userID, req)
}

func (s *Service) Delete(ctx context.Context, id, userID string) error {
	if !idValido(id) {
		return ErrNoEncontrado
	}
	return s.repo.Delete(ctx, id, userID)
}

func (s *Service) ResetAll(ctx context.Context, userID string) error {
	return s.repo.ResetAllSpent(ctx, userID)
}

// idValido: un id que no es UUID no existe. Sin esto llegaba a la base y
// Postgres lo rechazaba con un error de sintaxis, que salia como falla del
// servidor.
func idValido(id string) bool {
	_, err := uuid.Parse(id)
	return err == nil
}

func validarNombre(nombre string) (string, error) {
	limpio := strings.TrimSpace(nombre)
	if limpio == "" {
		return "", ErrNombreRequerido
	}
	if utf8.RuneCountInString(limpio) > largoMaximoNombre {
		return "", ErrNombreMuyLargo
	}
	return limpio, nil
}

// validarEstilo acepta punteros nil (un PATCH que no los toca).
func validarEstilo(icono, color *string) error {
	if icono != nil && utf8.RuneCountInString(*icono) > largoMaximoIcono {
		return ErrCampoInvalido
	}
	if color != nil && utf8.RuneCountInString(*color) > largoMaximoColor {
		return ErrCampoInvalido
	}
	return nil
}
