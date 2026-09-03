package auth_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/auth"
)

// leerError decodifica el sobre de error de una respuesta del handler y
// devuelve codigo y mensaje.
func leerError(t *testing.T, rec *httptest.ResponseRecorder) (code, message string) {
	t.Helper()
	var resp struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("la respuesta no es JSON (%d): %s", rec.Code, rec.Body.String())
	}
	return resp.Error.Code, resp.Error.Message
}

// textosInternos son fragmentos que solo existen en errores de BD o de
// infraestructura; ninguno puede aparecer en una respuesta al cliente.
var textosInternos = []string{"SQLSTATE", "duplicate key", "insert user", "context canceled", "lookup referral code"}

func exigirSinTextoInterno(t *testing.T, cuerpo string) {
	t.Helper()
	for _, fuga := range textosInternos {
		if strings.Contains(cuerpo, fuga) {
			t.Fatalf("la respuesta filtra texto interno (%q): %s", fuga, cuerpo)
		}
	}
}

// Contrato de POST /auth/register: cada error sentinela del servicio tiene un
// estado y un codigo fijos, y cualquier otro error es un 500 con mensaje fijo
// que jamas repite el texto interno. Corre sin base de datos.
func TestRegisterErrorResponse_Contrato(t *testing.T) {
	const textoBD = `ERROR: duplicate key value violates unique constraint "users_phone_hash_key" (SQLSTATE 23505)`
	casos := []struct {
		nombre string
		err    error
		status int
		code   string
	}{
		{"usuario existente", auth.ErrUserExists, http.StatusConflict, "USER_EXISTS"},
		{"usuario existente envuelto", fmt.Errorf("register: %w", auth.ErrUserExists), http.StatusConflict, "USER_EXISTS"},
		{"telefono sin verificar", auth.ErrPhoneNotVerified, http.StatusForbidden, "PHONE_NOT_VERIFIED"},
		{"cedula no usable en login", auth.ErrCedulaNoUsableEnLogin, http.StatusBadRequest, "CEDULA_INVALID"},
		{"codigo de invitacion", auth.ErrReferralCodeInvalid, http.StatusBadRequest, "REFERRAL_CODE_INVALID"},
		{"error de base de datos", fmt.Errorf("create user: insert user: %w", errors.New(textoBD)), http.StatusInternalServerError, "REGISTER_FAILED"},
		{"fallo al buscar el codigo", fmt.Errorf("lookup referral code: %w", errors.New("context canceled")), http.StatusInternalServerError, "REGISTER_FAILED"},
		{"pantalla de sanciones", errors.New("registration cannot be completed"), http.StatusInternalServerError, "REGISTER_FAILED"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			status, code, message := auth.RegisterErrorResponseForTest(c.err)
			if status != c.status || code != c.code {
				t.Fatalf("(%d, %q), esperaba (%d, %q)", status, code, c.status, c.code)
			}
			if message == "" {
				t.Fatal("el mensaje no puede ir vacio")
			}
			if status == http.StatusInternalServerError && message != "no se pudo completar el registro" {
				t.Fatalf("mensaje del 500 = %q, debe ser el fijo del contrato", message)
			}
			exigirSinTextoInterno(t, message)
		})
	}
}

// Una cedula de 11 digitos con prefijo 506 pasa la validacion de forma (9-12
// digitos) pero clasificaria como telefono en el login: el servicio la rechaza
// antes de tocar la base de datos y el handler responde 400 CEDULA_INVALID.
// El servicio se arma con repositorios nulos porque ese camino no los usa.
func TestRegisterHandler_CedulaNoUsable(t *testing.T) {
	svc := auth.NewService(nil, nil, nil, nil, nil)
	h := auth.NewHandler(svc, auth.CookieConfig{Secure: true}, false)

	body := `{"cedula":"50688880001","phone":"+50688887777","first_name":"Cedula","last_name":"Telefonica","password":"Kiramopay2024!"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.Register(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("register returned %d, want 400: %s", rec.Code, rec.Body.String())
	}
	if code, _ := leerError(t, rec); code != "CEDULA_INVALID" {
		t.Fatalf("error.code = %q, want CEDULA_INVALID", code)
	}
}
