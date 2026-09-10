package transaction

import "time"

type TransactionRecord struct {
	ID                string     `json:"id"`
	WalletID          string     `json:"wallet_id"`
	UserID            string     `json:"user_id"`
	Type              string     `json:"type"`
	Amount            int64      `json:"amount"`
	Currency          string     `json:"currency"`
	Fee               int64      `json:"fee"`
	CounterpartyType  string     `json:"counterparty_type,omitempty"`
	CounterpartyID    string     `json:"counterparty_id,omitempty"`
	CounterpartyName  string     `json:"counterparty_name,omitempty"`
	CounterpartyPhone string     `json:"counterparty_phone,omitempty"`
	Status            string     `json:"status"`
	ExternalReference string     `json:"external_reference,omitempty"`
	Metadata          string     `json:"metadata,omitempty"` // JSON string
	CreatedAt         time.Time  `json:"created_at"`
	ProcessedAt       *time.Time `json:"processed_at,omitempty"`
	CompletedAt       *time.Time `json:"completed_at,omitempty"`
	CreatedDate       string     `json:"created_date"`
}

// Transaction types
const (
	TypeSinpeSend    = "sinpe_send"
	TypeSinpeReceive = "sinpe_receive"
	TypeQRPayment    = "qr_payment"
	TypeQRReceive    = "qr_receive"
	TypeBillPayment  = "bill_payment"
	TypeRecharge     = "recharge"
	TypeDeposit      = "deposit"
	TypeWithdrawal   = "withdrawal"
	TypeP2PSend      = "p2p_send"
	TypeP2PReceive   = "p2p_receive"
	// Owner moving money from a shop's balance into their personal wallet.
	TypeMerchantWithdrawal = "merchant_withdrawal"
	TypeRefund             = "refund"
	TypeCryptoBuy          = "crypto_buy"       // fiat leaves the wallet to buy crypto
	TypeCryptoSell         = "crypto_sell"      // fiat enters the wallet from selling crypto
	TypeSavingsDeposit     = "savings_deposit"  // wallet -> SYSTEM:SAVINGS
	TypeSavingsWithdraw    = "savings_withdraw" // SYSTEM:SAVINGS -> wallet
)

// Transaction statuses
const (
	StatusPending    = "pending"
	StatusProcessing = "processing"
	StatusCompleted  = "completed"
	StatusFailed     = "failed"
	StatusReversed   = "reversed"
)

type CreateTransactionRequest struct {
	Type              string `json:"type"`
	Amount            int64  `json:"amount"`
	Currency          string `json:"currency"`
	Fee               int64  `json:"fee"`
	CounterpartyType  string `json:"counterparty_type,omitempty"`
	CounterpartyName  string `json:"counterparty_name,omitempty"`
	CounterpartyPhone string `json:"counterparty_phone,omitempty"`
	Description       string `json:"description,omitempty"`
	IdempotencyKey    string `json:"idempotency_key,omitempty"`

	// Internal marca las llamadas que hace otro servicio del backend, no una
	// persona por HTTP. Lleva `json:"-"` A PROPOSITO: el decodificador la
	// ignora, asi que un cliente no puede activarla mandandola en el cuerpo.
	//
	// Solo con ella se admite un tipo ENTRANTE, que es el que acredita dinero
	// desde una cuenta de sistema. Un usuario puede pedir mover SU plata hacia
	// afuera; que entre lo decide el servicio que sabe por que entra (vender
	// cripto, un reembolso), nunca el cliente.
	Internal bool `json:"-"`
}

// rutaPropiaDe: para cada tipo que POST /transactions llego a aceptar, cual es
// el camino que de verdad lo entrega.
//
// Esta puerta era una lista blanca de siete tipos "salientes", con el argumento
// de que sacar dinero del propio monedero pasa por saldo, limite y MFA. El
// argumento es cierto y aun asi la puerta quemaba plata: CreateTransaction arma
// un asiento de UNA SOLA PATA contra SYSTEM:EXTERNAL, o sea que debita la
// billetera y acredita "el exterior" sin que exista un exterior. Ninguno de los
// siete llega a su destino por aca:
//
//   - sinpe_send  no comprueba que el destinatario exista (esa guarda vive en
//     el modulo sinpe, y se puso justamente porque enviar a un no-usuario
//     perdia la plata);
//   - qr_payment  no acredita al comercio ni cobra la comision de 0,5%;
//   - p2p_send    tiene que ser un asiento de DOS patas, no uno solo;
//   - bill_payment y recharge estan deliberadamente APAGADOS mientras no haya
//     convenio (payment.ErrSinConvenio, 503 SIN_CONVENIO) — por aca entraban
//     igual, saltandose ese candado por completo;
//   - crypto_buy  no acredita tenencia de cripto;
//   - withdrawal  no tiene ninguna integracion bancaria detras.
//
// Los modulos legitimos no pasan por esta puerta: ponen Internal=true y llaman
// al servicio directamente. Ninguna pantalla de la aplicacion usaba esta ruta
// para crear nada. Asi que no se recorta la lista: se cierra, y el error dice
// adonde ir, que es mas util que un "no permitido" a secas.
var rutaPropiaDe = map[string]string{
	TypeSinpeSend:   "POST /api/v1/sinpe/send",
	TypeP2PSend:     "POST /api/v1/sinpe/send",
	TypeQRPayment:   "POST /api/v1/qr/pay",
	TypeBillPayment: "POST /api/v1/services/pay-bill",
	TypeRecharge:    "POST /api/v1/services/recharge",
	TypeCryptoBuy:   "POST /api/v1/crypto/buy",
	TypeWithdrawal:  "", // no existe: retirar exige una integracion bancaria que no hay
}

// RutaPropiaDe devuelve la ruta que atiende ese tipo de movimiento, y si la hay.
func RutaPropiaDe(txType string) (string, bool) {
	r, conocido := rutaPropiaDe[txType]
	return r, conocido && r != ""
}

type ListTransactionsRequest struct {
	Limit    int    `json:"limit"`
	Offset   int    `json:"offset"`
	Type     string `json:"type,omitempty"`
	Status   string `json:"status,omitempty"`
	Currency string `json:"currency,omitempty"`
	// From/To bound created_at: From inclusive, To exclusive, so a calendar
	// month is exactly [first, first-of-next). Zero values mean unbounded.
	From time.Time `json:"from,omitempty"`
	To   time.Time `json:"to,omitempty"`
	// Search es texto libre. Sin el, el buscador de la pantalla de movimientos
	// solo podia filtrar las filas que el cliente ya tenia en memoria —las
	// ultimas 50—, asi que un movimiento del mes pasado simplemente no
	// aparecia y el usuario concluia que no existia. Se busca contra el
	// nombre de la contraparte, la descripcion guardada en metadata, la
	// referencia externa y el tipo de movimiento.
	Search string `json:"search,omitempty"`
}

type TransactionListResponse struct {
	Transactions []TransactionRecord `json:"transactions"`
	Total        int                 `json:"total"`
	Limit        int                 `json:"limit"`
	Offset       int                 `json:"offset"`
}
