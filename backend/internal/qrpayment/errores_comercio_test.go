package qrpayment_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/qrpayment"
)

// Registrar o editar un comercio respondia 400 REGISTER_FAILED / UPDATE_FAILED
// con el error tal cual: la frase de validacion en ingles ("cedula is required")
// y, cuando la base fallaba, la del controlador ("ERROR: value too long for
// type character varying(200)", "failed to connect to ..."). La pantalla no
// podia distinguir un dato que hay que corregir de una caida, y el texto del
// controlador llegaba a la respuesta. Cada rechazo conocido sale con su codigo;
// lo inesperado es un 500 sin el detalle.

const rutaRegistro = "/api/v1/qr/merchant"

// cuerpoConCampos arma un registro valido y cambia lo que pida la prueba.
func cuerpoConCampos(nombre, cedula, tipo, razon string) string {
	return `{"name":"` + nombre + `","description":"","category":"restaurant",` +
		`"cedula":"` + cedula + `","cedula_type":"` + tipo + `","legal_name":"` + razon + `"}`
}

// Los datos que faltan o no valen salen ANTES de la base, cada uno con su codigo
// (la base esta caida: si el dato llegara a ella, saldria como otra cosa).
func TestRegisterMerchant_CadaDatoInvalidoTieneSuCodigo(t *testing.T) {
	h := qrpayment.NewHandler(servicioSinBase(t))

	casos := []struct {
		nombre string
		cuerpo string
		codigo string
	}{
		{"sin nombre", cuerpoConCampos("", "3-101-123", "juridica", "Soda Tica SA"), "MERCHANT_NAME_REQUIRED"},
		{"sin cedula", cuerpoConCampos("Soda Tica", "", "juridica", "Soda Tica SA"), "MERCHANT_CEDULA_REQUIRED"},
		{"sin razon social", cuerpoConCampos("Soda Tica", "3-101-123", "juridica", ""), "MERCHANT_LEGAL_NAME_REQUIRED"},
		{"tipo de cedula desconocido", cuerpoConCampos("Soda Tica", "3-101-123", "otra", "Soda Tica SA"), "MERCHANT_CEDULA_TYPE_INVALID"},
		{"nombre de 201 caracteres", cuerpoConCampos(strings.Repeat("a", 201), "3-101-123", "juridica", "Soda Tica SA"), "MERCHANT_FIELD_TOO_LONG"},
		{"razon social de 201 caracteres", cuerpoConCampos("Soda Tica", "3-101-123", "juridica", strings.Repeat("a", 201)), "MERCHANT_FIELD_TOO_LONG"},
		{"cedula de 51 caracteres", cuerpoConCampos("Soda Tica", strings.Repeat("1", 51), "juridica", "Soda Tica SA"), "MERCHANT_FIELD_TOO_LONG"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.RegisterMerchant(rec, peticion(http.MethodPost, rutaRegistro, c.cuerpo, "user-1", ""))
			codigo, mensaje := errorDeLaRespuesta(t, rec)
			if rec.Code != http.StatusBadRequest || codigo != c.codigo {
				t.Fatalf("= %d %s (%q), se esperaba 400 %s", rec.Code, codigo, mensaje, c.codigo)
			}
		})
	}
}

// El largo se cuenta en caracteres, no en bytes: la base lo hace asi, y un
// nombre de 200 letras con tilde (400 bytes) cabe. Llega a la base, que esta
// caida: es una caida, no un dato demasiado largo.
func TestRegisterMerchant_ElLargoSeCuentaEnCaracteresNoEnBytes(t *testing.T) {
	h := qrpayment.NewHandler(servicioSinBase(t))

	rec := httptest.NewRecorder()
	h.RegisterMerchant(rec, peticion(http.MethodPost, rutaRegistro,
		cuerpoConCampos(strings.Repeat("ñ", 200), "3-101-123", "juridica", "Soda Tica SA"), "user-1", ""))
	codigo, mensaje := errorDeLaRespuesta(t, rec)
	if rec.Code != http.StatusInternalServerError || codigo != "REGISTER_FAILED" {
		t.Fatalf("= %d %s (%q), se esperaba 500 REGISTER_FAILED: 200 caracteres caben", rec.Code, codigo, mensaje)
	}
}

// Una caida de la base al registrar no es del que llama: 500, y el texto del
// controlador ni la direccion de la base salen en la respuesta.
func TestRegisterMerchant_UnaCaidaDeLaBaseEsUn500SinElDetalle(t *testing.T) {
	h := qrpayment.NewHandler(servicioSinBase(t))

	rec := httptest.NewRecorder()
	h.RegisterMerchant(rec, peticion(http.MethodPost, rutaRegistro,
		cuerpoConCampos("Soda Tica", "3-101-123", "juridica", "Soda Tica SA"), "user-1", ""))
	codigo, mensaje := errorDeLaRespuesta(t, rec)
	if rec.Code != http.StatusInternalServerError || codigo != "REGISTER_FAILED" {
		t.Fatalf("= %d %s (%q), se esperaba 500 REGISTER_FAILED", rec.Code, codigo, mensaje)
	}
	for _, filtrado := range []string{"127.0.0.1", "connect", "dial", "refused"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), filtrado) {
			t.Fatalf("la respuesta filtra %q del controlador: %s", filtrado, rec.Body.String())
		}
	}
}

const idDeComercio = "5b0e7c1e-2a3f-4d5b-9c8e-1f2a3b4c5d6e"

// Editar con la base caida decia 400 "merchant not found": una caida disfrazada
// de comercio que no existe. Es un 500.
func TestUpdateMerchant_UnaCaidaDeLaBaseNoEsUnComercioQueNoExiste(t *testing.T) {
	h := qrpayment.NewHandler(servicioSinBase(t))

	rec := httptest.NewRecorder()
	h.UpdateMerchant(rec, peticion(http.MethodPatch, "/api/v1/qr/merchants/"+idDeComercio,
		cuerpoConCampos("Soda Tica", "3-101-123", "juridica", "Soda Tica SA"), "user-1", idDeComercio))
	codigo, mensaje := errorDeLaRespuesta(t, rec)
	if rec.Code != http.StatusInternalServerError || codigo != "UPDATE_FAILED" {
		t.Fatalf("= %d %s (%q), se esperaba 500 UPDATE_FAILED", rec.Code, codigo, mensaje)
	}
	if strings.Contains(rec.Body.String(), "127.0.0.1") {
		t.Fatalf("la respuesta filtra la direccion de la base: %s", rec.Body.String())
	}
}

// Las tres rutas de revision del administrador tenian el mismo defecto: la
// caida de la base salia como 400 *_FAILED con el texto del controlador.
func TestRevisionDeComercios_UnaCaidaDeLaBaseEsUn500SinElDetalle(t *testing.T) {
	h := qrpayment.NewHandler(servicioSinBase(t))
	admin := "/api/v1/admin/merchants/" + idDeComercio

	casos := []struct {
		nombre string
		llamar func(http.ResponseWriter, *http.Request)
		ruta   string
		cuerpo string
		codigo string
	}{
		{"aprobar", h.ApproveMerchant, admin + "/approve", `{}`, "APPROVE_FAILED"},
		{"rechazar", h.RejectMerchant, admin + "/reject", `{"reason":"cedula ilegible"}`, "REJECT_FAILED"},
		{"cambiar la comision", h.SetCommission, admin + "/commission", `{"commission_bps":100}`, "SET_COMMISSION_FAILED"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rec := httptest.NewRecorder()
			c.llamar(rec, peticion(http.MethodPost, c.ruta, c.cuerpo, "admin-1", idDeComercio))
			codigo, mensaje := errorDeLaRespuesta(t, rec)
			if rec.Code != http.StatusInternalServerError || codigo != c.codigo {
				t.Fatalf("= %d %s (%q), se esperaba 500 %s", rec.Code, codigo, mensaje, c.codigo)
			}
			if strings.Contains(rec.Body.String(), "127.0.0.1") {
				t.Fatalf("la respuesta filtra la direccion de la base: %s", rec.Body.String())
			}
		})
	}
}

// Una comision fuera de 0..10000 puntos basicos es un dato mal puesto, con su
// codigo, y sale antes de la base.
func TestSetCommission_FueraDeRangoTieneSuCodigo(t *testing.T) {
	h := qrpayment.NewHandler(servicioSinBase(t))

	for _, bps := range []string{"-1", "10001", "20000"} {
		rec := httptest.NewRecorder()
		h.SetCommission(rec, peticion(http.MethodPatch, "/api/v1/admin/merchants/"+idDeComercio+"/commission",
			`{"commission_bps":`+bps+`}`, "admin-1", idDeComercio))
		codigo, mensaje := errorDeLaRespuesta(t, rec)
		if rec.Code != http.StatusBadRequest || codigo != "COMMISSION_OUT_OF_RANGE" {
			t.Fatalf("bps %s: = %d %s (%q), se esperaba 400 COMMISSION_OUT_OF_RANGE", bps, rec.Code, codigo, mensaje)
		}
	}
}
