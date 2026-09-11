package payout

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/transaction"
)

// MFAEnforcer gates high-value payouts — same contract escrow/transfers use.
type MFAEnforcer interface {
	IsMFARequired(amountMinor int64, currency string) bool
	HasVerifiedMFA(ctx context.Context, userID, purpose string) (bool, error)
}

// UIFReporter is notified, best-effort, after a payout debits (AML thresholds).
type UIFReporter interface {
	Report(ctx context.Context, userID, txID, currency string, amountMinor int64)
}

// EventSink receives lifecycle events (payout.processing, payout.completed, …)
// for fan-out to merchant webhooks. Best-effort: emitting never fails the
// business operation.
type EventSink interface {
	Emit(ctx context.Context, userID, eventType string, payload any)
}

// HistoryRecorder mirrors payout money movements into the user's transaction
// list. The ledger posting itself happens here, in payout; this only writes the
// human-visible history row.
// HistoryRecorder anota el movimiento en el historial del usuario y presta el
// control de tope diario del servicio de transacciones. Van juntas: lo que
// debita la billetera tiene que anotarse donde el tope se cuenta Y consultar
// ese mismo tope, o el tope deja de significar lo que dice.
type HistoryRecorder interface {
	RecordHistory(ctx context.Context, userID string, req *transaction.CreateTransactionRequest) error
	CheckLimits(ctx context.Context, userID, currency string, amountMinor int64) error
	// Las versiones que corren dentro de la transaccion del asiento. Ver submit
	// y refundAndFail: la fila del payout, la del historial y el tope se
	// confirman con el dinero o no se confirman.
	RecordHistoryEnTx(ctx context.Context, tx pgx.Tx, userID, walletID string, req *transaction.CreateTransactionRequest) error
	CheckLimitsEnTx(ctx context.Context, tx pgx.Tx, userID, currency string, amountMinor int64) error
}

// Logger is the minimal logging surface (slog-compatible) the poller/service
// use; nil is fine.
type Logger interface {
	Warn(msg string, args ...any)
	Error(msg string, args ...any)
}

// Service drives the payout state machine, its ledger postings, and rail
// dispatch.
type Service struct {
	repo        *Repository
	ledger      *ledger.Engine
	rails       *Registry
	mfa         MFAEnforcer
	uif         UIFReporter
	events      EventSink
	history     HistoryRecorder
	auditLogger *audit.Logger
	logger      Logger
}

// Options carries the optional collaborators.
type Options struct {
	MFA         MFAEnforcer
	UIF         UIFReporter
	Events      EventSink
	History     HistoryRecorder
	AuditLogger *audit.Logger
	Logger      Logger
}

func NewService(repo *Repository, eng *ledger.Engine, rails *Registry, opts *Options) *Service {
	if opts == nil {
		opts = &Options{}
	}
	return &Service{
		repo:        repo,
		ledger:      eng,
		rails:       rails,
		mfa:         opts.MFA,
		uif:         opts.UIF,
		events:      opts.Events,
		history:     opts.History,
		auditLogger: opts.AuditLogger,
		logger:      opts.Logger,
	}
}

// Rails returns the registered rail names (for clients to choose from).
func (s *Service) Rails() []string {
	if s.rails == nil {
		return nil
	}
	return s.rails.Names()
}

// Create validates, opens, and submits a payout. It is idempotent on
// (userID, IdempotencyKey): a retried call returns the existing payout rather
// than moving money twice.
func (s *Service) Create(ctx context.Context, userID string, req *CreateRequest) (*Payout, error) {
	if err := s.normalizeAndValidate(req); err != nil {
		return nil, err
	}

	// Request-level idempotency: insert-or-return-existing.
	p, created, err := s.repo.CreateOrGet(ctx, userID, req)
	if err != nil {
		return nil, fmt.Errorf("create payout: %w", err)
	}
	// An existing payout that already advanced past pending is replayed as-is —
	// the caller's retry is a no-op.
	if !created && p.Status != StatusPending {
		return p, nil
	}
	if created {
		s.audit(userID, p, "payout_created", "low", nil)
	}

	// Balance pre-check (the ledger re-locks and is the final word).
	bal, err := s.repo.WalletBalance(ctx, userID, p.Currency)
	if err != nil {
		return nil, fmt.Errorf("balance check: %w", err)
	}
	if bal < p.AmountMinor {
		return nil, ErrInsufficient
	}

	// Mismo tope diario que las transferencias y el escrow: un payout debita la
	// billetera contra SYSTEM:EXTERNAL igual que ellos. Esta es la comprobacion
	// RAPIDA, para no pedir el segundo factor a quien de todos modos no puede;
	// la que decide corre dentro del asiento (submit), donde dos payouts
	// simultaneos ya no pueden leer la misma suma.
	if s.history != nil {
		if err := s.history.CheckLimits(ctx, userID, p.Currency, p.AmountMinor); err != nil {
			return nil, err
		}
	}

	// High-value MFA gate (same purpose as transfers/escrow, so one verified
	// TOTP challenge covers any high-value action).
	if s.mfa != nil && s.mfa.IsMFARequired(p.AmountMinor, p.Currency) {
		ok, err := s.mfa.HasVerifiedMFA(ctx, userID, "high_value_tx")
		if err != nil {
			return nil, fmt.Errorf("mfa check: %w", err)
		}
		if !ok {
			return nil, ErrMFARequired
		}
	}

	return s.submit(ctx, p)
}

// normalizeAndValidate canonicalises the request in place and rejects bad input.
func (s *Service) normalizeAndValidate(req *CreateRequest) error {
	if req == nil {
		return ErrInvalidRequest
	}
	req.Rail = strings.TrimSpace(req.Rail)
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	req.Currency = strings.ToUpper(strings.TrimSpace(req.Currency))
	req.Destination.Account = strings.TrimSpace(req.Destination.Account)
	req.Destination.Name = strings.TrimSpace(req.Destination.Name)

	if req.Currency == "" {
		req.Currency = "CRC"
	}
	if req.Currency != "CRC" && req.Currency != "USD" {
		return ErrInvalidRequest
	}
	if req.AmountMinor <= 0 {
		return ErrInvalidRequest
	}
	if req.Destination.Account == "" || req.Destination.Name == "" {
		return ErrInvalidRequest
	}
	// A client-supplied idempotency key is mandatory for outbound money: it is
	// what makes a retried POST safe.
	if req.IdempotencyKey == "" {
		return ErrInvalidRequest
	}
	if s.rails == nil {
		return ErrUnknownRail
	}
	if _, ok := s.rails.Get(req.Rail); !ok {
		return ErrUnknownRail
	}
	return nil
}

// submit es el nucleo que mueve dinero: reclama el payout, lo debita y lo anota
// en el historial, TODO en la transaccion del asiento.
//
// Antes eran tres pasos sueltos —reclamar (pending -> processing), postear, y
// si el asiento fallaba, compensar devolviendo el reclamo— con el mismo defecto
// que el escrow tenia antes del #179: la compensacion tambien puede fallar, y
// entonces quedaba un payout 'processing' SIN debito. El poller lo despachaba
// despues y el riel mandaba plata que nunca salio de la billetera. La fila del
// historial iba al final con el error descartado.
//
// Ahora el tope, el reclamo y el historial corren dentro del gancho: si el
// asiento no confirma, nada de eso ocurrio y no hay nada que compensar. El
// reclamo sigue siendo el mutex entre dos submit simultaneos del mismo payout:
// el UPDATE ... WHERE status = 'pending' lo gana uno, y el otro no postea.
func (s *Service) submit(ctx context.Context, p *Payout) (*Payout, error) {
	var claimed *Payout
	_, perr := s.ledger.Post(ctx, &ledger.Posting{
		Description:    fmt.Sprintf("payout submit: %s", p.ID),
		IdempotencyKey: "payout:debit:" + p.ID,
		CreatedBy:      p.UserID,
		Metadata: map[string]any{
			"payout_id": p.ID,
			"rail":      p.Rail,
			"action":    "submit",
		},
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: p.UserID}, Side: ledger.Debit, AmountMinor: p.AmountMinor, Currency: p.Currency},
			{Account: railSystemAccount(p.Rail, p.Currency), Side: ledger.Credit, AmountMinor: p.AmountMinor, Currency: p.Currency},
		},
		EnLaMismaTx: func(ctx context.Context, tx pgx.Tx) error {
			// El tope primero: antes de anotar el propio movimiento, o la suma
			// lo contaria dos veces.
			if s.history != nil {
				if err := s.history.CheckLimitsEnTx(ctx, tx, p.UserID, p.Currency, p.AmountMinor); err != nil {
					return err
				}
			}
			var err error
			if claimed, err = s.repo.ClaimEnTx(ctx, tx, p.ID); err != nil {
				return err
			}
			if s.history != nil {
				return s.history.RecordHistoryEnTx(ctx, tx, p.UserID, "", historialDeEnvio(claimed))
			}
			return nil
		},
	})
	switch {
	case errors.Is(perr, ledger.ErrIdempotent):
		// El debito ya estaba confirmado — y con el, en la misma transaccion,
		// el reclamo y el historial. Es un reintento de un submit que se corto
		// despues del COMMIT: se sigue con lo que quedo.
		actual, err := s.repo.Get(ctx, p.ID)
		if err != nil {
			return nil, err
		}
		if actual.Status != StatusProcessing {
			return actual, nil
		}
		claimed = actual
	case perr != nil:
		switch {
		case errors.Is(perr, ErrBadTransition):
			// Otro submit del mismo payout gano el reclamo; este no posteo.
			return s.repo.Get(ctx, p.ID)
		case errors.Is(perr, transaction.ErrDailyLimitExceeded):
			return nil, transaction.ErrDailyLimitExceeded
		case errors.Is(perr, transaction.ErrMonthlyLimitExceeded):
			return nil, transaction.ErrMonthlyLimitExceeded
		}
		return nil, fmt.Errorf("payout debit posting: %w", perr)
	}

	// Money is now held in SYSTEM:EXTERNAL:<RAIL>. Compliance + visibility.
	if s.uif != nil {
		s.uif.Report(ctx, claimed.UserID, claimed.ID, claimed.Currency, claimed.AmountMinor)
	}
	s.audit(claimed.UserID, claimed, "payout_processing", "medium", nil)
	s.emit(ctx, claimed, "payout.processing")

	// Hand off to the rail.
	return s.dispatch(ctx, claimed)
}

// dispatch calls Rail.Send for a processing payout that has not yet been
// accepted, then settles on the result. A transport error is treated as
// AMBIGUOUS (the money may or may not have moved) and the payout is LEFT
// processing for the poller to resolve — never refunded blindly, which would
// risk a double-spend.
func (s *Service) dispatch(ctx context.Context, p *Payout) (*Payout, error) {
	rail, ok := s.rails.Get(p.Rail)
	if !ok {
		s.audit(p.UserID, p, "payout_rail_missing", "high", map[string]any{"rail": p.Rail})
		return s.repo.Get(ctx, p.ID)
	}
	res, err := rail.Send(ctx, PayoutRequest{
		PayoutID:       p.ID,
		AmountMinor:    p.AmountMinor,
		Currency:       p.Currency,
		Destination:    p.Destination,
		IdempotencyKey: p.ID,
	})
	if err != nil {
		s.logWarn("payout rail send ambiguous; leaving processing",
			"payout_id", p.ID, "rail", p.Rail, "error", err.Error())
		s.audit(p.UserID, p, "payout_rail_unresolved", "medium",
			map[string]any{"rail": p.Rail, "error": err.Error()})
		return s.repo.Get(ctx, p.ID)
	}
	return s.settle(ctx, p, res)
}

// settle applies a rail result (from Send or Status) to a processing payout.
func (s *Service) settle(ctx context.Context, p *Payout, res PayoutResult) (*Payout, error) {
	switch res.Status {
	case RailCompleted:
		out, err := s.repo.MarkCompleted(ctx, p.ID, res.ExternalID)
		if err != nil {
			if errors.Is(err, ErrBadTransition) {
				return s.repo.Get(ctx, p.ID)
			}
			return nil, err
		}
		s.audit(out.UserID, out, "payout_completed", "medium", map[string]any{"external_id": out.ExternalID})
		s.emit(ctx, out, "payout.completed")
		return out, nil

	case RailFailed:
		return s.refundAndFail(ctx, p, res)

	case RailPending:
		if res.ExternalID != "" {
			if err := s.repo.SetExternalID(ctx, p.ID, res.ExternalID); err != nil {
				s.logWarn("payout set external id failed", "payout_id", p.ID, "error", err.Error())
			}
		}
		return s.repo.Get(ctx, p.ID)

	default:
		// Unknown rail status — treat as still pending (leave processing).
		s.logWarn("payout rail returned unknown status", "payout_id", p.ID, "status", string(res.Status))
		return s.repo.Get(ctx, p.ID)
	}
}

// refundAndFail aplica un rechazo definitivo del riel: marca el payout como
// fallido, le devuelve la plata y lo anota en el historial, TODO en la
// transaccion del asiento de reembolso.
//
// Antes eran tres pasos: reclamar el rechazo (processing -> failed), postear el
// reembolso, y si el asiento fallaba, desmarcar (failed -> processing). Si el
// desmarcar tambien fallaba, quedaba un payout 'failed' —terminal— con la
// plata todavia retenida en SYSTEM:EXTERNAL y nadie que la fuera a devolver.
//
// El reclamo sigue siendo el mutex entre dos trabajadores que reaccionan al
// riel: si otro ya lo marco 'completed', el UPDATE ... WHERE status =
// 'processing' falla, el asiento se revierte y no se reembolsa algo que el
// riel si pago.
func (s *Service) refundAndFail(ctx context.Context, p *Payout, res PayoutResult) (*Payout, error) {
	var claimed *Payout
	_, perr := s.ledger.Post(ctx, &ledger.Posting{
		Description:    fmt.Sprintf("payout refund: %s", p.ID),
		IdempotencyKey: "payout:refund:" + p.ID,
		CreatedBy:      p.UserID,
		Metadata: map[string]any{
			"payout_id": p.ID,
			"rail":      p.Rail,
			"action":    "refund",
		},
		Entries: []ledger.Entry{
			{Account: railSystemAccount(p.Rail, p.Currency), Side: ledger.Debit, AmountMinor: p.AmountMinor, Currency: p.Currency},
			{Account: ledger.Account{UserID: p.UserID}, Side: ledger.Credit, AmountMinor: p.AmountMinor, Currency: p.Currency},
		},
		EnLaMismaTx: func(ctx context.Context, tx pgx.Tx) error {
			var err error
			if claimed, err = s.repo.MarkFailedEnTx(ctx, tx, p.ID, res.ExternalID, res.Message); err != nil {
				return err
			}
			if s.history != nil {
				return s.history.RecordHistoryEnTx(ctx, tx, p.UserID, "", historialDeReembolso(claimed))
			}
			return nil
		},
	})
	switch {
	case errors.Is(perr, ledger.ErrIdempotent):
		// El reembolso ya se habia confirmado, y con el el estado 'failed'.
		return s.repo.Get(ctx, p.ID)
	case perr != nil:
		if errors.Is(perr, ErrBadTransition) {
			// Otro trabajador ya lo llevo a un estado terminal (por ejemplo,
			// completado): no se reembolsa.
			return s.repo.Get(ctx, p.ID)
		}
		// El reembolso no confirmo y el payout sigue 'processing', que es
		// donde el poller lo vuelve a intentar. Nada quedo a medias.
		s.audit(p.UserID, p, "payout_refund_failed", "high",
			map[string]any{"rail": p.Rail, "post_error": perr.Error()})
		return s.repo.Get(ctx, p.ID)
	}

	s.audit(claimed.UserID, claimed, "payout_failed", "medium", map[string]any{"reason": res.Message})
	s.emit(ctx, claimed, "payout.failed")
	return claimed, nil
}

// Refresh reconciles the caller's processing payout against the rail. It is the
// user-triggered counterpart to the background poller.
func (s *Service) Refresh(ctx context.Context, userID, id string) (*Payout, error) {
	p, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if p.UserID != userID {
		return nil, ErrNotOwner
	}
	if p.Status != StatusProcessing {
		return p, nil
	}
	return s.reconcile(ctx, p)
}

// reconcile drives one processing payout toward a terminal state. With no
// external id yet it (re)dispatches via Send (idempotent); otherwise it polls
// the rail's Status. Used by both Refresh and the poller.
func (s *Service) reconcile(ctx context.Context, p *Payout) (*Payout, error) {
	if p.Status != StatusProcessing {
		return p, nil
	}
	if p.ExternalID == "" {
		return s.dispatch(ctx, p)
	}
	rail, ok := s.rails.Get(p.Rail)
	if !ok {
		s.audit(p.UserID, p, "payout_rail_missing", "high", map[string]any{"rail": p.Rail})
		return p, nil
	}
	res, err := rail.Status(ctx, p.ExternalID)
	if err != nil {
		s.logWarn("payout rail status poll failed", "payout_id", p.ID, "error", err.Error())
		return p, nil
	}
	return s.settle(ctx, p, res)
}

// reconcileStuck reconciles up to `limit` processing payouts older than the
// grace period. Returns how many it advanced to a terminal state. Used by the
// poller.
func (s *Service) reconcileStuck(ctx context.Context, graceSecs, limit int) (int, error) {
	items, err := s.repo.ListStuckProcessing(ctx, graceSecs, limit)
	if err != nil {
		return 0, err
	}
	advanced := 0
	for i := range items {
		p := items[i]
		out, rerr := s.reconcile(ctx, &p)
		if rerr != nil {
			s.logError("payout reconcile failed", "payout_id", p.ID, "error", rerr.Error())
			continue
		}
		if out != nil && out.Status != StatusProcessing {
			advanced++
		}
	}
	return advanced, nil
}

// List returns the caller's payouts, newest first.
func (s *Service) List(ctx context.Context, userID string, limit int) ([]Payout, error) {
	return s.repo.ListByUser(ctx, userID, limit)
}

// Get returns the payout if the caller owns it.
func (s *Service) Get(ctx context.Context, userID, id string) (*Payout, error) {
	p, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if p.UserID != userID {
		return nil, ErrNotOwner
	}
	return p, nil
}

// ── helpers ──────────────────────────────────────────────────────────────────

// railSystemAccount returns the per-rail external liability account, e.g.
// SYSTEM:EXTERNAL:MOCK:CRC. It must be seeded (migration) for each rail/currency.
func railSystemAccount(rail, currency string) ledger.Account {
	code := fmt.Sprintf("SYSTEM:EXTERNAL:%s:%s", strings.ToUpper(rail), strings.ToUpper(currency))
	return ledger.Account{SystemCode: ledger.SystemAccountCode(code)}
}

// historialDeEnvio arma la fila del historial del debito. La escribe el gancho
// del asiento; antes se escribia despues, por fuera y con el error descartado,
// asi que un payout podia debitar la billetera sin aparecer nunca en la lista.
func historialDeEnvio(p *Payout) *transaction.CreateTransactionRequest {
	return &transaction.CreateTransactionRequest{
		Type:             "payout_sent",
		Amount:           p.AmountMinor,
		Currency:         p.Currency,
		CounterpartyType: "external",
		CounterpartyName: p.Destination.Name,
		Description:      "Payout via " + p.Rail + " to " + p.Destination.MaskedAccount(),
		IdempotencyKey:   "payout:sent:" + p.ID,
	}
}

// historialDeReembolso arma la fila del historial del reembolso.
func historialDeReembolso(p *Payout) *transaction.CreateTransactionRequest {
	return &transaction.CreateTransactionRequest{
		Type:             "payout_refund",
		Amount:           p.AmountMinor,
		Currency:         p.Currency,
		CounterpartyType: "external",
		CounterpartyName: p.Destination.Name,
		Description:      "Payout refund (" + p.Rail + ")",
		IdempotencyKey:   "payout:refund:" + p.ID,
	}
}

func (s *Service) emit(ctx context.Context, p *Payout, eventType string) {
	if s.events == nil {
		return
	}
	s.events.Emit(ctx, p.UserID, eventType, p)
}

func (s *Service) audit(actorID string, p *Payout, action, risk string, extra map[string]any) {
	if s.auditLogger == nil {
		return
	}
	details := map[string]any{
		"rail":         p.Rail,
		"amount_minor": p.AmountMinor,
		"currency":     p.Currency,
		"status":       string(p.Status),
		"destination":  p.Destination.MaskedAccount(),
	}
	for k, v := range extra {
		details[k] = v
	}
	s.auditLogger.Log(audit.Event{
		UserID:       actorID,
		Action:       action,
		ResourceType: "payout",
		ResourceID:   p.ID,
		Details:      details,
		RiskLevel:    risk,
	})
}

func (s *Service) logWarn(msg string, args ...any) {
	if s.logger != nil {
		s.logger.Warn(msg, args...)
	}
}

func (s *Service) logError(msg string, args ...any) {
	if s.logger != nil {
		s.logger.Error(msg, args...)
	}
}
