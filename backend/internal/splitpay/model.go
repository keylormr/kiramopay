package splitpay

import (
	"errors"
	"fmt"
	"time"
)

// ── Split Group ──────────────────────────────────────────────────────────────

type SplitGroup struct {
	ID          string    `json:"id"`
	CreatorID   string    `json:"creator_id"`
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	TotalAmount int64     `json:"total_amount"` // centimos
	Currency    string    `json:"currency"`
	SplitType   string    `json:"split_type"` // equal, custom, percentage
	Status      string    `json:"status"`     // active, settled, cancelled
	CreatedAt   time.Time `json:"created_at"`
	SettledAt   *time.Time `json:"settled_at,omitempty"`
}

// ── Split Share ──────────────────────────────────────────────────────────────

type SplitShare struct {
	ID        string     `json:"id"`
	GroupID   string     `json:"group_id"`
	UserID    string     `json:"user_id"`
	UserPhone string     `json:"user_phone,omitempty"` // for non-registered users
	UserName  string     `json:"user_name"`
	Amount    int64      `json:"amount"` // centimos
	Status    string     `json:"status"` // pending, paid, declined
	PaidAt    *time.Time `json:"paid_at,omitempty"`
}

// ── Request DTOs ─────────────────────────────────────────────────────────────

type CreateSplitRequest struct {
	Title       string             `json:"title"`
	Description string             `json:"description,omitempty"`
	TotalAmount int64              `json:"total_amount"` // centimos
	Currency    string             `json:"currency"`
	SplitType   string             `json:"split_type"` // equal, custom, percentage
	Participants []ParticipantReq  `json:"participants"`
}

type ParticipantReq struct {
	UserID    string `json:"user_id,omitempty"`
	UserPhone string `json:"user_phone,omitempty"`
	UserName  string `json:"user_name"`
	Amount    int64  `json:"amount,omitempty"`      // for custom split
	Percentage float64 `json:"percentage,omitempty"` // for percentage split
}

type PayShareRequest struct {
	GroupID string `json:"group_id"`
}

// ── Domain errors ────────────────────────────────────────────────────────────
//
// Antes cada rechazo de CreateSplit era un fmt.Errorf suelto en ingles, y el
// handler lo mandaba tal cual como `error.message` (codigo generico
// CREATE_FAILED para los nueve casos). La pantalla, sin forma de distinguirlos,
// pintaba ese texto crudo: "Yo mismo" is you..., appears twice in the split,
// the shares (40000) add up to more than the total (30000) -- en ingles y en
// centimos, dentro de una app en espanol (hallazgo QA n=52).
//
// Cada caso ahora tiene su propio error centinela con un codigo estable: el
// handler lo traduce a un `error.code` en la respuesta, y la pantalla elige su
// propio texto en el idioma activo a partir de ESE codigo (nunca del mensaje).
// Todos envuelven a ErrInvalidRequest para que un llamador que solo compruebe
// "fue una peticion invalida" siga funcionando sin conocer el caso puntual.
var (
	ErrInvalidRequest = errors.New("splitpay: invalid request")

	ErrTitleRequired          = fmt.Errorf("%w: title is required", ErrInvalidRequest)
	ErrInvalidAmount          = fmt.Errorf("%w: total amount must be positive", ErrInvalidRequest)
	ErrParticipantRequired    = fmt.Errorf("%w: at least one participant besides you is required", ErrInvalidRequest)
	ErrPhoneRequired          = fmt.Errorf("%w: participant needs a phone number", ErrInvalidRequest)
	ErrInvalidPhone           = fmt.Errorf("%w: participant phone is not a valid number", ErrInvalidRequest)
	ErrAccountNotFound        = fmt.Errorf("%w: participant has no KiramoPay account", ErrInvalidRequest)
	ErrSelfIncluded           = fmt.Errorf("%w: cannot include your own phone as a participant", ErrInvalidRequest)
	ErrDuplicateParticipant   = fmt.Errorf("%w: participant appears twice in the split", ErrInvalidRequest)
	ErrTotalTooSmall          = fmt.Errorf("%w: total is too small to split among the participants", ErrInvalidRequest)
	ErrCustomAmountRequired   = fmt.Errorf("%w: custom participant amount must be positive", ErrInvalidRequest)
	ErrExceedsTotal           = fmt.Errorf("%w: custom shares add up to more than the total", ErrInvalidRequest)
	ErrPercentageRequired     = fmt.Errorf("%w: participant percentage must be positive", ErrInvalidRequest)
	ErrPercentageExceedsTotal = fmt.Errorf("%w: percentages add up to more than 100", ErrInvalidRequest)
	ErrPercentageRoundsToZero = fmt.Errorf("%w: percentage rounds down to zero", ErrInvalidRequest)
	ErrInvalidSplitType       = fmt.Errorf("%w: invalid split type", ErrInvalidRequest)

	// ErrAccountLookupUnavailable no es un error de forma del usuario: es una
	// falla de configuracion del servidor (el repositorio de cuentas no se
	// cableo). Se queda fuera de ErrInvalidRequest a proposito para que el
	// handler la responda como 500, no como 400.
	ErrAccountLookupUnavailable = errors.New("splitpay: account lookup unavailable")

	// ErrCuotaNoReclamable: la cuota ya no estaba pendiente cuando se intento
	// tomarla —la pagaron, la rechazaron, o el que la rechazo gano la carrera—.
	// Cuando sale de un pago significa ademas que NO se cobro nada: el reclamo
	// corre dentro de la transaccion del asiento, asi que si falla el dinero no
	// se mueve.
	ErrCuotaNoReclamable = errors.New("splitpay: la cuota ya no esta pendiente")

	ErrGroupNotFound   = errors.New("splitpay: split group not found")
	ErrNotActive       = errors.New("splitpay: split is no longer active")
	ErrNoShareForUser  = errors.New("splitpay: no share for this user in the split")
	ErrNotCreator      = errors.New("splitpay: only the creator can cancel a split")
	ErrUnauthenticated = errors.New("splitpay: user not authenticated")
)
