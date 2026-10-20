package accountdeletion

import (
	"context"
	"errors"
	"time"

	"github.com/kiramopay/backend/internal/user"
)

// La respuesta escrita a una solicitud de eliminacion (Ley 8968 art. 7,
// Reglamento arts. 18 y 22). Ver la migracion 083.

// Tipos de respuesta.
const (
	// RespuestaPlazoIniciado: empezo el plazo de 30 dias.
	RespuestaPlazoIniciado = "scheduled"
	// RespuestaBloqueada: la solicitud web no pudo empezar; se dice que resolver.
	RespuestaBloqueada = "blocked"
)

// Por que una respuesta no salio.
const (
	MotivoSinCanal     = "no_channel"
	MotivoEnvioFallido = "send_failed"
)

var (
	// ErrRespuestaNoEncontrada: el panel pide una respuesta que no existe.
	ErrRespuestaNoEncontrada = errors.New("respuesta no encontrada")
	// ErrRespuestaCerrada: ya se entrego o se cancelo.
	ErrRespuestaCerrada = errors.New("la respuesta ya no esta pendiente")
	// ErrNotaRequerida: marcarla entregada a mano exige decir como.
	ErrNotaRequerida = errors.New("escribe como se entrego la respuesta")
)

// RespuestaPendiente es una respuesta que paso a operaciones, tal como la ve el
// panel. La cuenta va enmascarada desde SQL.
type RespuestaPendiente struct {
	ID               string              `json:"id"`
	Tipo             string              `json:"kind"`
	CreadaEn         time.Time           `json:"created_at"`
	ResponderAntesDe time.Time           `json:"respond_by"`
	Intentos         int                 `json:"attempts"`
	Motivo           string              `json:"reason"`
	SeEliminaEl      *time.Time          `json:"deletion_due_at,omitempty"`
	ConservaHasta    *time.Time          `json:"retained_until,omitempty"`
	Bloqueos         []string            `json:"blockers"`
	Cuenta           *user.AdminUserView `json:"account"`
}

// EntregarRespuestas manda las respuestas pendientes cuyo turno llego en now.
func (s *Service) EntregarRespuestas(ctx context.Context, now time.Time, limite int) (int, error) {
	return 0, nil
}

// RespuestasSinEntregar lista las que pasaron a operaciones.
func (s *Service) RespuestasSinEntregar(ctx context.Context, limite int) ([]RespuestaPendiente, error) {
	return []RespuestaPendiente{}, nil
}

// MarcarRespuestaEntregada deja constancia de una respuesta entregada por otro
// medio.
func (s *Service) MarcarRespuestaEntregada(ctx context.Context, id, adminID, nota string) error {
	return nil
}

// responderAntesDe es el plazo legal para responder: cinco dias habiles.
func responderAntesDe(desde time.Time) time.Time {
	return desde
}
