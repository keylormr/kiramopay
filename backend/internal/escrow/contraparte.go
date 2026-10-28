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
		if err != nil || u == nil || porEliminar(u.Status) {
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
	if err != nil || u == nil || porEliminar(u.Status) {
		return ErrVendedorSinCuenta
	}
	req.SellerID = u.ID
	return nil
}

// porEliminar: la cuenta tiene la eliminacion en curso. Para abrir un acuerdo es
// como si no tuviera cuenta: un acuerdo pendiente no vence y solo el comprador
// lo cancela, asi que cualquiera que conozca el telefono podria impedir el
// cierre del dia 30.
func porEliminar(status string) bool { return status == "pending_deletion" }

// otraParte es el id de la parte que NO es quien consulta; vacio si quien
// consulta no es parte del acuerdo.
func otraParte(a *Agreement, viewerID string) string {
	switch viewerID {
	case a.BuyerID:
		return a.SellerID
	case a.SellerID:
		return a.BuyerID
	default:
		return ""
	}
}

// nombreDeLaCuenta es el nombre y el apellido, sin espacios de mas. Vacio si la
// cuenta no se puede leer: el detalle se pinta igual, sin el nombre.
func (s *Service) nombreDeLaCuenta(ctx context.Context, id string) string {
	u, err := s.cuentas.FindByID(ctx, id)
	if err != nil || u == nil {
		return ""
	}
	return strings.Join(strings.Fields(u.FirstName+" "+u.LastName), " ")
}

// ConContraparte devuelve una COPIA del acuerdo con el nombre de la otra parte,
// para la respuesta de quien consulta. El acuerdo original no se toca: es el que
// se guarda y el que viaja en los avisos a los webhooks de las dos partes.
func (s *Service) ConContraparte(ctx context.Context, viewerID string, a *Agreement) *Agreement {
	if a == nil {
		return nil
	}
	copia := *a
	if otra := otraParte(&copia, viewerID); otra != "" && s.cuentas != nil {
		copia.CounterpartyName = s.nombreDeLaCuenta(ctx, otra)
	}
	return &copia
}

// ConContrapartes es ConContraparte para una lista: pregunta una sola vez por
// cada persona, aunque aparezca en varios acuerdos.
func (s *Service) ConContrapartes(ctx context.Context, viewerID string, items []Agreement) []Agreement {
	salida := make([]Agreement, len(items))
	nombres := map[string]string{}
	for i := range items {
		salida[i] = items[i]
		otra := otraParte(&items[i], viewerID)
		if otra == "" || s.cuentas == nil {
			continue
		}
		nombre, visto := nombres[otra]
		if !visto {
			nombre = s.nombreDeLaCuenta(ctx, otra)
			nombres[otra] = nombre
		}
		salida[i].CounterpartyName = nombre
	}
	return salida
}
