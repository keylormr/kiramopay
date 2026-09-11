package escrow

import (
	"context"
	"strings"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/pkg/identifier"
)

// Un escrow no se podia empezar con una persona real.
//
// La pantalla pedia el UUID del vendedor, con marcador de posicion
// "00000000-0000-0000-0000-000000000000". NINGUNA pantalla de la aplicacion
// muestra el UUID de nadie: no habia forma humana de conseguir ese dato, asi
// que el producto entero era inalcanzable desde la app.
//
// Y del otro lado el servidor tampoco comprobaba nada: cualquier UUID bien
// formado se aceptaba como vendedor. Un acuerdo creado hacia una cuenta que no
// existe se puede FONDEAR —la plata sale de la billetera del comprador y queda
// en SYSTEM:ESCROW— y al liberarlo se acredita el saldo de un usuario que no
// existe. La unica salida era el reembolso, si al comprador se le ocurria.
//
// Ahora la contraparte se resuelve por TELEFONO, igual que en dividir cuenta, y
// se comprueba que tenga cuenta antes de escribir el acuerdo.

// BuscadorDeCuentas resuelve la contraparte a una cuenta real.
type BuscadorDeCuentas interface {
	FindByPhone(ctx context.Context, telefono string) (*user.UserRecord, error)
	FindByID(ctx context.Context, id string) (*user.UserRecord, error)
}

// resolverVendedor deja `req.SellerID` apuntando a una cuenta que existe.
//
// Acepta las dos formas: `seller_phone`, que es la que usa la aplicacion, y
// `seller_id`, que se mantiene por los clientes B2B que ya integraron contra
// esta ruta. En los dos casos se comprueba que la cuenta exista.
func (s *Service) resolverVendedor(ctx context.Context, req *CreateRequest) error {
	telefono := strings.TrimSpace(req.SellerPhone)
	id := strings.TrimSpace(req.SellerID)
	if telefono == "" && id == "" {
		return ErrInvalidRequest
	}

	// Sin buscador cableado no se puede afirmar que la cuenta exista, asi que
	// tampoco se acepta un telefono: fallar es mejor que crear un acuerdo cuya
	// contraparte nadie comprobo.
	if s.cuentas == nil {
		if id == "" {
			return ErrInvalidRequest
		}
		if _, err := uuid.Parse(id); err != nil {
			return ErrInvalidRequest
		}
		req.SellerID = id
		return nil
	}

	if telefono != "" {
		clase, canonico, err := identifier.Classify(telefono)
		if err != nil || clase != identifier.KindPhone {
			return ErrInvalidRequest
		}
		u, err := s.cuentas.FindByPhone(ctx, canonico)
		if err != nil || u == nil {
			return ErrVendedorSinCuenta
		}
		req.SellerID = u.ID
		req.SellerPhone = canonico
		return nil
	}

	// Un id mal formado se rechaza aca: `$2::uuid` con basura revienta con
	// 22P02 y saldria como un 500 generico.
	if _, err := uuid.Parse(id); err != nil {
		return ErrInvalidRequest
	}
	u, err := s.cuentas.FindByID(ctx, id)
	if err != nil || u == nil {
		return ErrVendedorSinCuenta
	}
	req.SellerID = u.ID
	return nil
}
