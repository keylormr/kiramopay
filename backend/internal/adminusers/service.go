// Package adminusers implementa la gestion administrativa de cuentas: busqueda
// con la PII enmascarada en SQL y bloqueo/desbloqueo remoto con revocacion de
// sesiones. Solo se monta dentro del grupo RequireAdmin.
package adminusers

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/auth"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/pkg/identifier"
)

// ActorContext identifica la peticion del administrador para la auditoria.
type ActorContext struct{ IPAddress, UserAgent string }

var (
	ErrNotFound       = errors.New("user not found")
	ErrSelfBlock      = errors.New("cannot block your own account")
	ErrAdminTarget    = errors.New("cannot block an administrator")
	ErrReasonRequired = errors.New("reason is required")
	ErrTermTooShort   = errors.New("search term too short")
)

const (
	minSearchTermRunes = 3
	// Espeja chk_users_blocked_reason_len (char_length <= 500): se cuenta en
	// runas, igual que Postgres, no en bytes.
	maxReasonRunes = 500

	defaultSearchLimit  = 20
	maxSearchLimit      = 100
	defaultBlockedLimit = 50
	maxBlockedLimit     = 200
)

// ReasonDemoExpired es el motivo con el que el barrido bloquea una cuenta que
// llego a su fecha de vencimiento. Es una constante y no un texto libre porque
// distingue en la auditoria los bloqueos automaticos de los que decidio una
// persona, y porque el administrador lo lee tal cual en la ficha.
const ReasonDemoExpired = "demo vencido"

// Disconnector corta las conexiones WebSocket abiertas de una cuenta. Lo
// implementa websocket.Hub; la interfaz vive aqui, en el consumidor, porque el
// hub se construye mucho despues que este servicio (mismo arreglo que
// notification.Broadcaster).
type Disconnector interface {
	DisconnectUser(userID string) int
}

type Options struct{ AuditLogger *audit.Logger }

type Service struct {
	users        *user.Repository
	auth         *auth.Repository
	auditLogger  *audit.Logger
	disconnector Disconnector
}

// SetDisconnector cablea el hub una vez construido. Opcional: sin el, el
// bloqueo sigue siendo efectivo para todo lo demas (REST, refresh, API keys) y
// el socket abierto muere cuando el cliente lo cierre.
func (s *Service) SetDisconnector(d Disconnector) { s.disconnector = d }

func NewService(users *user.Repository, authRepo *auth.Repository, opts *Options) *Service {
	if opts == nil {
		opts = &Options{}
	}
	return &Service{users: users, auth: authRepo, auditLogger: opts.AuditLogger}
}

// Search busca cuentas por cedula, telefono o correo (lookup exacto por HMAC
// sobre el canonico de identifier.Classify) o, si el termino no clasifica, por
// nombre parcial. La auditoria guarda el TIPO de busqueda y la cantidad de
// resultados, nunca el termino: details es JSONB sin cifrar.
func (s *Service) Search(ctx context.Context, term string, limit int, actorID string, ac ActorContext) ([]user.AdminUserView, error) {
	term = strings.TrimSpace(term)
	if utf8.RuneCountInString(term) < minSearchTermRunes {
		return nil, ErrTermTooShort
	}
	limit = clampLimit(limit, defaultSearchLimit, maxSearchLimit)

	var (
		views []user.AdminUserView
		err   error
		kind  string
	)
	// Esta bifurcacion se apoyaba en que Classify FALLARA para decidir que el
	// termino es un nombre de persona. Eso dejo de ser cierto al existir el
	// nombre de usuario: "martinez" o "keil" ahora clasifican, y sin la guarda
	// de hashColumnFor irian a buscarse como HMAC de cedula — cero resultados,
	// en silencio, con la busqueda por nombre del panel muerta. Por eso el
	// criterio ya no es "clasifico o no" sino "hay una columna PII donde
	// buscarlo exacto"; lo que no la tiene sigue el camino del nombre.
	if k, canonical, cerr := identifier.Classify(term); cerr == nil && hashColumnFor(k) != "" {
		kind = string(k)
		views, err = s.users.FindAdminViewByHash(ctx, hashColumnFor(k), canonical)
	} else {
		kind = "name"
		views, err = s.users.SearchAdminViewByName(ctx, term, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("search users: %w", err)
	}
	if views == nil {
		views = []user.AdminUserView{}
	}
	s.audit(actorID, "admin_user_search", "user", "", "low", ac, map[string]interface{}{
		"kind":    kind,
		"results": len(views),
	})
	return views, nil
}

// Get devuelve la ficha administrativa; ErrNotFound si no existe o esta borrada.
func (s *Service) Get(ctx context.Context, userID string) (*user.AdminUserView, error) {
	v, err := s.users.GetAdminView(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}
	return v, nil
}

// ListBlocked lista las cuentas bloqueadas, la mas reciente primero.
func (s *Service) ListBlocked(ctx context.Context, limit int) ([]user.AdminUserView, error) {
	views, err := s.users.ListBlockedAdminViews(ctx, clampLimit(limit, defaultBlockedLimit, maxBlockedLimit))
	if err != nil {
		return nil, fmt.Errorf("list blocked users: %w", err)
	}
	if views == nil {
		views = []user.AdminUserView{}
	}
	return views, nil
}

// Block bloquea la cuenta y revoca todas sus sesiones. Idempotente.
//
// ORDEN: primero la transaccion en BD (autoritativa: con eso solo el bloqueo ya
// es efectivo aunque Redis este caido), despues la marca en Redis que da el
// codigo ACCOUNT_BLOCKED. Ante un fallo parcial la cuenta queda siempre en el
// estado MAS restrictivo, nunca en uno contradictorio: si la marca falla, la
// cuenta ya esta bloqueada (responde SESSION_REVOKED en vez de ACCOUNT_BLOCKED)
// y el error hace que el administrador reintente.
func (s *Service) Block(ctx context.Context, targetID, adminID, reason string, ac ActorContext) (*user.AdminUserView, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" || utf8.RuneCountInString(reason) > maxReasonRunes {
		return nil, ErrReasonRequired
	}
	if targetID == adminID {
		return nil, ErrSelfBlock
	}
	target, err := s.Get(ctx, targetID)
	if err != nil {
		return nil, err
	}
	if target.Role == "admin" {
		return nil, ErrAdminTarget
	}

	found, err := s.enforceBlock(ctx, targetID, adminID, reason, ac, nil)
	if !found {
		if err != nil {
			return nil, err
		}
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, targetID)
}

// enforceBlock aplica el bloqueo en el UNICO orden admitido y es el camino
// compartido por el bloqueo manual y el barrido de vencimientos: no debe haber
// dos formas distintas de quedar bloqueado.
//
//  1. BD (autoritativa, en una tx): status, rastro, sesiones y API keys.
//  2. Marca en Redis: lo que hace que el middleware responda ACCOUNT_BLOCKED.
//  3. Corte de los sockets ya abiertos.
//
// El orden importa en las dos direcciones. Cortar el socket ANTES de la marca
// abriria una ventana en la que el cliente reconecta sobre una cuenta que
// todavia no rechaza peticiones. Y el corte se hace aunque la marca falle: ahi
// la cuenta ya esta bloqueada en la fuente de verdad (responde SESSION_REVOKED
// en vez de ACCOUNT_BLOCKED) y el error hace que el llamador reintente.
//
// due distingue los dos caminos. nil es el bloqueo manual: su UPDATE es
// incondicional e idempotente, y repetirlo solo refresca el rastro. Con valor,
// es el barrido de vencimientos: el UPDATE reconfirma en el mismo statement que
// la cuenta sigue vencida, sin bloquear y sin ser administrador, asi que un
// bloqueo manual, una extension del vencimiento o un ascenso a administrador
// ocurridos desde que se leyo el lote ganan y el barrido se salta la fila. En
// ese caso adminID viene vacio (blocked_by NULL) y la auditoria marca
// automatic: no lo decidio una persona.
func (s *Service) enforceBlock(ctx context.Context, targetID, adminID, reason string, ac ActorContext, due *time.Time) (found bool, err error) {
	var revoked int
	if due != nil {
		found, revoked, err = s.auth.BlockExpiredUserAndRevokeSessions(ctx, targetID, reason, *due)
	} else {
		found, revoked, err = s.auth.BlockUserAndRevokeSessions(ctx, targetID, reason, adminID)
	}
	if err != nil {
		return false, fmt.Errorf("block user: %w", err)
	}
	if !found {
		return false, nil
	}
	markErr := s.auth.MarkUserBlocked(ctx, targetID)

	details := map[string]interface{}{"reason": reason, "sessions_revoked": revoked}
	if due != nil {
		details["automatic"] = true
	}
	// El bloqueo en BD ya ocurrio: el rastro se escribe aunque la marca falle.
	s.audit(adminID, "user_blocked", "user", targetID, "critical", ac, details)

	if s.disconnector != nil {
		s.disconnector.DisconnectUser(targetID)
	}
	if markErr != nil {
		return true, fmt.Errorf("mark user blocked: %w", markErr)
	}
	return true, nil
}

// SetExpiry programa (o quita, con at nil) el vencimiento de una cuenta. No
// bloquea nada por si mismo: la fecha la ejecuta el barrido, que pasa por
// enforceBlock como cualquier bloqueo manual. Programar una fecha ya pasada es
// legitimo — significa "que se cierre en el proximo tick".
func (s *Service) SetExpiry(ctx context.Context, targetID, adminID string, at *time.Time, ac ActorContext) (*user.AdminUserView, error) {
	target, err := s.Get(ctx, targetID)
	if err != nil {
		return nil, err
	}
	// Misma regla que el bloqueo: una cuenta de administrador no se programa
	// para vencer. El barrido tambien las excluye en SQL, asi que esto no es la
	// unica defensa, pero aqui el administrador recibe un error claro.
	if target.Role == "admin" {
		return nil, ErrAdminTarget
	}
	found, err := s.users.SetExpiresAt(ctx, targetID, at)
	if err != nil {
		return nil, fmt.Errorf("set expiry: %w", err)
	}
	if !found {
		return nil, ErrNotFound
	}
	details := map[string]interface{}{"cleared": at == nil}
	if at != nil {
		details["expires_at"] = at.UTC().Format(time.RFC3339)
	}
	s.audit(adminID, "user_expiry_set", "user", targetID, "high", ac, details)
	return s.Get(ctx, targetID)
}

// ExpireDue bloquea las cuentas cuyo vencimiento ya paso. Lo llama el barrido
// periodico en cada tick, y devuelve cuantas bloqueo.
//
// La consulta excluye a las ya bloqueadas para no repisar su rastro ni duplicar
// eventos criticos de auditoria, pero ese filtro es una foto: entre la lectura
// del lote y el turno de cada fila pasan segundos. La condicion que de verdad
// manda viaja en el UPDATE (ver BlockExpiredUserAndRevokeSessions), asi que una
// fila que cambio de estado en el medio se salta en silencio.
//
// Un fallo sobre una cuenta no detiene al resto: se guarda el primero y el
// barrido sigue, para que una fila problematica no deje vivas a las demas.
func (s *Service) ExpireDue(ctx context.Context, now time.Time, limit int) (int, error) {
	ids, err := s.users.ListDueForExpiry(ctx, now, limit)
	if err != nil {
		return 0, fmt.Errorf("list due for expiry: %w", err)
	}
	var (
		blocked  int
		firstErr error
	)
	for _, id := range ids {
		if ctx.Err() != nil {
			break
		}
		found, err := s.enforceBlock(ctx, id, "", ReasonDemoExpired, ActorContext{}, &now)
		if found {
			blocked++
		}
		if err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return blocked, firstErr
}

// ─────────────────────────────────────────────────────────────────────────
//  Sesiones de una cuenta ajena
// ─────────────────────────────────────────────────────────────────────────

// Sessions lista los dispositivos con sesion abierta de una cuenta. No marca
// ninguno como "actual": el administrador no es esa persona.
func (s *Service) Sessions(ctx context.Context, targetID string) ([]auth.SessionView, error) {
	if _, err := s.Get(ctx, targetID); err != nil {
		return nil, err
	}
	sesiones, err := s.auth.ListActiveSessions(ctx, targetID, "")
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	return sesiones, nil
}

// RevokeSession cierra UN dispositivo de una cuenta ajena. found=false si esa
// sesion no existe, ya estaba cerrada o es de otra cuenta.
//
// Corta ademas los sockets de esa persona. El hub identifica las conexiones por
// usuario y no por sesion, asi que caen todas: los demas dispositivos se
// reconectan solos con su token, que sigue siendo valido, y el que se acaba de
// cerrar es el unico que no puede volver. Cortar de mas es aceptable; dejar al
// dispositivo cerrado recibiendo notificaciones, no.
func (s *Service) RevokeSession(ctx context.Context, targetID, sessionID, adminID string, ac ActorContext) (bool, error) {
	found, err := s.auth.RevokeSessionByID(ctx, targetID, sessionID)
	if err != nil {
		return false, fmt.Errorf("revoke session: %w", err)
	}
	if !found {
		return false, nil
	}
	s.audit(adminID, "admin_session_revoked", "session", targetID, "high", ac, map[string]interface{}{
		"session_id": sessionID,
	})
	if s.disconnector != nil {
		s.disconnector.DisconnectUser(targetID)
	}
	return true, nil
}

// RevokeAllSessions cierra TODOS los dispositivos de una cuenta y revoca sus
// familias de refresh, sin bloquearla: la persona vuelve a entrar con su
// contrasena. Es lo que hace falta cuando se sospecha que alguien mas tiene
// acceso pero la cuenta en si no esta en cuestion.
func (s *Service) RevokeAllSessions(ctx context.Context, targetID, adminID string, ac ActorContext) (int, error) {
	if _, err := s.Get(ctx, targetID); err != nil {
		return 0, err
	}
	n, err := s.auth.RevokeAllSessions(ctx, targetID, "")
	if err != nil {
		return 0, fmt.Errorf("revoke sessions: %w", err)
	}
	s.audit(adminID, "admin_sessions_revoked_all", "session", targetID, "critical", ac, map[string]interface{}{
		"sessions_revoked": n,
	})
	if s.disconnector != nil {
		s.disconnector.DisconnectUser(targetID)
	}
	return n, nil
}

// ClaimMarkReconcile gana el turno de repasar las marcas de bloqueo para la
// ventana pedida. Devuelve false si otra instancia ya lo gano o si no hay Redis
// (sin Redis no hay marcas que repasar: el bloqueo se consulta contra la BD).
func (s *Service) ClaimMarkReconcile(ctx context.Context, every time.Duration) (bool, error) {
	return s.auth.TryClaimBlockedReconcile(ctx, every)
}

// ReconcileBlockedMarks pone al dia las marcas de Redis contra la BD, en las dos
// direcciones, y devuelve cuantas puso y cuantas quito.
//
// Existe porque el bloqueo automatico no tiene a nadie que note un fallo. El
// orden del bloqueo es BD primero y marca despues: si la marca falla, la cuenta
// queda bloqueada de verdad (las sesiones ya murieron) pero el middleware
// responde SESSION_REVOKED en vez de ACCOUNT_BLOCKED. En el bloqueo manual el
// administrador ve el error y reintenta; en el barrido nadie lo ve, y la propia
// consulta de candidatos ya excluye la cuenta por estar bloqueada, asi que no
// hay segundo intento. Hasta ahora eso solo se arreglaba al reiniciar.
func (s *Service) ReconcileBlockedMarks(ctx context.Context) (added, removed int, err error) {
	added, removed, err = s.auth.ReconcileBlockedMarks(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("reconcile blocked marks: %w", err)
	}
	return added, removed, nil
}

// Unblock reactiva la cuenta. Las sesiones revocadas NO se resucitan: la
// persona vuelve a entrar con su contrasena. Idempotente.
//
// ORDEN inverso al bloqueo: primero se quita la marca de Redis y despues se
// activa en BD. Si se hiciera al reves y el DEL fallara, la cuenta quedaria
// activa en BD pero rechazada con ACCOUNT_BLOCKED en cada peticion.
func (s *Service) Unblock(ctx context.Context, targetID, adminID string, ac ActorContext) (*user.AdminUserView, error) {
	if _, err := s.Get(ctx, targetID); err != nil {
		return nil, err
	}
	if err := s.auth.ClearUserBlocked(ctx, targetID); err != nil {
		return nil, fmt.Errorf("clear user blocked: %w", err)
	}
	found, err := s.auth.UnblockUser(ctx, targetID)
	if err != nil {
		return nil, fmt.Errorf("unblock user: %w", err)
	}
	if !found {
		return nil, ErrNotFound
	}
	s.audit(adminID, "user_unblocked", "user", targetID, "high", ac, nil)
	return s.Get(ctx, targetID)
}

func (s *Service) audit(actorID, action, resourceType, resourceID, risk string, ac ActorContext, details map[string]interface{}) {
	if s.auditLogger == nil {
		return
	}
	s.auditLogger.Log(audit.Event{
		UserID:       actorID,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		IPAddress:    ac.IPAddress,
		UserAgent:    ac.UserAgent,
		Details:      details,
		RiskLevel:    risk,
	})
}

// hashColumnFor traduce el tipo clasificado a la columna HMAC. El repositorio
// valida la columna contra su propia lista blanca; aqui solo se elige.
// hashColumnFor devuelve la columna de token HMAC donde buscar un
// identificador exacto, o "" si ese tipo no vive en una columna PII.
//
// SIN rama default a proposito: la que habia devolvia "cedula_hash" para
// cualquier tipo desconocido, asi que al aparecer un tipo nuevo la busqueda
// del panel se iba a consultar el HMAC de la cedula con un valor que no es una
// cedula. No fallaba: devolvia cero filas, en silencio. Un tipo nuevo tiene
// que aparecer aqui explicitamente o quedarse en "".
func hashColumnFor(k identifier.Kind) string {
	switch k {
	case identifier.KindCedula:
		return "cedula_hash"
	case identifier.KindPhone:
		return "phone_hash"
	case identifier.KindEmail:
		return "email_hash"
	}
	return ""
}

func clampLimit(limit, def, max int) int {
	if limit <= 0 {
		return def
	}
	if limit > max {
		return max
	}
	return limit
}
