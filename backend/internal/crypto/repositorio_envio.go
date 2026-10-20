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

// errDestinatarioNoRecibe: quien recibe pidio eliminar su cuenta, o ya no esta,
// entre que se leyo su codigo y que el envio llego a la base. Send lo contesta
// como qrpayment.ErrQRRevocado, lo mismo que si se hubiera escaneado despues.
var errDestinatarioNoRecibe = errors.New("recipient can no longer receive")

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
// Devuelve ErrSaldoDeActivoInsuficiente si el saldo no alcanza,
// errDestinatarioNoRecibe si quien recibe ya no puede recibir, y la fila que ya
// existe (con repetido=true) si la llave de idempotencia describe un envio que
// ya se hizo.
func (r *Repository) EnviarEnUnaTx(ctx context.Context, d *DatosDelEnvio) (previo *TransactionRecord, repetido bool, err error) {
	if d.Envio.ID == "" {
		d.Envio.ID = uuid.New().String()
	}

	// Read committed a proposito, como el libro: tomarDestinatarioYBilleteras
	// cuenta con que, despues de esperar un candado, la sentencia siguiente vea
	// lo que la otra transaccion confirmo.
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
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

	if err := tomarDestinatarioYBilleteras(ctx, tx, d.Envio.UserID, d.Recibo.UserID); err != nil {
		return nil, false, err
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

// tomarDestinatarioYBilleteras toma la fila de quien recibe y las dos
// billeteras, y despues comprueba que quien recibe todavia pueda recibir. Va en
// el mismo orden que el dia 0 de la eliminacion de cuenta, primero la fila de
// la persona y despues su billetera, asi que no se pueden trabar entre si.
//
// La fila de quien recibe se toma FOR KEY SHARE, el candado mas debil que choca
// con el FOR UPDATE del dia 0 (y el mismo que toma la llave foranea al escribir
// el abono). Si el dia 0 la tiene, el envio lo espera.
//
// Si el envio la toma primero, el dia 0 espera, pero su foto ya esta tomada y
// la fila de la persona no cambio, asi que al seguir no veria el cripto. Para
// eso es la billetera de quien recibe, que se toma con un UPDATE que no cambia
// nada, no con FOR UPDATE, por la misma razon que el libro toma asi la cuenta
// de un comercio: con una version nueva de la fila, el FOR UPDATE del dia 0
// falla por serializacion, reintenta y ve el cripto. Sin eso la cuenta quedaria
// por eliminar con cripto adentro, y el barrido del dia 30 no la cerraria.
//
// La billetera de quien envia la vuelve a pedir el tope (toparElGasto), que ya
// la tiene. Tomarla aqui es lo que deja las dos en el orden del libro (por id):
// tomando cada envio primero la suya, dos personas enviandose cripto a la vez
// quedarian cada una con la billetera que la otra espera.
//
// El estado se lee al final, con todo tomado. Un dia 0 que ya tenia la fila o
// la billetera de quien recibe termino antes de que el envio llegara aqui, y en
// read committed esta lectura ve lo que confirmo: la cuenta por eliminar, y el
// envio se rechaza. Leido antes de esperarlo, diria 'active' y el abono
// entraria en cuanto el dia 0 terminara. La condicion es la de
// qrpayment.PersonaDelQR: ni por eliminar ni cerrada.
func tomarDestinatarioYBilleteras(ctx context.Context, tx pgx.Tx, emisor, receptor string) error {
	if _, err := tx.Exec(ctx,
		`SELECT 1 FROM users WHERE id = $1::uuid FOR KEY SHARE`, receptor,
	); err != nil {
		return fmt.Errorf("tomar a quien recibe: %w", err)
	}

	orden := []string{emisor, receptor}
	if receptor < emisor {
		orden[0], orden[1] = receptor, emisor
	}
	for _, id := range orden {
		sql := `SELECT 1 FROM wallets WHERE user_id = $1::uuid FOR UPDATE`
		if id == receptor {
			sql = `UPDATE wallets SET updated_at = updated_at WHERE user_id = $1::uuid`
		}
		if _, err := tx.Exec(ctx, sql, id); err != nil {
			return fmt.Errorf("tomar la billetera de %s: %w", id, err)
		}
	}

	var recibe bool
	err := tx.QueryRow(ctx,
		`SELECT COALESCE(status, 'active') <> 'pending_deletion'
		   FROM users WHERE id = $1::uuid AND deleted_at IS NULL`, receptor,
	).Scan(&recibe)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !recibe) {
		return errDestinatarioNoRecibe
	}
	if err != nil {
		return fmt.Errorf("leer a quien recibe: %w", err)
	}
	return nil
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
