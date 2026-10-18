package accountdeletion

import (
	"context"
	"errors"
	"time"
)

// errSinImplementar: esqueleto de la linea de tiempo; las pruebas lo esperan en
// rojo hasta que llegue el comportamiento.
var errSinImplementar = errors.New("sin implementar")

// SeEliminaEl devuelve el dia 30 de la cuenta y si todavia se puede reactivar.
func (s *Service) SeEliminaEl(ctx context.Context, userID string) (time.Time, bool, error) {
	return time.Time{}, false, errSinImplementar
}

// Reactivar cancela el proceso de una cuenta dentro del plazo.
func (s *Service) Reactivar(ctx context.Context, userID string) (bool, error) {
	return false, errSinImplementar
}

// CerrarVencidas cierra las cuentas cuyo dia 30 ya llego.
func (s *Service) CerrarVencidas(ctx context.Context, now time.Time, limite int) (int, error) {
	return 0, errSinImplementar
}

// DesasociarVencidas desasocia lo conservado de las cuentas cuya conservacion vencio.
func (s *Service) DesasociarVencidas(ctx context.Context, now time.Time, limite int) (int, error) {
	return 0, errSinImplementar
}
