package loyalty

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/transaction"
)

// El cashback de puntos, pagado desde una cuenta de promociones que la empresa
// fondea. Decision del dueno del 2026-09-11; ver
// migrations/066_premios_con_fondo.sql para la contabilidad.
//
// Hasta la migracion 060, canjear un premio descontaba los puntos y devolvia
// un codigo "KP-..." que no leia nadie: ni abono, ni asiento. Ahora un premio
// solo se canjea si tiene COMO entregarse (cashback_minor), y el canje es un
// asiento de verdad que sale de SYSTEM:PROMOTIONS:CRC y se rechaza si no
// alcanzan los fondos. Nunca se regala plata que no existe.

var (
	// ErrPremioSinEntrega: el premio no tiene como entregarse. Aunque alguien
	// lo active a mano, no se canjea: descontar puntos a cambio de nada es
	// exactamente lo que corrigio la 060.
	ErrPremioSinEntrega = errors.New("reward has no way to be delivered")
	// ErrSinFondosPromocion: la cuenta de promociones no alcanza para este
	// canje. No se descuentan puntos ni se mueve plata.
	ErrSinFondosPromocion = errors.New("the promotions fund cannot cover this reward")
	// ErrFondeoInvalido: monto, referencia o llave faltantes al fondear.
	ErrFondeoInvalido = errors.New("invalid promotions funding request")
)

// HistoryRecorder anota el cashback en el historial de la persona, dentro de la
// transaccion del asiento. Lo satisface *transaction.Service.
type HistoryRecorder interface {
	RecordHistoryEnTx(ctx context.Context, tx pgx.Tx, userID, walletID string, req *transaction.CreateTransactionRequest) error
}

// UsarHistorial conecta el historial despues de construido el servicio: la
// autenticacion necesita este servicio (referidos) antes de que exista el de
// transacciones. Ver cmd/api/main.go.
func (s *Service) UsarHistorial(h HistoryRecorder) {
	s.history = h
}

// saldoPromocionesEnTx bloquea la cuenta de promociones y devuelve su saldo tal
// como queda con los asientos de ESTA transaccion.
//
// El gancho del libro corre despues de insertar los asientos, asi que el saldo
// ya incluye el debito de este canje: si da negativo, no alcanzaba. El bloqueo
// serializa los canjes simultaneos: el segundo espera al primero y, al leer,
// ya ve su asiento confirmado. Las cuentas de sistema del libro no tienen piso
// propio (SYSTEM:ESCROW tampoco): el piso lo pone esto.
func saldoPromocionesEnTx(ctx context.Context, tx pgx.Tx) (int64, error) {
	var id string
	if err := tx.QueryRow(ctx,
		`SELECT id::text FROM ledger_accounts WHERE code = $1 FOR UPDATE`,
		string(ledger.SystemPromotionsCRC)).Scan(&id); err != nil {
		return 0, fmt.Errorf("cuenta de promociones: %w", err)
	}
	var saldo int64
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_minor ELSE -amount_minor END), 0)
		  FROM journal_entries WHERE account_id = $1::uuid`, id).Scan(&saldo)
	return saldo, err
}

// SaldoPromociones devuelve lo que queda en la cuenta de promociones.
func (r *Repository) SaldoPromociones(ctx context.Context) (int64, error) {
	var saldo int64
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor ELSE -je.amount_minor END), 0)
		  FROM journal_entries je
		  JOIN ledger_accounts la ON la.id = je.account_id
		 WHERE la.code = $1`, string(ledger.SystemPromotionsCRC)).Scan(&saldo)
	return saldo, err
}

// canjearCashback paga el premio desde la cuenta de promociones: el asiento, el
// descuento de puntos, la redencion y la fila del historial, en UNA transaccion.
func (s *Service) canjearCashback(ctx context.Context, reward *Reward, rd *Redemption, ptx *PointsTransaction) error {
	if s.ledger == nil {
		return ErrPremioSinEntrega
	}
	_, err := s.ledger.Post(ctx, &ledger.Posting{
		Description:    "Canje de puntos: " + reward.Name,
		IdempotencyKey: "loyalty:canje:" + rd.ID,
		CreatedBy:      rd.UserID,
		Metadata: map[string]any{
			"reward_id":     reward.ID,
			"redemption_id": rd.ID,
		},
		Entries: []ledger.Entry{
			{Account: ledger.Account{SystemCode: ledger.SystemPromotionsCRC}, Side: ledger.Debit, AmountMinor: reward.CashbackMinor, Currency: "CRC"},
			{Account: ledger.Account{UserID: rd.UserID}, Side: ledger.Credit, AmountMinor: reward.CashbackMinor, Currency: "CRC"},
		},
		EnLaMismaTx: func(ctx context.Context, tx pgx.Tx) error {
			saldo, err := saldoPromocionesEnTx(ctx, tx)
			if err != nil {
				return err
			}
			if saldo < 0 {
				return ErrSinFondosPromocion
			}
			if err := s.repo.canjearCon(ctx, tx, rd, ptx, reward.Stock > 0); err != nil {
				return err
			}
			if s.history != nil {
				return s.history.RecordHistoryEnTx(ctx, tx, rd.UserID, "", &transaction.CreateTransactionRequest{
					Type:             TipoCashback,
					Amount:           reward.CashbackMinor,
					Currency:         "CRC",
					CounterpartyType: "system",
					CounterpartyName: "KiramoPay Puntos",
					Description:      reward.Name,
					IdempotencyKey:   "loyalty:canje:" + rd.ID,
				})
			}
			return nil
		},
	})
	switch {
	case err == nil, errors.Is(err, ledger.ErrIdempotent):
		return nil
	case errors.Is(err, ErrSinFondosPromocion):
		return ErrSinFondosPromocion
	case errors.Is(err, ErrSinExistencias):
		return ErrSinExistencias
	}
	return err
}

// TipoCashback es el tipo del movimiento en el historial: plata que ENTRA a la
// billetera desde la cuenta de promociones.
const TipoCashback = "loyalty_cashback"

// FondearPromociones registra que la empresa deposito `montoMinor` para
// promociones: debito SYSTEM:RESERVE:CRC, credito SYSTEM:PROMOTIONS:CRC.
//
// ESTO SUBE LA RESERVA PUBLICADA en la prueba de reservas: tiene que
// corresponder a un deposito real. Por eso exige una referencia (el numero de
// transferencia o comprobante) y queda en el rastro de auditoria con riesgo
// alto y el nombre de quien lo hizo.
func (s *Service) FondearPromociones(ctx context.Context, adminID string, montoMinor int64, referencia, llave string) (int64, error) {
	referencia = strings.TrimSpace(referencia)
	llave = strings.TrimSpace(llave)
	if montoMinor <= 0 || len(referencia) < 3 || llave == "" {
		return 0, ErrFondeoInvalido
	}
	if s.ledger == nil {
		return 0, errors.New("sin libro: no se puede fondear")
	}
	_, err := s.ledger.Post(ctx, &ledger.Posting{
		Description:    "Fondeo de promociones: " + referencia,
		IdempotencyKey: "loyalty:fondeo:" + llave,
		CreatedBy:      adminID,
		Metadata:       map[string]any{"referencia": referencia},
		Entries: []ledger.Entry{
			{Account: ledger.Account{SystemCode: ledger.SystemReserveCRC}, Side: ledger.Debit, AmountMinor: montoMinor, Currency: "CRC"},
			{Account: ledger.Account{SystemCode: ledger.SystemPromotionsCRC}, Side: ledger.Credit, AmountMinor: montoMinor, Currency: "CRC"},
		},
	})
	if err != nil && !errors.Is(err, ledger.ErrIdempotent) {
		return 0, fmt.Errorf("fondear promociones: %w", err)
	}
	if err == nil && s.auditLogger != nil {
		s.auditLogger.Log(audit.Event{
			UserID:       adminID,
			Action:       "promociones_fondeadas",
			ResourceType: "ledger_account",
			ResourceID:   string(ledger.SystemPromotionsCRC),
			RiskLevel:    "high",
			Details:      map[string]interface{}{"monto_minor": montoMinor, "referencia": referencia},
		})
	}
	return s.repo.SaldoPromociones(ctx)
}

// SaldoPromociones expone el saldo al panel del administrador.
func (s *Service) SaldoPromociones(ctx context.Context) (int64, error) {
	return s.repo.SaldoPromociones(ctx)
}

// nuevaRedencion arma la redencion y el apunte de puntos de un canje.
func nuevaRedencion(userID string, reward *Reward) (*Redemption, *PointsTransaction) {
	rd := &Redemption{
		ID:       uuid.New().String(),
		UserID:   userID,
		RewardID: reward.ID,
		Points:   reward.PointsCost,
		Status:   "completed",
	}
	return rd, &PointsTransaction{
		ID:          uuid.New().String(),
		UserID:      userID,
		Type:        "redeem",
		Points:      -reward.PointsCost,
		Description: fmt.Sprintf("Canje: %s", reward.Name),
		RefType:     "redemption",
		RefID:       rd.ID,
	}
}
