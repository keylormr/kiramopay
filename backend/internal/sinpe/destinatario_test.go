package sinpe

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/user"
)

// Quien paga por QR de contacto ve el nombre que escribio quien creo el QR, y
// nadie lo comprueba. La consulta devuelve el nombre REGISTRADO a ese telefono,
// recortado como lo hacen otras plataformas (Bizum: nombre e iniciales de los
// apellidos): sirve para reconocer a la persona sin entregar el nombre completo
// de cualquiera que conozca un numero.

type buscadorFalso struct {
	u        *user.UserRecord
	err      error
	llamadas int
	telefono string
}

func (b *buscadorFalso) FindByPhone(_ context.Context, telefono string) (*user.UserRecord, error) {
	b.llamadas++
	b.telefono = telefono
	return b.u, b.err
}

func TestNombreParcial(t *testing.T) {
	casos := []struct {
		nombre, apellidos, quiere string
	}{
		{"Keilor", "Martinez Rodriguez", "Keilor M. R."},
		{"Maria Jose", "Gomez", "Maria Jose G."},
		{"  Ana ", "  de   la Cruz ", "Ana D. L. C."},
		{"Óscar", "ñandú", "Óscar Ñ."},
		{"Ana", "", "Ana"},
		{"Ana", "L", "Ana L."},
		{"", "Perez", "P."},
		{"", "", ""},
		// Los caracteres que no se ven no entran: con un U+202E (cambio de sentido
		// de escritura) alguien podria invertir lo que se lee en pantalla.
		{"Ana‮", "Pe​rez", "Ana P."},
		{"A\u0000na", "Perez\n", "Ana P."},
		// El apellido completo no sale nunca, ni aunque sea de una sola palabra.
		{"Ana", "Perezoso", "Ana P."},
		// Un nombre de pila abreviado pierde el punto: el punto es de las iniciales.
		{"Ma. Jose", "Garcia", "Ma Jose G."},
		// Una inicial que no se ve (ancho cero al empezar el apellido) no cuenta.
		{"Ana", "\u200bPerez", "Ana P."},
	}
	for _, c := range casos {
		if got := nombreParcial(c.nombre, c.apellidos); got != c.quiere {
			t.Errorf("nombreParcial(%q, %q) = %q, quiere %q", c.nombre, c.apellidos, got, c.quiere)
		}
	}
}

func TestNombreParcial_NuncaDejaSalirElApellidoCompleto(t *testing.T) {
	got := nombreParcial("Keilor", "Martinez Rodriguez")
	for _, no := range []string{"Martinez", "Rodriguez", "artinez", "odriguez"} {
		if strings.Contains(got, no) {
			t.Fatalf("el resultado %q contiene %q", got, no)
		}
	}
}

func TestConsultarDestinatario_Registrado(t *testing.T) {
	b := &buscadorFalso{u: &user.UserRecord{ID: "u2", FirstName: "Keilor", LastName: "Martinez Rodriguez", Status: "active"}}

	got, err := consultarDestinatario(context.Background(), b, "u1", "8888-0000")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if !got.Registered || got.DisplayName != "Keilor M. R." {
		t.Fatalf("got = %+v, quiere registrado con \"Keilor M. R.\"", got)
	}
	// Se busca con el MISMO texto que usa el envio: si la consulta dice que el
	// numero esta registrado, enviar lo encuentra igual.
	if b.telefono != "8888-0000" {
		t.Errorf("telefono buscado = %q, quiere el recibido tal cual", b.telefono)
	}
}

func TestConsultarDestinatario_NoRegistrado(t *testing.T) {
	b := &buscadorFalso{err: fmt.Errorf("find user by phone: %w", pgx.ErrNoRows)}

	got, err := consultarDestinatario(context.Background(), b, "u1", "88880000")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if got.Registered || got.DisplayName != "" {
		t.Fatalf("got = %+v, quiere no registrado y sin nombre", got)
	}
}

func TestConsultarDestinatario_CuentaPorEliminarEsComoSinCuenta(t *testing.T) {
	b := &buscadorFalso{u: &user.UserRecord{ID: "u2", FirstName: "Keilor", LastName: "Martinez", Status: "pending_deletion"}}

	got, err := consultarDestinatario(context.Background(), b, "u1", "88880000")
	if err != nil {
		t.Fatalf("err = %v", err)
	}
	if got.Registered || got.DisplayName != "" {
		t.Fatalf("got = %+v: quien pidio eliminar su cuenta no se muestra", got)
	}
}

func TestConsultarDestinatario_ElPropioNumeroSeRechaza(t *testing.T) {
	b := &buscadorFalso{u: &user.UserRecord{ID: "u1", FirstName: "Keilor", LastName: "Martinez", Status: "active"}}

	_, err := consultarDestinatario(context.Background(), b, "u1", "88880000")
	if !errors.Is(err, ErrSelfSend) {
		t.Fatalf("err = %v, quiere ErrSelfSend", err)
	}
}

func TestConsultarDestinatario_FalloDeLaBaseNoDiceQueNoExiste(t *testing.T) {
	b := &buscadorFalso{err: errors.New("conexion perdida")}

	got, err := consultarDestinatario(context.Background(), b, "u1", "88880000")
	if !errors.Is(err, ErrBuscarDestino) {
		t.Fatalf("err = %v, quiere ErrBuscarDestino", err)
	}
	if got != nil {
		t.Fatalf("got = %+v: un fallo de la base no es \"sin cuenta\"", got)
	}
}

func TestConsultarDestinatario_TelefonoInvalidoNoToca_LaBase(t *testing.T) {
	b := &buscadorFalso{}

	for _, tel := range []string{"21234567", "1234", "", "abcdefgh"} {
		if _, err := consultarDestinatario(context.Background(), b, "u1", tel); !errors.Is(err, ErrInvalidPhone) {
			t.Errorf("%q: err = %v, quiere ErrInvalidPhone", tel, err)
		}
	}
	if b.llamadas != 0 {
		t.Errorf("la base se consulto %d veces con telefonos invalidos", b.llamadas)
	}
}

func TestDestinatario_ElJSONNoTrae_NombreSiNoEstaRegistrado(t *testing.T) {
	raw, _ := json.Marshal(Destinatario{Registered: false})
	if string(raw) != `{"registered":false}` {
		t.Errorf("json = %s", raw)
	}
	raw, _ = json.Marshal(Destinatario{Registered: true, DisplayName: "Ana P."})
	if string(raw) != `{"registered":true,"display_name":"Ana P."}` {
		t.Errorf("json = %s", raw)
	}
}

func TestServicio_SinBuscadorNoAfirmaNada(t *testing.T) {
	s := &Service{}
	if _, err := s.ConsultarDestinatario(context.Background(), "u1", "88880000"); !errors.Is(err, ErrBuscarDestino) {
		t.Fatalf("err = %v, quiere ErrBuscarDestino", err)
	}
}

// ---- handler ---------------------------------------------------------------

func llamarConsulta(t *testing.T, b *buscadorFalso, usuario, cuerpo string) (int, map[string]any) {
	t.Helper()
	h := &Handler{service: &Service{destinatarios: b}}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sinpe/recipient", strings.NewReader(cuerpo))
	if usuario != "" {
		req = req.WithContext(context.WithValue(req.Context(), middleware.UserIDKey, usuario))
	}
	rec := httptest.NewRecorder()
	h.LookupRecipient(rec, req)
	var salida map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &salida)
	return rec.Code, salida
}

func TestLookupRecipient_Registrado(t *testing.T) {
	b := &buscadorFalso{u: &user.UserRecord{ID: "u2", FirstName: "Keilor", LastName: "Martinez Rodriguez", Status: "active"}}

	codigo, salida := llamarConsulta(t, b, "u1", `{"phone":"+50688880000"}`)

	if codigo != http.StatusOK {
		t.Fatalf("codigo = %d, salida = %v", codigo, salida)
	}
	data, _ := salida["data"].(map[string]any)
	if data["registered"] != true || data["display_name"] != "Keilor M. R." {
		t.Fatalf("data = %v", data)
	}
	// Nada mas que eso: ni id, ni cedula, ni telefono, ni el apellido entero.
	if len(data) != 2 {
		t.Errorf("data trae %d campos, quiere 2: %v", len(data), data)
	}
}

func TestLookupRecipient_NoRegistrado(t *testing.T) {
	b := &buscadorFalso{err: pgx.ErrNoRows}

	codigo, salida := llamarConsulta(t, b, "u1", `{"phone":"+50688880000"}`)

	if codigo != http.StatusOK {
		t.Fatalf("codigo = %d", codigo)
	}
	data, _ := salida["data"].(map[string]any)
	if data["registered"] != false {
		t.Fatalf("data = %v", data)
	}
	if _, hay := data["display_name"]; hay {
		t.Errorf("un numero sin cuenta no lleva nombre: %v", data)
	}
}

func TestLookupRecipient_Rechazos(t *testing.T) {
	casos := []struct {
		nombre  string
		b       *buscadorFalso
		usuario string
		cuerpo  string
		codigo  int
		error   string
	}{
		{"sin sesion", &buscadorFalso{}, "", `{"phone":"+50688880000"}`, http.StatusUnauthorized, "UNAUTHORIZED"},
		{"cuerpo roto", &buscadorFalso{}, "u1", `{`, http.StatusBadRequest, "INVALID_BODY"},
		{"telefono invalido", &buscadorFalso{}, "u1", `{"phone":"+50621234567"}`, http.StatusBadRequest, "INVALID_PHONE"},
		{"telefono vacio", &buscadorFalso{}, "u1", `{"phone":""}`, http.StatusBadRequest, "VALIDATION_ERROR"},
		{"propio numero", &buscadorFalso{u: &user.UserRecord{ID: "u1", Status: "active"}}, "u1", `{"phone":"+50688880000"}`, http.StatusBadRequest, "SELF_SEND"},
		{"falla la base", &buscadorFalso{err: errors.New("conexion perdida")}, "u1", `{"phone":"+50688880000"}`, http.StatusInternalServerError, "RECIPIENT_LOOKUP_FAILED"},
	}
	for _, c := range casos {
		codigo, salida := llamarConsulta(t, c.b, c.usuario, c.cuerpo)
		if codigo != c.codigo {
			t.Errorf("%s: codigo = %d, quiere %d (%v)", c.nombre, codigo, c.codigo, salida)
			continue
		}
		e, _ := salida["error"].(map[string]any)
		if e["code"] != c.error {
			t.Errorf("%s: error = %v, quiere %s", c.nombre, e, c.error)
		}
	}
}

func TestLookupRecipient_ElFalloDeLaBaseNoSeFiltraAlCliente(t *testing.T) {
	b := &buscadorFalso{err: errors.New("password authentication failed for user kiramopay_admin")}

	_, salida := llamarConsulta(t, b, "u1", `{"phone":"+50688880000"}`)

	raw, _ := json.Marshal(salida)
	if strings.Contains(string(raw), "password") || strings.Contains(string(raw), "kiramopay_admin") {
		t.Errorf("la respuesta filtra el detalle interno: %s", raw)
	}
}
