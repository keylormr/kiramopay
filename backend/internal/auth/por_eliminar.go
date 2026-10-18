package auth

import (
	"context"
	"errors"
	"time"
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
