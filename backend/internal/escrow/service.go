package escrow

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/transaction"
)

// MFAEnforcer gates high-value funding, same contract as transfers.
type MFAEnforcer interface {
	IsMFARequired(amountMinor int64, currency string) bool
	HasVerifiedMFA(ctx context.Context, userID, purpose string) (bool, error)
}

// UIFReporter is notified, best-effort, after funding posts (AML thresholds).
type UIFReporter interface {
	Report(ctx context.Context, userID, txID, currency string, amountMinor int64)
}

// EventSink receives lifecycle events (escrow.funded, escrow.released, …) for
// fan-out to merchant webhooks. Best-effort: emitting never fails the
// business operation.
type EventSink interface {
	Emit(ctx context.Context, userID, eventType string, payload any)
}

// HistoryRecorder makes escrow money movements visible in the user's
// transaction list (the ledger posting itself happens here, in escrow), y
// ademas presta el control de tope diario del servicio de transacciones.
//
// Las dos cosas van juntas a proposito: escrow mueve dinero fuera de la
// billetera por su propio camino, asi que tiene que anotarlo donde el tope se
// cuenta Y consultar ese mismo tope. Con solo una de las dos, el tope diario
// deja de significar lo que dice.
type HistoryRecorder interface {
	RecordHistory(ctx context.Context, userID string, req *transaction.CreateTransactionRequest) error
	// RecordHistoryEnTx es la version que corre dentro de la transaccion del
	// asiento. Ver HistoryRecorderEnTx para por que hace falta.
	RecordHistoryEnTx(ctx context.Context, tx pgx.Tx, userID, walletID string, req *transaction.CreateTransactionRequest) error
	CheckLimits(ctx context.Context, userID, currency string, amountMinor int64) error
}

// Service drives the escrow state machine and its ledger postings.
type Service struct {
	repo        *Repository
	ledger      *ledger.Engine
	mfa         MFAEnforcer
	uif         UIFReporter
	events      EventSink
	history     HistoryRecorder
	auditLogger *audit.Logger
	cuentas     BuscadorDeCuentas
	plazos      Plazos
	notifier    Notifier
}

// Options carries the optional collaborators.
type Options struct {
	MFA         MFAEnforcer
	UIF         UIFReporter
	Events      EventSink
	History     HistoryRecorder
	AuditLogger *audit.Logger
	// Cuentas resuelve la contraparte del acuerdo. Ver contraparte.go.
	Cuentas BuscadorDeCuentas
	// Plazos para entregar y para revisar. Nil usa PlazosPorDefecto.
	Plazos *Plazos
	// Notifier avisa a las partes de la entrega y de los vencimientos. Nil
	// deja todo funcionando sin avisos.
	Notifier Notifier
}

func NewService(repo *Repository, eng *ledger.Engine, opts *Options) *Service {
	if opts == nil {
		opts = &Options{}
	}
	return &Service{
		repo:        repo,
		ledger:      eng,
		mfa:         opts.MFA,
		uif:         opts.UIF,
		events:      opts.Events,
		history:     opts.History,
		auditLogger: opts.AuditLogger,
		cuentas:     opts.Cuentas,
		plazos:      plazosDe(opts.Plazos),
		notifier:    opts.Notifier,
	}
}

// plazosDe completa lo que falte con los valores por defecto: un plazo en cero
// venceria el acuerdo en el mismo barrido que lo ve fondeado.
func plazosDe(p *Plazos) Plazos {
	d := PlazosPorDefecto()
	if p == nil {
		return d
	}
	if p.DiasParaEntregar > 0 {
		d.DiasParaEntregar = p.DiasParaEntregar
	}
	if p.DiasParaRevisar > 0 {
		d.DiasParaRevisar = p.DiasParaRevisar
	}
	if p.AvisoAntes > 0 {
		d.AvisoAntes = p.AvisoAntes
	}
	return d
}

// emit notifies both parties' webhook endpoints about a lifecycle event.
func (s *Service) emit(ctx context.Context, a *Agreement, eventType string) {
	if s.events == nil {
		return
	}
	s.events.Emit(ctx, a.BuyerID, eventType, a)
	s.events.Emit(ctx, a.SellerID, eventType, a)
}

// Create opens a pending agreement with the caller as buyer. No money moves.
func (s *Service) Create(ctx context.Context, buyerID string, req *CreateRequest) (*Agreement, error) {
	if req == nil || req.AmountMinor <= 0 || strings.TrimSpace(req.Description) == "" {
		return nil, ErrInvalidRequest
	}
	req.Currency = strings.ToUpper(strings.TrimSpace(req.Currency))
	if req.Currency == "" {
		req.Currency = "CRC"
	}
	if req.Currency != "CRC" && req.Currency != "USD" {
		return nil, ErrInvalidRequest
	}
	// La contraparte se resuelve ANTES de escribir nada: un acuerdo hacia una
	// cuenta que no existe se puede fondear y no se puede liberar a nadie.
	if err := s.resolverVendedor(ctx, req); err != nil {
		return nil, err
	}
	if req.SellerID == buyerID {
		return nil, ErrInvalidRequest
	}
	a, err := s.repo.Create(ctx, buyerID, req)
	if err != nil {
		return nil, fmt.Errorf("create agreement: %w", err)
	}
	s.audit(buyerID, a, "escrow_created", "low", nil)
	s.emit(ctx, a, "escrow.created")
	return a, nil
}

// Get returns the agreement if the viewer is a party to it.
func (s *Service) Get(ctx context.Context, viewerID, id string) (*Agreement, error) {
	a, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.BuyerID != viewerID && a.SellerID != viewerID {
		return nil, ErrNotParty
	}
	return a, nil
}

// List returns the viewer's agreements (as buyer or seller).
func (s *Service) List(ctx context.Context, viewerID string, limit int) ([]Agreement, error) {
	return s.repo.ListByUser(ctx, viewerID, limit)
}

// Fund locks the buyer's money into SYSTEM:ESCROW (pending → funded).
func (s *Service) Fund(ctx context.Context, callerID, id string) (*Agreement, error) {
	a, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.BuyerID != callerID {
		if a.SellerID == callerID {
			return nil, ErrNotBuyer
		}
		return nil, ErrNotParty
	}
	if a.Status != StatusPending {
		return nil, ErrBadTransition
	}

	bal, err := s.repo.WalletBalance(ctx, a.BuyerID, a.Currency)
	if err != nil {
		return nil, fmt.Errorf("balance check: %w", err)
	}
	if bal < a.AmountMinor {
		return nil, ErrInsufficient
	}

	// Tope diario. Faltaba: escrow comprobaba el saldo pero ningun limite, a
	// diferencia de las transferencias. Se podia vaciar la billetera creando
	// escrows hacia una cuenta propia en tramos por debajo del umbral que pide
	// segundo factor, y liberandolos.
	//
	// Solo se comprueba al FINANCIAR: es el unico momento en que el dinero sale
	// de la billetera del comprador. Liberar mueve desde la cuenta de escrow al
	// vendedor y reembolsar devuelve al comprador; ninguno de los dos saca nada
	// de una billetera, asi que volver a cobrar el tope ahi lo cobraria dos
	// veces por el mismo dinero.
	if s.history != nil {
		if err := s.history.CheckLimits(ctx, a.BuyerID, a.Currency, a.AmountMinor); err != nil {
			if errors.Is(err, transaction.ErrMonthlyLimitExceeded) {
				return nil, ErrMonthlyLimitExceeded
			}
			if errors.Is(err, transaction.ErrDailyLimitExceeded) {
				return nil, ErrDailyLimitExceeded
			}
			return nil, fmt.Errorf("daily limit check: %w", err)
		}
	}

	if s.mfa != nil && s.mfa.IsMFARequired(a.AmountMinor, a.Currency) {
		ok, err := s.mfa.HasVerifiedMFA(ctx, a.BuyerID, "high_value_tx")
		if err != nil {
			return nil, fmt.Errorf("mfa check: %w", err)
		}
		if !ok {
			return nil, ErrMFARequired
		}
	}

	// El plazo del vendedor se fija DENTRO del asiento: un acuerdo fondeado sin
	// plazo es justo el que no vence nunca.
	return s.moverYTransicionar(ctx, a, StatusPending, StatusFunded, "fund",
		ledger.Account{UserID: a.BuyerID}, escrowAccount(a.Currency),
		func(ctx context.Context, tx pgx.Tx, _ *Agreement) (*Agreement, error) {
			return fijarPlazoEntregaEnTx(ctx, tx, a.ID, s.plazos.DiasParaEntregar)
		},
		func(done *Agreement) {
			if s.uif != nil {
				s.uif.Report(ctx, a.BuyerID, a.ID, a.Currency, a.AmountMinor)
			}
		})
}

// Release pays the held funds out to the seller (funded → released, buyer only).
func (s *Service) Release(ctx context.Context, callerID, id string) (*Agreement, error) {
	a, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.BuyerID != callerID {
		if a.SellerID == callerID {
			return nil, ErrNotBuyer
		}
		return nil, ErrNotParty
	}
	// High-value step-up: releasing held funds to the seller is an outbound
	// money movement and is gated like the equivalent transfer/fund.
	if s.mfa != nil && s.mfa.IsMFARequired(a.AmountMinor, a.Currency) {
		ok, err := s.mfa.HasVerifiedMFA(ctx, a.BuyerID, "high_value_tx")
		if err != nil {
			return nil, fmt.Errorf("mfa check: %w", err)
		}
		if !ok {
			return nil, ErrMFARequired
		}
	}
	// Tambien desde una disputa: el comprador puede CEDER en cualquier momento
	// sin esperar al arbitro. Liberar le da la razon al vendedor, que es la
	// otra parte de la disputa, asi que no hay nadie a quien perjudique.
	return s.moveAndTransition(ctx, a, desdeFondeadoODisputado(a), StatusReleased, "release",
		escrowAccount(a.Currency), ledger.Account{UserID: a.SellerID}, nil)
}

// desdeFondeadoODisputado: liberar y reembolsar valen desde 'funded' y, como
// concesion de una parte, desde 'disputed'. La disputa tenia UNA sola salida,
// Resolve, y es del administrador: si las partes se ponian de acuerdo, igual
// tenian que esperar a un arbitro para mover su propia plata.
//
// Para cualquier otro estado devuelve 'funded' y deja que moveAndTransition
// decida, NO rechaza aca: un acuerdo ya liberado que se vuelve a liberar tiene
// que llegar al camino de ErrIdempotent, que lo devuelve tal como quedo (tocar
// dos veces el boton es exito, no error). Y uno reembolsado que se intenta
// liberar falla igual adentro, en la transicion guardada, sin mover plata.
// Rechazar antes rompia la primera de esas dos cosas.
func desdeFondeadoODisputado(a *Agreement) Status {
	if a.Status == StatusDisputed {
		return StatusDisputed
	}
	return StatusFunded
}

// Refund returns the held funds to the buyer (funded → refunded, seller only —
// the seller waiving the sale).
func (s *Service) Refund(ctx context.Context, callerID, id string) (*Agreement, error) {
	a, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.SellerID != callerID {
		if a.BuyerID == callerID {
			return nil, ErrNotSeller
		}
		return nil, ErrNotParty
	}
	// High-value step-up: refunding held funds to the buyer is an outbound
	// money movement and is gated like the equivalent transfer/fund.
	if s.mfa != nil && s.mfa.IsMFARequired(a.AmountMinor, a.Currency) {
		ok, err := s.mfa.HasVerifiedMFA(ctx, a.SellerID, "high_value_tx")
		if err != nil {
			return nil, fmt.Errorf("mfa check: %w", err)
		}
		if !ok {
			return nil, ErrMFARequired
		}
	}
	// Tambien desde una disputa: el vendedor puede ceder y devolver.
	return s.moveAndTransition(ctx, a, desdeFondeadoODisputado(a), StatusRefunded, "refund",
		escrowAccount(a.Currency), ledger.Account{UserID: a.BuyerID}, nil)
}

// Dispute freezes a funded agreement pending admin resolution (either party).
func (s *Service) Dispute(ctx context.Context, callerID, id, reason string) (*Agreement, error) {
	a, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.BuyerID != callerID && a.SellerID != callerID {
		return nil, ErrNotParty
	}
	if strings.TrimSpace(reason) == "" {
		return nil, ErrInvalidRequest
	}
	// Con el plazo vigente vencido el resultado ya esta decidido —la plata va a
	// quien no le tocaba actuar— y el barrido lo ejecuta en menos de un
	// minuto. Una disputa en ese minuto no reclama nada: frena un resultado
	// que la regla ya dio.
	if a.Status == StatusFunded && plazoVencido(plazoVigente(a)) {
		return nil, ErrPlazoVencido
	}
	out, err := s.repo.Transition(ctx, id, StatusFunded, StatusDisputed, reason)
	if err != nil {
		return nil, err
	}
	s.audit(callerID, out, "escrow_disputed", "medium", map[string]interface{}{"reason": reason})
	s.emit(ctx, out, "escrow.disputed")
	return out, nil
}

// Cancel abandons a pending (unfunded) agreement (either party). No money moves.
func (s *Service) Cancel(ctx context.Context, callerID, id string) (*Agreement, error) {
	a, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if a.BuyerID != callerID && a.SellerID != callerID {
		return nil, ErrNotParty
	}
	out, err := s.repo.Transition(ctx, id, StatusPending, StatusCancelled, "")
	if err != nil {
		return nil, err
	}
	s.audit(callerID, out, "escrow_cancelled", "low", nil)
	s.emit(ctx, out, "escrow.cancelled")
	return out, nil
}

// Resolve settles a disputed agreement (admin only — enforced at the route).
// outcome must be "released" (pay seller) or "refunded" (return to buyer).
func (s *Service) Resolve(ctx context.Context, adminID, id string, outcome Status) (*Agreement, error) {
	a, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	switch outcome {
	case StatusReleased:
		return s.moveAndTransition(ctx, a, StatusDisputed, StatusReleased, "release",
			escrowAccount(a.Currency), ledger.Account{UserID: a.SellerID},
			func(done *Agreement) {
				s.audit(adminID, done, "escrow_resolved", "high",
					map[string]interface{}{"outcome": "released"})
			})
	case StatusRefunded:
		return s.moveAndTransition(ctx, a, StatusDisputed, StatusRefunded, "refund",
			escrowAccount(a.Currency), ledger.Account{UserID: a.BuyerID},
			func(done *Agreement) {
				s.audit(adminID, done, "escrow_resolved", "high",
					map[string]interface{}{"outcome": "refunded"})
			})
	default:
		return nil, ErrInvalidRequest
	}
}

// moveAndTransition es el nucleo que mueve dinero: cambia el estado del acuerdo
// y postea el asiento de doble partida, EN LA MISMA TRANSACCION.
//
// Antes iban por separado —reclamar el estado, postear, y compensar el reclamo
// si el asiento fallaba— con un orden razonado: el estado sin dinero es
// detectable y arreglable, el dinero sin estado no. El razonamiento era bueno y
// dejaba dos agujeros que ningun orden cierra:
//
//   - Un acuerdo quedaba 'funded' sin que el asiento de fondeo existiera (el
//     proceso muere, o el contexto se cancela y la compensacion muere con el
//     mismo contexto). Nadie lo reparaba: el barrido solo mira estados
//     terminales. Liberarlo despues SI postea, y ese asiento debita
//     SYSTEM:ESCROW —que no tiene piso— y acredita al vendedor: dinero que
//     nadie pago, sin una sola alarma.
//   - Reclamar liberar, que el asiento aterrice pero el cliente reciba error, y
//     que la compensacion devuelva el estado a 'funded'. Reembolsar despues usa
//     OTRA llave de idempotencia, asi que pasa: las dos partes cobran y
//     SYSTEM:ESCROW queda en rojo.
//
// Con las dos escrituras en una transaccion, o se confirman las dos o ninguna.
// El reclamo sigue siendo el mutex entre dos acciones simultaneas (liberar del
// comprador contra reembolsar del vendedor): el UPDATE ... WHERE status = from
// solo lo gana uno, y ahora el perdedor tampoco puede postear.
//
// ErrIdempotent significa que este asiento ya se confirmo antes, y con el la
// transicion: se devuelve el acuerdo tal como quedo, sin volver a moverlo.
func (s *Service) moveAndTransition(
	ctx context.Context, a *Agreement, from, to Status, action string,
	debit, credit ledger.Account, onSuccess func(*Agreement),
) (*Agreement, error) {
	return s.moverYTransicionar(ctx, a, from, to, action, debit, credit, nil, onSuccess)
}

// moverYTransicionar es moveAndTransition con una escritura mas dentro de la
// transaccion del asiento: el plazo al fondear, el motivo al vencer. Corre
// despues de la transicion y devuelve el acuerdo actualizado.
func (s *Service) moverYTransicionar(
	ctx context.Context, a *Agreement, from, to Status, action string,
	debit, credit ledger.Account,
	enTx func(ctx context.Context, tx pgx.Tx, claimed *Agreement) (*Agreement, error),
	onSuccess func(*Agreement),
) (*Agreement, error) {
	var claimed *Agreement
	_, err := s.ledger.Post(ctx, &ledger.Posting{
		Description:    fmt.Sprintf("escrow %s: %s", action, a.ID),
		IdempotencyKey: fmt.Sprintf("escrow:%s:%s", action, a.ID),
		CreatedBy:      a.BuyerID,
		Metadata: map[string]any{
			"escrow_id": a.ID,
			"action":    action,
		},
		Entries: []ledger.Entry{
			{Account: debit, Side: ledger.Debit, AmountMinor: a.AmountMinor, Currency: a.Currency},
			{Account: credit, Side: ledger.Credit, AmountMinor: a.AmountMinor, Currency: a.Currency},
		},
		// La transicion, la marca de liquidacion y la fila del historial, las
		// tres dentro de la transaccion del asiento. Antes la transicion ya
		// estaba adentro (eso lo arreglo el #168) pero las otras dos corrian
		// despues del COMMIT y con el error descartado: el acuerdo podia quedar
		// 'released' con settled_at en NULL —el estado diciendo una cosa y la
		// marca otra, que es lo que sale por el webhook del comercio— y el
		// movimiento podia no aparecer nunca en la lista del usuario.
		EnLaMismaTx: func(ctx context.Context, tx pgx.Tx) error {
			var terr error
			claimed, terr = s.repo.TransitionEnTx(ctx, tx, a.ID, from, to, "")
			if terr != nil {
				return terr
			}
			if enTx != nil {
				if claimed, terr = enTx(ctx, tx, claimed); terr != nil {
					return terr
				}
			}
			// settled_at solo tiene sentido en los estados terminales:
			// estamparla al fondear dejaba al barrido de legado sin poder ver
			// jamas un release o un refund atascado.
			if to == StatusReleased || to == StatusRefunded {
				if serr := MarkSettledEnTx(ctx, tx, a.ID); serr != nil {
					return serr
				}
			}
			return s.recordHistoryEnTx(ctx, tx, claimed, action)
		},
	})
	switch {
	case errors.Is(err, ledger.ErrIdempotent):
		// El asiento ya existia, asi que este movimiento ya ocurrio. Se responde
		// con el acuerdo tal como quedo, sin volver a moverlo: repetir la misma
		// accion es exito, que es para lo que existe la llave determinista.
		//
		// (Cambia el contrato: antes una segunda liberacion devolvia 409 porque
		// el reclamo del estado corria primero y fallaba. Devolver el estado
		// alcanzado es mejor para quien toca dos veces el boton o para un
		// reintento de red: la operacion SI se hizo.)
		hecho, gerr := s.repo.Get(ctx, a.ID)
		if gerr != nil {
			return nil, gerr
		}
		if hecho.Status == from {
			// El asiento aterrizo y el estado se quedo en el de partida. Es justo
			// la averia que dejaba la ventana vieja —postear y que la
			// compensacion revirtiera el estado— y el dinero YA se movio, asi
			// que la verdad es el estado de destino. Se completa la transicion
			// en vez de devolver un estado que contradice al libro.
			alineado, terr := s.repo.Transition(ctx, a.ID, from, to, "")
			if terr != nil {
				return nil, unwrapEscrow(terr)
			}
			s.audit(a.BuyerID, alineado, "escrow_estado_alineado_con_el_libro", "high",
				map[string]interface{}{"action": action, "estado_previo": string(hecho.Status)})
			hecho = alineado
		} else if hecho.Status != to {
			// Ni el estado de partida ni el de destino: el acuerdo se fue por
			// otro camino (por ejemplo, ya reembolsado) y este asiento no lo
			// explica. No se toca nada; que lo mire una persona.
			return nil, ErrBadTransition
		}
		claimed = hecho
		// El gancho NO corrio en esta rama, asi que la marca y el historial
		// pueden faltar: son las filas que dejo pendientes el codigo viejo. Se
		// reponen best-effort — el dinero ya se movio y negarse no lo devuelve.
		if to == StatusReleased || to == StatusRefunded {
			_ = s.repo.MarkSettled(ctx, claimed.ID)
		}
		s.recordHistory(ctx, claimed, action)
	case err != nil:
		// El error de la transicion se devuelve sin envolver: el manejador lo
		// traduce a 409/404 por errors.Is, y "escrow release posting: ..."
		// delante lo dejaria fuera de esa traduccion.
		if errors.Is(err, ErrBadTransition) || errors.Is(err, ErrNotFound) {
			return nil, unwrapEscrow(err)
		}
		return nil, fmt.Errorf("escrow %s posting: %w", action, err)
	}

	s.audit(a.BuyerID, claimed, "escrow_"+string(to), "medium", nil)
	s.emit(ctx, claimed, "escrow."+string(to))
	if onSuccess != nil {
		onSuccess(claimed)
	}
	return claimed, nil
}

// unwrapEscrow saca el error del modulo de las capas que le pone el motor del
// libro al propagar un fallo del gancho.
func unwrapEscrow(err error) error {
	switch {
	case errors.Is(err, ErrBadTransition):
		return ErrBadTransition
	case errors.Is(err, ErrNotFound):
		return ErrNotFound
	}
	return err
}

// ReconcileStuck re-drives terminal agreements whose settlement was never
// confirmed — e.g. the posting failed AND its compensating revert also failed,
// leaving funds stuck in SYSTEM:ESCROW with the agreement in a terminal state.
// Re-posting uses the original idempotency key, so it completes a genuinely
// stuck transfer or is a no-op (ErrIdempotent) for one that actually settled.
// Returns how many agreements it confirmed/healed.
func (s *Service) ReconcileStuck(ctx context.Context, limit int) (int, error) {
	stuck, err := s.repo.ListUnsettledTerminal(ctx, limit)
	if err != nil {
		return 0, err
	}
	healed := 0
	for i := range stuck {
		a := &stuck[i]
		var action string
		var debit, credit ledger.Account
		switch a.Status {
		case StatusReleased:
			action, debit, credit = "release", escrowAccount(a.Currency), ledger.Account{UserID: a.SellerID}
		case StatusRefunded:
			action, debit, credit = "refund", escrowAccount(a.Currency), ledger.Account{UserID: a.BuyerID}
		default:
			continue
		}
		_, perr := s.ledger.Post(ctx, &ledger.Posting{
			Description:    fmt.Sprintf("escrow %s (reconcile): %s", action, a.ID),
			IdempotencyKey: fmt.Sprintf("escrow:%s:%s", action, a.ID),
			CreatedBy:      a.BuyerID,
			Metadata:       map[string]any{"escrow_id": a.ID, "action": action, "reconcile": true},
			Entries: []ledger.Entry{
				{Account: debit, Side: ledger.Debit, AmountMinor: a.AmountMinor, Currency: a.Currency},
				{Account: credit, Side: ledger.Credit, AmountMinor: a.AmountMinor, Currency: a.Currency},
			},
		})
		if perr != nil && !errors.Is(perr, ledger.ErrIdempotent) {
			s.audit(a.BuyerID, a, "escrow_reconcile_failed", "high",
				map[string]interface{}{"action": action, "error": perr.Error()})
			continue
		}
		if err := s.repo.MarkSettled(ctx, a.ID); err != nil {
			continue
		}
		healed++
	}

	return healed + s.repararFundeosSinAsiento(ctx, limit), nil
}

// EdadMinimaParaReparar es cuanto tiene que llevar un acuerdo en 'funded' antes
// de que el barrido se atreva a tocarlo.
const EdadMinimaParaReparar = 10 * time.Minute

// repararFundeosSinAsiento devuelve a 'pending' los acuerdos que quedaron
// 'funded' sin que el dinero saliera nunca de la billetera del comprador.
//
// Desde que la transicion y el asiento se confirman juntos esto no puede volver
// a ocurrir, pero las filas que quedaron asi antes siguen ahi, y son peligrosas:
// liberar una debita SYSTEM:ESCROW —que no tiene piso— y acredita al vendedor
// dinero que nadie pago. Nadie las miraba: el barrido solo veia estados
// terminales.
//
// Se devuelven a 'pending', que es la verdad —el acuerdo existe y no esta
// fondeado— y deja que el comprador vuelva a fondearlo o lo cancele. Cada
// reparacion queda auditada en alto, porque significa que hubo un fondeo que la
// persona pudo haber creido hecho.
func (s *Service) repararFundeosSinAsiento(ctx context.Context, limit int) int {
	candidatos, err := s.repo.ListFundedAntiguos(ctx, EdadMinimaParaReparar, limit)
	if err != nil {
		return 0
	}
	reparados := 0
	for i := range candidatos {
		a := &candidatos[i]
		hay, err := s.ledger.PostingExists(ctx, fmt.Sprintf("escrow:fund:%s", a.ID))
		if err != nil || hay {
			continue
		}
		if _, terr := s.repo.Transition(ctx, a.ID, StatusFunded, StatusPending, ""); terr != nil {
			continue
		}
		s.audit(a.BuyerID, a, "escrow_fondeo_sin_asiento_reparado", "high",
			map[string]interface{}{"amount_minor": a.AmountMinor, "currency": a.Currency})
		reparados++
	}
	return reparados
}

// recordHistory mirrors the movement into the affected user's transaction
// list, best-effort. Deterministic idempotency keys make retries no-ops.
// movimientoDeHistorial arma la fila que el usuario ve en su lista. Devuelve
// nil cuando la accion no genera movimiento visible.
func movimientoDeHistorial(a *Agreement, action string) (string, *transaction.CreateTransactionRequest) {
	var userID, txType string
	switch action {
	case "fund":
		userID, txType = a.BuyerID, "escrow_fund"
	case "release":
		userID, txType = a.SellerID, "escrow_receive"
	case "refund":
		userID, txType = a.BuyerID, "escrow_refund"
	default:
		return "", nil
	}
	return userID, &transaction.CreateTransactionRequest{
		Type:             txType,
		Amount:           a.AmountMinor,
		Currency:         a.Currency,
		CounterpartyType: "escrow",
		CounterpartyName: a.Description,
		Description:      "Escrow: " + a.Description,
		IdempotencyKey:   "escrow:" + action + ":" + a.ID,
	}
}

// recordHistoryEnTx anota el movimiento DENTRO de la transaccion del asiento.
//
// Se escribia despues del COMMIT y con el error descartado: si esa escritura se
// caia, el dinero ya se habia movido y en la lista del usuario no aparecia nada,
// sin que nadie lo reintentara. Ahora, si no se puede anotar, el dinero no se
// mueve.
func (s *Service) recordHistoryEnTx(ctx context.Context, tx pgx.Tx, a *Agreement, action string) error {
	if s.history == nil {
		return nil
	}
	userID, req := movimientoDeHistorial(a, action)
	if req == nil {
		return nil
	}
	return s.history.RecordHistoryEnTx(ctx, tx, userID, "", req)
}

// recordHistory es el camino de REPARACION: solo lo usa la rama en que el libro
// responde que el asiento ya existia, donde el gancho no llego a correr. Sigue
// siendo best-effort porque ahi el dinero ya se movio y negarse no lo devuelve.
func (s *Service) recordHistory(ctx context.Context, a *Agreement, action string) {
	if s.history == nil {
		return
	}
	userID, req := movimientoDeHistorial(a, action)
	if req == nil {
		return
	}
	_ = s.history.RecordHistory(ctx, userID, req)
}

func escrowAccount(currency string) ledger.Account {
	if currency == "USD" {
		return ledger.Account{SystemCode: ledger.SystemEscrowUSD}
	}
	return ledger.Account{SystemCode: ledger.SystemEscrowCRC}
}

func (s *Service) audit(actorID string, a *Agreement, action, risk string, extra map[string]interface{}) {
	if s.auditLogger == nil {
		return
	}
	details := map[string]interface{}{
		"buyer_id":     a.BuyerID,
		"seller_id":    a.SellerID,
		"amount_minor": a.AmountMinor,
		"currency":     a.Currency,
		"status":       string(a.Status),
	}
	for k, v := range extra {
		details[k] = v
	}
	s.auditLogger.Log(audit.Event{
		UserID:       actorID,
		Action:       action,
		ResourceType: "escrow",
		ResourceID:   a.ID,
		Details:      details,
		RiskLevel:    risk,
	})
}
