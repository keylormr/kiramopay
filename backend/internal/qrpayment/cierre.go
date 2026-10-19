package qrpayment

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/pkg/hash"
)

// ── El cierre de un comercio (migracion 079) ────────────────────────────────
//
// Pedido del dueno del 2026-10-18: todo borrado es logico. Un comercio no se
// borra: se cierra. La fila queda con su identidad legal, sus ventas y su
// billetera, que la Ley 7786 obliga a conservar; se marca cuando, quien y por
// que; y el rastro queda en audit_logs en la misma transaccion. Es la regla del
// repositorio: quitar acceso no es borrar registros.
//
// Lo que deja de pasar: cobrar (el rotulo y los cobros), aparecer en la lista
// del dueno y en la del equipo, editarlo, sumarle gente, aprobarlo. Lo que
// sigue: la fila, sus ventas, su equipo revocado, su historial, y la vista de
// administracion, que lo muestra con su estado.

// Motivos y acciones del cierre.
const (
	// MotivoCierrePropio es el motivo cuando el dueno cierra el suyo: no se le
	// pide que escriba uno.
	MotivoCierrePropio = "owner_request"

	// Acciones en audit_logs.
	AccionCierrePropio = "merchant_closed"
	AccionCierreAdmin  = "admin_merchant_closed"

	// propositoTOTPCierre es el proposito con el que queda registrado el codigo
	// del autenticador que confirmo un cierre.
	propositoTOTPCierre = "merchant_close"

	// maxIntentosDeCierrePorDefecto: el mismo tope que el login y que cambiar la
	// contrasena.
	maxIntentosDeCierrePorDefecto = 5

	// MaxMotivoDeCierre es el largo maximo del motivo, en caracteres. Es texto
	// que queda para siempre en la fila y en el rastro; la pantalla lo limita
	// igual.
	MaxMotivoDeCierre = 500
)

// TOTPChecker es lo que el cierre necesita del segundo factor. Lo cumple
// mfa.Service; la interfaz vive aqui, en el consumidor, para no atar los
// paquetes.
type TOTPChecker interface {
	TOTPEnabled(ctx context.Context, userID string) (bool, error)
	VerifyTOTP(ctx context.Context, userID, purpose, code string) (bool, error)
}

// CerrarComercioRequest es la reautenticacion del dueno: la contrasena, y el
// codigo del autenticador si lo tiene encendido.
type CerrarComercioRequest struct {
	Password string `json:"password"`
	TOTPCode string `json:"totp_code,omitempty"`
}

// CerrarComercioAdminRequest es el motivo que escribe un administrador.
type CerrarComercioAdminRequest struct {
	Reason string `json:"reason"`
}

// Cierre es quien cierra, por que, y desde donde, para el rastro.
type Cierre struct {
	CerradoPor string
	Motivo     string
	// Accion es la que queda en audit_logs; vacia, AccionCierrePropio.
	Accion    string
	IPAddress string
	UserAgent string
}

// CerrarComercioEnTx cierra el comercio dentro de la transaccion de quien llama.
// Es la pieza que comparten el cierre del dueno, el del administrador y el de
// la eliminacion de la cuenta: con la transaccion de afuera, el cierre y lo que
// lo provoco quedan los dos o ninguno, y el rastro tambien.
//
// La transaccion tiene que ser READ COMMITTED (la de pgx por defecto). La fila
// del comercio se toma FOR UPDATE antes de mirar el saldo, y el pago la pide
// FOR SHARE dentro de la transaccion de su asiento (comercioAbiertoEnTx), asi
// que los dos se ordenan:
//   - si el pago la tomo primero, este cierre espera a que confirme y la
//     lectura del saldo, que es una sentencia nueva, ya ve lo que entro: se
//     rechaza por saldo;
//   - si la tomo el cierre, el pago espera, lee el comercio ya cerrado y se
//     deshace entero.
//
// Con REPEATABLE READ o SERIALIZABLE la foto de la transaccion se toma en su
// primera sentencia, y el saldo se leeria sin lo que confirmo el pago que se
// espero: el cierre veria cero con plata adentro.
//
// Se rechaza, sin tocar nada, si el comercio no existe (ErrComercioNoEncontrado),
// si ya esta cerrado (ErrComercioCerrado), si tiene saldo en alguna moneda
// (ComercioConSaldoError) o si tiene cobros que todavia se pueden pagar
// (ComercioConCobrosError).
func CerrarComercioEnTx(ctx context.Context, tx pgx.Tx, merchantID string, c Cierre) (*Merchant, error) {
	motivo := strings.TrimSpace(c.Motivo)
	if motivo == "" || c.CerradoPor == "" {
		return nil, ErrMotivoDeCierreRequerido
	}
	if utf8.RuneCountInString(motivo) > MaxMotivoDeCierre {
		return nil, ErrMotivoDeCierreMuyLargo
	}
	accion := c.Accion
	if accion == "" {
		accion = AccionCierrePropio
	}

	m, err := scanMerchant(tx.QueryRow(ctx,
		`SELECT `+merchantCols+` FROM qr_merchants WHERE id = $1::uuid FOR UPDATE`, merchantID))
	if err != nil {
		if noEsUnComercio(err) {
			return nil, ErrComercioNoEncontrado
		}
		return nil, fmt.Errorf("tomar el comercio: %w", err)
	}
	if m.ClosedAt != nil {
		return nil, ErrComercioCerrado
	}

	if err := sePuedeCerrar(ctx, tx, merchantID); err != nil {
		return nil, err
	}

	// clock_timestamp y no NOW(): NOW() es la hora en que empezo la
	// transaccion, y si el cierre espero la fila detras de un retiro, quedaria
	// cerrado antes de ese retiro.
	cerrado, err := scanMerchant(tx.QueryRow(ctx,
		`UPDATE qr_merchants
		    SET active = FALSE, closed_at = clock_timestamp(), closed_by = $2::uuid, closure_reason = $3
		  WHERE id = $1::uuid
		  RETURNING `+merchantCols, merchantID, c.CerradoPor, motivo))
	if err != nil {
		return nil, fmt.Errorf("marcar el cierre: %w", err)
	}

	// El equipo pierde el acceso; sus filas quedan, con la fecha.
	equipo, err := tx.Exec(ctx,
		`UPDATE merchant_staff SET status = 'revoked', revoked_at = NOW()
		  WHERE merchant_id = $1::uuid AND status = 'active'`, merchantID)
	if err != nil {
		return nil, fmt.Errorf("revocar al equipo: %w", err)
	}
	// El rotulo pegado en la pared deja de cobrar. Todos: los de cada sucursal y
	// moneda, y cualquier fila vieja que siguiera viva.
	codigos, err := tx.Exec(ctx,
		`UPDATE qr_payment_codes SET status = 'revoked', revoked_at = COALESCE(revoked_at, NOW())
		  WHERE merchant_id = $1::uuid AND status <> 'revoked'`, merchantID)
	if err != nil {
		return nil, fmt.Errorf("revocar los codigos: %w", err)
	}
	vencidos, err := tx.Exec(ctx,
		`UPDATE qr_charges SET status = 'expired'
		  WHERE merchant_id = $1::uuid AND status = 'pending' AND expires_at <= NOW()`, merchantID)
	if err != nil {
		return nil, fmt.Errorf("vencer los cobros: %w", err)
	}

	if err := audit.EscribirEnTx(ctx, tx, &audit.Event{
		UserID:       c.CerradoPor,
		Action:       accion,
		ResourceType: "merchant",
		ResourceID:   merchantID,
		IPAddress:    c.IPAddress,
		UserAgent:    c.UserAgent,
		RiskLevel:    "high",
		Details: map[string]interface{}{
			"reason":          motivo,
			"owner_id":        m.UserID,
			"staff_revoked":   equipo.RowsAffected(),
			"codes_revoked":   codigos.RowsAffected(),
			"charges_expired": vencidos.RowsAffected(),
		},
	}); err != nil {
		return nil, fmt.Errorf("registrar el cierre: %w", err)
	}
	return cerrado, nil
}

// sePuedeCerrar rechaza un comercio con saldo en alguna moneda o con cobros
// que todavia se pueden pagar. Dentro del cierre se lee con la fila del
// comercio tomada; antes de reautenticar al dueno, sin candado, para no gastarle
// el codigo del autenticador en un cierre que igual no iba a pasar.
//
// Un cobro vencido que el barrido todavia no marco no frena: el reclamo ya se
// niega a pagarlo (`expires_at > NOW()`), y el cierre lo deja vencido.
func sePuedeCerrar(ctx context.Context, q pgxQuerier, merchantID string) error {
	saldos, err := saldosDelComercio(ctx, q, merchantID)
	if err != nil {
		return err
	}
	if len(saldos) > 0 {
		return &ComercioConSaldoError{Saldos: saldos}
	}
	var pendientes int
	if err := q.QueryRow(ctx,
		`SELECT COUNT(*) FROM qr_charges
		  WHERE merchant_id = $1::uuid AND status = 'pending' AND expires_at > NOW()`,
		merchantID).Scan(&pendientes); err != nil {
		return fmt.Errorf("contar los cobros pendientes: %w", err)
	}
	if pendientes > 0 {
		return &ComercioConCobrosError{Pendientes: pendientes}
	}
	return nil
}

// saldosDelComercio son los saldos distintos de cero, por moneda. Es la misma
// suma que ledger.MerchantBalance.
func saldosDelComercio(ctx context.Context, q pgxQuerier, merchantID string) ([]SaldoDelComercio, error) {
	filas, err := q.Query(ctx,
		`SELECT la.currency,
		        COALESCE(SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor
		                          ELSE -je.amount_minor END), 0) AS saldo
		   FROM ledger_accounts la
		   LEFT JOIN journal_entries je ON je.account_id = la.id
		  WHERE la.merchant_id = $1::uuid AND la.type = 'merchant_wallet'
		  GROUP BY la.currency
		 HAVING COALESCE(SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor
		                          ELSE -je.amount_minor END), 0) <> 0
		  ORDER BY la.currency`, merchantID)
	if err != nil {
		return nil, fmt.Errorf("leer el saldo del comercio: %w", err)
	}
	defer filas.Close()
	var saldos []SaldoDelComercio
	for filas.Next() {
		var s SaldoDelComercio
		if err := filas.Scan(&s.Currency, &s.Amount); err != nil {
			return nil, fmt.Errorf("leer el saldo del comercio: %w", err)
		}
		saldos = append(saldos, s)
	}
	if err := filas.Err(); err != nil {
		return nil, fmt.Errorf("leer el saldo del comercio: %w", err)
	}
	return saldos, nil
}

// comercioAbiertoEnTx es la otra mitad del orden que explica
// CerrarComercioEnTx: el pago pide la fila del comercio FOR SHARE dentro de la
// transaccion de su asiento. FOR SHARE no frena a otros pagos (se comparte),
// solo al cierre, que la quiere FOR UPDATE.
func comercioAbiertoEnTx(ctx context.Context, tx pgx.Tx, merchantID string) error {
	var cerrado bool
	err := tx.QueryRow(ctx,
		`SELECT closed_at IS NOT NULL FROM qr_merchants WHERE id = $1::uuid FOR SHARE`, merchantID).Scan(&cerrado)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrComercioNoEncontrado
	}
	if err != nil {
		return fmt.Errorf("leer el comercio en el asiento: %w", err)
	}
	if cerrado {
		return ErrComercioCerrado
	}
	return nil
}

// noEsUnComercio: la fila no esta, o el id ni siquiera tiene forma de UUID (la
// base lo rechaza con la clase 22). Lo demas es la base que no contesto.
func noEsUnComercio(err error) bool {
	var pgErr *pgconn.PgError
	return errors.Is(err, pgx.ErrNoRows) || (errors.As(err, &pgErr) && strings.HasPrefix(pgErr.Code, "22"))
}

// cerrar abre la transaccion, cierra y confirma.
func (s *Service) cerrar(ctx context.Context, merchantID string, c Cierre) (*Merchant, error) {
	tx, err := s.repo.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return nil, fmt.Errorf("abrir el cierre: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	m, err := CerrarComercioEnTx(ctx, tx, merchantID, c)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("confirmar el cierre: %w", err)
	}
	return m, nil
}

// CerrarMiComercio es el cierre del dueno, que confirma con su contrasena (y el
// codigo del autenticador si lo tiene encendido), como las demas operaciones
// que no se deshacen.
//
// Solo el dueno: ajeno, del equipo o inexistente es ErrComercioNoEncontrado,
// sin mirar la contrasena, para no confirmarle a nadie que el comercio existe.
func (s *Service) CerrarMiComercio(
	ctx context.Context, merchantID, userID string, req *CerrarComercioRequest, ac ActorContext,
) (*Merchant, error) {
	if req == nil {
		req = &CerrarComercioRequest{}
	}
	m, err := s.repo.GetMerchant(ctx, merchantID)
	if err != nil {
		if noEsUnComercio(err) {
			return nil, ErrComercioNoEncontrado
		}
		return nil, fmt.Errorf("leer el comercio: %w", err)
	}
	if m.UserID != userID {
		return nil, ErrComercioNoEncontrado
	}
	if m.ClosedAt != nil {
		return nil, ErrComercioCerrado
	}
	// El saldo y los cobros se miran antes de la contrasena: el rechazo mas
	// comun (quedo plata adentro) no le gasta a la persona un intento ni el
	// codigo del autenticador, que puede ser uno de recuperacion, de un solo
	// uso. Dentro del cierre se vuelven a mirar, ya con la fila tomada.
	if err := sePuedeCerrar(ctx, s.repo.db, merchantID); err != nil {
		return nil, err
	}
	if err := s.reautenticar(ctx, userID, req); err != nil {
		return nil, err
	}
	return s.cerrar(ctx, merchantID, Cierre{
		CerradoPor: userID,
		Motivo:     MotivoCierrePropio,
		Accion:     AccionCierrePropio,
		IPAddress:  ac.IPAddress,
		UserAgent:  ac.UserAgent,
	})
}

// reautenticar confirma que quien cierra es la persona y no solo su sesion.
//
// El tope es el de cambiar la contrasena: el intento se cuenta ANTES de mirar
// la contrasena, con el INCR atomico, y pasado el tope no se mira ni la
// correcta. Se limpia solo cuando la persona paso todo (contrasena y codigo):
// limpiarlo con la contrasena sola dejaria probar codigos del autenticador sin
// limite a quien ya la sabe.
//
// Que falte el codigo se dice antes de mirar la contrasena y sin contar un
// intento: el primer envio de la pantalla todavia no sabe si hace falta. Con un
// codigo escrito, la contrasena se mira primero, como en el login, que tambien
// dice si es la correcta antes de pedir el segundo factor; mirarla despues
// dejaria a quien tiene la sesion pero no la contrasena gastar los intentos del
// autenticador, que se comparten con el login.
func (s *Service) reautenticar(ctx context.Context, userID string, req *CerrarComercioRequest) error {
	u, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("leer la cuenta: %w", err)
	}
	if u == nil {
		return fmt.Errorf("leer la cuenta: no existe")
	}
	// Una cuenta que entra sin contrasena no tiene con que confirmar.
	if u.DemoLogin {
		return user.ErrCuentaDeDemostracion
	}

	conSegundoFactor := false
	if s.totp != nil {
		conSegundoFactor, err = s.totp.TOTPEnabled(ctx, userID)
		if err != nil {
			return fmt.Errorf("leer el segundo factor: %w", err)
		}
	}
	codigo := strings.TrimSpace(req.TOTPCode)
	if conSegundoFactor && codigo == "" {
		return ErrTOTPRequerido
	}

	if s.contarIntentoDeCierre(userID) > int64(s.maxIntentosDeCierre) {
		return ErrCierreEnPausa
	}
	valida, err := hash.VerifyPin(req.Password, u.PasswordHash)
	if err != nil || !valida {
		return ErrContrasenaIncorrecta
	}
	if conSegundoFactor {
		ok, err := s.totp.VerifyTOTP(ctx, userID, propositoTOTPCierre, codigo)
		if err != nil {
			return fmt.Errorf("verificar el segundo factor: %w", err)
		}
		if !ok {
			return ErrTOTPInvalido
		}
	}
	s.reiniciarIntentosDeCierre(userID)
	return nil
}

// Contador propio, como el de cambiar la contrasena: no se comparte con el del
// login, para que probar contrasenas aqui con una sesion robada no le bloquee la
// entrada a la persona titular.
func cierreLockoutKey(userID string) string { return "lockout:merchantclose:uid:" + userID }

func (s *Service) contarIntentoDeCierre(userID string) int64 {
	if s.lockout == nil || userID == "" {
		return 0
	}
	return s.lockout.IncrLockout(cierreLockoutKey(userID))
}

func (s *Service) reiniciarIntentosDeCierre(userID string) {
	if s.lockout == nil || userID == "" {
		return
	}
	s.lockout.ResetLockout(cierreLockoutKey(userID))
}

// CerrarComercioComoAdmin es el cierre de un administrador, con un motivo que
// queda en la fila y en el rastro. El rol lo exige la ruta (RequireAdmin).
func (s *Service) CerrarComercioComoAdmin(
	ctx context.Context, merchantID, adminID, motivo string, ac ActorContext,
) (*Merchant, error) {
	motivo = strings.TrimSpace(motivo)
	if motivo == "" {
		return nil, ErrMotivoDeCierreRequerido
	}
	if utf8.RuneCountInString(motivo) > MaxMotivoDeCierre {
		return nil, ErrMotivoDeCierreMuyLargo
	}
	return s.cerrar(ctx, merchantID, Cierre{
		CerradoPor: adminID,
		Motivo:     motivo,
		Accion:     AccionCierreAdmin,
		IPAddress:  ac.IPAddress,
		UserAgent:  ac.UserAgent,
	})
}

// ListarComercios es la vista de administracion: todos los comercios, cerrados
// incluidos y con su estado, los mas nuevos primero. La busqueda mira el
// nombre, la razon social y el identificador.
func (s *Service) ListarComercios(ctx context.Context, busqueda string) ([]Merchant, error) {
	return s.repo.ListarComercios(ctx, strings.TrimSpace(busqueda))
}

// estaCerrado lo usan los cambios que filtran `closed_at IS NULL` para decir por
// que no encontraron la fila.
func (s *Service) estaCerrado(ctx context.Context, merchantID string) bool {
	m, err := s.repo.GetMerchant(ctx, merchantID)
	return err == nil && m.ClosedAt != nil
}

// ListarComercios lee todos los comercios para la administracion, con el nombre
// de su dueno.
//
// La busqueda es por texto literal (strpos, no LIKE): un % o un _ que escriba
// el administrador se busca como tal y no como comodin.
func (r *Repository) ListarComercios(ctx context.Context, busqueda string) ([]Merchant, error) {
	filas, err := r.db.Query(ctx,
		`SELECT `+merchantCols+`,
		        COALESCE((SELECT btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))
		                    FROM users u WHERE u.id = qr_merchants.user_id), '')
		   FROM qr_merchants
		  WHERE $1::text = ''
		     OR strpos(lower(name), lower($1::text)) > 0
		     OR strpos(lower(legal_name), lower($1::text)) > 0
		     OR id::text = lower($1::text)
		  ORDER BY created_at DESC
		  LIMIT 200`, busqueda)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	var out []Merchant
	ahora := time.Now()
	for filas.Next() {
		var m Merchant
		if err := filas.Scan(append(merchantDest(&m), &m.OwnerName)...); err != nil {
			return nil, err
		}
		m.ComisionEfectivaBps = ComisionEfectiva(m.CommissionBps, m.PromoHasta, ahora)
		out = append(out, m)
	}
	return out, filas.Err()
}
