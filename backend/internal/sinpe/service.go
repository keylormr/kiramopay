package sinpe

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
)

// Notifier delivers a user-facing notification (history + push). Implemented by
// the notification service; optional so sinpe works without it.
type Notifier interface {
	NotifyUser(ctx context.Context, userID, title, body, tag string) error
}

type Service struct {
	repo        *Repository
	txService   *transaction.Service
	walletRepo  *wallet.Repository
	userRepo    *user.Repository
	auditLogger *audit.Logger
	notifier    Notifier
}

// Options bundles optional collaborators.
type Options struct {
	AuditLogger *audit.Logger
	Notifier    Notifier
}

func NewService(
	repo *Repository,
	txService *transaction.Service,
	walletRepo *wallet.Repository,
	userRepo *user.Repository,
	opts *Options,
) *Service {
	if opts == nil {
		opts = &Options{}
	}
	return &Service{
		repo:        repo,
		txService:   txService,
		walletRepo:  walletRepo,
		userRepo:    userRepo,
		auditLogger: opts.AuditLogger,
		notifier:    opts.Notifier,
	}
}

func (s *Service) GetContacts(ctx context.Context, userID string) ([]ContactRecord, error) {
	return s.repo.GetContacts(ctx, userID)
}

func (s *Service) AddContact(ctx context.Context, userID, phone, name, bank string, isFavorite bool) (*ContactRecord, error) {
	return s.repo.AddContact(ctx, userID, phone, name, bank, isFavorite)
}

func (s *Service) GetHistory(ctx context.Context, userID string) ([]HistoryRecord, error) {
	return s.repo.GetHistory(ctx, userID, 50)
}

// notifyReceiver delivers the "SINPE received" notification on a context
// detached from the (already-completed) request, bounded by its own timeout.
// Best-effort: never blocks or fails the transfer.
func (s *Service) notifyReceiver(userID, body string) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_ = s.notifier.NotifyUser(ctx, userID, "SINPE recibido", body, "transaction")
}

// Send transfers CRC to a recipient phone. If the phone belongs to a
// KiramoPay user, the transfer is INTERNAL: both legs are booked atomically
// against the ledger and the receiver's wallet is credited. If the phone is
// external, the transfer is booked against the SYSTEM:EXTERNAL account.
func (s *Service) Send(ctx context.Context, userID string, req *SendRequest, ipAddr string) (*SendResponse, error) {
	if req.Amount <= 0 {
		return nil, fmt.Errorf("amount must be positive")
	}
	if req.Amount > MaxSinglePaymentCRC {
		return nil, fmt.Errorf("amount exceeds single-payment ceiling")
	}
	if !validCRMobile(req.Phone) {
		return nil, ErrInvalidPhone
	}

	// Serialize concurrent SINPE sends for THIS user so the daily-limit check
	// below and the debit further down cannot interleave (two parallel sends
	// each reading a stale "spent" total and both passing the 500K ceiling).
	unlock, err := s.repo.AcquireUserSendLock(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("serialize send: %w", err)
	}
	defer unlock()

	// Resolve the recipient. Only KiramoPay-to-KiramoPay transfers are accepted.
	// Un fallo de la base no dice que el numero no sea de KiramoPay: se tragaba
	// el error, y el envio a un usuario se contestaba "no es usuario".
	peer, err := s.userRepo.FindByPhone(ctx, req.Phone)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("buscar a quien recibe: %w", err)
	}
	// Sending to your OWN number used to debit you plus a cross-bank fee with no
	// credit back — a silent money loss. Reject it outright.
	if peer != nil && peer.ID == userID {
		return nil, ErrSelfSend
	}
	// Sending to a number that is NOT a KiramoPay user is refused rather than
	// accepted. The cross-bank rail needs a licence we do not hold, so such a
	// transfer could only be debited and parked in SYSTEM:EXTERNAL: never
	// delivered, and with no refund path to undo it. Taking the money and
	// showing "pending" forever is worse than saying no up front.
	//
	// Salvo que sea el reintento de un envio que ya salio: si la cuenta de
	// quien lo recibio se cerro entre el envio y el reintento, el telefono ya
	// no la encuentra, y se contestaba "no es usuario" por un envio hecho. La
	// llave, el monto y el numero son los de aquel envio; contestarlo no mueve
	// nada.
	if peer == nil {
		hecha, err := s.txService.TransferenciaHecha(ctx, userID, req.IdempotencyKey, req.Amount, "CRC", transaction.TypeSinpeSend, req.Phone)
		if err != nil {
			return nil, err
		}
		if hecha != nil {
			return &SendResponse{
				TransactionID: hecha.ID,
				Status:        "completed",
				Amount:        hecha.Amount,
				Fee:           hecha.Fee,
				Recipient:     hecha.CounterpartyName,
				Internal:      true,
				Replayed:      true,
			}, nil
		}
		return nil, ErrRecipientNotUser
	}

	contactName := peer.FirstName + " " + peer.LastName
	if contact, _ := s.repo.FindContactByPhone(ctx, userID, req.Phone); contact != nil {
		contactName = contact.Name
	}

	// KiramoPay-to-KiramoPay moves inside our own ledger, so there is no fee.
	// TransactionFee stays defined for the cross-bank rail, dormant until the
	// licence exists.
	const fee int64 = 0

	w, err := s.walletRepo.FindByUserID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("wallet not found")
	}

	idem := req.IdempotencyKey
	if idem == "" {
		idem = "sinpe:" + uuid.New().String()
	}

	// The sender's own name and phone go on the receiver's history row.
	// Best-effort: a failed lookup degrades to the frontend's generic title,
	// never blocks the transfer.
	senderName := ""
	senderPhone := ""
	if sender, _ := s.userRepo.FindByID(ctx, userID); sender != nil {
		senderName = strings.TrimSpace(sender.FirstName + " " + sender.LastName)
		senderPhone = sender.Phone
	}
	receiverContact := senderName
	if receiverContact == "" {
		receiverContact = "KiramoPay user"
	}

	// El historial de los dos lados se escribe DENTRO de la transaccion del
	// asiento. Antes se escribia despues, aparte: un envio podia quedar sin su
	// fila —y sin contar para el cupo del dia—, y la repeticion de un envio que
	// ya se habia hecho escribia otra. El gancho no corre en la repeticion: la
	// fila de aquella vez es la que vale.
	//
	// Los nombres van recortados al ancho de la columna (VARCHAR(100),
	// migracion 023). Nombre y apellido pueden sumar 201 caracteres, y dentro
	// de la transaccion del dinero un nombre que no entra hace fallar el envio
	// entero, siempre igual: un nombre de pantalla no vale un envio. Los
	// telefonos si entran (VARCHAR(15)): el de destino lo valida el handler
	// (+506 y ocho digitos), y el de quien envia tiene el mismo formato porque
	// se valida al registrarse y ningun otro camino lo cambia.
	ahora := time.Now()
	idEnvio, idRecibo := uuid.New().String(), uuid.New().String()
	nombreDelContacto := transaction.RecortarNombre(contactName)
	nombreDeQuienEnvia := transaction.RecortarNombre(receiverContact)
	pedido := &transaction.CreateTransferRequest{
		FromUserID:               userID,
		ToUserID:                 peer.ID,
		Amount:                   req.Amount,
		Currency:                 "CRC",
		Fee:                      fee,
		Description:              req.Description,
		IdempotencyKey:           idem,
		TxType:                   transaction.TypeSinpeSend,
		ReceiveType:              transaction.TypeSinpeReceive,
		SenderCounterpartyName:   contactName,
		ReceiverCounterpartyName: senderName,
		SenderCounterpartyPhone:  req.Phone,
		EnLaMismaTx: func(ctx context.Context, tx pgx.Tx, _ string) error {
			if err := s.repo.AddHistoryEnTx(ctx, tx, &HistoryRecord{
				ID:          idEnvio,
				UserID:      userID,
				Phone:       req.Phone,
				ContactName: nombreDelContacto,
				Amount:      req.Amount,
				Fee:         fee,
				Type:        "sent",
				Status:      "completed",
				Description: req.Description,
				CreatedAt:   ahora,
			}); err != nil {
				return fmt.Errorf("historial de quien envia: %w", err)
			}
			if err := s.repo.AddHistoryEnTx(ctx, tx, &HistoryRecord{
				ID:     idRecibo,
				UserID: peer.ID,
				// El telefono REAL del emisor (ya se trajo para senderName).
				// Antes se guardaba su UUID como relleno y el historial del
				// receptor mostraba ese identificador en vez de un numero.
				Phone:       senderPhone,
				ContactName: nombreDeQuienEnvia,
				Amount:      req.Amount,
				Fee:         0,
				Type:        "received",
				Status:      "completed",
				Description: req.Description,
				CreatedAt:   ahora,
			}); err != nil {
				return fmt.Errorf("historial de quien recibe: %w", err)
			}
			return nil
		},
	}

	// Comprobaciones de cortesia: el cupo SINPE del dia y el saldo. Las dos
	// miden algo que el propio envio consume, asi que sobre el reintento de un
	// envio que ya salio dirian "no alcanza" por la plata que ya se movio, y
	// la pantalla lo daria por fallido. Se leen PRIMERO y la llave DESPUES,
	// solo si alguna no alcanza: si la llave ya tiene respuesta —este envio
	// hecho, o la llave de otro—, contesta CreateTransfer. Bajo el candado de
	// arriba ningun otro envio de esta persona puede confirmar entre una
	// lectura y la otra.
	if errCortesia := s.cortesia(ctx, userID, req.Amount, fee, w.BalanceCRC); errCortesia != nil {
		responde, err := s.txService.TransferenciaYaTieneRespuesta(ctx, pedido)
		if err != nil {
			return nil, err
		}
		if !responde {
			return nil, errCortesia
		}
	}

	senderTx, _, repetido, err := s.txService.TransferirOReconocer(ctx, pedido)
	if err != nil {
		if errors.Is(err, transaction.ErrMFARequired) {
			return nil, err
		}
		return nil, fmt.Errorf("create transaction: %w", err)
	}

	// Lo que sale hacia afuera —el aviso a quien recibe, la auditoria— va solo
	// cuando ESTA llamada movio el dinero: la repeticion no es otro envio. Lo
	// dice el libro: una bandera puesta por el gancho mentia cuando el gancho
	// corria en una pasada que despues se deshacia.
	if !repetido {
		// Notify the recipient (best-effort, detached so it never blocks or
		// fails the transfer).
		if s.notifier != nil {
			body := fmt.Sprintf("Recibiste ₡%d.%02d por SINPE Móvil", req.Amount/100, req.Amount%100)
			// #nosec G118 -- intentionally detached: the request context is
			// cancelled when the response returns, but this best-effort
			// notification must outlive the request (notifyReceiver uses its own
			// bounded context).
			go s.notifyReceiver(peer.ID, body)
		}
		if s.auditLogger != nil {
			s.auditLogger.LogTransfer(userID, senderTx.ID, req.Amount, "CRC", ipAddr)
		}
	}
	// Every accepted transfer is now KiramoPay-to-KiramoPay and settles inside
	// our ledger, so it is genuinely completed. Internal stays in the response:
	// the client still distinguishes both cases, ready for the day the
	// cross-bank rail is licensed.
	return &SendResponse{
		TransactionID: senderTx.ID,
		Status:        "completed",
		Amount:        req.Amount,
		Fee:           fee,
		Recipient:     contactName,
		Internal:      true,
		Replayed:      repetido,
	}, nil
}

// cortesia es la comprobacion previa del cupo SINPE del dia y del saldo. Es de
// cortesia: lo que de verdad impide gastar de mas es el asiento, con su
// comprobacion de saldo adentro de la transaccion. El cupo cuenta lo enviado;
// el saldo tiene que cubrir ademas la comision.
func (s *Service) cortesia(ctx context.Context, userID string, monto, comision, saldo int64) error {
	dailySpent, err := s.repo.GetDailySinpeSpent(ctx, userID)
	if err != nil {
		return fmt.Errorf("check daily limit: %w", err)
	}
	if dailySpent+monto > DailyLimitCRC {
		return fmt.Errorf("SINPE daily limit exceeded")
	}
	if saldo < monto+comision {
		return fmt.Errorf("insufficient balance")
	}
	return nil
}

// validCRMobile reports whether p is a valid Costa Rican mobile number for
// SINPE Móvil: 8 digits starting with 6, 7 or 8, with an optional +506 / 506
// country-code prefix.
func validCRMobile(p string) bool {
	d := digitsOnly(p)
	d = strings.TrimPrefix(d, "506")
	if len(d) != 8 {
		return false
	}
	switch d[0] {
	case '6', '7', '8':
		return true
	default:
		return false
	}
}

func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteByte(byte(r))
		}
	}
	return b.String()
}
