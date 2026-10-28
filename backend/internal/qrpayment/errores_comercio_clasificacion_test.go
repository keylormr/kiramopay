package qrpayment

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// responderErrorDelComercio da su respuesta a cada rechazo conocido de
// registrar, editar y revisar un comercio. Lo que la base devuelve y la ruta no
// previo —un choque de unicidad, un texto que no cabe— tambien tiene su lugar;
// lo demas es un 500 sin el texto del controlador.

func TestResponderErrorDelComercio_CadaRechazoConocidoTieneSuCodigo(t *testing.T) {
	casos := []struct {
		nombre string
		err    error
		estado int
		codigo string
	}{
		{"categoria", ErrCategoriaInvalida, http.StatusBadRequest, "INVALID_CATEGORY"},
		{"nombre", ErrNombreDeComercioRequerido, http.StatusBadRequest, "MERCHANT_NAME_REQUIRED"},
		{"cedula", ErrCedulaRequerida, http.StatusBadRequest, "MERCHANT_CEDULA_REQUIRED"},
		{"razon social", ErrRazonSocialRequerida, http.StatusBadRequest, "MERCHANT_LEGAL_NAME_REQUIRED"},
		{"tipo de cedula", ErrTipoDeCedulaInvalido, http.StatusBadRequest, "MERCHANT_CEDULA_TYPE_INVALID"},
		{"dato demasiado largo", ErrDatoDeComercioMuyLargo, http.StatusBadRequest, "MERCHANT_FIELD_TOO_LONG"},
		{"comision", ErrComisionFueraDeRango, http.StatusBadRequest, "COMMISSION_OUT_OF_RANGE"},
		{"no existe", ErrComercioNoEncontrado, http.StatusNotFound, "MERCHANT_NOT_FOUND"},
		// Envuelto, como llega desde el servicio.
		{"envuelto", fmt.Errorf("edit: %w", ErrCedulaRequerida), http.StatusBadRequest, "MERCHANT_CEDULA_REQUIRED"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rec := httptest.NewRecorder()
			responderErrorDelComercio(rec, "REGISTER_FAILED", c.err)
			if codigo, _ := codigoDe(t, rec); rec.Code != c.estado || codigo != c.codigo {
				t.Fatalf("= %d %s, se esperaba %d %s", rec.Code, codigo, c.estado, c.codigo)
			}
		})
	}
}

// Los choques de la base se reconocen por el SQLSTATE y no por el texto, que
// cambia con el idioma del servidor de base de datos.
func TestResponderErrorDelComercio_LoQueDiceLaBase(t *testing.T) {
	casos := []struct {
		nombre string
		err    error
		estado int
		codigo string
	}{
		{"unicidad", fmt.Errorf("insert merchant: %w", &pgconn.PgError{Code: "23505", Message: "duplicate key value violates unique constraint \"secreta\""}),
			http.StatusConflict, "MERCHANT_DUPLICATE"},
		{"texto que no cabe", fmt.Errorf("update merchant: %w", &pgconn.PgError{Code: "22001", Message: "value too long for type character varying(200)"}),
			http.StatusBadRequest, "MERCHANT_FIELD_TOO_LONG"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			rec := httptest.NewRecorder()
			responderErrorDelComercio(rec, "REGISTER_FAILED", c.err)
			codigo, msg := codigoDe(t, rec)
			if rec.Code != c.estado || codigo != c.codigo {
				t.Fatalf("= %d %s, se esperaba %d %s", rec.Code, codigo, c.estado, c.codigo)
			}
			if strings.Contains(msg, "secreta") || strings.Contains(msg, "character varying") {
				t.Fatalf("el mensaje lleva el texto del controlador: %q", msg)
			}
		})
	}
}

// Lo que nadie previo es un 500 con el codigo de la ruta, y el texto del
// controlador no llega a la respuesta (solo al log).
func TestResponderErrorDelComercio_LoInesperadoEs500SinElTextoDelControlador(t *testing.T) {
	for _, err := range []error{
		errors.New(`insert merchant: ERROR: relation "qr_merchants_secreta" does not exist`),
		&pgconn.PgError{Code: "23503", Message: "insert or update violates foreign key constraint \"secreta\""},
		errors.New("failed to connect to `user=nadie database=nada`: 127.0.0.1:1"),
	} {
		rec := httptest.NewRecorder()
		responderErrorDelComercio(rec, "UPDATE_FAILED", err)
		codigo, msg := codigoDe(t, rec)
		if rec.Code != http.StatusInternalServerError || codigo != "UPDATE_FAILED" {
			t.Fatalf("%v = %d %s, se esperaba 500 UPDATE_FAILED", err, rec.Code, codigo)
		}
		if strings.Contains(rec.Body.String(), "secreta") || strings.Contains(rec.Body.String(), "127.0.0.1") || msg != "internal server error" {
			t.Fatalf("la respuesta filtra el detalle: %s", rec.Body.String())
		}
	}
}
