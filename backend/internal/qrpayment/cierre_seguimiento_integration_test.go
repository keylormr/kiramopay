package qrpayment_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/middleware"
	"github.com/kiramopay/backend/internal/qrpayment"
)

// Lo que la revision del cierre (PR 292) habia dejado como seguimiento.

// ── El reintento de un pago que ya entro ────────────────────────────────────

// El pago entro, la respuesta no llego, y antes del reintento el comercio
// retiro todo y cerro. El reintento no es un pago nuevo: es la misma operacion,
// y lo honesto es devolver la venta que ya existe, no decir que el comercio
// cerro como si el pago no hubiera pasado. Lo que no es el reintento de aquel
// pago (otra llave, otro monto) sigue siendo un pago a un comercio cerrado.
func TestComercioCerrado_ReintentarUnPagoQueYaEntroLoReproduce(t *testing.T) {
	svc, pool, payer, owner := setupCierre(t, nil)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	rotulo := rotuloDelComercio(t, svc, owner, m.ID)

	abierto := qrpayment.ScanQRPaymentRequest{
		QRData: rotulo.QRData, Amount: 5000, Currency: "CRC", IdempotencyKey: "pago-antes-del-cierre-1",
	}
	delRotulo, err := svc.ScanAndPay(ctx, payer, &abierto)
	if err != nil {
		t.Fatalf("pagar el rotulo: %v", err)
	}
	cobro := cobrar(t, svc, owner, rotulo.ID, 7000)
	conCobro := qrpayment.ScanQRPaymentRequest{QRData: cobro.QRData, ChargeID: cobro.ID}
	delCobro, err := svc.ScanAndPay(ctx, payer, &conCobro)
	if err != nil {
		t.Fatalf("pagar el cobro: %v", err)
	}

	if _, err := svc.WithdrawToOwner(ctx, m.ID, owner, "CRC", saldoDelComercio(t, pool, m.ID, "CRC"), "vaciar-antes-de-cerrar"); err != nil {
		t.Fatalf("vaciar el comercio: %v", err)
	}
	cerrarComoDueno(t, svc, m.ID, owner)
	billetera := walletCRC(t, pool, payer)
	ventas := contar(t, pool, `SELECT COUNT(*) FROM qr_payments WHERE merchant_id = $1::uuid`, m.ID)

	casos := []struct {
		nombre   string
		req      qrpayment.ScanQRPaymentRequest
		original *qrpayment.QRPaymentRecord
	}{
		{"el pago del rotulo", abierto, delRotulo},
		{"el pago del cobro", conCobro, delCobro},
	}
	for _, c := range casos {
		req := c.req
		got, err := svc.ScanAndPay(ctx, payer, &req)
		if err != nil {
			t.Fatalf("reintentar %s despues del cierre: %v", c.nombre, err)
		}
		if got.ID != c.original.ID || got.Amount != c.original.Amount {
			t.Fatalf("reintentar %s devolvio %+v, se esperaba la venta %s", c.nombre, got, c.original.ID)
		}
	}

	otraLlave := abierto
	otraLlave.IdempotencyKey = "pago-despues-del-cierre-1"
	otroMonto := abierto
	otroMonto.Amount = 9000
	for nombre, req := range map[string]qrpayment.ScanQRPaymentRequest{"otra llave": otraLlave, "otro monto": otroMonto} {
		if _, err := svc.ScanAndPay(ctx, payer, &req); !errors.Is(err, qrpayment.ErrComercioCerrado) {
			t.Fatalf("%s despues del cierre: err = %v, se esperaba ErrComercioCerrado", nombre, err)
		}
	}

	if got := walletCRC(t, pool, payer); got != billetera {
		t.Fatalf("los reintentos movieron la billetera del pagador: %d -> %d", billetera, got)
	}
	if n := contar(t, pool, `SELECT COUNT(*) FROM qr_payments WHERE merchant_id = $1::uuid`, m.ID); n != ventas {
		t.Fatalf("ventas del comercio: %d -> %d", ventas, n)
	}
	if s := saldoDelComercio(t, pool, m.ID, "CRC"); s != 0 {
		t.Fatalf("el comercio cerrado recibio %d", s)
	}
}

// Lo mismo con un codigo que su dueno retiro: el reintento del pago que entro
// antes devuelve ese pago; uno nuevo dice que el codigo se retiro.
func TestCodigoRevocado_ReintentarUnPagoQueYaEntroLoReproduce(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	code, err := svc.GetOrCreateMyCode(ctx, owner, "CRC")
	if err != nil {
		t.Fatalf("GetOrCreateMyCode: %v", err)
	}
	req := qrpayment.ScanQRPaymentRequest{QRData: code.QRData, Amount: 3000, Currency: "CRC", IdempotencyKey: "pago-antes-de-revocar"}
	primero, err := svc.ScanAndPay(ctx, payer, &req)
	if err != nil {
		t.Fatalf("pagar: %v", err)
	}
	if err := svc.RevokeCode(ctx, owner, code.ID); err != nil {
		t.Fatalf("revocar: %v", err)
	}
	billetera := walletCRC(t, pool, payer)

	reintento := req
	got, err := svc.ScanAndPay(ctx, payer, &reintento)
	if err != nil {
		t.Fatalf("reintentar despues de revocar: %v", err)
	}
	if got.ID != primero.ID {
		t.Fatalf("el reintento devolvio la venta %s, se esperaba %s", got.ID, primero.ID)
	}
	nuevo := req
	nuevo.IdempotencyKey = "pago-despues-de-revocar"
	if _, err := svc.ScanAndPay(ctx, payer, &nuevo); !errors.Is(err, qrpayment.ErrQRRevocado) {
		t.Fatalf("un pago nuevo a un codigo revocado: err = %v, se esperaba ErrQRRevocado", err)
	}
	if got := walletCRC(t, pool, payer); got != billetera {
		t.Fatalf("la billetera del pagador cambio: %d -> %d", billetera, got)
	}
}

// ── Lo que se crea justo mientras el comercio se cierra ─────────────────────

// cierreEnCurso deja un cierre a medio escribir: la fila del comercio tomada
// FOR UPDATE, con el comercio ya marcado pero sin confirmar.
func cierreEnCurso(t *testing.T, pool *pgxpool.Pool, merchantID, quien string) pgx.Tx {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("abrir el cierre: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	if _, err := qrpayment.CerrarComercioEnTx(ctx, tx, merchantID, qrpayment.Cierre{CerradoPor: quien, Motivo: "carrera"}); err != nil {
		t.Fatalf("cerrar dentro de la transaccion: %v", err)
	}
	return tx
}

// carreraConElCierre corre algo mientras un cierre tiene la fila del comercio.
// Tiene que esperar en el FOR SHARE de la fila del comercio, no en otro candado:
// la clave foranea tambien frena un INSERT, pero lo suelta cuando el cierre
// confirma, y la fila nace viva en un comercio cerrado. Confirmado el cierre,
// lo que esperaba tiene que rechazarse con ErrComercioCerrado.
func carreraConElCierre(t *testing.T, pool *pgxpool.Pool, merchantID, owner, que string, hacer func() error) {
	t.Helper()
	tx := cierreEnCurso(t, pool, merchantID, owner)
	termino := make(chan error, 1)
	go func() { termino <- hacer() }()
	esperarSentenciaBloqueada(t, pool, termino, que, "FROM qr_merchants", "FOR SHARE")
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatalf("confirmar el cierre: %v", err)
	}
	select {
	case err := <-termino:
		if !errors.Is(err, qrpayment.ErrComercioCerrado) {
			t.Fatalf("%s durante el cierre: err = %v, se esperaba ErrComercioCerrado", que, err)
		}
	case <-time.After(15 * time.Second):
		t.Fatalf("%s no termino", que)
	}
}

func TestCerrarComercio_UnCobroQueSeEmiteDuranteElCierreNoNaceVivo(t *testing.T) {
	svc, pool, _, owner := setupCierre(t, nil)
	m := comercioVerificado(t, svc, owner)
	rotulo := rotuloDelComercio(t, svc, owner, m.ID)

	carreraConElCierre(t, pool, m.ID, owner, "el cobro", func() error {
		_, err := svc.CreateCharge(context.Background(), owner, &qrpayment.CreateChargeRequest{QRCodeID: rotulo.ID, Amount: 5000})
		return err
	})
	if n := contar(t, pool, `SELECT COUNT(*) FROM qr_charges WHERE merchant_id = $1::uuid AND status = 'pending'`, m.ID); n != 0 {
		t.Fatalf("el comercio cerrado quedo con %d cobros pendientes", n)
	}
}

func TestCerrarComercio_UnCajeroQueSeSumaDuranteElCierreNoQuedaActivo(t *testing.T) {
	svc, pool, _, owner := setupCierre(t, nil)
	m := comercioVerificado(t, svc, owner)
	seedEmployee(t, pool, "808880888")

	carreraConElCierre(t, pool, m.ID, owner, "el alta del cajero", func() error {
		_, err := svc.AddStaff(context.Background(), m.ID, owner, &qrpayment.AddStaffRequest{Cedula: "808880888", Role: "cashier"})
		return err
	})
	if n := contar(t, pool, `SELECT COUNT(*) FROM merchant_staff WHERE merchant_id = $1::uuid AND status = 'active'`, m.ID); n != 0 {
		t.Fatalf("el comercio cerrado quedo con %d personas activas en el equipo", n)
	}
}

// Volver a sumar a alguien que ya se habia ido no inserta: reactiva su fila, y
// eso ni siquiera pasa por la clave foranea. Sin la fila del comercio tomada,
// no esperaria a nadie.
func TestCerrarComercio_UnCajeroQueSeReactivaDuranteElCierreNoQuedaActivo(t *testing.T) {
	svc, pool, _, owner := setupCierre(t, nil)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	seedEmployee(t, pool, "818881888")
	miembro, err := svc.AddStaff(ctx, m.ID, owner, &qrpayment.AddStaffRequest{Cedula: "818881888", Role: "cashier"})
	if err != nil {
		t.Fatalf("sumar al cajero: %v", err)
	}
	if err := svc.RevokeStaff(ctx, m.ID, owner, miembro.ID); err != nil {
		t.Fatalf("revocar al cajero: %v", err)
	}

	carreraConElCierre(t, pool, m.ID, owner, "la reactivacion del cajero", func() error {
		_, err := svc.AddStaff(context.Background(), m.ID, owner, &qrpayment.AddStaffRequest{Cedula: "818881888", Role: "manager"})
		return err
	})
	if n := contar(t, pool, `SELECT COUNT(*) FROM merchant_staff WHERE merchant_id = $1::uuid AND status = 'active'`, m.ID); n != 0 {
		t.Fatalf("el comercio cerrado quedo con %d personas activas en el equipo", n)
	}
}

func TestCerrarComercio_UnRotuloQueSePideDuranteElCierreNoNaceVivo(t *testing.T) {
	svc, pool, _, owner := setupCierre(t, nil)
	m := comercioVerificado(t, svc, owner)

	carreraConElCierre(t, pool, m.ID, owner, "el rotulo", func() error {
		_, err := svc.GetOrCreateMerchantCode(context.Background(), owner, m.ID, "", "USD")
		return err
	})
	if n := contar(t, pool, `SELECT COUNT(*) FROM qr_payment_codes WHERE merchant_id = $1::uuid AND status = 'active'`, m.ID); n != 0 {
		t.Fatalf("el comercio cerrado quedo con %d rotulos vivos", n)
	}
}

// ── Las rutas de gestion de un comercio cerrado ─────────────────────────────

// peticionCon es peticion con mas de un parametro de ruta ({id}, {staffID},
// {locationID}, {itemID}).
func peticionCon(method, url, cuerpo, userID string, params map[string]string) *http.Request {
	r := httptest.NewRequest(method, url, strings.NewReader(cuerpo))
	ctx := context.WithValue(r.Context(), middleware.UserIDKey, userID)
	rctx := chi.NewRouteContext()
	for k, v := range params {
		rctx.URLParams.Add(k, v)
	}
	ctx = context.WithValue(ctx, chi.RouteCtxKey, rctx)
	return r.WithContext(ctx)
}

// Cada ruta que administra el comercio dice que cerro, con su codigo, en vez de
// un 404 o un 400 con el texto del servidor. La pantalla lo explica en su
// idioma. Y ninguna deja algo escrito.
func TestComercioCerrado_LasRutasDeGestionDicenQueCerro(t *testing.T) {
	svc, pool, payer, owner := setupCierre(t, nil)
	h := qrpayment.NewHandler(svc)
	m := comercioVerificado(t, svc, owner)
	seedEmployee(t, pool, "909990999")
	cerrarComoDueno(t, svc, m.ID, owner)
	otro := uuid.NewString()
	base := "/api/v1/qr/merchants/" + m.ID
	admin := "/api/v1/admin/merchants/" + m.ID
	conID := map[string]string{"id": m.ID}

	casos := []struct {
		nombre  string
		handler http.HandlerFunc
		method  string
		url     string
		cuerpo  string
		quien   string
		params  map[string]string
	}{
		{"ver el equipo", h.ListStaff, http.MethodGet, base + "/staff", "", owner, conID},
		{"sumar al equipo", h.AddStaff, http.MethodPost, base + "/staff", `{"cedula":"909990999","role":"cashier"}`, owner, conID},
		{"cambiar a alguien del equipo", h.UpdateStaff, http.MethodPut, base + "/staff/" + otro, `{"role":"manager"}`, owner,
			map[string]string{"id": m.ID, "staffID": otro}},
		{"sacar a alguien del equipo", h.RevokeStaff, http.MethodDelete, base + "/staff/" + otro, "", owner,
			map[string]string{"id": m.ID, "staffID": otro}},
		{"ver las sucursales", h.ListLocations, http.MethodGet, base + "/locations", "", owner, conID},
		{"abrir una sucursal", h.CreateLocation, http.MethodPost, base + "/locations", `{"name":"Centro","address":"Calle 1"}`, owner, conID},
		{"cambiar una sucursal", h.UpdateLocation, http.MethodPut, base + "/locations/" + otro, `{"name":"Otra"}`, owner,
			map[string]string{"id": m.ID, "locationID": otro}},
		{"ver el catalogo", h.ListCatalog, http.MethodGet, base + "/catalog", "", owner, conID},
		{"sumar al catalogo", h.CreateCatalogItem, http.MethodPost, base + "/catalog", `{"name":"Cafe","price_minor":100000,"currency":"CRC"}`, owner, conID},
		{"cambiar el catalogo", h.UpdateCatalogItem, http.MethodPut, base + "/catalog/" + otro, `{"name":"Te","price_minor":5000}`, owner,
			map[string]string{"id": m.ID, "itemID": otro}},
		{"sacar del catalogo", h.DeleteCatalogItem, http.MethodDelete, base + "/catalog/" + otro, "", owner,
			map[string]string{"id": m.ID, "itemID": otro}},
		{"cobrar por la ruta vieja", h.CreateQRCode, http.MethodPost, "/api/v1/qr/codes",
			`{"type":"merchant_fixed","amount":5000,"currency":"CRC","merchant_id":"` + m.ID + `"}`, owner, nil},
		{"cambiar la comision", h.SetCommission, http.MethodPatch, admin + "/commission", `{"commission_bps":100}`, payer, conID},
		{"cambiar el plan", h.SetMerchantPlan, http.MethodPatch, admin + "/plan", `{"plan":"analitica"}`, payer, conID},
	}
	for _, c := range casos {
		rec := httptest.NewRecorder()
		c.handler(rec, peticionCon(c.method, c.url, c.cuerpo, c.quien, c.params))
		if rec.Code != http.StatusConflict || codigoDeError(t, rec) != "MERCHANT_CLOSED" {
			t.Errorf("%s: %d %s, se esperaba 409 MERCHANT_CLOSED", c.nombre, rec.Code, rec.Body.String())
		}
	}

	for tabla, sql := range map[string]string{
		"equipo activo":   `SELECT COUNT(*) FROM merchant_staff WHERE merchant_id = $1::uuid AND status = 'active'`,
		"sucursales":      `SELECT COUNT(*) FROM merchant_locations WHERE merchant_id = $1::uuid`,
		"catalogo":        `SELECT COUNT(*) FROM merchant_catalog_items WHERE merchant_id = $1::uuid`,
		"cobros":          `SELECT COUNT(*) FROM qr_charges WHERE merchant_id = $1::uuid`,
		"plan cambiado":   `SELECT COUNT(*) FROM qr_merchants WHERE id = $1::uuid AND plan <> 'base'`,
		"comision tocada": `SELECT COUNT(*) FROM qr_merchants WHERE id = $1::uuid AND commission_bps = 100`,
	} {
		if n := contar(t, pool, sql, m.ID); n != 0 {
			t.Errorf("%s en un comercio cerrado: %d", tabla, n)
		}
	}
}

// ── La reautenticacion del cierre ───────────────────────────────────────────

// suma es el total de intentos contados, en todas las llaves.
func (t *topeDePrueba) suma() int64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	var s int64
	for _, n := range t.n {
		s += n
	}
	return s
}

// Con el segundo factor encendido, la respuesta no dice cual de los dos fallo:
// quien tiene la sesion pero no la contrasena no aprende que la adivino porque
// el error cambio a "el codigo". La contrasena se sigue mirando primero, asi
// que con una equivocada el codigo ni se verifica (y no se gasta). Y acertar la
// contrasena con un codigo malo no limpia el contador.
func TestCerrarMiComercio_ConSegundoFactorNoDiceCualFallo(t *testing.T) {
	verificados := &atomic.Int32{}
	tope := nuevoTope()
	svc, pool, _, owner := setupCierre(t, &qrpayment.Options{
		Lockout: tope, MaxIntentosDeCierre: 5,
		TOTP: autenticadorQueCuenta{codigo: "123456", verificados: verificados},
	})
	h := qrpayment.NewHandler(svc)
	m := comercioVerificado(t, svc, owner)
	cerrar := func(cuerpo string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.CloseMerchant(rec, peticion(http.MethodPost, "/api/v1/qr/merchants/"+m.ID+"/close", cuerpo, owner, m.ID))
		return rec
	}

	conClaveMala := cerrar(`{"password":"otra-clave","totp_code":"123456"}`)
	conCodigoMalo := cerrar(`{"password":"` + claveDelDueno + `","totp_code":"999999"}`)
	for nombre, rec := range map[string]*httptest.ResponseRecorder{"contrasena equivocada": conClaveMala, "codigo equivocado": conCodigoMalo} {
		if rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "CREDENTIALS_INVALID" {
			t.Fatalf("%s: %d %s, se esperaba 400 CREDENTIALS_INVALID", nombre, rec.Code, rec.Body.String())
		}
	}
	if conClaveMala.Body.String() != conCodigoMalo.Body.String() {
		t.Fatalf("las dos respuestas se distinguen:\n%s\n%s", conClaveMala.Body.String(), conCodigoMalo.Body.String())
	}
	if n := verificados.Load(); n != 1 {
		t.Fatalf("el codigo se verifico %d veces; solo se verifica con la contrasena correcta", n)
	}
	if n := tope.suma(); n != 2 {
		t.Fatalf("intentos contados = %d, se esperaban 2 (un codigo malo no limpia el contador)", n)
	}
	if f := leerCierre(t, pool, m.ID); f.cerradoEn != nil {
		t.Fatalf("un intento rechazado cerro el comercio: %+v", f)
	}
}

// topeSinRedis es el contador de produccion con Redis caido: IncrLockout no
// puede contar y devuelve 0, que para el login es dejar pasar. ContarIntento,
// en cambio, dice que no pudo.
type topeSinRedis struct{}

func (topeSinRedis) IncrLockout(string) int64 { return 0 }
func (topeSinRedis) ResetLockout(string)      {}
func (topeSinRedis) GetLockout(string) int64  { return 0 }
func (topeSinRedis) ContarIntento(string) (int64, error) {
	return 0, errors.New("dial tcp: connection refused")
}

// Sin con que contar los intentos, el cierre no se confirma: es una operacion
// que no se deshace, y sin tope se podrian probar contrasenas sin limite con una
// sesion robada. La persona recibe "no se pudo, intenta de nuevo".
func TestCerrarMiComercio_SinElContadorDeIntentosNoSeCierra(t *testing.T) {
	svc, pool, _, owner := setupCierre(t, &qrpayment.Options{Lockout: topeSinRedis{}, MaxIntentosDeCierre: 5})
	h := qrpayment.NewHandler(svc)
	m := comercioVerificado(t, svc, owner)

	rec := httptest.NewRecorder()
	h.CloseMerchant(rec, peticion(http.MethodPost, "/api/v1/qr/merchants/"+m.ID+"/close",
		`{"password":"`+claveDelDueno+`"}`, owner, m.ID))
	if rec.Code != http.StatusInternalServerError || codigoDeError(t, rec) != "CLOSE_FAILED" {
		t.Fatalf("sin contador: %d %s, se esperaba 500 CLOSE_FAILED", rec.Code, rec.Body.String())
	}
	if f := leerCierre(t, pool, m.ID); f.cerradoEn != nil || !f.activo {
		t.Fatalf("se cerro sin poder contar el intento: %+v", f)
	}
}

// Cada intento fallido de confirmar el cierre queda en el rastro, con que fallo:
// es la senal de una sesion robada probando contrasenas. Pedir el codigo no es
// un intento y no deja fila.
func TestCerrarMiComercio_LosIntentosFallidosQuedanEnElRastro(t *testing.T) {
	tope := nuevoTope()
	svc, pool, _, owner := setupCierre(t, &qrpayment.Options{
		Lockout: tope, MaxIntentosDeCierre: 2, TOTP: autenticadorDePrueba{codigo: "123456"},
	})
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)

	if _, err := svc.CerrarMiComercio(ctx, m.ID, owner, &qrpayment.CerrarComercioRequest{Password: claveDelDueno}, actorDePrueba); !errors.Is(err, qrpayment.ErrTOTPRequerido) {
		t.Fatalf("sin el codigo: err = %v, se esperaba ErrTOTPRequerido", err)
	}
	for _, req := range []qrpayment.CerrarComercioRequest{
		{Password: "otra-clave", TOTPCode: "123456"},
		{Password: claveDelDueno, TOTPCode: "999999"},
		{Password: claveDelDueno, TOTPCode: "123456"}, // pasado el tope
	} {
		req := req
		if _, err := svc.CerrarMiComercio(ctx, m.ID, owner, &req, actorDePrueba); err == nil {
			t.Fatalf("%+v cerro el comercio", req)
		}
	}

	filas, err := pool.Query(ctx, `
		SELECT COALESCE(details->>'failure', ''), COALESCE(user_id::text, ''), COALESCE(risk_level, '')
		  FROM audit_logs
		 WHERE action = 'merchant_close_reauth_failed' AND resource_type = 'merchant' AND resource_id = $1
		 ORDER BY created_at`, m.ID)
	if err != nil {
		t.Fatalf("leer el rastro: %v", err)
	}
	defer filas.Close()
	var fallos []string
	for filas.Next() {
		var fallo, quien, riesgo string
		if err := filas.Scan(&fallo, &quien, &riesgo); err != nil {
			t.Fatalf("leer el rastro: %v", err)
		}
		if quien != owner || riesgo == "" {
			t.Fatalf("fila del rastro: quien = %q, riesgo = %q", quien, riesgo)
		}
		fallos = append(fallos, fallo)
	}
	if strings.Join(fallos, ",") != "password,totp,locked" {
		t.Fatalf("intentos fallidos en el rastro = %v, se esperaba [password totp locked]", fallos)
	}
}

// ── Lo que el dueno conserva de un comercio cerrado ─────────────────────────

// El comercio cerrado ya no se administra, pero lo que vendio sigue siendo del
// dueno: lo ve en su lista de comercios cerrados, lee sus ventas, el saldo y el
// reporte, y descarga el CSV aunque el comercio tenga el plan base. Leer no es
// administrar: el gerente revocado y un ajeno no leen nada.
func TestComercioCerrado_ElDuenoSigueLeyendoLoQueVendio(t *testing.T) {
	svc, pool, payer, owner := setupCierre(t, nil)
	h := qrpayment.NewHandler(svc)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	venta := pagarAlComercio(t, svc, payer, owner, m.ID, 100000)
	gerente := seedEmployee(t, pool, "505550555")
	if _, err := svc.AddStaff(ctx, m.ID, owner, &qrpayment.AddStaffRequest{Cedula: "505550555", Role: "manager"}); err != nil {
		t.Fatalf("sumar al gerente: %v", err)
	}
	if _, err := svc.WithdrawToOwner(ctx, m.ID, owner, "CRC", saldoDelComercio(t, pool, m.ID, "CRC"), "vaciar-antes-de-cerrar"); err != nil {
		t.Fatalf("vaciar el comercio: %v", err)
	}
	cerrarComoDueno(t, svc, m.ID, owner)

	listar := func(quien, url string) []qrpayment.Merchant {
		t.Helper()
		rec := httptest.NewRecorder()
		h.GetMerchants(rec, peticion(http.MethodGet, url, "", quien, ""))
		if rec.Code != http.StatusOK {
			t.Fatalf("listar %s: %d %s", url, rec.Code, rec.Body.String())
		}
		var lista []qrpayment.Merchant
		if err := json.Unmarshal(leerSobre(t, rec).Data, &lista); err != nil {
			t.Fatalf("lista ilegible: %v", err)
		}
		return lista
	}
	cerrados := listar(owner, "/api/v1/qr/merchants?status=closed")
	if len(cerrados) != 1 || cerrados[0].ID != m.ID || cerrados[0].ClosedAt == nil || cerrados[0].Role != qrpayment.RoleOwner {
		t.Fatalf("comercios cerrados del dueno = %+v, se esperaba %s", cerrados, m.ID)
	}
	if abiertos := listar(owner, "/api/v1/qr/merchants"); len(abiertos) != 0 {
		t.Fatalf("la lista de siempre trae el comercio cerrado: %+v", abiertos)
	}
	for _, quien := range []string{payer, gerente} {
		if ajenos := listar(quien, "/api/v1/qr/merchants?status=closed"); len(ajenos) != 0 {
			t.Fatalf("%s ve comercios cerrados que no son suyos: %+v", quien, ajenos)
		}
	}

	ventas, err := svc.MerchantPayments(ctx, m.ID, owner, 50)
	if err != nil || len(ventas) != 1 || ventas[0].ID != venta.ID {
		t.Fatalf("ventas del comercio cerrado = %+v (err %v), se esperaba %s", ventas, err, venta.ID)
	}
	if saldo, err := svc.MerchantBalance(ctx, m.ID, owner, "CRC"); err != nil || saldo != 0 {
		t.Fatalf("saldo del comercio cerrado = %d (err %v)", saldo, err)
	}
	rep, err := svc.MerchantReport(ctx, m.ID, owner, 30, 0)
	if err != nil || rep.Totals.Count != 1 {
		t.Fatalf("reporte del comercio cerrado = %+v (err %v)", rep, err)
	}

	rec := httptest.NewRecorder()
	h.GetMerchantPayments(rec, peticion(http.MethodGet, "/api/v1/qr/merchants/"+m.ID+"/payments", "", owner, m.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("ventas por HTTP: %d %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	h.GetMerchantReportCSV(rec, peticion(http.MethodGet, "/api/v1/qr/merchants/"+m.ID+"/report.csv?days=30", "", owner, m.ID))
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("CSV de un comercio cerrado con el plan base: %d %s", rec.Code, rec.Body.String())
	}

	for _, quien := range []string{gerente, payer} {
		if _, err := svc.MerchantPayments(ctx, m.ID, quien, 50); err == nil {
			t.Fatalf("%s leyo las ventas de un comercio cerrado ajeno", quien)
		}
		if _, err := svc.MerchantReport(ctx, m.ID, quien, 30, 0); err == nil {
			t.Fatalf("%s leyo el reporte de un comercio cerrado ajeno", quien)
		}
		if _, err := svc.ReporteExportable(ctx, m.ID, quien, 30, 0); err == nil {
			t.Fatalf("%s exporto el reporte de un comercio cerrado ajeno", quien)
		}
	}
}
