package recurring

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Un pago recurrente es un RECORDATORIO que la persona lleva a mano: nada lo
// ejecuta. No hay tarea programada que cobre en next_date, y MarkPaid solo
// anota la fecha de hoy y corre next_date al siguiente periodo; no mueve
// dinero. Quien lea este modulo buscando "el cobro automatico": no existe.

// Rechazos del modulo. Antes todos salian como CREATE_FAILED/UPDATE_FAILED con
// el texto de fmt.Errorf; una fecha mal escrita o un nombre de 201 caracteres
// llegaban a la base y la respuesta traia el error crudo de Postgres.
var (
	ErrNoEncontrado       = errors.New("recurring: not found")
	ErrNombreRequerido    = errors.New("recurring: label is required")
	ErrNombreMuyLargo     = errors.New("recurring: label is too long")
	ErrMontoInvalido      = errors.New("recurring: amount must be positive")
	ErrTipoInvalido       = errors.New("recurring: invalid type")
	ErrFrecuenciaInvalida = errors.New("recurring: invalid frequency")
	ErrFechaInvalida      = errors.New("recurring: next_date must be a YYYY-MM-DD date")
	ErrCampoInvalido      = errors.New("recurring: invalid currency or recipient field")
)

// Los largos de la tabla recurring_payments (migracion 017).
const (
	largoMaximoNombre       = 200
	largoMaximoTelefono     = 15
	largoMaximoDestinatario = 100
	largoMaximoProveedor    = 20
	largoMaximoCliente      = 50
)

var (
	tiposValidos       = map[string]bool{"service": true, "sinpe": true, "recharge": true}
	frecuenciasValidas = map[string]bool{"weekly": true, "biweekly": true, "monthly": true}
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
	label, err := validarNombre(req.Label)
	if err != nil {
		return nil, err
	}
	if req.Amount <= 0 {
		return nil, ErrMontoInvalido
	}
	if !tiposValidos[req.Type] {
		return nil, ErrTipoInvalido
	}
	if !frecuenciasValidas[req.Frequency] {
		return nil, ErrFrecuenciaInvalida
	}
	if !fechaValida(req.NextDate) {
		return nil, ErrFechaInvalida
	}
	if req.Currency == "" {
		req.Currency = "CRC"
	}
	if req.Currency != "CRC" && req.Currency != "USD" {
		return nil, ErrCampoInvalido
	}
	if excede(req.RecipientPhone, largoMaximoTelefono) ||
		excede(req.RecipientName, largoMaximoDestinatario) ||
		excede(req.ServiceProviderID, largoMaximoProveedor) ||
		excede(req.ClientID, largoMaximoCliente) {
		return nil, ErrCampoInvalido
	}

	p := &RecurringPaymentRecord{
		UserID:            userID,
		Label:             label,
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
	if req.Amount != nil && *req.Amount <= 0 {
		return ErrMontoInvalido
	}
	if req.Frequency != nil && !frecuenciasValidas[*req.Frequency] {
		return ErrFrecuenciaInvalida
	}
	if req.NextDate != nil && !fechaValida(*req.NextDate) {
		return ErrFechaInvalida
	}
	return s.repo.Update(ctx, id, userID, req)
}

func (s *Service) Delete(ctx context.Context, id, userID string) error {
	if !idValido(id) {
		return ErrNoEncontrado
	}
	return s.repo.Delete(ctx, id, userID)
}

func (s *Service) Toggle(ctx context.Context, id, userID string) (bool, error) {
	if !idValido(id) {
		return false, ErrNoEncontrado
	}
	return s.repo.ToggleEnabled(ctx, id, userID)
}

// MarkPaid anota que la persona ya hizo el pago y corre la proxima fecha. No
// mueve dinero: el pago lo hizo ella por su cuenta (SINPE, servicios...).
func (s *Service) MarkPaid(ctx context.Context, id, userID string) (*RecurringPaymentRecord, error) {
	if !idValido(id) {
		return nil, ErrNoEncontrado
	}
	return s.repo.MarkPaid(ctx, id, userID)
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

// fechaValida exige la fecha civil que guarda la columna DATE. Una fecha que
// Postgres entenderia de otra forma ("03/04/2026") queda fuera: el dia y el
// mes no se adivinan.
func fechaValida(fecha string) bool {
	_, err := time.Parse("2006-01-02", fecha)
	return err == nil
}

func excede(valor string, largo int) bool {
	return utf8.RuneCountInString(valor) > largo
}
