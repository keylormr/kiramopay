package accountdeletion

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kiramopay/backend/internal/messaging"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/pkg/hash"
)

// TOTPChecker es lo que se necesita del segundo factor. Lo cumple mfa.Service; la
// interfaz vive aqui, en el consumidor, para no atar los paquetes.
type TOTPChecker interface {
	TOTPEnabled(ctx context.Context, userID string) (bool, error)
	VerifyTOTP(ctx context.Context, userID, purpose, code string) (bool, error)
}

// Disconnector corta los WebSocket abiertos de una cuenta. Lo cumple websocket.Hub.
type Disconnector interface {
	DisconnectUser(userID string) int
}

// proposito con el que se registra el codigo TOTP de esta operacion.
const propositoTOTP = "account_deletion"

// maxReintentosSerializacion: el motor SERIALIZABLE rechaza con 40001 a una de
// dos transacciones que se pisan; reintentar es lo correcto y casi siempre
// alcanza a la primera.
const maxReintentosSerializacion = 4

// Options agrupa las dependencias opcionales del servicio.
type Options struct {
	TOTP         TOTPChecker
	Lockout      middleware.LockoutStore
	MaxIntentos  int
	Email        messaging.EmailSender
	SMS          messaging.SMSSender
	Disconnector Disconnector
	// Marcas pone y quita la marca de bloqueo que mira cada peticion
	// autenticada (auth.Repository). Sin ella, el token de acceso que quedo vivo
	// sirve hasta que vence.
	Marcas Marcas
	Logger *slog.Logger
}

// Marcas es la parte de auth.Repository que marca una cuenta para que el
// middleware la rechace en cada peticion.
type Marcas interface {
	MarkUserBlocked(ctx context.Context, userID string) error
	ClearUserBlocked(ctx context.Context, userID string) error
}

// Service elimina cuentas. Ver el comentario del paquete.
type Service struct {
	pool         *pgxpool.Pool
	users        *user.Repository
	totp         TOTPChecker
	lockout      middleware.LockoutStore
	maxIntentos  int
	email        messaging.EmailSender
	sms          messaging.SMSSender
	disconnector Disconnector
	marcas       Marcas
	logger       *slog.Logger
}

func NewService(pool *pgxpool.Pool, users *user.Repository, opts *Options) *Service {
	if opts == nil {
		opts = &Options{}
	}
	s := &Service{
		pool: pool, users: users,
		totp: opts.TOTP, lockout: opts.Lockout, maxIntentos: opts.MaxIntentos,
		email: opts.Email, sms: opts.SMS, disconnector: opts.Disconnector,
		marcas: opts.Marcas, logger: opts.Logger,
	}
	if s.maxIntentos <= 0 {
		s.maxIntentos = 5
	}
	if s.logger == nil {
		s.logger = slog.Default()
	}
	return s
}

// SetDisconnector cablea el hub una vez construido (se crea despues que este
// servicio, igual que en adminusers).
func (s *Service) SetDisconnector(d Disconnector) { s.disconnector = d }

// Preflight es lo que la pantalla muestra antes de pedir la contrasena.
type Preflight struct {
	// Elegible es true cuando se puede eliminar ahora mismo.
	Elegible bool `json:"eligible"`
	// Motivo explica por que no, cuando no es cuestion de saldo o de movimientos
	// pendientes: DEMO_ACCOUNT, ADMIN_ACCOUNT o ACCOUNT_NOT_ELIGIBLE.
	Motivo string `json:"reason,omitempty"`
	// Bloqueos son las cosas que la persona puede resolver. Nunca es null.
	Bloqueos []Bloqueo `json:"blockers"`
	// ConSegundoFactor dice si la confirmacion pedira ademas el codigo del
	// autenticador, para que la pantalla muestre el campo desde el principio.
	ConSegundoFactor bool `json:"requires_totp"`
}

// Preflight responde "se puede eliminar?" sin tocar nada.
func (s *Service) Preflight(ctx context.Context, userID string) (*Preflight, error) {
	u, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, ErrCuentaNoEncontrada
	}
	out := &Preflight{Bloqueos: []Bloqueo{}}
	if s.totp != nil {
		if on, err := s.totp.TOTPEnabled(ctx, userID); err == nil {
			out.ConSegundoFactor = on
		}
	}
	switch {
	case u.DemoLogin:
		out.Motivo = "DEMO_ACCOUNT"
		return out, nil
	case s.rolDe(ctx, userID) != "user":
		out.Motivo = "ADMIN_ACCOUNT"
		return out, nil
	case u.Status != "active":
		out.Motivo = "ACCOUNT_NOT_ELIGIBLE"
		return out, nil
	}
	bloqueos, err := bloqueosDe(ctx, s.pool, userID)
	if err != nil {
		return nil, err
	}
	out.Bloqueos = bloqueos
	out.Elegible = len(bloqueos) == 0
	return out, nil
}

func (s *Service) rolDe(ctx context.Context, userID string) string {
	var role string
	if err := s.pool.QueryRow(ctx,
		`SELECT COALESCE(role, 'user') FROM users WHERE id = $1::uuid`, userID,
	).Scan(&role); err != nil {
		return "user"
	}
	return role
}

// Confirmacion es lo que la persona presenta para eliminar su cuenta.
type Confirmacion struct {
	Password string `json:"password"`
	// TOTPCode solo se exige si la cuenta tiene el autenticador encendido.
	TOTPCode string `json:"totp_code,omitempty"`
	// AceptaPlazo es la aceptacion expresa del plazo de 30 dias.
	AceptaPlazo bool `json:"accept_terms"`
}

// ErrPlazoNoAceptado: la solicitud no trae la aceptacion expresa del plazo.
var ErrPlazoNoAceptado = errors.New("hay que aceptar el plazo de 30 dias")

// Solicitud es el resultado de pedir la eliminacion.
type Solicitud struct {
	Ya           bool      `json:"already_requested"`
	SolicitadaEn time.Time `json:"requested_at"`
	SeEliminaEl  time.Time `json:"deletion_due_at"`
}

func lockoutKey(userID string) string { return "lockout:delacct:uid:" + userID }

// EliminarMiCuenta es la via de la aplicacion: reautentica a la persona con su
// contrasena (y el autenticador si lo tiene) y elimina.
//
// El tope de intentos se cuenta ANTES de mirar la contrasena, con el INCR
// atomico de Redis, por la misma razon que en ChangePassword: leer el contador y
// sumar despues deja que una rafaga en paralelo lo esquive. Sin Redis el tope no
// frena, igual que en el login.
func (s *Service) EliminarMiCuenta(ctx context.Context, userID string, c Confirmacion) (*Solicitud, error) {
	// Sin la aceptacion expresa del plazo no hay solicitud. Va antes que todo:
	// no gasta intentos ni mira la contrasena.
	if !c.AceptaPlazo {
		return nil, ErrPlazoNoAceptado
	}
	u, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return nil, ErrCuentaNoEncontrada
	}
	if u.DemoLogin {
		return nil, user.ErrCuentaDeDemostracion
	}
	if s.lockout != nil && s.lockout.IncrLockout(lockoutKey(userID)) > int64(s.maxIntentos) {
		return nil, ErrEnPausa
	}
	valido, err := hash.VerifyPin(c.Password, u.PasswordHash)
	if err != nil || !valido {
		return nil, ErrContrasenaIncorrecta
	}
	if s.totp != nil {
		on, err := s.totp.TOTPEnabled(ctx, userID)
		if err != nil {
			return nil, fmt.Errorf("consultar segundo factor: %w", err)
		}
		if on {
			if c.TOTPCode == "" {
				return nil, ErrTOTPRequerido
			}
			ok, err := s.totp.VerifyTOTP(ctx, userID, propositoTOTP, c.TOTPCode)
			if err != nil || !ok {
				return nil, ErrTOTPInvalido
			}
		}
	}
	if s.lockout != nil {
		s.lockout.ResetLockout(lockoutKey(userID))
	}

	res, err := s.iniciar(ctx, userID, opciones{canal: CanalApp})
	if err != nil {
		return nil, err
	}
	s.despues(userID, res)
	return &Solicitud{Ya: res.Ya, SolicitadaEn: res.SolicitadaEn, SeEliminaEl: res.SeEliminaEl}, nil
}

// iniciar abre la transaccion SERIALIZABLE, pide la eliminacion (el dia 0) y
// confirma, reintentando si el motor rechaza por serializacion.
func (s *Service) iniciar(ctx context.Context, userID string, op opciones) (resultado, error) {
	var res resultado
	err := s.conReintentos(ctx, func(tx pgx.Tx) error {
		var err error
		res, err = iniciarEnTx(ctx, tx, userID, op)
		return err
	})
	return res, err
}

// conReintentos corre f dentro de una transaccion SERIALIZABLE y la confirma. Si
// f devuelve error, hace rollback. Un 40001 (serialization_failure) o 40P01
// (deadlock) reabre la transaccion y vuelve a correr f, hasta
// maxReintentosSerializacion veces.
func (s *Service) conReintentos(ctx context.Context, f func(tx pgx.Tx) error) error {
	var ultimo error
	for intento := 0; intento < maxReintentosSerializacion; intento++ {
		err := s.unaVez(ctx, f)
		if err == nil {
			return nil
		}
		if !esReintentable(err) {
			return err
		}
		ultimo = err
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(intento+1) * 15 * time.Millisecond):
		}
	}
	return fmt.Errorf("no se pudo serializar tras %d intentos: %w", maxReintentosSerializacion, ultimo)
}

func (s *Service) unaVez(ctx context.Context, f func(tx pgx.Tx) error) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fmt.Errorf("abrir transaccion: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op una vez confirmada
	if err := f(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func esReintentable(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && (pgErr.Code == "40001" || pgErr.Code == "40P01")
}

// avisoTimeout acota el envio del correo de aviso, que va por un contexto propio
// para que un proveedor lento no retenga la peticion.
const avisoTimeout = 30 * time.Second

// despues hace lo que no puede estar dentro de la transaccion del dia 0: marcar
// la cuenta para que ningun token siga vivo, cortar los WebSocket y mandar la
// respuesta escrita. Nada de esto es critico: la base ya es autoritativa (sin
// la marca, el repaso de las marcas la pone) y una falla aqui solo se registra.
func (s *Service) despues(userID string, res resultado) {
	if res.Ya {
		return
	}
	s.marcar(userID)
	if s.disconnector != nil {
		s.disconnector.DisconnectUser(userID)
	}
	s.responderPorEscrito(userID, res)
}

// responderPorEscrito manda la respuesta escrita del dia 0 con las fechas de la
// solicitud. La via web la vuelve a mandar cuando se pide de nuevo una cuenta
// que ya esta en plazo: la pagina promete el correo.
func (s *Service) responderPorEscrito(userID string, res resultado) {
	subject, text, html := messaging.AccountDeletionRequestedEmail(res.SeEliminaEl,
		res.SeEliminaEl.AddDate(anosDeConservacion, 0, 0))
	s.enviarAviso(userID, res.Correo, subject, text, html, "respuesta a la solicitud de eliminacion no enviada")
}

// marcar pone la marca que el middleware mira en cada peticion autenticada.
func (s *Service) marcar(userID string) {
	if s.marcas == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), avisoTimeout)
	defer cancel()
	if err := s.marcas.MarkUserBlocked(ctx, userID); err != nil {
		s.logger.Warn("marca de la eliminacion no puesta", "user", userID, "err", err.Error())
	}
}

// desmarcar quita la marca al reactivar. Si falla, la persona recibe
// ACCOUNT_BLOCKED hasta que el repaso de las marcas la quite: queda en el log.
func (s *Service) desmarcar(userID string) {
	if s.marcas == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), avisoTimeout)
	defer cancel()
	if err := s.marcas.ClearUserBlocked(ctx, userID); err != nil {
		s.logger.Error("marca de la eliminacion no quitada al reactivar", "user", userID, "err", err.Error())
	}
}

// enviarAviso manda un correo por fuera de la peticion, acotado por avisoTimeout.
// El correo no se escribe en el log: es un dato que se va a suprimir.
func (s *Service) enviarAviso(userID, correo, subject, text, html, siFalla string) {
	if s.email == nil || correo == "" {
		return
	}
	// #nosec G118 -- intentionally detached: the request context dies with the
	// response and the notice must outlive it; it bounds itself with avisoTimeout.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), avisoTimeout)
		defer cancel()
		if err := s.email.SendEmail(ctx, correo, subject, text, html); err != nil {
			s.logger.Warn(siFalla, "user", userID, "err", err.Error())
		}
	}()
}
