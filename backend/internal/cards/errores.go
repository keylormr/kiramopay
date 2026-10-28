package cards

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/kiramopay/backend/internal/plans"
	"github.com/kiramopay/backend/pkg/response"
)

// Crear una tarjeta devolvia 400 CREATE_FAILED con err.Error() crudo: el texto
// del controlador de la base ("ERROR: ... SQLSTATE 22001") llegaba a la
// pantalla. Cada motivo que la persona puede corregir tiene ahora su codigo, y
// lo demas es un 500 que no cuenta nada (el detalle queda en el log).

var (
	// ErrMonedaInvalida: la tarjeta se emite en una moneda que la app maneja
	// (colones o dolares).
	ErrMonedaInvalida = errors.New("invalid card currency")
	// ErrTipoDeTarjetaInvalido: solo existen la virtual y la fisica.
	ErrTipoDeTarjetaInvalido = errors.New("invalid card type")
	// ErrSinNombre: el perfil no tiene nombre que imprimir como titular. No se
	// inventa uno.
	ErrSinNombre = errors.New("the profile has no name to print on the card")
)

// LargoMaximoDelTitular es lo que cabe en virtual_cards.cardholder_name.
const LargoMaximoDelTitular = 200

// validarPeticionDeTarjeta completa lo que falta (colones, virtual) y normaliza
// la moneda a mayusculas. Rechaza lo que la app no emite.
func validarPeticionDeTarjeta(req *CreateCardRequest) error {
	req.Currency = strings.ToUpper(strings.TrimSpace(req.Currency))
	if req.Currency == "" {
		req.Currency = "CRC"
	}
	if req.Currency != "CRC" && req.Currency != "USD" {
		return ErrMonedaInvalida
	}

	req.Type = strings.TrimSpace(req.Type)
	if req.Type == "" {
		req.Type = "virtual"
	}
	if req.Type != "virtual" && req.Type != "physical" {
		return ErrTipoDeTarjetaInvalido
	}
	return nil
}

// BuscadorDeNombre dice como se llama la persona: nombre y apellido de su
// perfil. main lo cablea con el repositorio de usuarios.
type BuscadorDeNombre func(ctx context.Context, userID string) (string, error)

// ConNombreDe fija de donde sale el titular de las tarjetas nuevas.
func (h *Handler) ConNombreDe(f BuscadorDeNombre) *Handler {
	h.nombreDe = f
	return h
}

// titular es el nombre que lleva la tarjeta: el de la persona, sin espacios de
// mas. Antes el handler pasaba el literal "Titular KiramoPay" (un TODO).
func (h *Handler) titular(ctx context.Context, userID string) (string, error) {
	if h.nombreDe == nil {
		return "", errors.New("cards: no cardholder name lookup configured")
	}
	crudo, err := h.nombreDe(ctx, userID)
	if err != nil {
		return "", fmt.Errorf("read cardholder name: %w", err)
	}
	nombre := strings.Join(strings.Fields(crudo), " ")
	if nombre == "" {
		return "", ErrSinNombre
	}
	if utf8.RuneCountInString(nombre) > LargoMaximoDelTitular {
		nombre = string([]rune(nombre)[:LargoMaximoDelTitular])
	}
	return nombre, nil
}

// responderErrorDeCreacion traduce el fallo de crear una tarjeta. El tope del
// plan sigue siendo 409 con su detalle; un motivo conocido, su codigo; lo
// inesperado, un 500 sin el texto de la base.
func responderErrorDeCreacion(w http.ResponseWriter, err error) {
	var tope *plans.TopeAlcanzadoError
	switch {
	case errors.As(err, &tope):
		response.ErrorConDetalle(w, http.StatusConflict, "CARD_LIMIT",
			"your plan does not allow more active or frozen cards", tope.Detalle())
	case errors.Is(err, ErrMonedaInvalida):
		response.Error(w, http.StatusBadRequest, "INVALID_CURRENCY", "cards can be issued in CRC or USD")
	case errors.Is(err, ErrTipoDeTarjetaInvalido):
		response.Error(w, http.StatusBadRequest, "INVALID_CARD_TYPE", "card type must be virtual or physical")
	case errors.Is(err, ErrSinNombre):
		response.Error(w, http.StatusConflict, "CARDHOLDER_NAME_MISSING", "the profile has no name to print on the card")
	default:
		// Error enmascara cualquier 5xx y deja la causa en el log.
		response.Error(w, http.StatusInternalServerError, "CREATE_FAILED", err.Error())
	}
}
