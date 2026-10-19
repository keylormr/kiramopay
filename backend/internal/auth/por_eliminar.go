package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/kiramopay/backend/internal/audit"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/pkg/identifier"
)

// Cuenta con la eliminacion en curso (users.status = 'pending_deletion', ver la
// migracion 077). Durante los 30 dias del plazo la persona no tiene sesion ni
// puede operar, pero si puede volver: al entrar con su contrasena se le ofrece
// reactivar la cuenta, y reactivarla cancela el proceso.
//
// El ciclo de vida de la eliminacion vive en internal/accountdeletion; auth solo
// necesita dos preguntas y las pide por esta interfaz, que cumple
// accountdeletion.Service. Va aqui, en el consumidor, para no atar los paquetes
// (accountdeletion ya depende de auth en sus pruebas).
type CuentasPorEliminar interface {
	// SeEliminaEl devuelve el dia 30 de la cuenta y si todavia se puede
	// reactivar (el plazo no vencio).
	SeEliminaEl(ctx context.Context, userID string) (fecha time.Time, reactivable bool, err error)
	// Reactivar cancela el proceso. false sin error: ya no se puede (vencio,
	// la cerro el barrido o la cuenta quedo bloqueada mientras tanto).
	Reactivar(ctx context.Context, userID string) (bool, error)
}

// ErrCuentaPorEliminar: la cuenta tiene la eliminacion en curso. En Login solo
// se llega aqui DESPUES de verificar la contrasena, como con ErrAccountBlocked,
// para que el codigo distinto no delate que la cuenta existe.
var ErrCuentaPorEliminar = errors.New("account pending deletion")

// CuentaPorEliminarError lleva la fecha del cierre para que la pantalla diga
// hasta cuando se puede reactivar. errors.Is(err, ErrCuentaPorEliminar) es true.
type CuentaPorEliminarError struct {
	SeEliminaEl time.Time
}

func (e *CuentaPorEliminarError) Error() string { return ErrCuentaPorEliminar.Error() }

func (e *CuentaPorEliminarError) Is(target error) bool { return target == ErrCuentaPorEliminar }

// SetCuentasPorEliminar cablea el servicio de eliminacion, que se construye
// despues que este (mismo patron que SetDisconnector en adminusers).
func (s *Service) SetCuentasPorEliminar(c CuentasPorEliminar) { s.porEliminar = c }

// loginPorEliminar resuelve el login de una cuenta con la eliminacion en curso,
// con la contrasena ya verificada. Sin reactivate responde la fecha del cierre;
// con reactivate cancela el proceso y emite la sesion. Si ya no se puede volver
// (vencio el plazo, operaciones la bloqueo) o no hay quien responda por la
// eliminacion, se rechaza cerrado como cualquier cuenta que no puede entrar.
func (s *Service) loginPorEliminar(ctx context.Context, u *user.UserRecord, req *LoginRequest, kind identifier.Kind, canonical string, lc LoginContext) (*LoginResponse, error) {
	rechazar := func() (*LoginResponse, error) {
		s.auditarLoginNoActivo(u, lc)
		return nil, ErrAccountBlocked
	}
	if s.porEliminar == nil {
		return rechazar()
	}
	fecha, reactivable, err := s.porEliminar.SeEliminaEl(ctx, u.ID)
	if err != nil {
		return nil, fmt.Errorf("consultar la eliminacion: %w", err)
	}
	if !reactivable {
		return rechazar()
	}
	if !req.Reactivate {
		s.auditarLoginNoActivo(u, lc)
		return nil, &CuentaPorEliminarError{SeEliminaEl: fecha}
	}
	ok, err := s.porEliminar.Reactivar(ctx, u.ID)
	if err != nil {
		return nil, fmt.Errorf("reactivar la cuenta: %w", err)
	}
	if !ok {
		// El doble clic: otra peticion la reactivo un instante antes. Con la
		// contrasena ya verificada y la cuenta activa, es un login como
		// cualquiera, no una cuenta bloqueada.
		actual, err := s.userRepo.FindByID(ctx, u.ID)
		if err != nil || actual.Status != "active" {
			return rechazar()
		}
	}
	u.Status = "active"
	return s.emitirSesion(ctx, u, kind, canonical, lc)
}

// auditarLoginNoActivo deja en la auditoria el intento de entrar a una cuenta
// que no esta activa, con su estado en el detalle.
func (s *Service) auditarLoginNoActivo(u *user.UserRecord, lc LoginContext) {
	if s.auditLogger == nil {
		return
	}
	s.auditLogger.Log(audit.Event{
		UserID:       u.ID,
		Action:       "login_blocked",
		ResourceType: "session",
		IPAddress:    lc.IPAddress,
		UserAgent:    lc.UserAgent,
		Details:      map[string]interface{}{"status": u.Status},
		RiskLevel:    "medium",
	})
}
