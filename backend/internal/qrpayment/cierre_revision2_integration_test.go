package qrpayment_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/qrpayment"
)

// Lo que encontro la segunda revision del cierre (PR 292).

// ── Lo que el dueno lee de un cierre que no hizo el ───────────────────────────

// motivoCierrePorAdmin es lo que lee el dueno cuando lo cerro un administrador.
const motivoCierrePorAdmin = "admin_closure"

// Un administrador cierra con un motivo que es suyo: una nota interna, a veces
// de cumplimiento, que al cliente no se le dice. La lista de cerrados del dueno
// dice que lo cerro la plataforma, sin el texto y sin quien. El motivo sigue
// entero en la vista de administracion.
func TestComercioCerradoPorAdmin_ElDuenoNoLeeElMotivoNiQuienLoCerro(t *testing.T) {
	svc, pool, payer, owner := setupCierre(t, nil)
	h := qrpayment.NewHandler(svc)
	ctx := context.Background()
	admin := payer // el servicio no mira el rol: eso lo hace el middleware de la ruta
	m := comercioVerificado(t, svc, owner)
	const motivo = "nota interna de cumplimiento 4471"
	if _, err := svc.CerrarComercioComoAdmin(ctx, m.ID, admin, motivo, actorDePrueba); err != nil {
		t.Fatalf("cerrar como administrador: %v", err)
	}

	rec := httptest.NewRecorder()
	h.GetMerchants(rec, peticion(http.MethodGet, "/api/v1/qr/merchants?status=closed", "", owner, ""))
	if rec.Code != http.StatusOK {
		t.Fatalf("listar los cerrados: %d %s", rec.Code, rec.Body.String())
	}
	cuerpo := rec.Body.String()
	if strings.Contains(cuerpo, motivo) || strings.Contains(cuerpo, admin) {
		t.Fatalf("la lista del dueno trae el motivo o el id del administrador: %s", cuerpo)
	}
	var cerrados []qrpayment.Merchant
	if err := json.Unmarshal(leerSobre(t, rec).Data, &cerrados); err != nil {
		t.Fatalf("lista ilegible: %v", err)
	}
	if len(cerrados) != 1 || cerrados[0].ClosureReason != motivoCierrePorAdmin || cerrados[0].ClosedBy != "" {
		t.Fatalf("cerrados del dueno = %+v, se esperaba motivo %q y sin quien", cerrados, motivoCierrePorAdmin)
	}

	// El que lo cerro el mismo si dice por que: es su propia decision.
	propio := comercioVerificado(t, svc, owner)
	cerrarComoDueno(t, svc, propio.ID, owner)
	rec = httptest.NewRecorder()
	h.GetMerchants(rec, peticion(http.MethodGet, "/api/v1/qr/merchants?status=closed", "", owner, ""))
	cerrados = nil
	if err := json.Unmarshal(leerSobre(t, rec).Data, &cerrados); err != nil {
		t.Fatalf("lista ilegible: %v", err)
	}
	for _, c := range cerrados {
		if c.ID == propio.ID && c.ClosureReason != qrpayment.MotivoCierrePropio {
			t.Fatalf("el cierre propio dice %q, se esperaba %q", c.ClosureReason, qrpayment.MotivoCierrePropio)
		}
		if c.ClosedBy != "" {
			t.Fatalf("la lista del dueno trae quien cerro: %+v", c)
		}
	}

	if f := leerCierre(t, pool, m.ID); f.motivo != motivo || f.cerradoPor != admin {
		t.Fatalf("el motivo del administrador no quedo en la fila: %+v", f)
	}
}

// ── El reintento repara la fila del pago ─────────────────────────────────────

// El asiento confirmo y la venta quedo escrita, pero el proceso cayo antes de
// marcar la fila del movimiento: quedo 'pending'. El reintento con la misma
// llave es el que la pone al dia, y lo tiene que seguir haciendo aunque entre
// tanto el comercio haya cerrado: si no, la persona ve para siempre como
// pendiente un pago que ya hizo.
func TestComercioCerrado_ElReintentoDejaElPagoCompletado(t *testing.T) {
	svc, pool, payer, owner := setupCierre(t, nil)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	rotulo := rotuloDelComercio(t, svc, owner, m.ID)
	req := qrpayment.ScanQRPaymentRequest{QRData: rotulo.QRData, Amount: 4000, Currency: "CRC", IdempotencyKey: "pago-que-quedo-sin-marcar"}
	venta, err := svc.ScanAndPay(ctx, payer, &req)
	if err != nil {
		t.Fatalf("pagar: %v", err)
	}
	dejarPendiente(t, pool, venta.TxID)
	if _, err := svc.WithdrawToOwner(ctx, m.ID, owner, "CRC", saldoDelComercio(t, pool, m.ID, "CRC"), "vaciar-antes-de-cerrar"); err != nil {
		t.Fatalf("vaciar el comercio: %v", err)
	}
	cerrarComoDueno(t, svc, m.ID, owner)

	reintento := req
	got, err := svc.ScanAndPay(ctx, payer, &reintento)
	if err != nil || got.ID != venta.ID {
		t.Fatalf("reintentar: %+v (err %v), se esperaba la venta %s", got, err, venta.ID)
	}
	if estado := estadoDeLaFila(t, pool, venta.TxID); estado != "completed" {
		t.Fatalf("la fila del pago quedo %q despues del reintento, se esperaba completed", estado)
	}
}

// Con un codigo personal que se revoco hay dos filas: la de quien paga y la de
// quien recibe. Las dos se ponen al dia.
func TestCodigoRevocado_ElReintentoDejaLasDosFilasCompletadas(t *testing.T) {
	svc, pool, payer, owner := setupQR(t)
	ctx := context.Background()
	code, err := svc.GetOrCreateMyCode(ctx, owner, "CRC")
	if err != nil {
		t.Fatalf("GetOrCreateMyCode: %v", err)
	}
	req := qrpayment.ScanQRPaymentRequest{QRData: code.QRData, Amount: 2500, Currency: "CRC", IdempotencyKey: "pago-personal-sin-marcar"}
	pago, err := svc.ScanAndPay(ctx, payer, &req)
	if err != nil {
		t.Fatalf("pagar: %v", err)
	}
	dejarPendiente(t, pool, pago.TxID)
	if _, err := pool.Exec(ctx,
		`UPDATE transactions SET status = 'pending'
		  WHERE idempotency_key = (SELECT idempotency_key FROM transactions WHERE id::text = $1) || ':recv'`,
		pago.TxID); err != nil {
		t.Fatalf("dejar pendiente la fila de quien recibe: %v", err)
	}
	if err := svc.RevokeCode(ctx, owner, code.ID); err != nil {
		t.Fatalf("revocar: %v", err)
	}

	reintento := req
	if got, err := svc.ScanAndPay(ctx, payer, &reintento); err != nil || got.ID != pago.ID {
		t.Fatalf("reintentar: %+v (err %v)", got, err)
	}
	if n := contar(t, pool,
		`SELECT COUNT(*) FROM transactions
		  WHERE status <> 'completed'
		    AND (id::text = $1 OR idempotency_key = (SELECT idempotency_key FROM transactions WHERE id::text = $1) || ':recv')`,
		pago.TxID); n != 0 {
		t.Fatalf("%d filas del pago siguen sin completar despues del reintento", n)
	}
}

// dejarPendiente deja la fila del movimiento como la deja una caida entre el
// asiento y la marca: el dinero se movio y la fila dice 'pending'.
func dejarPendiente(t *testing.T, pool *pgxpool.Pool, txID string) {
	t.Helper()
	tag, err := pool.Exec(context.Background(), `UPDATE transactions SET status = 'pending' WHERE id::text = $1`, txID)
	if err != nil || tag.RowsAffected() != 1 {
		t.Fatalf("dejar pendiente la fila %s: %v (%d filas)", txID, err, tag.RowsAffected())
	}
}

func estadoDeLaFila(t *testing.T, pool *pgxpool.Pool, txID string) string {
	t.Helper()
	var estado string
	if err := pool.QueryRow(context.Background(), `SELECT status FROM transactions WHERE id::text = $1`, txID).Scan(&estado); err != nil {
		t.Fatalf("leer la fila %s: %v", txID, err)
	}
	return estado
}

// ── Lo que vendio un comercio cerrado hace tiempo ────────────────────────────

// El reporte de un comercio cerrado cuenta hasta el dia del cierre, no hasta
// hoy: un ano despues de cerrar, "los ultimos 30 dias" no traian ninguna venta y
// el dueno ya no tenia como ver ni exportar lo que vendio.
func TestComercioCerrado_ElReporteCuentaHastaElCierre(t *testing.T) {
	svc, pool, payer, owner := setupCierre(t, nil)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	venta := pagarAlComercio(t, svc, payer, owner, m.ID, 100000)
	if _, err := svc.WithdrawToOwner(ctx, m.ID, owner, "CRC", saldoDelComercio(t, pool, m.ID, "CRC"), "vaciar-antes-de-cerrar"); err != nil {
		t.Fatalf("vaciar el comercio: %v", err)
	}
	cerrarComoDueno(t, svc, m.ID, owner)
	// Cerro hace 400 dias, y la venta fue un dia antes del cierre.
	if _, err := pool.Exec(ctx,
		`UPDATE qr_merchants SET closed_at = closed_at - INTERVAL '400 days' WHERE id = $1::uuid`, m.ID); err != nil {
		t.Fatalf("mover el cierre: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE qr_payments SET created_at = created_at - INTERVAL '401 days' WHERE id = $1::uuid`, venta.ID); err != nil {
		t.Fatalf("mover la venta: %v", err)
	}

	rep, err := svc.MerchantReport(ctx, m.ID, owner, 30, 0)
	if err != nil || rep.Totals.Count != 1 {
		t.Fatalf("reporte de los 30 dias antes del cierre = %+v (err %v), se esperaba la venta", rep, err)
	}
	csv, err := svc.ReporteExportable(ctx, m.ID, owner, 30, 0)
	if err != nil || csv.Totals.Count != 1 {
		t.Fatalf("CSV de los 30 dias antes del cierre = %+v (err %v), se esperaba la venta", csv, err)
	}
}

// Las ventas se leen por paginas: el feed traia las ultimas 50 y nada mas, y de
// un comercio cerrado no hay otra forma de llegar a las anteriores.
func TestVentasDelComercio_SeLeenPorPaginas(t *testing.T) {
	svc, pool, payer, owner := setupCierre(t, nil)
	h := qrpayment.NewHandler(svc)
	m := comercioVerificado(t, svc, owner)
	var ventas []*qrpayment.QRPaymentRecord
	for _, monto := range []int64{10000, 20000, 30000} {
		ventas = append(ventas, pagarAlComercio(t, svc, payer, owner, m.ID, monto))
	}
	// Distintas en el tiempo, para que el orden no dependa del reloj de la prueba.
	for i, v := range ventas {
		if _, err := pool.Exec(context.Background(),
			`UPDATE qr_payments SET created_at = NOW() - make_interval(mins => $2) WHERE id = $1::uuid`,
			v.ID, 10*(len(ventas)-i)); err != nil {
			t.Fatalf("ordenar las ventas: %v", err)
		}
	}
	pagina := func(url string) ([]qrpayment.QRPaymentRecord, *httptest.ResponseRecorder) {
		t.Helper()
		rec := httptest.NewRecorder()
		h.GetMerchantPayments(rec, peticion(http.MethodGet, url, "", owner, m.ID))
		if rec.Code != http.StatusOK {
			return nil, rec
		}
		var out []qrpayment.QRPaymentRecord
		if err := json.Unmarshal(leerSobre(t, rec).Data, &out); err != nil {
			t.Fatalf("ventas ilegibles: %v", err)
		}
		return out, rec
	}
	base := "/api/v1/qr/merchants/" + m.ID + "/payments"

	primera, _ := pagina(base + "?limit=2")
	if len(primera) != 2 || primera[0].ID != ventas[2].ID || primera[1].ID != ventas[1].ID {
		t.Fatalf("primera pagina = %+v, se esperaban las dos ultimas", primera)
	}
	segunda, _ := pagina(base + "?limit=2&before=" + primera[1].ID)
	if len(segunda) != 1 || segunda[0].ID != ventas[0].ID {
		t.Fatalf("segunda pagina = %+v, se esperaba la primera venta", segunda)
	}
	if _, rec := pagina(base + "?before=no-es-un-id"); rec == nil || rec.Code != http.StatusBadRequest || codigoDeError(t, rec) != "INVALID_CURSOR" {
		t.Fatalf("un cursor que no es un id: se esperaba 400 INVALID_CURSOR")
	}
}

// ── El rotulo de un comercio, pedido a la vez ────────────────────────────────

// Dos pantallas que piden el rotulo del mostrador a la vez: el que pierde la
// carrera relee el del que gano. Ese camino corre dentro de la transaccion que
// tiene la fila del comercio, con un SAVEPOINT, y es distinto del rotulo personal.
func TestRotuloDelComercio_EsUnoSoloBajoCarrera(t *testing.T) {
	svc, pool, _, owner := setupCierre(t, nil)
	m := comercioVerificado(t, svc, owner)

	const n = 6
	var wg sync.WaitGroup
	ids := make([]string, n)
	errs := make([]error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c, err := svc.GetOrCreateMerchantCode(context.Background(), owner, m.ID, "", "USD")
			errs[i] = err
			if c != nil {
				ids[i] = c.ID
			}
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("pedido %d: %v", i, err)
		}
		if ids[i] != ids[0] {
			t.Fatalf("dos rotulos distintos: %s y %s", ids[0], ids[i])
		}
	}
	if c := contar(t, pool, `SELECT COUNT(*) FROM qr_payment_codes WHERE merchant_id = $1::uuid AND status = 'active' AND currency = 'USD'`, m.ID); c != 1 {
		t.Fatalf("rotulos activos en USD = %d, se esperaba 1", c)
	}
}

// ── Sucursales y catalogo durante el cierre ──────────────────────────────────

func TestCerrarComercio_LoQueSeEscribeEnSucursalesYCatalogoDuranteElCierreNoQueda(t *testing.T) {
	ctx := context.Background()
	activa := true
	inactiva := false

	t.Run("una sucursal nueva", func(t *testing.T) {
		svc, pool, _, owner := setupCierre(t, nil)
		m := comercioVerificado(t, svc, owner)
		carreraConElCierre(t, pool, m.ID, owner, "la sucursal", func() error {
			_, err := svc.CreateLocation(context.Background(), m.ID, owner, &qrpayment.LocationRequest{Name: "Centro"})
			return err
		})
		if n := contar(t, pool, `SELECT COUNT(*) FROM merchant_locations WHERE merchant_id = $1::uuid`, m.ID); n != 0 {
			t.Fatalf("el comercio cerrado quedo con %d sucursales nuevas", n)
		}
	})
	t.Run("una sucursal reactivada", func(t *testing.T) {
		svc, pool, _, owner := setupCierre(t, nil)
		m := comercioVerificado(t, svc, owner)
		loc, err := svc.CreateLocation(ctx, m.ID, owner, &qrpayment.LocationRequest{Name: "Centro"})
		if err != nil {
			t.Fatalf("crear la sucursal: %v", err)
		}
		if _, err := svc.UpdateLocation(ctx, m.ID, owner, loc.ID, &qrpayment.LocationRequest{Name: "Centro", Active: &inactiva}); err != nil {
			t.Fatalf("desactivar la sucursal: %v", err)
		}
		carreraConElCierre(t, pool, m.ID, owner, "la reactivacion de la sucursal", func() error {
			_, err := svc.UpdateLocation(context.Background(), m.ID, owner, loc.ID, &qrpayment.LocationRequest{Name: "Centro", Active: &activa})
			return err
		})
		if n := contar(t, pool, `SELECT COUNT(*) FROM merchant_locations WHERE merchant_id = $1::uuid AND active`, m.ID); n != 0 {
			t.Fatalf("el comercio cerrado quedo con %d sucursales activas", n)
		}
	})
	t.Run("un producto nuevo", func(t *testing.T) {
		svc, pool, _, owner := setupCierre(t, nil)
		m := comercioVerificado(t, svc, owner)
		carreraConElCierre(t, pool, m.ID, owner, "el producto", func() error {
			_, err := svc.CreateCatalogItem(context.Background(), m.ID, owner, &qrpayment.CatalogItemRequest{Name: "Cafe", PriceMinor: 100000, Currency: "CRC"})
			return err
		})
		if n := contar(t, pool, `SELECT COUNT(*) FROM merchant_catalog_items WHERE merchant_id = $1::uuid`, m.ID); n != 0 {
			t.Fatalf("el comercio cerrado quedo con %d productos nuevos", n)
		}
	})
	t.Run("un producto editado", func(t *testing.T) {
		svc, pool, _, owner := setupCierre(t, nil)
		m := comercioVerificado(t, svc, owner)
		item, err := svc.CreateCatalogItem(ctx, m.ID, owner, &qrpayment.CatalogItemRequest{Name: "Cafe", PriceMinor: 100000, Currency: "CRC"})
		if err != nil {
			t.Fatalf("crear el producto: %v", err)
		}
		carreraConElCierre(t, pool, m.ID, owner, "la edicion del producto", func() error {
			_, err := svc.UpdateCatalogItem(context.Background(), m.ID, owner, item.ID, &qrpayment.CatalogItemRequest{Name: "Te", PriceMinor: 90000, Currency: "CRC"})
			return err
		})
		if n := contar(t, pool, `SELECT COUNT(*) FROM merchant_catalog_items WHERE id = $1::uuid AND name = 'Cafe' AND price_minor = 100000`, item.ID); n != 1 {
			t.Fatalf("el producto de un comercio cerrado cambio")
		}
	})
	t.Run("un producto borrado", func(t *testing.T) {
		svc, pool, _, owner := setupCierre(t, nil)
		m := comercioVerificado(t, svc, owner)
		item, err := svc.CreateCatalogItem(ctx, m.ID, owner, &qrpayment.CatalogItemRequest{Name: "Cafe", PriceMinor: 100000, Currency: "CRC"})
		if err != nil {
			t.Fatalf("crear el producto: %v", err)
		}
		carreraConElCierre(t, pool, m.ID, owner, "el borrado del producto", func() error {
			return svc.DeleteCatalogItem(context.Background(), m.ID, owner, item.ID)
		})
		if n := contar(t, pool, `SELECT COUNT(*) FROM merchant_catalog_items WHERE id = $1::uuid`, item.ID); n != 1 {
			t.Fatalf("el producto de un comercio cerrado se borro")
		}
	})
}

// ── La reautenticacion, otra vez ─────────────────────────────────────────────

// Pasado el tope, cada intento sigue rechazado, pero el rastro anota la pausa
// una sola vez por ventana: si no, un guion que insiste llena audit_logs a la
// velocidad a la que manda peticiones.
func TestCerrarMiComercio_LaPausaQuedaEnElRastroUnaSolaVez(t *testing.T) {
	tope := nuevoTope()
	svc, pool, _, owner := setupCierre(t, &qrpayment.Options{Lockout: tope, MaxIntentosDeCierre: 2})
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	for i := 0; i < 2; i++ {
		_, err := svc.CerrarMiComercio(ctx, m.ID, owner, &qrpayment.CerrarComercioRequest{Password: "otra-clave"}, actorDePrueba)
		if !errors.Is(err, qrpayment.ErrContrasenaIncorrecta) {
			t.Fatalf("intento %d: err = %v", i+1, err)
		}
	}
	for i := 0; i < 3; i++ {
		_, err := svc.CerrarMiComercio(ctx, m.ID, owner, &qrpayment.CerrarComercioRequest{Password: "otra-clave"}, actorDePrueba)
		if !errors.Is(err, qrpayment.ErrCierreEnPausa) {
			t.Fatalf("intento en pausa %d: err = %v", i+1, err)
		}
	}
	if n := contar(t, pool,
		`SELECT COUNT(*) FROM audit_logs WHERE action = $1 AND resource_id = $2 AND details->>'failure' = 'locked'`,
		qrpayment.AccionCierreFallido, m.ID); n != 1 {
		t.Fatalf("la pausa quedo %d veces en el rastro, se esperaba 1", n)
	}
	if n := contar(t, pool,
		`SELECT COUNT(*) FROM audit_logs WHERE action = $1 AND resource_id = $2 AND details->>'failure' = 'password'`,
		qrpayment.AccionCierreFallido, m.ID); n != 2 {
		t.Fatalf("las contrasenas equivocadas quedaron %d veces en el rastro, se esperaban 2", n)
	}
}

// Con el segundo factor encendido, el rechazo tarda lo mismo falle lo que falle.
// Una contrasena equivocada se rechaza sin verificar el codigo y una correcta
// con el codigo malo lo verifica: sin un piso comun, el tiempo de la respuesta
// decia cual de los dos fallo, aunque el cuerpo fuera el mismo.
func TestCerrarMiComercio_ConSegundoFactorElRechazoTieneUnPisoDeTiempo(t *testing.T) {
	// El de cierre.go: por encima de lo que tarda Argon2 con los parametros de
	// produccion mas el codigo.
	const pisoDelRechazo = time.Second
	verificados := &atomic.Int32{}
	svc, _, _, owner := setupCierre(t, &qrpayment.Options{
		Lockout: nuevoTope(), MaxIntentosDeCierre: 5,
		TOTP: autenticadorQueCuenta{codigo: "123456", verificados: verificados},
	})
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	for nombre, req := range map[string]qrpayment.CerrarComercioRequest{
		"contrasena equivocada": {Password: "otra-clave", TOTPCode: "123456"},
		"codigo equivocado":     {Password: claveDelDueno, TOTPCode: "999999"},
	} {
		inicio := time.Now()
		_, err := svc.CerrarMiComercio(ctx, m.ID, owner, &req, actorDePrueba)
		tardo := time.Since(inicio)
		if !errors.Is(err, qrpayment.ErrCredencialesIncorrectas) {
			t.Fatalf("%s: err = %v", nombre, err)
		}
		if tardo < pisoDelRechazo {
			t.Fatalf("%s tardo %v, menos que el piso de %v", nombre, tardo, pisoDelRechazo)
		}
	}
}

// ── Un cajero que ya no esta ─────────────────────────────────────────────────

// Quien se fue del equipo ya no lee los cobros que abrio en el comercio: ni uno
// por uno ni en su lista. Sus cobros personales siguen siendo suyos.
func TestCobroDelComercio_QuienSeFueDelEquipoYaNoLoLee(t *testing.T) {
	svc, pool, _, owner := setupCierre(t, nil)
	ctx := context.Background()
	m := comercioVerificado(t, svc, owner)
	rotulo := rotuloDelComercio(t, svc, owner, m.ID)
	cajero := seedEmployee(t, pool, "828882888")
	miembro, err := svc.AddStaff(ctx, m.ID, owner, &qrpayment.AddStaffRequest{Cedula: "828882888", Role: "cashier"})
	if err != nil {
		t.Fatalf("sumar al cajero: %v", err)
	}
	delComercio, err := svc.CreateCharge(ctx, cajero, &qrpayment.CreateChargeRequest{QRCodeID: rotulo.ID, Amount: 5000})
	if err != nil {
		t.Fatalf("el cajero cobra: %v", err)
	}
	personal, err := svc.GetOrCreateMyCode(ctx, cajero, "CRC")
	if err != nil {
		t.Fatalf("rotulo personal del cajero: %v", err)
	}
	suyo, err := svc.CreateCharge(ctx, cajero, &qrpayment.CreateChargeRequest{QRCodeID: personal.ID, Amount: 3000})
	if err != nil {
		t.Fatalf("cobro personal del cajero: %v", err)
	}
	if err := svc.RevokeStaff(ctx, m.ID, owner, miembro.ID); err != nil {
		t.Fatalf("revocar al cajero: %v", err)
	}

	if _, err := svc.GetCharge(ctx, cajero, delComercio.ID); !errors.Is(err, qrpayment.ErrQRInvalido) {
		t.Fatalf("leer un cobro del comercio despues de irse: err = %v, se esperaba ErrQRInvalido", err)
	}
	if err := svc.CancelCharge(ctx, cajero, delComercio.ID); !errors.Is(err, qrpayment.ErrQRInvalido) {
		t.Fatalf("cancelar un cobro del comercio despues de irse: err = %v, se esperaba ErrQRInvalido", err)
	}
	lista, err := svc.ListCharges(ctx, cajero, "")
	if err != nil {
		t.Fatalf("listar: %v", err)
	}
	if len(lista) != 1 || lista[0].ID != suyo.ID {
		t.Fatalf("la lista del cajero que se fue = %+v, se esperaba solo su cobro personal %s", lista, suyo.ID)
	}
	if got, err := svc.GetCharge(ctx, cajero, suyo.ID); err != nil || got.ID != suyo.ID {
		t.Fatalf("su cobro personal: %+v (err %v)", got, err)
	}
}
