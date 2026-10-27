package qrpayment_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/qrpayment"
)

// La categoria del comercio se valida contra las cinco que ofrece la app, al
// registrar y al editar, con un codigo propio. Las filas que ya existen con
// otra categoria (el servidor guardaba cualquier texto) siguen leyendose.

func categoriaGuardada(t *testing.T, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var c string
	if err := pool.QueryRow(context.Background(),
		`SELECT category FROM qr_merchants WHERE id = $1::uuid`, id).Scan(&c); err != nil {
		t.Fatalf("leer categoria: %v", err)
	}
	return c
}

func TestRegisterMerchant_RechazaUnaCategoriaDesconocida(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	h := qrpayment.NewHandler(svc)

	for _, categoria := range []string{"other", "", "Restaurant", "bar"} {
		rec := httptest.NewRecorder()
		h.RegisterMerchant(rec, peticion(http.MethodPost, "/api/v1/qr/merchant",
			cuerpoDeRegistro(categoria), owner, ""))
		codigo, _ := errorDeLaRespuesta(t, rec)
		if rec.Code != http.StatusBadRequest || codigo != "INVALID_CATEGORY" {
			t.Fatalf("categoria %q: = %d %s, se esperaba 400 INVALID_CATEGORY", categoria, rec.Code, codigo)
		}
	}
	if n := contar(t, pool, `SELECT COUNT(*) FROM qr_merchants WHERE user_id = $1::uuid`, owner); n != 0 {
		t.Fatalf("un registro rechazado dejo %d comercios", n)
	}
}

func TestRegisterMerchant_AceptaLasCincoCategoriasDeLaApp(t *testing.T) {
	svc, _, _, owner := setupQR(t)
	ctx := context.Background()

	for _, categoria := range []string{"restaurant", "retail", "services", "food_truck", "market"} {
		m, err := svc.RegisterMerchant(ctx, owner, &qrpayment.RegisterMerchantRequest{
			Name: "Comercio " + categoria, Category: categoria,
			Cedula: "3-101-123", CedulaType: "juridica", LegalName: "Comercio SA",
		})
		if err != nil {
			t.Fatalf("registrar con %q: %v", categoria, err)
		}
		if m.Category != categoria {
			t.Fatalf("categoria = %q, se esperaba %q", m.Category, categoria)
		}
	}
}

func TestUpdateMerchant_RechazaUnaCategoriaDesconocidaYNoCambiaNada(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	qr := verifiedMerchantQR(t, svc, owner, 1000)
	h := qrpayment.NewHandler(svc)

	rec := httptest.NewRecorder()
	h.UpdateMerchant(rec, peticion(http.MethodPatch, "/api/v1/qr/merchants/"+qr.MerchantID,
		cuerpoDeRegistro("other"), owner, qr.MerchantID))
	codigo, _ := errorDeLaRespuesta(t, rec)
	if rec.Code != http.StatusBadRequest || codigo != "INVALID_CATEGORY" {
		t.Fatalf("= %d %s, se esperaba 400 INVALID_CATEGORY", rec.Code, codigo)
	}
	if got := categoriaGuardada(t, pool, qr.MerchantID); got != "restaurant" {
		t.Fatalf("categoria = %q: el editar rechazado cambio la fila", got)
	}

	// Cambiar a otra de las cinco si se puede.
	rec = httptest.NewRecorder()
	h.UpdateMerchant(rec, peticion(http.MethodPatch, "/api/v1/qr/merchants/"+qr.MerchantID,
		cuerpoDeRegistro("market"), owner, qr.MerchantID))
	if rec.Code != http.StatusOK {
		t.Fatalf("editar a market = %d: %s", rec.Code, rec.Body.String())
	}
	if got := categoriaGuardada(t, pool, qr.MerchantID); got != "market" {
		t.Fatalf("categoria = %q, se esperaba market", got)
	}
}

// Una fila vieja con una categoria que la app ya no ofrece se lee tal cual, y
// su dueno puede corregirle el nombre sin que el servidor le exija elegir otra
// categoria; lo que no puede es pasar a otra categoria desconocida.
func TestComercioConCategoriaVieja_SeLeeYSePuedeEditarSinTocarLaCategoria(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx,
		`INSERT INTO qr_merchants (user_id, name, category, qr_code, cedula, cedula_type, legal_name, verification_status)
		 VALUES ($1::uuid, 'Soda Vieja', 'other', 'MRC-VIEJA-1', '3-101-123', 'juridica', 'Soda Vieja SA', 'verified')
		 RETURNING id::text`, owner).Scan(&id); err != nil {
		t.Fatalf("sembrar el comercio viejo: %v", err)
	}

	lista, err := svc.GetMerchants(ctx, owner)
	if err != nil || len(lista) != 1 || lista[0].Category != "other" {
		t.Fatalf("GetMerchants = %+v (err %v), se esperaba el comercio viejo con su categoria", lista, err)
	}

	h := qrpayment.NewHandler(svc)
	rec := httptest.NewRecorder()
	h.UpdateMerchant(rec, peticion(http.MethodPatch, "/api/v1/qr/merchants/"+id,
		`{"name":"Soda Vieja Renovada","category":"other","cedula":"3-101-123","cedula_type":"juridica","legal_name":"Soda Vieja SA"}`,
		owner, id))
	if rec.Code != http.StatusOK {
		t.Fatalf("editar el nombre de un comercio viejo = %d: %s", rec.Code, rec.Body.String())
	}
	var sobre struct {
		Data struct {
			Name     string `json:"name"`
			Category string `json:"category"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil || sobre.Data.Name != "Soda Vieja Renovada" {
		t.Fatalf("respuesta = %s (err %v)", rec.Body.String(), err)
	}

	rec = httptest.NewRecorder()
	h.UpdateMerchant(rec, peticion(http.MethodPatch, "/api/v1/qr/merchants/"+id,
		`{"name":"Soda Vieja","category":"bar","cedula":"3-101-123","cedula_type":"juridica","legal_name":"Soda Vieja SA"}`,
		owner, id))
	if codigo, _ := errorDeLaRespuesta(t, rec); rec.Code != http.StatusBadRequest || codigo != "INVALID_CATEGORY" {
		t.Fatalf("pasar a otra categoria desconocida = %d %s, se esperaba 400 INVALID_CATEGORY", rec.Code, codigo)
	}
}
