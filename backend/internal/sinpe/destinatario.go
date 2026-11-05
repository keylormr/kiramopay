package sinpe

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/kiramopay/backend/internal/user"
)

// Quien recibe un QR de contacto por chat ve el nombre que escribio quien lo
// creo, y nadie lo comprueba: un QR "de Mama" con el numero de otra persona
// llega igual que uno de verdad. Para poder reconocer a la persona antes de
// enviarle, la pantalla pregunta que nombre tiene REGISTRADO ese telefono.
//
// Es un dato personal (Ley 8968, art. 3 b) y la consulta deja a cualquiera con
// sesion preguntar por cualquier numero, asi que se acota:
//   - Se devuelve el nombre y las INICIALES de los apellidos ("Keilor M. R."),
//     como hace Bizum. Pix y UPI muestran el nombre completo; Bre-B y Nequi lo
//     enmascaran. Reconocer a alguien no necesita el apellido entero.
//   - Solo el nombre: nunca el id, la cedula, el telefono ni el correo.
//   - Con limite por minuto y por hora en la ruta (cmd/api/main.go).
//   - Quien pidio eliminar su cuenta no aparece, igual que en el envio.
//
// El telefono se busca con el MISMO texto y la misma funcion que usa el envio:
// si esta consulta dice "registrado", enviar encuentra a la misma persona.

// buscadorPorTelefono es lo unico que hace falta del repositorio de usuarios.
type buscadorPorTelefono interface {
	FindByPhone(ctx context.Context, telefono string) (*user.UserRecord, error)
}

// Destinatario es la respuesta de la consulta. DisplayName va vacio (y no sale)
// cuando el numero no tiene cuenta: no hay nada que decir de el.
type Destinatario struct {
	Registered  bool   `json:"registered"`
	DisplayName string `json:"display_name,omitempty"`
}

// limpiarNombre deja el texto como se LEE: los espacios raros pasan a un espacio
// y se quitan los caracteres de control y de formato. Con un U+202E (cambio de
// sentido de escritura) alguien podria invertir lo que se ve en pantalla.
func limpiarNombre(s string) string {
	return strings.Map(func(r rune) rune {
		switch {
		case unicode.IsSpace(r):
			return ' '
		case unicode.IsControl(r), unicode.Is(unicode.Cf, r):
			return -1
		}
		return r
	}, s)
}

// nombreParcial es el nombre completo y la inicial de cada apellido.
func nombreParcial(nombre, apellidos string) string {
	// Un nombre de pila abreviado ("Ma.", "Ma. Jose") sale sin el punto: el punto
	// queda para las iniciales de los apellidos, y el cliente se apoya en eso para
	// distinguir unos de otras.
	partes := strings.Fields(limpiarNombre(nombre))
	for i, p := range partes {
		partes[i] = strings.TrimRight(p, ".")
	}
	for _, a := range strings.Fields(limpiarNombre(apellidos)) {
		inicial, _ := utf8.DecodeRuneInString(a)
		partes = append(partes, string(unicode.ToUpper(inicial))+".")
	}
	return strings.Join(partes, " ")
}

func consultarDestinatario(ctx context.Context, buscador buscadorPorTelefono, userID, telefono string) (*Destinatario, error) {
	if !validCRMobile(telefono) {
		return nil, ErrInvalidPhone
	}
	peer, err := buscador.FindByPhone(ctx, telefono)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &Destinatario{}, nil
		}
		// Un fallo de la base no dice que el numero no tenga cuenta (ver
		// ErrBuscarDestino): se contesta como fallo, no como "sin cuenta".
		return nil, fmt.Errorf("%w: %w", ErrBuscarDestino, err)
	}
	if peer == nil || peer.Status == "pending_deletion" {
		return &Destinatario{}, nil
	}
	if peer.ID == userID {
		return nil, ErrSelfSend
	}
	return &Destinatario{Registered: true, DisplayName: nombreParcial(peer.FirstName, peer.LastName)}, nil
}

// ConsultarDestinatario dice si el telefono tiene cuenta de KiramoPay y como se
// llama su titular, recortado. Ver el comentario del archivo.
func (s *Service) ConsultarDestinatario(ctx context.Context, userID, telefono string) (*Destinatario, error) {
	if s.destinatarios == nil {
		return nil, ErrBuscarDestino
	}
	return consultarDestinatario(ctx, s.destinatarios, userID, telefono)
}
