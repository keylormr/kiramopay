package accountdeletion

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Codigos de bloqueo. La app los traduce por codigo (nunca muestra el texto del
// servidor), asi que son parte del contrato con el front.
const (
	BloqueoSaldo             = "BALANCE_POSITIVE"
	BloqueoAhorros           = "SAVINGS_BALANCE"
	BloqueoCripto            = "CRYPTO_BALANCE"
	BloqueoStaking           = "STAKING_ACTIVE"
	BloqueoSaldoRegional     = "REGIONAL_BALANCE"
	BloqueoSaldoComercio     = "MERCHANT_BALANCE"
	BloqueoCobrosAbiertos    = "MERCHANT_PENDING_CHARGES"
	BloqueoMovimientoEnCurso = "TX_PENDING"
	BloqueoEscrowAbierto     = "ESCROW_OPEN"
	BloqueoPayoutEnCurso     = "PAYOUT_PENDING"
	BloqueoTransfronterizo   = "CROSS_BORDER_PENDING"
	BloqueoMarketplace       = "MARKETPLACE_IN_PROGRESS"
)

// Bloqueo es una razon por la que la cuenta no se puede eliminar todavia. No es
// un error de la peticion: la persona puede resolverla y volver a intentar.
type Bloqueo struct {
	Codigo string `json:"code"`
}

// ErrBloqueada la devuelve la eliminacion cuando hay al menos un bloqueo. No se
// movio ni se borro nada.
type ErrBloqueada struct{ Bloqueos []Bloqueo }

func (e *ErrBloqueada) Error() string {
	codigos := make([]string, 0, len(e.Bloqueos))
	for _, b := range e.Bloqueos {
		codigos = append(codigos, b.Codigo)
	}
	return fmt.Sprintf("la cuenta no se puede eliminar todavia: %v", codigos)
}

// lector es lo que necesitan las consultas de bloqueo; lo cumplen el pool y una
// transaccion, de modo que la MISMA comprobacion corre en el preflight y, ya con
// la fila bloqueada, dentro de la transaccion que elimina.
type lector interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// comprobacion es una pregunta de si/no sobre la cuenta. El SQL devuelve un
// booleano: true significa "esto bloquea".
type comprobacion struct {
	codigo string
	sql    string
}

// Saldo derivado del diario: una cuenta del libro de naturaleza credito vale
// creditos menos debitos. Se mira ademas la cache de wallets: si las dos
// discrepan, cualquiera de las dos distinta de cero basta para no eliminar.
const sumaDelDiario = `SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor ELSE -je.amount_minor END)`

var comprobaciones = []comprobacion{
	{BloqueoSaldo, `
		SELECT EXISTS (SELECT 1 FROM wallets w
		                WHERE w.user_id = $1::uuid AND (w.balance_crc <> 0 OR w.balance_usd <> 0))
		    OR EXISTS (SELECT 1 FROM ledger_accounts la
		                 JOIN journal_entries je ON je.account_id = la.id
		                WHERE la.user_id = $1::uuid AND la.type = 'user_wallet'
		                GROUP BY la.id
		               HAVING ` + sumaDelDiario + ` <> 0)`},
	{BloqueoAhorros, `
		SELECT EXISTS (SELECT 1 FROM savings_goals WHERE user_id = $1::uuid AND saved_minor > 0)`},
	{BloqueoCripto, `
		SELECT EXISTS (SELECT 1 FROM crypto_assets WHERE user_id = $1::uuid AND balance > 0)`},
	{BloqueoStaking, `
		SELECT EXISTS (SELECT 1 FROM crypto_staking WHERE user_id = $1::uuid AND status = 'active')`},
	{BloqueoSaldoRegional, `
		SELECT EXISTS (SELECT 1 FROM regional_wallets WHERE user_id = $1::uuid AND balance <> 0)`},
	{BloqueoSaldoComercio, `
		SELECT EXISTS (SELECT 1 FROM ledger_accounts la
		                 JOIN qr_merchants m ON m.id = la.merchant_id
		                 JOIN journal_entries je ON je.account_id = la.id
		                WHERE m.user_id = $1::uuid AND la.type = 'merchant_wallet'
		                GROUP BY la.id
		               HAVING ` + sumaDelDiario + ` <> 0)`},
	{BloqueoCobrosAbiertos, `
		SELECT EXISTS (SELECT 1 FROM qr_charges c
		                 JOIN qr_merchants m ON m.id = c.merchant_id
		                WHERE m.user_id = $1::uuid AND c.status = 'pending')`},
	{BloqueoMovimientoEnCurso, `
		SELECT EXISTS (SELECT 1 FROM transactions
		                WHERE user_id = $1::uuid AND status IN ('pending', 'processing'))`},
	{BloqueoEscrowAbierto, `
		SELECT EXISTS (SELECT 1 FROM escrow_agreements
		                WHERE (buyer_id = $1::uuid OR seller_id = $1::uuid)
		                  AND (status IN ('pending', 'funded', 'disputed')
		                       OR (status IN ('released', 'refunded') AND settled_at IS NULL)))`},
	{BloqueoPayoutEnCurso, `
		SELECT EXISTS (SELECT 1 FROM payouts
		                WHERE user_id = $1::uuid AND status IN ('pending', 'processing'))`},
	{BloqueoTransfronterizo, `
		SELECT EXISTS (SELECT 1 FROM cross_border_transfers
		                WHERE (sender_id = $1::uuid OR receiver_id = $1::uuid)
		                  AND status IN ('pending', 'processing'))`},
	{BloqueoMarketplace, `
		SELECT EXISTS (SELECT 1 FROM ride_requests
		                WHERE user_id = $1::uuid
		                  AND status IN ('searching', 'confirmed', 'arriving', 'in_progress'))
		    OR EXISTS (SELECT 1 FROM food_orders
		                WHERE user_id = $1::uuid
		                  AND status IN ('preparing', 'ready', 'on_the_way'))`},
}

// bloqueosDe devuelve, en un orden estable, todo lo que impide eliminar la
// cuenta. Una lista vacia quiere decir que se puede.
//
// Se evaluan TODAS (no se corta en la primera) para que la persona vea de una
// vez lo que tiene que resolver. El EXISTS con GROUP BY ... HAVING devuelve filas
// solo cuando hay una cuenta con saldo, y EXISTS lo vuelve booleano.
func bloqueosDe(ctx context.Context, q lector, userID string) ([]Bloqueo, error) {
	out := make([]Bloqueo, 0, 2)
	for _, c := range comprobaciones {
		var bloquea bool
		if err := q.QueryRow(ctx, c.sql, userID).Scan(&bloquea); err != nil {
			return nil, fmt.Errorf("bloqueo %s: %w", c.codigo, err)
		}
		if bloquea {
			out = append(out, Bloqueo{Codigo: c.codigo})
		}
	}
	return out, nil
}

// Errores de elegibilidad: la cuenta no puede usar esta via, y no es algo que se
// resuelva moviendo dinero.
var (
	// ErrCuentaNoEncontrada: no existe, o ya esta eliminada.
	ErrCuentaNoEncontrada = errors.New("cuenta no encontrada")

	// ErrRolNoPermitido: las cuentas de administracion y soporte no se
	// autoeliminan; lo gestiona operaciones.
	ErrRolNoPermitido = errors.New("una cuenta de administracion o soporte no se elimina desde la aplicacion")

	// ErrCuentaNoElegible: la cuenta esta bloqueada o suspendida. Esta bajo
	// revision y se atiende solo por la via web, con una persona de por medio.
	ErrCuentaNoElegible = errors.New("una cuenta bloqueada o suspendida se elimina solo por la via web")

	// ErrContrasenaIncorrecta y ErrTOTP*: reautenticacion fallida.
	ErrContrasenaIncorrecta = errors.New("la contrasena no es correcta")
	ErrTOTPRequerido        = errors.New("se requiere el codigo del autenticador")
	ErrTOTPInvalido         = errors.New("el codigo del autenticador no es valido")

	// ErrEnPausa: demasiados intentos de reautenticacion fallidos.
	ErrEnPausa = errors.New("demasiados intentos; vuelve a intentar mas tarde")

	// ErrCorreoParaRespuesta: la cuenta no tiene correo y la solicitud no trae
	// uno para mandar la respuesta escrita. ErrCorreoParaRespuestaInvalido: el
	// que trae no es un correo.
	ErrCorreoParaRespuesta         = errors.New("tu cuenta no tiene correo: escribe uno para enviarte la respuesta")
	ErrCorreoParaRespuestaInvalido = errors.New("el correo para la respuesta no es valido")
)
