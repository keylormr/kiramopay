package qrpayment

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Un 500 de una ruta de gestion (equipo, sucursales, catalogo) dejaba en el log
// solo "the change could not be saved": la causa de la base no quedaba en
// ningun lado. Sacar un producto ahora tambien escribe el rastro, y si eso
// falla tiene que poder saberse por que. Al cliente la causa no le llega.
func TestResponderFalloDeGestion_LaCausaQuedaEnElLog(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	defer slog.SetDefault(prev)

	const causa = "invalid input syntax for type uuid (SQLSTATE 22P02)"
	rec := httptest.NewRecorder()
	responderFalloDeGestion(rec, "DELETE_ITEM_FAILED", interno(errors.New("registrar: ERROR: "+causa)))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d, se esperaba 500", rec.Code)
	}
	if codigo, _ := codigoDe(t, rec); codigo != "DELETE_ITEM_FAILED" {
		t.Errorf("codigo %q, se esperaba DELETE_ITEM_FAILED", codigo)
	}
	if strings.Contains(rec.Body.String(), "invalid input syntax") {
		t.Errorf("la causa llego al cliente: %s", rec.Body.String())
	}
	if log := buf.String(); !strings.Contains(log, causa) || !strings.Contains(log, "DELETE_ITEM_FAILED") {
		t.Errorf("el log no tiene la causa y el codigo: %s", log)
	}
}
