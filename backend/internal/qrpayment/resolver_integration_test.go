package qrpayment_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/user"
)

// consultaQueSeCae hace fallar, como falla una caida de la base, cada consulta
// cuyo texto lleve el fragmento: le devuelve a pgx un contexto ya cancelado. Lo
// demas pasa intacto, asi que se puede cortar UNA lectura de un servicio sin
// tocar el codigo de produccion.
type consultaQueSeCae struct{ fragmento string }

func (c consultaQueSeCae) TraceQueryStart(ctx context.Context, _ *pgx.Conn, datos pgx.TraceQueryStartData) context.Context {
	if !strings.Contains(datos.SQL, c.fragmento) {
		return ctx
	}
	cortado, cancelar := context.WithCancel(ctx)
	cancelar()
	return cortado
}

func (consultaQueSeCae) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func resolverPorLaRuta(t *testing.T, svc *qrpayment.Service, qrData string) (int, string, string) {
	t.Helper()
	rec := httptest.NewRecorder()
	qrpayment.NewHandler(svc).ResolveQR(rec, peticion(http.MethodPost, "/api/v1/qr/resolve",
		`{"qr_data":"`+qrData+`"}`, "user-1", ""))
	codigo, mensaje := errorDeLaRespuesta(t, rec)
	return rec.Code, codigo, mensaje
}

// La otra mitad de la separacion: un codigo que no esta en la base sigue siendo
// QR_INVALIDO, en sus tres formas. Separar la caida no puede convertir un codigo
// malo en un "intenta de nuevo" que nunca va a funcionar.
func TestResolveQR_UnCodigoQueNoExisteSigueSiendoQRInvalido(t *testing.T) {
	svc, _, _, _ := setupQR(t)
	for _, c := range payloadsDeCadaForma {
		t.Run(c.nombre, func(t *testing.T) {
			estado, codigo, mensaje := resolverPorLaRuta(t, svc, c.qrData)
			if estado != http.StatusBadRequest || codigo != "QR_INVALIDO" {
				t.Fatalf("= %d %s (%q), se esperaba 400 QR_INVALIDO", estado, codigo, mensaje)
			}
		})
	}
}

// Una cadena que la base rechaza por su contenido tampoco es una caida: un byte
// nulo no se guarda en una columna de texto, y la respuesta es la misma cada
// vez. Es un codigo invalido, no un "intenta de nuevo".
func TestResolveQR_UnaCadenaQueLaBaseRechazaEsQRInvalido(t *testing.T) {
	svc, _, _, _ := setupQR(t)
	estado, codigo, mensaje := resolverPorLaRuta(t, svc, `KP:p2p_receive:abcd1234:0:CRC:i\u0000`)
	if estado != http.StatusBadRequest || codigo != "QR_INVALIDO" {
		t.Fatalf("= %d %s (%q), se esperaba 400 QR_INVALIDO", estado, codigo, mensaje)
	}
}

// El nombre del comercio es lo que la hoja muestra ANTES del boton de pagar:
// es la defensa contra el rotulo de otro pegado encima. Si leer el comercio
// fallaba, el error se descartaba y la hoja recibia un 200 sin nombre, como si
// el codigo no tuviera a quien pagarle. Es el mismo caso que el pago ya separa
// (#271): solo un comercio que no existe es "no encontrado"; no poder leerlo es
// un 500.
func TestResolveQR_SinPoderLeerElComercioEsUn500YNoUnCodigoSinNombre(t *testing.T) {
	svc, _, _, owner := setupQR(t)
	m := comercioVerificado(t, svc, owner)
	code := rotuloDelComercio(t, svc, owner, m.ID)

	pool := testutil.PoolTrazado(t, consultaQueSeCae{"FROM qr_merchants"})
	caido := qrpayment.NewService(qrpayment.NewRepository(pool), nil, user.NewRepository(pool), nil)

	estado, codigo, mensaje := resolverPorLaRuta(t, caido, code.QRData)
	if estado != http.StatusInternalServerError || codigo != "RESOLVE_FAILED" {
		t.Fatalf("= %d %s (%q), se esperaba 500 RESOLVE_FAILED", estado, codigo, mensaje)
	}
	if mensaje != "internal server error" {
		t.Fatalf("la respuesta lleva el detalle interno: %q", mensaje)
	}

	// Con la base sana, el mismo codigo resuelve con su nombre: lo que fallo
	// fue la lectura, no el codigo.
	if res, err := svc.ResolveQR(context.Background(), code.QRData); err != nil || res.MerchantName != "Soda Tica" {
		t.Fatalf("con la base sana = %+v, %v; se esperaba Soda Tica", res, err)
	}
}

// Un cobro cuya lectura se cae a mitad de camino (el cobro se lee, su codigo
// no) tampoco es un codigo invalido.
func TestResolveQR_SinPoderLeerElCodigoDeUnCobroEsUn500(t *testing.T) {
	svc, _, _, owner := setupQR(t)
	m := comercioVerificado(t, svc, owner)
	code := rotuloDelComercio(t, svc, owner, m.ID)
	cobro := cobrar(t, svc, owner, code.ID, 12345)

	pool := testutil.PoolTrazado(t, consultaQueSeCae{"FROM qr_payment_codes WHERE id = $1"})
	caido := qrpayment.NewService(qrpayment.NewRepository(pool), nil, user.NewRepository(pool), nil)

	estado, codigo, mensaje := resolverPorLaRuta(t, caido, cobro.QRData)
	if estado != http.StatusInternalServerError || codigo != "RESOLVE_FAILED" {
		t.Fatalf("= %d %s (%q), se esperaba 500 RESOLVE_FAILED", estado, codigo, mensaje)
	}
}

// Con un QR personal la hoja muestra el nombre de la persona antes del boton de
// pagar. Si leerla fallaba, el error se descartaba y la hoja recibia un 200 sin
// nombre: el mismo "codigo sin a quien pagarle" que ya se separo para el
// comercio. No poder leer a quien cobra es un 500.
func TestResolveQR_SinPoderLeerAQuienCobraEsUn500YNoUnCodigoSinNombre(t *testing.T) {
	svc, _, _, owner := setupQR(t)
	code, err := svc.GetOrCreateMyCode(context.Background(), owner, "CRC")
	if err != nil {
		t.Fatalf("GetOrCreateMyCode: %v", err)
	}

	pool := testutil.PoolTrazado(t, consultaQueSeCae{"FROM users WHERE id = $1"})
	caido := qrpayment.NewService(qrpayment.NewRepository(pool), nil, user.NewRepository(pool), nil)

	estado, codigo, mensaje := resolverPorLaRuta(t, caido, code.QRData)
	if estado != http.StatusInternalServerError || codigo != "RESOLVE_FAILED" {
		t.Fatalf("= %d %s (%q), se esperaba 500 RESOLVE_FAILED", estado, codigo, mensaje)
	}
	if mensaje != "internal server error" {
		t.Fatalf("la respuesta lleva el detalle interno: %q", mensaje)
	}

	if res, err := svc.ResolveQR(context.Background(), code.QRData); err != nil || res.PayeeName != "Admin User" {
		t.Fatalf("con la base sana = %+v, %v; se esperaba Admin User", res, err)
	}
}

// La otra mitad: una persona que ya no esta (dada de baja) deja el codigo sin
// nombre, como siempre, y el pago lo decide despues. Separar la caida no puede
// convertir a quien ya no existe en un "intenta de nuevo" que nunca va a
// funcionar.
func TestResolveQR_UnaPersonaQueYaNoEstaDejaElCodigoSinNombre(t *testing.T) {
	svc, pool, _, owner := setupQR(t)
	ctx := context.Background()
	code, err := svc.GetOrCreateMyCode(ctx, owner, "CRC")
	if err != nil {
		t.Fatalf("GetOrCreateMyCode: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET deleted_at = NOW() WHERE id = $1`, owner); err != nil {
		t.Fatalf("dar de baja: %v", err)
	}

	res, err := svc.ResolveQR(ctx, code.QRData)
	if err != nil {
		t.Fatalf("ResolveQR = %v, se esperaba el codigo resuelto sin nombre", err)
	}
	if res.PayeeName != "" {
		t.Fatalf("PayeeName = %q, se esperaba vacio", res.PayeeName)
	}
}

// La sucursal es parte del rotulo que la hoja muestra antes de pagar ("Soda
// Tica, Sucursal Centro"). Leerla tambien se tragaba cualquier error: con la
// base caida la hoja decia el comercio sin la sucursal, como si el rotulo no
// tuviera una. No poder leerla es un 500.
func TestResolveQR_SinPoderLeerLaSucursalEsUn500(t *testing.T) {
	svc, _, _, owner := setupQR(t)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	loc, err := svc.CreateLocation(ctx, m.ID, owner, &qrpayment.LocationRequest{Name: "Sucursal Centro"})
	if err != nil {
		t.Fatalf("crear la sucursal: %v", err)
	}
	code, err := svc.GetOrCreateMerchantCode(ctx, owner, m.ID, loc.ID, "CRC")
	if err != nil {
		t.Fatalf("rotulo de la sucursal: %v", err)
	}

	pool := testutil.PoolTrazado(t, consultaQueSeCae{"SELECT name FROM merchant_locations"})
	caido := qrpayment.NewService(qrpayment.NewRepository(pool), nil, user.NewRepository(pool), nil)

	estado, codigo, mensaje := resolverPorLaRuta(t, caido, code.QRData)
	if estado != http.StatusInternalServerError || codigo != "RESOLVE_FAILED" {
		t.Fatalf("= %d %s (%q), se esperaba 500 RESOLVE_FAILED", estado, codigo, mensaje)
	}
	if mensaje != "internal server error" {
		t.Fatalf("la respuesta lleva el detalle interno: %q", mensaje)
	}

	res, err := svc.ResolveQR(ctx, code.QRData)
	if err != nil || res.MerchantName != "Soda Tica" || res.LocationName != "Sucursal Centro" {
		t.Fatalf("con la base sana = %+v, %v; se esperaba Soda Tica, Sucursal Centro", res, err)
	}
}

// La otra mitad de la sucursal. Por la ruta no se llega: borrar una sucursal
// deja el location_id del rotulo en NULL. Pero entre leer el rotulo y leer su
// sucursal alguien puede borrarla, y eso es "no esta", no una caida.
func TestNombreDeSucursal_UnaQueNoEstaEsVaciaSinError(t *testing.T) {
	pool := testutil.TestDB(t)
	nombre, err := qrpayment.NewRepository(pool).NombreDeSucursal(context.Background(), uuid.NewString())
	if err != nil || nombre != "" {
		t.Fatalf("= %q, %v; se esperaba vacio y sin error", nombre, err)
	}
}
