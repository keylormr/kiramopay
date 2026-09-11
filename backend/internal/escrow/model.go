// Package escrow implements buyer-funded, ledger-backed payment holds.
//
// An agreement moves through a strict state machine; every state that moves
// money does it through the double-entry ledger against the SYSTEM:ESCROW
// liability account, so escrow balances are provable from the journal:
//
//	pending ──fund──▶ funded ──release──▶ released   (buyer → escrow → seller)
//	   │                │ ├────refund───▶ refunded   (escrow → buyer)
//	   └──cancel──▶ cancelled └─dispute─▶ disputed ──resolve──▶ released|refunded
package escrow

import (
	"errors"
	"time"
)

// Status is the workflow state of an agreement.
type Status string

const (
	StatusPending   Status = "pending"   // created, not yet funded — no money moved
	StatusFunded    Status = "funded"    // buyer's funds held in SYSTEM:ESCROW
	StatusReleased  Status = "released"  // funds delivered to the seller
	StatusRefunded  Status = "refunded"  // funds returned to the buyer
	StatusDisputed  Status = "disputed"  // frozen pending admin resolution
	StatusCancelled Status = "cancelled" // abandoned before funding
)

// validTransitions is the single source of truth for the state machine.
var validTransitions = map[Status][]Status{
	StatusPending:  {StatusFunded, StatusCancelled},
	StatusFunded:   {StatusReleased, StatusRefunded, StatusDisputed},
	StatusDisputed: {StatusReleased, StatusRefunded},
}

// CanTransition reports whether moving from → to is allowed.
func CanTransition(from, to Status) bool {
	for _, t := range validTransitions[from] {
		if t == to {
			return true
		}
	}
	return false
}

// Agreement is one escrow contract between a buyer and a seller.
type Agreement struct {
	ID            string     `json:"id"`
	BuyerID       string     `json:"buyer_id"`
	SellerID      string     `json:"seller_id"`
	AmountMinor   int64      `json:"amount_minor"`
	Currency      string     `json:"currency"`
	Status        Status     `json:"status"`
	Description   string     `json:"description"`
	DisputeReason string     `json:"dispute_reason,omitempty"`
	FundedAt      *time.Time `json:"funded_at,omitempty"`
	ReleasedAt    *time.Time `json:"released_at,omitempty"`
	RefundedAt    *time.Time `json:"refunded_at,omitempty"`
	DisputedAt    *time.Time `json:"disputed_at,omitempty"`
	CancelledAt   *time.Time `json:"cancelled_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`

	// Los plazos (migracion 064). DeliveredAt lo marca el vendedor;
	// DeliverBy vence si no lo hace, ReviewBy si despues el comprador no
	// libera ni reclama.
	DeliveredAt *time.Time `json:"delivered_at,omitempty"`
	DeliverBy   *time.Time `json:"deliver_by,omitempty"`
	ReviewBy    *time.Time `json:"review_by,omitempty"`
	// ClosedByExpiry dice si el acuerdo lo cerro un vencimiento y cual:
	// "entrega" (el vendedor no marco la entrega) o "revision" (el comprador
	// no libero ni reclamo).
	ClosedByExpiry string `json:"closed_by_expiry,omitempty"`
}

// Plazos son los dias que tiene cada parte para actuar. Ver EscrowConfig.
type Plazos struct {
	DiasParaEntregar int
	DiasParaRevisar  int
	// AvisoAntes: cuanto antes de que venza un plazo se les avisa a las dos
	// partes.
	AvisoAntes time.Duration
}

// PlazosPorDefecto son los que rigen si quien arma el servicio no dice otros.
func PlazosPorDefecto() Plazos {
	return Plazos{DiasParaEntregar: 14, DiasParaRevisar: 7, AvisoAntes: 48 * time.Hour}
}

// Motivos de cierre por vencimiento.
const (
	VencioEntrega  = "entrega"
	VencioRevision = "revision"
)

// CreateRequest is the payload to open an agreement.
type CreateRequest struct {
	// SellerID identifica al vendedor por su id interno. Se mantiene para los
	// clientes B2B que ya integraron contra esta ruta; la aplicacion manda
	// SellerPhone, porque ninguna pantalla muestra el UUID de nadie.
	SellerID string `json:"seller_id"`
	// SellerPhone es el telefono del vendedor. El servidor lo resuelve a una
	// cuenta real; si no hay cuenta, el acuerdo se rechaza en vez de nacer
	// apuntando a nadie. Ver resolverVendedor.
	SellerPhone string `json:"seller_phone,omitempty"`
	AmountMinor int64  `json:"amount_minor"`
	Currency    string `json:"currency"`
	Description string `json:"description"`
}

// Domain errors mapped to HTTP statuses by the handler.
var (
	ErrNotFound       = errors.New("escrow: agreement not found")
	ErrNotParty       = errors.New("escrow: caller is not a party to this agreement")
	ErrNotBuyer       = errors.New("escrow: only the buyer may perform this action")
	ErrNotSeller      = errors.New("escrow: only the seller may perform this action")
	ErrBadTransition  = errors.New("escrow: action not allowed in the current status")
	ErrInsufficient   = errors.New("escrow: insufficient balance")
	ErrMFARequired    = errors.New("escrow: verified MFA challenge required for this amount")
	ErrInvalidRequest = errors.New("escrow: invalid request")
	// ErrVendedorSinCuenta: el telefono (o el id) del vendedor no corresponde a
	// ninguna cuenta. Un acuerdo hacia una cuenta que no existe se puede
	// fondear —la plata sale de la billetera del comprador— y no se puede
	// liberar a nadie.
	ErrVendedorSinCuenta = errors.New("escrow: seller has no KiramoPay account")
	// ErrPlazoVencido: el plazo vigente ya paso, y con el el resultado quedo
	// decidido. El barrido corre cada minuto; sin esta guarda, en ese minuto
	// se podia marcar una entrega tardia o abrir una disputa tardia.
	ErrPlazoVencido = errors.New("escrow: the deadline for this step has passed")
	// ErrDailyLimitExceeded: financiar este acuerdo pasaria el tope diario de
	// salida de la billetera del comprador. La regla es la MISMA que la de las
	// transferencias (transaction.CheckLimits); aqui solo se traduce para
	// que el handler de escrow pueda devolver su propio codigo.
	ErrDailyLimitExceeded = errors.New("escrow: daily spending limit exceeded")
	// ErrMonthlyLimitExceeded: lo mismo con el tope del mes. Ese tope existia en
	// la base y no lo comparaba nadie; ahora que si frena, tiene que llegar a la
	// pantalla con su propio codigo en vez de caer en el 500 generico.
	ErrMonthlyLimitExceeded = errors.New("escrow: monthly spending limit exceeded")
)
