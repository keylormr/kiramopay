package crypto

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/shopspring/decimal"
)

// El envio de cripto entre personas, en la base.
//
// Va por una transaccion PROPIA y no por el gancho del libro, por la misma
// razon que ConvertirEnUnaTx: aqui no hay ninguna pata de fiat. El activo sale
// de una fila de crypto_assets y entra en otra, y esas filas no pasan por el
// motor de doble partida. Si la mitad confirmara y la otra no, no existe
// conciliacion que levante el faltante ni asiento que lo explique — la cripto
// simplemente habria desaparecido de la aplicacion.

// ErrLlaveDeOtroEnvio: la llave ya tiene un envio escrito, pero de otra cosa
// (otro activo, otro monto u otro destinatario). No es un reintento.
var ErrLlaveDeOtroEnvio = errors.New("idempotency key reused for a different transfer")

// codigoLlaveDuplicada es el SQLSTATE de unique_violation, e indiceDeLaLlave el
// indice unico parcial de la 072 que lo levanta cuando la llave ya tiene
// movimiento. Hacen falta los dos: la llave primaria tambien da 23505, y un id
// repetido no es un reintento.
const (
	codigoLlaveDuplicada = "23505"
	indiceDeLaLlave      = "uq_crypto_tx_llave"
)

// DatosDelEnvio es todo lo que una transferencia de cripto escribe.
type DatosDelEnvio struct {
	// Envio es la pata de quien envia: Amount es lo que LLEGA al destinatario y
	// Fee es la comision de KiramoPay. Del saldo baja la suma de los dos.
	Envio *TransactionRecord
	// Recibo es la pata de quien recibe, por Amount y sin comision.
	Recibo *TransactionRecord
	// NombreDelActivo alimenta la fila de crypto_assets si el destinatario
	// todavia no tiene ese activo.
	NombreDelActivo string
	// PrecioUSD es el costo por unidad con el que entra al promedio del
	// destinatario. Sin el, recibir cripto le diria a esa persona que le costo
	// cero y toda su ganancia seria falsa.
	PrecioUSD decimal.Decimal
	// AntesDeMover corre DENTRO de la transaccion, antes de tocar los saldos.
	// Ahi van las comprobaciones que bloquean la billetera de quien envia (el
	// tope diario), para que el orden de bloqueos sea el mismo que el de
	// comprar y vender: primero la billetera, despues el activo.
	AntesDeMover func(ctx context.Context, tx pgx.Tx) error
	// DespuesDeMover corre DENTRO de la transaccion, con los saldos ya movidos.
	// Ahi va la fila del historial, que tiene que confirmar junto con el envio.
	DespuesDeMover func(ctx context.Context, tx pgx.Tx) error
}

// EnviarEnUnaTx mueve el activo de una persona a otra y anota las dos patas, la
// comision y el historial, todo junto.
//
// Devuelve ErrSaldoDeActivoInsuficiente si el saldo no alcanza, y la fila que
// ya existe (con repetido=true) si la llave de idempotencia describe un envio
// que ya se hizo.
func (r *Repository) EnviarEnUnaTx(ctx context.Context, d *DatosDelEnvio) (previo *TransactionRecord, repetido bool, err error) {
	if d.Envio.ID == "" {
		d.Envio.ID = uuid.New().String()
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// La pata de quien envia se escribe PRIMERO porque es la que lleva la llave
	// de idempotencia: si el envio ya se hizo, el indice unico lo dice aqui, y
	// se sale sin haber tocado un solo saldo.
	if hecho, repetido, err := r.anotarConLlave(ctx, tx, d.Envio); err != nil || repetido {
		return hecho, repetido, err
	}

	if d.AntesDeMover != nil {
		if err := d.AntesDeMover(ctx, tx); err != nil {
			return nil, false, err
		}
	}

	// El saldo de quien envia baja por lo que llega MAS la comision. El
	// descuento lleva su guarda: es la unica compuerta real contra dos envios
	// simultaneos del mismo activo.
	total := d.Envio.Amount.Add(d.Envio.Fee)
	if err := moverLosDosSaldos(ctx, tx, d, total); err != nil {
		return nil, false, err
	}

	if d.Envio.Fee.IsPositive() {
		if _, err := tx.Exec(ctx,
			`INSERT INTO crypto_platform_fees (id, user_id, crypto_tx_id, asset, amount)
			 VALUES ($1, $2, $3, $4, $5)`,
			uuid.New().String(), d.Envio.UserID, d.Envio.ID, d.Envio.Asset, d.Envio.Fee,
		); err != nil {
			return nil, false, fmt.Errorf("anotar comision: %w", err)
		}
	}

	if err := insertarMovimiento(ctx, tx, d.Recibo); err != nil {
		return nil, false, err
	}

	if d.DespuesDeMover != nil {
		if err := d.DespuesDeMover(ctx, tx); err != nil {
			return nil, false, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	return d.Envio, false, nil
}

// moverLosDosSaldos aplica el descuento y el abono SIEMPRE en el mismo orden
// entre las dos personas: primero la del id mas bajo.
//
// Sin ese orden, dos personas enviandose el mismo activo a la vez se bloquean
// cruzadas —cada transaccion tiene la fila que la otra espera— y Postgres aborta
// una con un interbloqueo, que al cliente le llega como un error del servidor
// por un envio que era perfectamente valido.
func moverLosDosSaldos(ctx context.Context, tx pgx.Tx, d *DatosDelEnvio, total decimal.Decimal) error {
	descontar := func() error {
		return descontarActivo(ctx, tx, d.Envio.UserID, d.Envio.Asset, total)
	}
	abonar := func() error {
		return abonarActivo(ctx, tx, d.Recibo.UserID, d.Recibo.Asset, d.NombreDelActivo,
			d.Recibo.Amount, d.PrecioUSD)
	}
	if d.Envio.UserID < d.Recibo.UserID {
		if err := descontar(); err != nil {
			return err
		}
		return abonar()
	}
	if err := abonar(); err != nil {
		return err
	}
	return descontar()
}

// MovimientoPorLlave lee el movimiento que se escribio bajo una llave de
// idempotencia: un envio, una conversion o un apartado para staking. Nil sin
// error quiere decir que esa llave no tiene movimiento.
//
// El indice unico de la llave abarca todos los tipos, asi que lo que vuelve
// puede ser de otro tipo que el que se pide: quien lo compara tiene que mirar
// Type tambien.
func (r *Repository) MovimientoPorLlave(ctx context.Context, userID, llave string) (*TransactionRecord, error) {
	if llave == "" {
		return nil, nil
	}
	var mov TransactionRecord
	fila := r.db.QueryRow(ctx,
		`SELECT `+columnasDeMovimiento+`
		 FROM crypto_transactions WHERE user_id = $1 AND idempotency_key = $2`,
		userID, llave,
	)
	if err := escanearMovimiento(fila, &mov); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("releer movimiento por llave: %w", err)
	}
	return &mov, nil
}

func esLlaveDuplicada(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) &&
		pgErr.Code == codigoLlaveDuplicada && pgErr.ConstraintName == indiceDeLaLlave
}
