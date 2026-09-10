package crypto

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// Assets

func (r *Repository) GetAssets(ctx context.Context, userID string) ([]AssetRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, symbol, name, balance, avg_cost, created_at, updated_at
		 FROM crypto_assets WHERE user_id = $1 ORDER BY balance * avg_cost DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("query assets: %w", err)
	}
	defer rows.Close()

	var assets []AssetRecord
	for rows.Next() {
		var a AssetRecord
		if err := rows.Scan(&a.ID, &a.UserID, &a.Symbol, &a.Name, &a.Balance, &a.AvgCost, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan asset: %w", err)
		}
		assets = append(assets, a)
	}
	if assets == nil {
		assets = []AssetRecord{}
	}
	return assets, nil
}

func (r *Repository) GetAsset(ctx context.Context, userID, symbol string) (*AssetRecord, error) {
	a := &AssetRecord{}
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, symbol, name, balance, avg_cost, created_at, updated_at
		 FROM crypto_assets WHERE user_id = $1 AND symbol = $2`,
		userID, symbol,
	).Scan(&a.ID, &a.UserID, &a.Symbol, &a.Name, &a.Balance, &a.AvgCost, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return a, nil
}

// pgxQuerier lo satisfacen *pgxpool.Pool y pgx.Tx, para que el mismo SQL corra
// suelto o dentro de una transaccion del llamante.
type pgxQuerier interface {
	Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row
}

// abonarActivo suma saldo, creando la fila si es el primer abono de ese activo.
func abonarActivo(ctx context.Context, q pgxQuerier, userID, symbol, name string, cantidad, precio decimal.Decimal) error {
	_, err := q.Exec(ctx,
		`INSERT INTO crypto_assets (id, user_id, symbol, name, balance, avg_cost, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
		 ON CONFLICT (user_id, symbol) DO UPDATE SET
		   balance = crypto_assets.balance + $5,
		   avg_cost = CASE WHEN $5 > 0 THEN
		     (crypto_assets.balance * crypto_assets.avg_cost + $5 * $6) / (crypto_assets.balance + $5)
		   ELSE crypto_assets.avg_cost END,
		   updated_at = NOW()`,
		uuid.New().String(), userID, symbol, name, cantidad, precio,
	)
	return err
}

// ErrSaldoDeActivoInsuficiente: el descuento no se pudo aplicar porque el saldo
// del activo no alcanza. El texto llega al cliente, asi que se mantiene estable.
var ErrSaldoDeActivoInsuficiente = errors.New("insufficient asset balance")

// descontarActivo resta saldo CON GUARDA. La condicion `balance >= $3` es la
// unica compuerta real: la comprobacion que hace el servicio antes lee fuera de
// la transaccion, asi que dos operaciones simultaneas sobre el mismo activo la
// pasaban las dos y el saldo quedaba en negativo.
func descontarActivo(ctx context.Context, q pgxQuerier, userID, symbol string, cantidad decimal.Decimal) error {
	ct, err := q.Exec(ctx,
		`UPDATE crypto_assets SET balance = balance - $3, updated_at = NOW()
		 WHERE user_id = $1 AND symbol = $2 AND balance >= $3`,
		userID, symbol, cantidad)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("%w: %s", ErrSaldoDeActivoInsuficiente, symbol)
	}
	return nil
}

// ConvertirEnUnaTx mueve los dos activos de una conversion, y anota el
// movimiento, DENTRO de una sola transaccion.
//
// Eran tres escrituras sueltas. Si la segunda fallaba, al usuario le
// desaparecia el activo de origen y no le llegaba el de destino: una perdida
// directa. Y no hay red que la recoja — los activos de cripto NO pasan por el
// motor de doble partida, viven en esta tabla, asi que no existe conciliacion
// que levante el faltante ni asiento que lo explique. Por eso el arreglo es una
// transaccion propia y no el gancho del libro.
func (r *Repository) ConvertirEnUnaTx(
	ctx context.Context, userID, origen, destino, nombreDestino string,
	cantidadOrigen, cantidadDestino, precioDestino decimal.Decimal,
	mov *TransactionRecord,
) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := descontarActivo(ctx, tx, userID, origen, cantidadOrigen); err != nil {
		return err
	}
	if err := abonarActivo(ctx, tx, userID, destino, nombreDestino, cantidadDestino, precioDestino); err != nil {
		return err
	}
	// El movimiento se anota aqui adentro a proposito: se descartaba con `_ =`,
	// asi que una conversion podia ocurrir sin quedar registrada en ninguna
	// parte. Si no se puede anotar, no se convierte.
	if err := insertarMovimiento(ctx, tx, mov); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ApartarParaStakingEnUnaTx descuenta el activo y escribe la posicion juntos.
// Sueltos, un fallo al escribir la posicion dejaba el saldo descontado sin nada
// que lo respalde: el usuario perdia el activo y no tenia posicion en staking.
func (r *Repository) ApartarParaStakingEnUnaTx(ctx context.Context, s *StakingRecord) error {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := descontarActivo(ctx, tx, s.UserID, s.Asset, s.Amount); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO crypto_staking (id, user_id, asset, amount, apy, start_date, locked, lock_days, earned, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
		s.ID, s.UserID, s.Asset, s.Amount, s.APY, s.StartDate, s.Locked, s.LockDays, s.Earned, s.Status,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func insertarMovimiento(ctx context.Context, q pgxQuerier, tx *TransactionRecord) error {
	if tx.ID == "" {
		tx.ID = uuid.New().String()
	}
	if tx.CreatedAt.IsZero() {
		tx.CreatedAt = time.Now()
	}
	_, err := q.Exec(ctx,
		`INSERT INTO crypto_transactions (id, user_id, type, asset, amount, price, total, currency, fee, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		tx.ID, tx.UserID, tx.Type, tx.Asset, tx.Amount, tx.Price, tx.Total, tx.Currency, tx.Fee, tx.Status, tx.CreatedAt,
	)
	return err
}

func (r *Repository) UpsertAsset(ctx context.Context, userID, symbol, name string, balanceDelta, price decimal.Decimal) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO crypto_assets (id, user_id, symbol, name, balance, avg_cost, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
		 ON CONFLICT (user_id, symbol) DO UPDATE SET
		   balance = crypto_assets.balance + $5,
		   avg_cost = CASE WHEN $5 > 0 THEN
		     (crypto_assets.balance * crypto_assets.avg_cost + $5 * $6) / (crypto_assets.balance + $5)
		   ELSE crypto_assets.avg_cost END,
		   updated_at = NOW()`,
		uuid.New().String(), userID, symbol, name, balanceDelta, price,
	)
	return err
}

// Transactions

func (r *Repository) AddTransaction(ctx context.Context, tx *TransactionRecord) error {
	return insertarMovimiento(ctx, r.db, tx)
}

func (r *Repository) GetTransactions(ctx context.Context, userID string, limit int) ([]TransactionRecord, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, type, asset, amount, price, total, currency, fee, status, created_at
		 FROM crypto_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
		userID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []TransactionRecord
	for rows.Next() {
		var tx TransactionRecord
		if err := rows.Scan(&tx.ID, &tx.UserID, &tx.Type, &tx.Asset, &tx.Amount, &tx.Price, &tx.Total, &tx.Currency, &tx.Fee, &tx.Status, &tx.CreatedAt); err != nil {
			return nil, err
		}
		txs = append(txs, tx)
	}
	if txs == nil {
		txs = []TransactionRecord{}
	}
	return txs, nil
}

// Staking

func (r *Repository) GetStakingPositions(ctx context.Context, userID string) ([]StakingRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, asset, amount, apy, start_date, locked, lock_days, earned, status, created_at
		 FROM crypto_staking WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var positions []StakingRecord
	for rows.Next() {
		var s StakingRecord
		if err := rows.Scan(&s.ID, &s.UserID, &s.Asset, &s.Amount, &s.APY, &s.StartDate, &s.Locked, &s.LockDays, &s.Earned, &s.Status, &s.CreatedAt); err != nil {
			return nil, err
		}
		positions = append(positions, s)
	}
	if positions == nil {
		positions = []StakingRecord{}
	}
	return positions, nil
}

func (r *Repository) GetStakingByID(ctx context.Context, id, userID string) (*StakingRecord, error) {
	s := &StakingRecord{}
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, asset, amount, apy, start_date, locked, lock_days, earned, status, created_at
		 FROM crypto_staking WHERE id = $1 AND user_id = $2`,
		id, userID,
	).Scan(&s.ID, &s.UserID, &s.Asset, &s.Amount, &s.APY, &s.StartDate, &s.Locked, &s.LockDays, &s.Earned, &s.Status, &s.CreatedAt)
	if err != nil {
		return nil, err
	}
	return s, nil
}

// CompleteStakingAndRelease marks an active staking position as completed and
// returns its principal plus any accrued earnings to the user's asset balance,
// in one transaction. The row lock prevents a double release under concurrent
// unstake calls.
func (r *Repository) CompleteStakingAndRelease(ctx context.Context, id, userID string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var asset string
	var amount, earned decimal.Decimal
	err = tx.QueryRow(ctx,
		`SELECT asset, amount, earned FROM crypto_staking
		 WHERE id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE`,
		id, userID,
	).Scan(&asset, &amount, &earned)
	if err != nil {
		return fmt.Errorf("active staking position not found")
	}

	if _, err := tx.Exec(ctx,
		`UPDATE crypto_staking SET status = 'completed' WHERE id = $1`, id); err != nil {
		return err
	}

	release := amount.Add(earned)
	ct, err := tx.Exec(ctx,
		`UPDATE crypto_assets SET balance = balance + $3, updated_at = NOW()
		 WHERE user_id = $1 AND symbol = $2`,
		userID, asset, release)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		if _, err := tx.Exec(ctx,
			`INSERT INTO crypto_assets (id, user_id, symbol, name, balance, avg_cost, created_at, updated_at)
			 VALUES ($1, $2, $3, $3, $4, 0, NOW(), NOW())`,
			uuid.New().String(), userID, asset, release); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (r *Repository) UpdateStakingStatus(ctx context.Context, id, userID, status string) error {
	_, err := r.db.Exec(ctx, `UPDATE crypto_staking SET status = $3 WHERE id = $1 AND user_id = $2`, id, userID, status)
	return err
}

// Price Alerts

func (r *Repository) GetPriceAlerts(ctx context.Context, userID string) ([]PriceAlertRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, asset, target_price, direction, active, created_at
		 FROM crypto_price_alerts WHERE user_id = $1 AND active = true ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var alerts []PriceAlertRecord
	for rows.Next() {
		var a PriceAlertRecord
		if err := rows.Scan(&a.ID, &a.UserID, &a.Asset, &a.TargetPrice, &a.Direction, &a.Active, &a.CreatedAt); err != nil {
			return nil, err
		}
		alerts = append(alerts, a)
	}
	if alerts == nil {
		alerts = []PriceAlertRecord{}
	}
	return alerts, nil
}

func (r *Repository) AddPriceAlert(ctx context.Context, a *PriceAlertRecord) error {
	if a.ID == "" {
		a.ID = uuid.New().String()
	}

	_, err := r.db.Exec(ctx,
		`INSERT INTO crypto_price_alerts (id, user_id, asset, target_price, direction, active, created_at)
		 VALUES ($1, $2, $3, $4, $5, true, NOW())`,
		a.ID, a.UserID, a.Asset, a.TargetPrice, a.Direction,
	)
	return err
}

func (r *Repository) DeactivatePriceAlert(ctx context.Context, id, userID string) error {
	_, err := r.db.Exec(ctx, `UPDATE crypto_price_alerts SET active = false WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}
