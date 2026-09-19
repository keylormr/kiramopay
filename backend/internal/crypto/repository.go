package crypto

import (
	"context"
	"errors"
	"fmt"
	"sort"
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

// errAbonoNoPositivo: se intento pasar un descuento por el camino del abono.
var errAbonoNoPositivo = errors.New("crypto asset credit must be positive")

// abonarActivo suma saldo, creando la fila si es el primer abono de ese activo.
//
// SOLO abona. Un descuento por aqui falla SIEMPRE, tenga o no saldo: Postgres
// evalua los CHECK sobre la fila que PROPONE el INSERT antes de resolver el
// ON CONFLICT, y esa fila trae el delta como saldo, asi que un delta negativo
// choca con chk_crypto_balance_nonneg (migracion 019) aunque la fila existente
// alcance. Asi murio toda venta en produccion. Los descuentos van por
// descontarActivo; la guarda de abajo impide que se vuelva a mezclar.
func abonarActivo(ctx context.Context, q pgxQuerier, userID, symbol, name string, cantidad, precio decimal.Decimal) error {
	if !cantidad.IsPositive() {
		return fmt.Errorf("%w: %s %s", errAbonoNoPositivo, cantidad, symbol)
	}
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

// bloquearActivosEnOrden toma las filas de los activos indicados con
// SELECT ... FOR UPDATE SIEMPRE en el mismo orden: alfabetico por simbolo.
//
// Existe por el abrazo mortal de las conversiones. Cada transaccion tomaba
// primero la fila del activo de ORIGEN y despues pedia la de destino, asi que
// dos conversiones de la misma persona en sentidos opuestos —BTC a ETH y ETH a
// BTC a la vez— se quedaban cada una con la fila que la otra necesitaba.
// Postgres rompe el empate matando una con 40P01 y a esa persona le salia el
// error crudo de la base de datos. Tomar los bloqueos en un orden unico es lo
// que hace imposible el ciclo; es la misma disciplina que el libro aplica sobre
// las billeteras antes de asentar.
//
// Una fila que todavia no existe (el primer abono de ese activo) no se puede
// bloquear y no hace falta: la crea el INSERT ... ON CONFLICT del abono, que se
// serializa solo contra el indice unico.
func bloquearActivosEnOrden(ctx context.Context, q pgxQuerier, userID string, simbolos ...string) error {
	orden := append([]string(nil), simbolos...)
	sort.Strings(orden)

	anterior := ""
	for _, simbolo := range orden {
		if simbolo == "" || simbolo == anterior {
			continue
		}
		anterior = simbolo
		var uno int
		err := q.QueryRow(ctx,
			`SELECT 1 FROM crypto_assets WHERE user_id = $1 AND symbol = $2 FOR UPDATE`,
			userID, simbolo).Scan(&uno)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("bloquear activo %s: %w", simbolo, err)
		}
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

	// Los dos activos se toman ANTES de tocar ninguno, y siempre en el mismo
	// orden: sin esto, dos conversiones en sentidos opuestos se abrazan y
	// Postgres mata una con 40P01.
	if err := bloquearActivosEnOrden(ctx, tx, userID, origen, destino); err != nil {
		return err
	}
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

// ApartarParaStakingEnUnaTx descuenta el activo, escribe la posicion y anota el
// movimiento, los tres juntos. Sueltos, un fallo al escribir la posicion dejaba
// el saldo descontado sin nada que lo respalde: el usuario perdia el activo y no
// tenia posicion en staking.
//
// El movimiento es lo que la pantalla muestra en "Transacciones recientes", que
// se arma solo con crypto_transactions. Sin el, el activo salia del saldo y el
// historial no decia a donde.
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
	if err := insertarMovimiento(ctx, tx, movimientoDeStaking(s.UserID, "stake", s.Asset, s.Amount)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// movimientoDeStaking arma la anotacion de apartar o liberar un activo.
//
// No hay precio ni fiat de por medio: el activo solo cambia de lugar. Por eso
// Price va en cero y Total repite la cantidad, en el mismo activo (Currency),
// igual que una conversion anota lo recibido en el simbolo de destino.
func movimientoDeStaking(userID, tipo, activo string, cantidad decimal.Decimal) *TransactionRecord {
	return &TransactionRecord{
		UserID:   userID,
		Type:     tipo,
		Asset:    activo,
		Amount:   cantidad,
		Price:    decimal.Zero,
		Total:    cantidad,
		Currency: activo,
		Fee:      decimal.Zero,
		Status:   "completed",
	}
}

// VenderEnTx descuenta el activo vendido y anota la venta DENTRO de la
// transaccion del asiento que acredita el fiat (transaction.CreateTransaction
// con EnLaMismaTx).
//
// Aqui si es el gancho del libro, y no una transaccion propia como la de
// ConvertirEnUnaTx: la venta tiene una pata en el libro (el fiat) y otra fuera
// (el activo), y las dos tienen que confirmar juntas. Antes eran pasos
// sueltos con una compensacion a mano en medio, y el descuento iba por el
// abono con delta negativo, que el CHECK de saldo rechaza siempre.
//
// Dos ventas simultaneas de la misma persona hacen fila en el bloqueo de su
// billetera que toma el asiento, y aunque no lo hicieran, el UPDATE con guarda
// de descontarActivo relee la fila ya confirmada por la otra antes de decidir.
func (r *Repository) VenderEnTx(ctx context.Context, tx pgx.Tx, mov *TransactionRecord) error {
	if err := descontarActivo(ctx, tx, mov.UserID, mov.Asset, mov.Amount); err != nil {
		return err
	}
	return insertarMovimiento(ctx, tx, mov)
}

// ComprarEnTx abona el activo comprado y anota la compra DENTRO de la
// transaccion del asiento que debita el fiat.
//
// El abono iba despues del asiento, por fuera. Ademas de la ventana entre los
// dos pasos, eso hacia que repetir una compra con la misma llave de
// idempotencia acreditara el activo otra vez: el libro reconocia la repeticion
// y no cobraba, pero el abono corria igual. Dentro del gancho, la repeticion
// no abona nada porque el gancho no corre.
//
// costoUSD es el precio de una unidad en dolares, con el que se promedia el
// costo del activo. No es mov.Price: ese va en la moneda del pago, y una
// compra en colones metia en el promedio un precio 500 veces mayor.
func (r *Repository) ComprarEnTx(ctx context.Context, tx pgx.Tx, nombre string, mov *TransactionRecord, costoUSD decimal.Decimal) error {
	if err := abonarActivo(ctx, tx, mov.UserID, mov.Asset, nombre, mov.Amount, costoUSD); err != nil {
		return err
	}
	return insertarMovimiento(ctx, tx, mov)
}

func insertarMovimiento(ctx context.Context, q pgxQuerier, tx *TransactionRecord) error {
	if tx.ID == "" {
		tx.ID = uuid.New().String()
	}
	if tx.CreatedAt.IsZero() {
		tx.CreatedAt = time.Now()
	}
	_, err := q.Exec(ctx,
		`INSERT INTO crypto_transactions (id, user_id, type, asset, amount, price, total, currency, fee, status, created_at,
		                                  counterparty_user_id, counterparty_name, idempotency_key)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
		tx.ID, tx.UserID, tx.Type, tx.Asset, tx.Amount, tx.Price, tx.Total, tx.Currency, tx.Fee, tx.Status, tx.CreatedAt,
		textoONulo(tx.CounterpartyUserID), textoONulo(tx.CounterpartyName), textoONulo(tx.IdempotencyKey),
	)
	return err
}

// textoONulo manda NULL en vez de cadena vacia. counterparty_user_id es UUID
// —una cadena vacia no es un UUID valido— y el indice unico de la llave es
// parcial (WHERE idempotency_key IS NOT NULL): con "" los movimientos que no
// llevan llave chocarian todos entre si.
func textoONulo(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// columnasDeMovimiento: la lista de SELECT que leen escanearMovimiento y todas
// las consultas de crypto_transactions, en el mismo orden. Agregar una columna
// en un solo lado es como se llega a un scan desalineado.
const columnasDeMovimiento = `id, user_id, type, asset, amount, price, total, currency, fee, status, created_at,
	 COALESCE(counterparty_user_id::text, ''), COALESCE(counterparty_name, ''), COALESCE(idempotency_key, '')`

type filaEscaneable interface {
	Scan(dest ...interface{}) error
}

func escanearMovimiento(fila filaEscaneable, tx *TransactionRecord) error {
	return fila.Scan(&tx.ID, &tx.UserID, &tx.Type, &tx.Asset, &tx.Amount, &tx.Price, &tx.Total,
		&tx.Currency, &tx.Fee, &tx.Status, &tx.CreatedAt,
		&tx.CounterpartyUserID, &tx.CounterpartyName, &tx.IdempotencyKey)
}

// UpsertAsset abona `cantidad` al activo, fuera de cualquier transaccion. Es
// el mismo SQL que abonarActivo, y con su misma guarda: solo abona. Era una
// copia aparte, y por esa copia pasaba el descuento de la venta con un delta
// negativo.
func (r *Repository) UpsertAsset(ctx context.Context, userID, symbol, name string, cantidad, price decimal.Decimal) error {
	return abonarActivo(ctx, r.db, userID, symbol, name, cantidad, price)
}

// Transactions

func (r *Repository) AddTransaction(ctx context.Context, tx *TransactionRecord) error {
	return insertarMovimiento(ctx, r.db, tx)
}

// GetTransaction lee un movimiento de cripto de la persona por su id.
func (r *Repository) GetTransaction(ctx context.Context, userID, id string) (*TransactionRecord, error) {
	var tx TransactionRecord
	fila := r.db.QueryRow(ctx,
		`SELECT `+columnasDeMovimiento+`
		 FROM crypto_transactions WHERE id = $1 AND user_id = $2`,
		id, userID,
	)
	if err := escanearMovimiento(fila, &tx); err != nil {
		return nil, err
	}
	return &tx, nil
}

func (r *Repository) GetTransactions(ctx context.Context, userID string, limit int) ([]TransactionRecord, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := r.db.Query(ctx,
		`SELECT `+columnasDeMovimiento+`
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
		if err := escanearMovimiento(rows, &tx); err != nil {
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
//
// El retiro queda anotado en crypto_transactions dentro de la misma
// transaccion: el historial de la pantalla sale solo de esa tabla, y sin la
// fila el activo volvia al saldo sin que nada lo explicara. Dos retiros
// simultaneos no anotan dos veces: el segundo no pasa del bloqueo.
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
	// Sin fila es que otro retiro la completo entre la lectura del servicio y
	// este bloqueo: para quien llega segundo, la posicion ya no esta activa.
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrPosicionNoActiva
	}
	if err != nil {
		return fmt.Errorf("lock staking position: %w", err)
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

	if err := insertarMovimiento(ctx, tx, movimientoDeStaking(userID, "unstake", asset, release)); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (r *Repository) UpdateStakingStatus(ctx context.Context, id, userID, status string) error {
	_, err := r.db.Exec(ctx, `UPDATE crypto_staking SET status = $3 WHERE id = $1 AND user_id = $2`, id, userID, status)
	return err
}
