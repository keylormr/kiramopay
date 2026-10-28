package qrpayment_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/kiramopay/backend/internal/qrpayment"
)

// Con la base de pruebas: lo que la prueba sin base (errores_comercio_test.go)
// no puede ver, es decir, el comercio real contra el que se edita o se revisa.

// Editar un comercio: cada rechazo con su codigo, y ninguno deja la fila
// cambiada. Quien no es el dueno y un comercio que no existe se dicen igual,
// para no confirmar que ids son reales. Antes todo salia como 400 UPDATE_FAILED
// con el texto del servidor.
func TestUpdateMerchant_CadaRechazoTieneSuCodigoYNoCambiaNada(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	h := qrpayment.NewHandler(svc)
	m := registrarComercio(t, svc, owner, "Soda Tica")

	valido := cuerpoConCampos("Soda Tica Renovada", "3-101-123", "juridica", "Soda Tica SA")
	casos := []struct {
		nombre  string
		persona string
		id      string
		cuerpo  string
		estado  int
		codigo  string
	}{
		{"sin nombre", owner, m.ID, cuerpoConCampos("", "3-101-123", "juridica", "Soda Tica SA"), http.StatusBadRequest, "MERCHANT_NAME_REQUIRED"},
		{"sin cedula", owner, m.ID, cuerpoConCampos("Soda", "", "juridica", "Soda Tica SA"), http.StatusBadRequest, "MERCHANT_CEDULA_REQUIRED"},
		{"sin razon social", owner, m.ID, cuerpoConCampos("Soda", "3-101-123", "juridica", ""), http.StatusBadRequest, "MERCHANT_LEGAL_NAME_REQUIRED"},
		// El tipo de cedula en blanco conserva el actual; uno que no existe llegaba
		// a la base, que lo rechazaba con su CHECK y el texto del controlador.
		{"tipo de cedula desconocido", owner, m.ID, cuerpoConCampos("Soda", "3-101-123", "otra", "Soda Tica SA"), http.StatusBadRequest, "MERCHANT_CEDULA_TYPE_INVALID"},
		{"nombre demasiado largo", owner, m.ID, cuerpoConCampos(strings.Repeat("a", 201), "3-101-123", "juridica", "Soda Tica SA"), http.StatusBadRequest, "MERCHANT_FIELD_TOO_LONG"},
		{"razon social demasiado larga", owner, m.ID, cuerpoConCampos("Soda", "3-101-123", "juridica", strings.Repeat("a", 201)), http.StatusBadRequest, "MERCHANT_FIELD_TOO_LONG"},
		{"cedula demasiado larga", owner, m.ID, cuerpoConCampos("Soda", strings.Repeat("1", 51), "juridica", "Soda Tica SA"), http.StatusBadRequest, "MERCHANT_FIELD_TOO_LONG"},
		{"otra persona", payer, m.ID, valido, http.StatusNotFound, "MERCHANT_NOT_FOUND"},
		{"comercio que no existe", owner, uuid.NewString(), valido, http.StatusNotFound, "MERCHANT_NOT_FOUND"},
		{"id sin forma de UUID", owner, "no-es-un-id", valido, http.StatusNotFound, "MERCHANT_NOT_FOUND"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.UpdateMerchant(rec, peticion(http.MethodPatch, "/api/v1/qr/merchants/"+c.id, c.cuerpo, c.persona, c.id))
			codigo, mensaje := errorDeLaRespuesta(t, rec)
			if rec.Code != c.estado || codigo != c.codigo {
				t.Fatalf("= %d %s (%q), se esperaba %d %s", rec.Code, codigo, mensaje, c.estado, c.codigo)
			}
		})
	}

	var nombre string
	if err := pool.QueryRow(context.Background(),
		`SELECT name FROM qr_merchants WHERE id = $1::uuid`, m.ID).Scan(&nombre); err != nil || nombre != "Soda Tica" {
		t.Fatalf("nombre guardado = %q (err %v): un rechazo cambio la fila", nombre, err)
	}

	// Y editar bien sigue funcionando.
	rec := httptest.NewRecorder()
	h.UpdateMerchant(rec, peticion(http.MethodPatch, "/api/v1/qr/merchants/"+m.ID, valido, owner, m.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("editar con datos validos = %d: %s", rec.Code, rec.Body.String())
	}
}

// Registrar con un dato que no cabe en la columna (200 caracteres de nombre) si
// se acepta; uno de mas se rechaza antes de la base con su codigo, y no deja una
// fila a medias.
func TestRegisterMerchant_ElLimiteDeLargoEsElDeLaColumna(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	h := qrpayment.NewHandler(svc)

	rec := httptest.NewRecorder()
	h.RegisterMerchant(rec, peticion(http.MethodPost, rutaRegistro,
		cuerpoConCampos(strings.Repeat("ñ", 201), "3-101-123", "juridica", "Soda Tica SA"), owner, ""))
	if codigo, _ := errorDeLaRespuesta(t, rec); rec.Code != http.StatusBadRequest || codigo != "MERCHANT_FIELD_TOO_LONG" {
		t.Fatalf("201 caracteres = %d %s, se esperaba 400 MERCHANT_FIELD_TOO_LONG", rec.Code, codigo)
	}
	if n := contar(t, pool, `SELECT COUNT(*) FROM qr_merchants WHERE user_id = $1::uuid`, owner); n != 0 {
		t.Fatalf("un registro rechazado dejo %d comercios", n)
	}

	rec = httptest.NewRecorder()
	h.RegisterMerchant(rec, peticion(http.MethodPost, rutaRegistro,
		cuerpoConCampos(strings.Repeat("ñ", 200), "3-101-123", "juridica", "Soda Tica SA"), owner, ""))
	if rec.Code != http.StatusCreated {
		t.Fatalf("200 caracteres = %d: %s", rec.Code, rec.Body.String())
	}
}

// La revision del administrador: un comercio que no existe es un 404 con su
// codigo, un id que no es UUID es un 400, y una comision fuera de rango se
// rechaza sin tocar la fila. Antes salian como 400 *_FAILED con el texto tal
// cual, y un id mal escrito con el del controlador.
func TestRevisionDeComercios_CadaRechazoTieneSuCodigo(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	h := qrpayment.NewHandler(svc)
	m := registrarComercio(t, svc, owner, "Soda Tica")
	admin := "/api/v1/admin/merchants/"
	inexistente := uuid.NewString()

	casos := []struct {
		nombre string
		llamar func(http.ResponseWriter, *http.Request)
		ruta   string
		id     string
		cuerpo string
		estado int
		codigo string
	}{
		{"aprobar uno que no existe", h.ApproveMerchant, "/approve", inexistente, `{}`, http.StatusNotFound, "MERCHANT_NOT_FOUND"},
		{"rechazar uno que no existe", h.RejectMerchant, "/reject", inexistente, `{"reason":"x"}`, http.StatusNotFound, "MERCHANT_NOT_FOUND"},
		{"comision de uno que no existe", h.SetCommission, "/commission", inexistente, `{"commission_bps":100}`, http.StatusNotFound, "MERCHANT_NOT_FOUND"},
		{"aprobar con un id mal escrito", h.ApproveMerchant, "/approve", "no-es-un-id", `{}`, http.StatusBadRequest, "INVALID_ID"},
		{"rechazar con un id mal escrito", h.RejectMerchant, "/reject", "no-es-un-id", `{}`, http.StatusBadRequest, "INVALID_ID"},
		{"comision con un id mal escrito", h.SetCommission, "/commission", "no-es-un-id", `{"commission_bps":100}`, http.StatusBadRequest, "INVALID_ID"},
		{"comision fuera de rango", h.SetCommission, "/commission", m.ID, `{"commission_bps":10001}`, http.StatusBadRequest, "COMMISSION_OUT_OF_RANGE"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rec := httptest.NewRecorder()
			c.llamar(rec, peticion(http.MethodPost, admin+c.id+c.ruta, c.cuerpo, revisorDePrueba, c.id))
			codigo, mensaje := errorDeLaRespuesta(t, rec)
			if rec.Code != c.estado || codigo != c.codigo {
				t.Fatalf("= %d %s (%q), se esperaba %d %s", rec.Code, codigo, mensaje, c.estado, c.codigo)
			}
		})
	}

	var bps int
	var estado string
	if err := pool.QueryRow(context.Background(),
		`SELECT commission_bps, verification_status FROM qr_merchants WHERE id = $1::uuid`, m.ID).Scan(&bps, &estado); err != nil ||
		bps != qrpayment.DefaultCommissionBps || estado != "pending" {
		t.Fatalf("comision %d, estado %q (err %v): un rechazo cambio la fila", bps, estado, err)
	}
}
