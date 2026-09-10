package transaction

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/wallet"
)

// MFAEnforcer (optional) gates high-value transactions. If non-nil and
// IsMFARequired returns true, the service expects a prior verified challenge
// for the user before the transaction proceeds.
type MFAEnforcer interface {
	IsMFARequired(amountMinor int64, currency string) bool
	HasVerifiedMFA(ctx context.Context, userID, purpose string) (bool, error)
}

// UIFReporter (optional) is notified, best-effort, after an outgoing
// transaction posts, so it can evaluate AML/UIF reporting thresholds. It must
// not block or fail the transaction.
type UIFReporter interface {
	Report(ctx context.Context, userID, txID, currency string, amountMinor int64)
}

type Service struct {
	repo        *Repository
	walletRepo  *wallet.Repository
	ledger      *ledger.Engine
	auditLogger *audit.Logger
	mfa         MFAEnforcer
	uif         UIFReporter
}

// Options carries optional collaborators.
type Options struct {
	AuditLogger *audit.Logger
	MFA         MFAEnforcer
	UIF         UIFReporter
}

func NewService(repo *Repository, walletRepo *wallet.Repository, l *ledger.Engine, opts *Options) *Service {
	if opts == nil {
		opts = &Options{}
	}
	return &Service{
		repo:        repo,
		walletRepo:  walletRepo,
		ledger:      l,
		auditLogger: opts.AuditLogger,
		mfa:         opts.MFA,
		uif:         opts.UIF,
	}
}

// completarEnLaMismaTx devuelve el gancho que marca COMPLETADAS las filas de
// `transactions` DENTRO de la transaccion que escribe el asiento.
//
// Es la regla de la que dependen las demas: una fila esta 'completed' si y solo
// si su asiento confirmo. Antes el UPDATE corria despues de Post, por fuera, y
// de las dos formas se perdia plata:
//
//   - con el error descartado (`_ =` en CreateTransfer), una caida entre el
//     asiento y el UPDATE dejaba la fila en 'pending' para siempre con el
//     dinero ya movido: no aparece en la lista, no cuenta para el tope y la
//     conciliacion la marca como sobrante;
//   - con el error devuelto (CreateTransaction), se le contestaba "fallo" al
//     llamante DESPUES de que el asiento confirmo. Cripto lo leia como "el
//     debito no ocurrio" y no acreditaba el activo: al usuario le salia el
//     dinero de la billetera y no le entraba nada a cambio.
//
// Ver ledger.Posting.EnLaMismaTx. Un reintento por conflicto ejecuta esto otra
// vez sobre una transaccion nueva; el UPDATE es idempotente, asi que no importa.
func (s *Service) completarEnLaMismaTx(ids ...string) func(context.Context, pgx.Tx) error {
	return func(ctx context.Context, tx pgx.Tx) error {
		for _, id := range ids {
			if id == "" {
				continue
			}
			if err := s.repo.UpdateStatusTx(ctx, tx, id, StatusCompleted); err != nil {
				return fmt.Errorf("marcar completada %s: %w", id, err)
			}
		}
		return nil
	}
}

// marcarFallidaSinAsiento rotula la fila cuando el asiento NO confirmo.
//
// El error se descarta a proposito, y aqui si es correcto: no se movio dinero,
// asi que el rotulo es lo unico en juego. Si tambien se pierde, la fila queda
// en 'pending' y el proximo intento con la misma llave la reintenta igual, que
// es lo que hace la relectura de idempotencia de mas arriba.
func (s *Service) marcarFallidaSinAsiento(ctx context.Context, ids ...string) {
	for _, id := range ids {
		if id != "" {
			_ = s.repo.MarcarFallida(ctx, id)
		}
	}
}

// ErrLlaveDeOtroMovimiento: la llave de idempotencia ya tiene un asiento
// escrito, pero de OTRO movimiento. No se puede dar por hecho el actual.
var ErrLlaveDeOtroMovimiento = errors.New("idempotency key already belongs to another movement")

// ErrLlaveReutilizada: se pidio reintentar bajo una llave que existe, pero
// describiendo un movimiento distinto (otro monto, otra moneda u otro tipo).
var ErrLlaveReutilizada = errors.New("idempotency key reused for a different movement")

// completarAsientoRepetido cierra el caso en que el libro responde
// ErrIdempotent: ya hay un asiento con esta llave, o sea que el dinero se movio
// en un intento anterior. El gancho que marca la fila corrio en AQUELLA
// transaccion, no en esta, asi que aqui solo queda ponerla al dia.
//
// Antes comprueba que el asiento existente sea el de estas filas. Sin esa
// comprobacion, marcar 'completed' seria afirmar un movimiento de dinero que
// esta llamada no hizo y no puede ver.
func (s *Service) completarAsientoRepetido(ctx context.Context, llave, esperado string, ids ...string) error {
	hecho, err := s.repararFilaConAsiento(ctx, llave, esperado, ids...)
	if err != nil {
		return err
	}
	// Sin asiento no hay nada que dar por hecho: el libro dijo repetido y ya no
	// esta. Es un estado que no deberia ocurrir, y callarlo seria inventar.
	if !hecho {
		return fmt.Errorf("%w: %s", ErrLlaveDeOtroMovimiento, llave)
	}
	return nil
}

// repararFilaConAsiento cierra el caso de la fila que quedo SIN MARCAR aunque su
// asiento si confirmo — la herencia de cuando el UPDATE corria por fuera.
//
// Se comprueba ANTES de volver a evaluar saldo, tope y segundo factor, y esa
// posicion es parte del arreglo: ese dinero ya se movio, asi que volver a
// pedirle un segundo factor —que ya se consumio— o compararlo contra el tope
// del dia dejaria la fila rota para siempre y le diria al llamante que su pago
// no paso. En el retiro del saldo de un negocio es todavia mas claro: el saldo
// ya salio, asi que la comprobacion de fondos diria "insuficiente" sobre un
// retiro que ya ocurrio.
//
// Devuelve hecho=false cuando no hay asiento: ahi si es un movimiento por hacer.
func (s *Service) repararFilaConAsiento(ctx context.Context, llave, esperado string, ids ...string) (bool, error) {
	if llave == "" {
		return false, nil
	}
	txID, existe, err := s.ledger.PostingTxID(ctx, llave)
	if err != nil {
		return false, fmt.Errorf("leer asiento previo: %w", err)
	}
	if !existe {
		return false, nil
	}
	if txID != "" && txID != esperado {
		return false, fmt.Errorf("%w: %s", ErrLlaveDeOtroMovimiento, llave)
	}
	for _, id := range ids {
		if id == "" {
			continue
		}
		if err := s.repo.UpdateStatus(ctx, id, StatusCompleted); err != nil {
			return false, fmt.Errorf("marcar completada %s: %w", id, err)
		}
	}
	return true, nil
}

// mismoMovimiento comprueba que una fila que ya existe bajo la llave describa
// la MISMA operacion que se esta pidiendo. Una llave repetida con otro monto no
// es un reintento: es otra operacion pidiendo prestada una llave usada, y
// seguirla escribiria un asiento por un importe que la fila no dice.
func mismoMovimiento(previa *TransactionRecord, req *CreateTransactionRequest) bool {
	return previa.Amount == req.Amount &&
		previa.Currency == req.Currency &&
		previa.Type == req.Type
}

// CreateTransaction is the public entry point used by HTTP handlers for
// simple user-initiated transactions. Internal callers (sinpe, qr, splitpay)
// should prefer CreateTransfer which expresses BOTH legs of a transfer.
func (s *Service) CreateTransaction(ctx context.Context, userID string, req *CreateTransactionRequest) (*TransactionRecord, error) {
	// La moneda y el monto se normalizan ANTES de la relectura de idempotencia
	// porque esa relectura compara la fila existente contra estos campos: sin
	// normalizar, un pedido sin moneda no coincidiria con su propia fila.
	if req.Currency == "" {
		req.Currency = "CRC"
	}
	if req.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}

	// Un tipo ENTRANTE acredita desde una cuenta de sistema, asi que solo puede
	// originarlo otro servicio del backend. Sin esta puerta, cualquier tipo que
	// no estuviera en isOutgoing caia por descarte en la rama de credito y
	// acreditaba dinero real saltandose saldo, limite diario y MFA, que viven
	// todos dentro del `if` de abajo.
	if !isOutgoing(req.Type) && !req.Internal {
		return nil, ErrCreditNotAllowed
	}

	// Relectura de idempotencia, antes de tocar nada mas. Solo un movimiento
	// COMPLETADO es una repeticion; una fila 'failed' o 'pending' significa que
	// el asiento NO confirmo, y devolverla como exito —que es lo que se hacia—
	// le decia al llamante que su plata se movio cuando no se movio, y dejaba
	// el reintento sin ocurrir jamas. Lo que se hace con esa fila es
	// reintentarla SOBRE ELLA MISMA: la llave del libro es la que decide si el
	// dinero se mueve o no, no esta lectura.
	var previa *TransactionRecord
	if req.IdempotencyKey != "" {
		existing, err := s.repo.FindByIdempotencyKey(ctx, userID, req.IdempotencyKey)
		if err == nil && existing != nil {
			// La comprobacion va ANTES de dar la repeticion por buena: devolver
			// el movimiento viejo ante un monto nuevo es lo que hacia que
			// cripto acreditara activo por una cifra que el libro no debito.
			if !mismoMovimiento(existing, req) {
				return nil, fmt.Errorf("%w: %s", ErrLlaveReutilizada, req.IdempotencyKey)
			}
			if existing.Status == StatusCompleted {
				return existing, nil
			}
			hecho, err := s.repararFilaConAsiento(ctx, req.IdempotencyKey, existing.ID, existing.ID)
			if err != nil {
				return nil, err
			}
			if hecho {
				existing.Status = StatusCompleted
				return existing, nil
			}
			previa = existing
		}
	}

	w, err := s.walletRepo.FindByUserID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("wallet not found")
	}

	if isOutgoing(req.Type) {
		totalCost := req.Amount + req.Fee
		if req.Currency == "CRC" && w.BalanceCRC < totalCost {
			return nil, fmt.Errorf("insufficient balance")
		}
		if req.Currency == "USD" && w.BalanceUSD < totalCost {
			return nil, fmt.Errorf("insufficient balance")
		}
		if err := s.checkDailyLimit(ctx, userID, req.Currency, req.Amount, w); err != nil {
			return nil, err
		}

		if s.mfa != nil && s.mfa.IsMFARequired(req.Amount, req.Currency) {
			ok, err := s.mfa.HasVerifiedMFA(ctx, userID, "high_value_tx")
			if err != nil {
				return nil, fmt.Errorf("mfa check: %w", err)
			}
			if !ok {
				return nil, ErrMFARequired
			}
		}
	}

	// Insert tx in pending with idempotency_key persisted. Un reintento sobre
	// una fila que ya existe la reusa: insertar otra chocaria con la llave, y
	// abandonar dejaria el movimiento sin hacerse para siempre.
	tx := previa
	if tx == nil {
		creada, err := s.repo.Create(ctx, userID, w.ID, req)
		if err != nil {
			// Un intento simultaneo gano la insercion. Su fila es la de este
			// mismo movimiento, asi que se sigue sobre ella: la llave del
			// asiento es la que decide cual de los dos mueve el dinero.
			if !errors.Is(err, ErrDuplicate) || creada == nil {
				return nil, fmt.Errorf("create transaction: %w", err)
			}
			if creada.Status == StatusCompleted {
				return creada, nil
			}
		}
		tx = creada
	}

	// Build the ledger posting for outgoing/incoming legs against the
	// SYSTEM:EXTERNAL counterparty for now (callers that know the peer should
	// use CreateTransfer instead).
	posting := s.buildSingleSidedPosting(tx, req)
	posting.EnLaMismaTx = s.completarEnLaMismaTx(tx.ID)
	if _, err := s.ledger.Post(ctx, posting); err != nil {
		if !errors.Is(err, ledger.ErrIdempotent) {
			s.marcarFallidaSinAsiento(ctx, tx.ID)
			return nil, fmt.Errorf("post ledger: %w", err)
		}
		if err := s.completarAsientoRepetido(ctx, req.IdempotencyKey, tx.ID, tx.ID); err != nil {
			return nil, err
		}
	}
	// El estado tambien se refleja en lo que se devuelve: la fila que arma el
	// repositorio nace 'pending' y el llamante —y el JSON que sale al cliente—
	// se quedaba con ese rotulo aunque el dinero ya se hubiera movido.
	tx.Status = StatusCompleted

	if isOutgoing(req.Type) {
		if s.auditLogger != nil {
			s.auditLogger.LogTransfer(userID, tx.ID, req.Amount, req.Currency, "")
		}
		if s.uif != nil {
			s.uif.Report(ctx, userID, tx.ID, req.Currency, req.Amount)
		}
	}
	return tx, nil
}

// CreateTransferRequest carries both legs of an internal transfer.
// MerchantBalance is the shop's own balance in minor units, derived from the
// journal (no cache, so it cannot drift).
func (s *Service) MerchantBalance(ctx context.Context, merchantID, currency string) (int64, error) {
	return s.ledger.MerchantBalance(ctx, merchantID, currency)
}

// WithdrawMerchantToUser moves money from a shop's balance into the owner's
// personal wallet: debit the merchant account, credit the user wallet. The
// engine updates the user's balance cache from the credit leg.
//
// The caller supplies idempotencyKey so a retried or double-tapped withdrawal
// settles once. The replay lookup runs BEFORE any balance read: a retry of a
// withdrawal that already drained the balance must return the original result,
// not "insufficient". The balance pre-check here is a fast-fail courtesy only —
// the race-free enforcement is the ledger's in-tx negativity check.
//
// merchantName is the shop's display name for the history row; this service has
// no merchant repository, and the caller already loaded the merchant to check
// ownership. Empty is fine (the frontend falls back to a generic title) — it
// used to store the merchant UUID, which surfaced raw in the history.
func (s *Service) WithdrawMerchantToUser(
	ctx context.Context, merchantID, merchantName, userID, currency string, amount int64, idempotencyKey string,
) (*TransactionRecord, error) {
	if amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}
	w, err := s.walletRepo.FindByUserID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("wallet not found")
	}
	if idempotencyKey == "" {
		idempotencyKey = "mwithdraw:" + uuid.New().String()
	}
	// Misma regla que en CreateTransaction: solo un retiro COMPLETADO es una
	// repeticion. Este era el tercer sitio del mismo defecto —el que la lista
	// de hallazgos no nombraba— y aqui pesa mas que en ningun otro: un retiro
	// que fallo devuelto como exito deja el saldo del negocio adentro y al
	// dueño convencido de que ya lo saco.
	var previa *TransactionRecord
	if existing, _ := s.repo.FindByIdempotencyKey(ctx, userID, idempotencyKey); existing != nil {
		if existing.Amount != amount || existing.Currency != currency || existing.Type != TypeMerchantWithdrawal {
			return nil, fmt.Errorf("%w: %s", ErrLlaveReutilizada, idempotencyKey)
		}
		if existing.Status == StatusCompleted {
			return existing, nil
		}
		// La reparacion va antes de leer el saldo del negocio, y por la razon
		// que ya explicaba el comentario de arriba: un retiro que ya salio
		// dejaria el saldo corto y la comprobacion diria "insuficiente" sobre
		// algo que ya ocurrio.
		hecho, err := s.repararFilaConAsiento(ctx, idempotencyKey, existing.ID, existing.ID)
		if err != nil {
			return nil, err
		}
		if hecho {
			existing.Status = StatusCompleted
			return existing, nil
		}
		previa = existing
	}
	bal, err := s.ledger.MerchantBalance(ctx, merchantID, currency)
	if err != nil {
		return nil, fmt.Errorf("read merchant balance: %w", err)
	}
	if bal < amount {
		return nil, ErrInsufficientMerchantBalance
	}

	rec := previa
	if rec == nil {
		creada, err := s.repo.Create(ctx, userID, w.ID, &CreateTransactionRequest{
			Type:             TypeMerchantWithdrawal,
			Amount:           amount,
			Currency:         currency,
			CounterpartyType: "merchant",
			CounterpartyName: merchantName,
			Description:      "Retiro del saldo del negocio",
			IdempotencyKey:   idempotencyKey,
		})
		if err != nil {
			// A concurrent retry won the insert; it owns the posting. Se sigue
			// sobre su fila en vez de devolverla: si ese intento se cayo antes
			// de postear, abandonar aqui dejaria el retiro sin hacerse.
			if !errors.Is(err, ErrDuplicate) || creada == nil {
				return nil, fmt.Errorf("create withdrawal tx: %w", err)
			}
			if creada.Status == StatusCompleted {
				return creada, nil
			}
		}
		rec = creada
	}

	_, err = s.ledger.Post(ctx, &ledger.Posting{
		Description:    fmt.Sprintf("merchant withdrawal %d %s", amount, currency),
		IdempotencyKey: idempotencyKey,
		TxID:           rec.ID,
		CreatedBy:      userID,
		Entries: []ledger.Entry{
			{Account: ledger.Account{MerchantID: merchantID}, Side: ledger.Debit, AmountMinor: amount, Currency: currency},
			{Account: ledger.Account{UserID: userID}, Side: ledger.Credit, AmountMinor: amount, Currency: currency},
		},
		Metadata:    map[string]any{"merchant_id": merchantID, "to_user": userID},
		EnLaMismaTx: s.completarEnLaMismaTx(rec.ID),
	})
	if err != nil {
		if !errors.Is(err, ledger.ErrIdempotent) {
			s.marcarFallidaSinAsiento(ctx, rec.ID)
			if errors.Is(err, ledger.ErrInsufficientFunds) {
				return nil, ErrInsufficientMerchantBalance
			}
			return nil, fmt.Errorf("post withdrawal: %w", err)
		}
		if err := s.completarAsientoRepetido(ctx, idempotencyKey, rec.ID, rec.ID); err != nil {
			return nil, err
		}
	}
	rec.Status = StatusCompleted
	return rec, nil
}

type CreateTransferRequest struct {
	FromUserID string
	ToUserID   string
	// ToMerchantID credits a shop's own ledger balance instead of a user wallet
	// (business income is kept apart from the owner's personal money; they
	// withdraw explicitly). Mutually exclusive with ToUserID. When set there is
	// no receiver `transactions` row: the shop's record is the qr_payments row
	// plus the journal entry.
	ToMerchantID   string
	Amount         int64
	Currency       string
	Fee            int64
	Description    string
	IdempotencyKey string
	TxType         string // for the sender's transactions row
	ReceiveType    string // for the receiver's transactions row (e.g. p2p_receive)

	// SenderCounterpartyName is the display name of WHO RECEIVES, shown on the
	// sender's history row; ReceiverCounterpartyName is who sent, shown on the
	// receiver's row. Both optional — the frontend falls back to a generic
	// per-type title when empty, so callers pass what they know (SINPE knows the
	// contact, QR knows the shop) and never fail a transfer over a name.
	SenderCounterpartyName   string
	ReceiverCounterpartyName string

	// EnLaMismaTx, si viene, corre DENTRO de la transaccion que escribe el
	// asiento, junto con el cambio de estado de las dos filas: si devuelve
	// error, el dinero no se mueve. Recibe el id de la fila del EMISOR, que es
	// a lo que cuelga el asiento: un modulo que escribe su propia fila —la
	// venta del QR, el movimiento del escrow— necesita apuntar a ella.
	//
	// Existe para el modulo que necesita reclamar algo en exclusiva al cobrar
	// —el codigo QR de un solo uso, que hoy se comprueba antes y se marca
	// despues, y por eso dos personas pueden pagarlo a la vez—. Rigen las
	// mismas reglas que ledger.Posting.EnLaMismaTx: escribir solo por el `tx`
	// que se recibe, y ningun efecto irreversible adentro.
	EnLaMismaTx func(ctx context.Context, tx pgx.Tx, txID string) error

	// FeeFromReceiver selects who absorbs Fee. Default (false) is the historical
	// payer-absorbed model: the payer pays Amount + Fee, the receiver is credited
	// the full Amount, and Fee is booked to SYSTEM:FEES. When true (merchant
	// model), the payer pays exactly Amount, the receiver is credited
	// Amount - Fee, and Fee is booked to SYSTEM:FEES. Either way the posting is
	// balanced and Fee always lands in SYSTEM:FEES.
	FeeFromReceiver bool
}

// CreateTransfer atomically debits sender, credits receiver, books fee to
// SYSTEM:FEES, and writes 2 transactions rows (one each). All in one tx.
func (s *Service) CreateTransfer(ctx context.Context, req *CreateTransferRequest) (sender, receiver *TransactionRecord, err error) {
	if req.Amount <= 0 {
		return nil, nil, fmt.Errorf("amount must be positive")
	}
	toMerchant := req.ToMerchantID != ""
	if toMerchant && req.ToUserID != "" {
		return nil, nil, fmt.Errorf("only one of ToUserID/ToMerchantID allowed")
	}
	if !toMerchant && req.ToUserID == "" {
		return nil, nil, fmt.Errorf("receiver required")
	}
	if !toMerchant && req.FromUserID == req.ToUserID {
		return nil, nil, fmt.Errorf("sender and receiver must differ")
	}
	if req.Fee < 0 {
		return nil, nil, fmt.Errorf("fee must not be negative")
	}
	// In the merchant model the fee is carved out of the amount, so it must leave
	// a positive credit for the receiver (the ledger rejects non-positive entries).
	if req.FeeFromReceiver && req.Fee >= req.Amount {
		return nil, nil, fmt.Errorf("fee must be less than amount")
	}
	if req.Currency == "" {
		req.Currency = "CRC"
	}

	// Idempotency: if already done, return BOTH existing rows. The receiver leg
	// was stored under the derived "recv" key, so look it up too — callers that
	// record a follow-on row keyed off the receiver can then detect the replay.
	//
	// Y solo un movimiento COMPLETADO es una repeticion: devolver una fila
	// 'failed' como exito le decia al que cobra que ya le pagaron. Una fila que
	// no completo significa que el asiento no confirmo, asi que se reintenta
	// sobre esas mismas filas.
	var previaEmisor, previaReceptor *TransactionRecord
	if req.IdempotencyKey != "" {
		if existing, _ := s.repo.FindByIdempotencyKey(ctx, req.FromUserID, req.IdempotencyKey); existing != nil {
			// A merchant collection has no receiver row to replay.
			var recv *TransactionRecord
			if !toMerchant {
				recv, _ = s.repo.FindByIdempotencyKey(ctx, req.ToUserID, pairKey(req.IdempotencyKey, "recv"))
			}
			if existing.Amount != req.Amount || existing.Currency != req.Currency || existing.Type != req.TxType {
				return nil, nil, fmt.Errorf("%w: %s", ErrLlaveReutilizada, req.IdempotencyKey)
			}
			if existing.Status == StatusCompleted {
				return existing, recv, nil
			}
			var idRecv string
			if recv != nil {
				idRecv = recv.ID
			}
			hecho, err := s.repararFilaConAsiento(ctx, req.IdempotencyKey, existing.ID, existing.ID, idRecv)
			if err != nil {
				return nil, nil, err
			}
			if hecho {
				existing.Status = StatusCompleted
				if recv != nil {
					recv.Status = StatusCompleted
				}
				return existing, recv, nil
			}
			previaEmisor, previaReceptor = existing, recv
		}
	}

	senderWallet, err := s.walletRepo.FindByUserID(ctx, req.FromUserID)
	if err != nil {
		return nil, nil, fmt.Errorf("sender wallet not found")
	}
	var receiverWallet *wallet.WalletRecord
	if !toMerchant {
		receiverWallet, err = s.walletRepo.FindByUserID(ctx, req.ToUserID)
		if err != nil {
			return nil, nil, fmt.Errorf("receiver wallet not found")
		}
	}

	// The payer only funds the fee when it is payer-absorbed; in the merchant
	// model the fee comes out of the receiver's credit, so the payer needs Amount.
	senderTotal := req.Amount
	if !req.FeeFromReceiver {
		senderTotal += req.Fee
	}
	if req.Currency == "CRC" && senderWallet.BalanceCRC < senderTotal {
		return nil, nil, fmt.Errorf("insufficient balance")
	}
	if req.Currency == "USD" && senderWallet.BalanceUSD < senderTotal {
		return nil, nil, fmt.Errorf("insufficient balance")
	}
	if err := s.checkDailyLimit(ctx, req.FromUserID, req.Currency, req.Amount, senderWallet); err != nil {
		return nil, nil, err
	}

	if s.mfa != nil && s.mfa.IsMFARequired(req.Amount, req.Currency) {
		ok, err := s.mfa.HasVerifiedMFA(ctx, req.FromUserID, "high_value_tx")
		if err != nil {
			return nil, nil, fmt.Errorf("mfa check: %w", err)
		}
		if !ok {
			return nil, nil, ErrMFARequired
		}
	}

	// The fee shows on whichever party absorbs it: the payer's row in the classic
	// model, the receiver's row (a deduction from what they collect) in the
	// merchant model.
	senderFee, receiverFee := req.Fee, int64(0)
	if req.FeeFromReceiver {
		senderFee, receiverFee = 0, req.Fee
	}
	senderReq := &CreateTransactionRequest{
		Type:             req.TxType,
		Amount:           req.Amount,
		Currency:         req.Currency,
		Fee:              senderFee,
		CounterpartyType: "user",
		CounterpartyName: req.SenderCounterpartyName,
		Description:      req.Description,
		IdempotencyKey:   req.IdempotencyKey,
	}
	receiveReq := &CreateTransactionRequest{
		Type:             req.ReceiveType,
		Amount:           req.Amount,
		Currency:         req.Currency,
		Fee:              receiverFee,
		CounterpartyType: "user",
		CounterpartyName: req.ReceiverCounterpartyName,
		Description:      req.Description,
		// Receiver idempotency: derive deterministically to avoid double-credit.
		IdempotencyKey: pairKey(req.IdempotencyKey, "recv"),
	}

	sender = previaEmisor
	if sender == nil {
		sender, err = s.repo.Create(ctx, req.FromUserID, senderWallet.ID, senderReq)
		if err != nil && !errors.Is(err, ErrDuplicate) {
			return nil, nil, fmt.Errorf("create sender tx: %w", err)
		}
	}
	// Sin fila del emisor no hay a que colgar el asiento: `sender.ID` es el
	// TxID del posteo. Puede venir nil cuando la insercion choco por llave
	// duplicada y la relectura de esa fila tambien fallo.
	if sender == nil {
		return nil, nil, fmt.Errorf("create sender tx: fila no disponible")
	}
	// A shop is not a user: its side of the collection is the qr_payments row
	// plus the journal entry, so there is no receiver `transactions` row.
	if !toMerchant {
		receiver = previaReceptor
		if receiver == nil {
			receiver, err = s.repo.Create(ctx, req.ToUserID, receiverWallet.ID, receiveReq)
			if err != nil && !errors.Is(err, ErrDuplicate) {
				return nil, nil, fmt.Errorf("create receiver tx: %w", err)
			}
		}
		if receiver == nil {
			return nil, nil, fmt.Errorf("create receiver tx: fila no disponible")
		}
	}

	// Build the balanced posting. Two fee models, both booking Fee to SYSTEM:FEES:
	//   payer-absorbed (default): payer -Amount-Fee, receiver +Amount, fees +Fee.
	//   merchant-absorbed (FeeFromReceiver): payer -Amount, receiver +Amount-Fee, fees +Fee.
	feeAccount := ledger.SystemFeesCRC
	if req.Currency == "USD" {
		feeAccount = ledger.SystemFeesUSD
	}
	// The credit leg lands either in a user wallet or in the shop's own account.
	creditAccount := ledger.Account{UserID: req.ToUserID}
	if toMerchant {
		creditAccount = ledger.Account{MerchantID: req.ToMerchantID}
	}
	var entries []ledger.Entry
	if req.Fee > 0 && req.FeeFromReceiver {
		entries = []ledger.Entry{
			{Account: ledger.Account{UserID: req.FromUserID}, Side: ledger.Debit, AmountMinor: req.Amount, Currency: req.Currency},
			{Account: creditAccount, Side: ledger.Credit, AmountMinor: req.Amount - req.Fee, Currency: req.Currency},
			{Account: ledger.Account{SystemCode: feeAccount}, Side: ledger.Credit, AmountMinor: req.Fee, Currency: req.Currency},
		}
	} else {
		entries = []ledger.Entry{
			{Account: ledger.Account{UserID: req.FromUserID}, Side: ledger.Debit, AmountMinor: req.Amount, Currency: req.Currency},
			{Account: creditAccount, Side: ledger.Credit, AmountMinor: req.Amount, Currency: req.Currency},
		}
		if req.Fee > 0 {
			entries = append(entries,
				ledger.Entry{Account: ledger.Account{UserID: req.FromUserID}, Side: ledger.Debit, AmountMinor: req.Fee, Currency: req.Currency},
				ledger.Entry{Account: ledger.Account{SystemCode: feeAccount}, Side: ledger.Credit, AmountMinor: req.Fee, Currency: req.Currency},
			)
		}
	}

	p := &ledger.Posting{
		Description:    fmt.Sprintf("transfer %s %d %s", req.TxType, req.Amount, req.Currency),
		IdempotencyKey: req.IdempotencyKey,
		TxID:           sender.ID,
		CreatedBy:      req.FromUserID,
		Entries:        entries,
		Metadata: map[string]any{
			"from_user":   req.FromUserID,
			"to_user":     req.ToUserID,
			"to_merchant": req.ToMerchantID,
			"description": req.Description,
		},
	}
	// A merchant collection has no receiver row (`receiver` is nil): the shop's
	// record is qr_payments + the journal entry.
	var idReceptor string
	if receiver != nil {
		idReceptor = receiver.ID
	}
	// El gancho del llamante corre PRIMERO: si lo que quiere reclamar ya no
	// esta disponible, el asiento se aborta antes de escribir nada mas.
	completar := s.completarEnLaMismaTx(sender.ID, idReceptor)
	p.EnLaMismaTx = func(ctx context.Context, tx pgx.Tx) error {
		if req.EnLaMismaTx != nil {
			if err := req.EnLaMismaTx(ctx, tx, sender.ID); err != nil {
				return err
			}
		}
		return completar(ctx, tx)
	}
	if _, err := s.ledger.Post(ctx, p); err != nil {
		if !errors.Is(err, ledger.ErrIdempotent) {
			s.marcarFallidaSinAsiento(ctx, sender.ID, idReceptor)
			return nil, nil, fmt.Errorf("post ledger: %w", err)
		}
		if err := s.completarAsientoRepetido(ctx, req.IdempotencyKey, sender.ID, sender.ID, idReceptor); err != nil {
			return nil, nil, err
		}
	}
	sender.Status = StatusCompleted
	if receiver != nil {
		receiver.Status = StatusCompleted
	}

	if s.auditLogger != nil {
		s.auditLogger.LogTransfer(req.FromUserID, sender.ID, req.Amount, req.Currency, "")
	}
	if s.uif != nil {
		s.uif.Report(ctx, req.FromUserID, sender.ID, req.Currency, req.Amount)
	}
	return sender, receiver, nil
}

// ErrCreditNotAllowed indica que se pidio un tipo entrante desde fuera del
// backend. Acreditar dinero lo decide el servicio que sabe de donde viene.
var ErrCreditNotAllowed = errors.New("this transaction type cannot be requested by a client")

// ErrMFARequired indicates the user must verify MFA before this tx proceeds.
var ErrMFARequired = errors.New("mfa challenge required")

// ErrDailyLimitExceeded: la salida del dia superaria el tope de la billetera,
// que depende del nivel de KYC (kyc.LevelLimits). El texto es exactamente el
// que ya salia al cliente antes de existir el sentinela, para no cambiarle el
// mensaje a nadie.
var ErrDailyLimitExceeded = errors.New("daily spending limit exceeded")

// ErrMonthlyLimitExceeded: la salida del mes superaria el tope mensual de la
// billetera. Ese tope existia en la base, lo calculaba KYC por nivel y el perfil
// se lo mostraba a la persona como una promesa — y no lo comparaba nadie. Se
// podia gastar el tope diario todos los dias del mes sin tocarlo.
var ErrMonthlyLimitExceeded = errors.New("monthly spending limit exceeded")

// ErrMonedaSinTope: se intento sacar dinero en una moneda para la que no hay
// tope diario definido. Dejarla pasar "sin tope" seria el mismo agujero que el
// tope por moneda vino a cerrar, con otro nombre.
var ErrMonedaSinTope = errors.New("no daily limit defined for this currency")

// ErrInsufficientMerchantBalance rejects a withdrawal larger than the shop's
// journal-derived balance. The exact string reaches the client as the 400
// message, so keep it stable.
var ErrInsufficientMerchantBalance = errors.New("insufficient business balance")

// RecordHistory inserts a COMPLETED history row for a movement whose money
// already moved through the ledger elsewhere (e.g. escrow fund/release/refund
// post directly against SYSTEM:ESCROW). It performs no balance checks and no
// posting — it only makes the movement visible in the user's transaction
// list. Idempotent via the request's IdempotencyKey (duplicates are ignored).
func (s *Service) RecordHistory(ctx context.Context, userID string, req *CreateTransactionRequest) error {
	w, err := s.walletRepo.FindByUserID(ctx, userID)
	if err != nil {
		return fmt.Errorf("find wallet: %w", err)
	}
	// La fila y su estado se escriben en una sola transaccion. Eran dos
	// escrituras sueltas: si la segunda se perdia, quedaba en la lista del
	// usuario un movimiento 'pending' de un dinero que ya se habia movido y que
	// nadie iba a completar nunca, porque el reintento choca con la llave.
	dbtx, err := s.repo.Pool().Begin(ctx)
	if err != nil {
		return fmt.Errorf("record history: %w", err)
	}
	defer dbtx.Rollback(ctx) //nolint:errcheck

	if err := s.RecordHistoryEnTx(ctx, dbtx, userID, w.ID, req); err != nil {
		return err
	}
	return dbtx.Commit(ctx)
}

// RecordHistoryEnTx escribe la fila de historial por una transaccion que abrio
// OTRO modulo — tipicamente la del asiento, via ledger.Posting.EnLaMismaTx.
//
// Existe porque un modulo que mueve dinero por su cuenta (escrow, payouts) tenia
// que elegir entre anotar el movimiento fuera de su transaccion —y quedarse sin
// fila si esa escritura se caia, con el dinero ya movido— o no anotarlo. Con
// esto, la fila del historial y el asiento se confirman juntos.
//
// walletID lo pasa quien llama porque normalmente ya cargo la billetera; si va
// vacio, se busca.
func (s *Service) RecordHistoryEnTx(
	ctx context.Context, tx pgx.Tx, userID, walletID string, req *CreateTransactionRequest,
) error {
	if walletID == "" {
		w, err := s.walletRepo.FindByUserID(ctx, userID)
		if err != nil {
			return fmt.Errorf("find wallet: %w", err)
		}
		walletID = w.ID
	}
	fila, err := s.repo.CreateTx(ctx, tx, userID, walletID, req)
	if err != nil {
		// Una llave repetida quiere decir que el movimiento ya quedo anotado.
		if errors.Is(err, ErrDuplicate) {
			return nil
		}
		return fmt.Errorf("record history: %w", err)
	}
	return s.repo.UpdateStatusTx(ctx, tx, fila.ID, StatusCompleted)
}

func (s *Service) GetTransaction(ctx context.Context, id string) (*TransactionRecord, error) {
	return s.repo.FindByID(ctx, id)
}

func (s *Service) ListTransactions(ctx context.Context, userID string, req *ListTransactionsRequest) (*TransactionListResponse, error) {
	return s.repo.ListByUser(ctx, userID, req)
}

// CheckLimits comprueba que sacar amountMinor no pase NI el tope diario NI el
// mensual de la billetera.
//
// La exponen escrow, marketplace y payouts, que mueven dinero fuera de la
// billetera por su propio camino. La regla vive AQUI y en ningun otro lado;
// duplicarla es como se llega a dos topes distintos.
//
// Se llamaba CheckDailyLimit y comprobaba solo el diario. El mensual existia en
// la base, lo calculaba KYC por nivel, se escribia al aprobar una verificacion y
// el perfil se lo mostraba a la persona — sin que nada lo comparara jamas. El
// nombre nuevo es parte del arreglo: el viejo describia lo que hacia y por eso
// no delataba lo que faltaba.
func (s *Service) CheckLimits(ctx context.Context, userID, currency string, amountMinor int64) error {
	w, err := s.walletRepo.FindByUserID(ctx, userID)
	if err != nil {
		return fmt.Errorf("wallet not found")
	}
	return s.checkDailyLimit(ctx, userID, currency, amountMinor, w)
}

// topeDiarioDe elige el tope de la MONEDA del movimiento.
//
// Antes se pasaba siempre w.DailyLimit, que esta en centimos de COLON, y se
// comparaba contra el monto viniera en la moneda que viniera. En dolares eso no
// frenaba nada: USD 5.000 son 500.000 centimos, muy por debajo de los
// 10.000.000 de un tope basico, asi que una billetera en dolares podia mover
// unas 26 veces su tope — por transferencia y por escrow por igual.
//
// Devuelve false para una moneda sin tope definido. No hay conversion a
// proposito: el tipo de cambio de la base esta congelado desde su semilla y
// derivar un tope de el seria heredar ese problema.
func topeDiarioDe(w *wallet.WalletRecord, currency string) (int64, bool) {
	switch strings.ToUpper(currency) {
	case "CRC":
		return w.DailyLimit, true
	case "USD":
		return w.DailyLimitUSD, true
	}
	return 0, false
}

// topeMensualDe: mismo criterio por moneda que topeDiarioDe, y por la misma
// razon. No hay conversion.
func topeMensualDe(w *wallet.WalletRecord, currency string) (int64, bool) {
	switch strings.ToUpper(currency) {
	case "CRC":
		return w.MonthlyLimit, true
	case "USD":
		return w.MonthlyLimitUSD, true
	}
	return 0, false
}

// checkDailyLimit es la version interna, para los llamantes que ya cargaron la
// billetera y no tienen por que volver a consultarla.
func (s *Service) checkDailyLimit(ctx context.Context, userID, currency string, amountMinor int64, w *wallet.WalletRecord) error {
	dailyLimit, conocida := topeDiarioDe(w, currency)
	if !conocida {
		// Una moneda para la que no hay tope definido no puede salir "sin
		// tope": seria exactamente el agujero que esto cierra, con otro nombre.
		return fmt.Errorf("%w: %s", ErrMonedaSinTope, currency)
	}
	if dailyLimit <= 0 {
		return nil // sin tope configurado
	}
	spentToday, err := s.repo.DailyOutgoingMinor(ctx, userID, currency)
	if err != nil {
		return fmt.Errorf("daily spend check: %w", err)
	}
	if spentToday+amountMinor > dailyLimit {
		return ErrDailyLimitExceeded
	}
	return s.checkMonthlyLimit(ctx, userID, currency, amountMinor, w)
}

// checkMonthlyLimit espeja al diario: mismo criterio de moneda, misma lista de
// tipos de salida, misma decision de negarse cuando la moneda no tiene tope.
func (s *Service) checkMonthlyLimit(ctx context.Context, userID, currency string, amountMinor int64, w *wallet.WalletRecord) error {
	monthlyLimit, conocida := topeMensualDe(w, currency)
	if !conocida {
		return fmt.Errorf("%w: %s", ErrMonedaSinTope, currency)
	}
	if monthlyLimit <= 0 {
		return nil // sin tope configurado
	}
	spentThisMonth, err := s.repo.MonthlyOutgoingMinor(ctx, userID, currency)
	if err != nil {
		return fmt.Errorf("monthly spend check: %w", err)
	}
	if spentThisMonth+amountMinor > monthlyLimit {
		return ErrMonthlyLimitExceeded
	}
	return nil
}

// buildSingleSidedPosting books external-counterparty transfers (deposits,
// withdrawals, bill payments) where the second leg is a system account.
func (s *Service) buildSingleSidedPosting(tx *TransactionRecord, req *CreateTransactionRequest) *ledger.Posting {
	// La cuenta externa y la de comisiones se eligen por la moneda del
	// movimiento. Anotar un asiento en dolares contra SYSTEM:EXTERNAL:CRC
	// —una cuenta declarada en colones— deja la contraparte externa con dos
	// monedas mezcladas y arruina cualquier conciliacion por moneda.
	external := ledger.SystemExternalCRC
	feeAccount := ledger.SystemFeesCRC
	if req.Currency == "USD" {
		external = ledger.SystemExternalUSD
		feeAccount = ledger.SystemFeesUSD
	}

	entries := []ledger.Entry{}
	if isOutgoing(req.Type) {
		entries = append(entries,
			ledger.Entry{Account: ledger.Account{UserID: tx.UserID}, Side: ledger.Debit, AmountMinor: req.Amount, Currency: req.Currency},
			ledger.Entry{Account: ledger.Account{SystemCode: external}, Side: ledger.Credit, AmountMinor: req.Amount, Currency: req.Currency},
		)
		if req.Fee > 0 {
			entries = append(entries,
				ledger.Entry{Account: ledger.Account{UserID: tx.UserID}, Side: ledger.Debit, AmountMinor: req.Fee, Currency: req.Currency},
				ledger.Entry{Account: ledger.Account{SystemCode: feeAccount}, Side: ledger.Credit, AmountMinor: req.Fee, Currency: req.Currency},
			)
		}
	} else {
		entries = append(entries,
			ledger.Entry{Account: ledger.Account{SystemCode: external}, Side: ledger.Debit, AmountMinor: req.Amount, Currency: req.Currency},
			ledger.Entry{Account: ledger.Account{UserID: tx.UserID}, Side: ledger.Credit, AmountMinor: req.Amount, Currency: req.Currency},
		)
	}

	return &ledger.Posting{
		Description:    req.Type,
		IdempotencyKey: req.IdempotencyKey,
		TxID:           tx.ID,
		CreatedBy:      tx.UserID,
		Entries:        entries,
	}
}

func pairKey(base, suffix string) string {
	if base == "" {
		return ""
	}
	return base + ":" + suffix
}

func isOutgoing(txType string) bool {
	switch txType {
	case TypeSinpeSend, TypeQRPayment, TypeBillPayment, TypeRecharge, TypeWithdrawal, TypeP2PSend, TypeCryptoBuy:
		return true
	default:
		return false
	}
}
