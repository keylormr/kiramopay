package crypto

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// La pausa de compras.
//
// Comprar, convertir y apartar para staking anotan cripto en una fila que no
// tiene nada detras: no vive en ninguna cadena (ver envio.go), nadie la entrega
// y el rendimiento del staking no se acredita. Es la misma politica que los
// convenios de recibos y los cobros del marketplace: lo que nadie entrega no se
// cobra. Por eso en produccion estas tres operaciones se rechazan.
//
// Vender y retirar del staking siguen abiertos a proposito: la pausa no puede
// dejar a nadie sin salida de lo que ya tiene.

// Disponibilidad le dice a la pantalla, antes de ofrecer nada, si esta cuenta
// puede comprar, convertir y apartar, y si ve la billetera propia
// (billetera_propia.go).
type Disponibilidad struct {
	PurchasesActive   bool `json:"purchases_active"`
	SelfCustodyActive bool `json:"self_custody_active"`
}

// ComprasAbiertas dice si esta cuenta puede comprar, convertir y apartar. Las
// cuentas de demostracion (users.demo_login) siguen abiertas para poder
// ensenar la funcion.
func (s *Service) ComprasAbiertas(ctx context.Context, userID string) (bool, error) {
	if !s.comprasEnPausa {
		return true, nil
	}
	return s.repo.EsCuentaDemo(ctx, userID)
}

// exigirComprasAbiertas va DESPUES de reconocer el reintento de una operacion
// que ya se hizo: la respuesta que se perdio antes de la pausa se contesta
// igual, porque no abre nada nuevo.
func (s *Service) exigirComprasAbiertas(ctx context.Context, userID string) error {
	abiertas, err := s.ComprasAbiertas(ctx, userID)
	if err != nil {
		return err
	}
	if !abiertas {
		return ErrComprasEnPausa
	}
	return nil
}

// EsCuentaDemo dice si la cuenta esta marcada como de demostracion. Una cuenta
// que no existe no lo es.
func (r *Repository) EsCuentaDemo(ctx context.Context, userID string) (bool, error) {
	var demo bool
	err := r.db.QueryRow(ctx, `SELECT demo_login FROM users WHERE id = $1`, userID).Scan(&demo)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return demo, err
}
