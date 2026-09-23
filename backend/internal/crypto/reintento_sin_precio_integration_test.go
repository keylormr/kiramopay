package crypto_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kiramopay/backend/internal/crypto"
)

// El reintento de una operacion que ya se hizo no necesita el precio: lo que
// contesta es lo que se hizo entonces, con el precio de entonces. Pero comprar,
// vender, convertir y enviar pedian el precio ANTES de mirar la llave, asi que
// el reintento que llegaba con el proveedor de precios caido recibia 503 en vez
// de la operacion hecha. No se cobraba dos veces —la pantalla conserva la llave
// ante un 503 y la base no deja repetir—, pero la persona se quedaba sin saber
// si su operacion habia ocurrido, justo despues de que la red ya le fallo una
// vez. En la venta, ademas, el reintento que llegaba con el precio ya movido
// recibia un rechazo por un monto recalculado que nadie pidio.
//
// Cada prueba repite la operacion, con la misma llave, sobre un segundo
// servicio igual en todo menos en el feed. Antes de nada, un pedido NUEVO a ese
// segundo servicio tiene que fallar por falta de precio: sin esa comprobacion,
// un feed que si cotizara dejaria pasar la prueba sin que el precio hubiera
// faltado nunca.

// feedSinPrecios es un proveedor que contesta pero no cotiza nada, que es como
// se ve uno caido o rechazando la clave.
func feedSinPrecios(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("[]"))
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// exigirSinPrecio comprueba que el pedido nuevo de control fallo por falta de
// precio y no por otra cosa.
func exigirSinPrecio(t *testing.T, err error) {
	t.Helper()
	if !errors.Is(err, crypto.ErrSinPrecio) {
		t.Fatalf("un pedido nuevo al servicio sin precios dio %v, se esperaba ErrSinPrecio: "+
			"el reintento no llegaria sin precio", err)
	}
}

func TestComprar_ElReintentoSinPrecioDevuelveLaCompraHecha(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	pedido := crypto.BuyRequest{
		Asset: "BTC", Price: d(1000), FromCurrency: "CRC", FromAmount: d(50000),
		IdempotencyKey: "crypto:buy:toque-1",
	}

	sinPrecio := servicioDeVenta(t, m.pool, feedSinPrecios(t))
	otra := pedido
	otra.IdempotencyKey = "crypto:buy:otro-toque"
	_, err := sinPrecio.Buy(ctx, m.userID, &otra)
	exigirSinPrecio(t, err)

	primera, err := m.svc.Buy(ctx, m.userID, &pedido)
	if err != nil {
		t.Fatalf("la compra: %v", err)
	}
	crc, _ := m.billetera(t)
	btc := saldoDelActivo(t, m, "BTC")

	reintento := pedido
	segunda, err := sinPrecio.Buy(ctx, m.userID, &reintento)
	if err != nil {
		t.Fatalf("el reintento de una compra que ya se hizo dio %v, se esperaba la compra", err)
	}
	if segunda.ID != primera.ID || !segunda.Amount.Equal(primera.Amount) {
		t.Fatalf("el reintento devolvio %+v, la compra fue %+v", segunda, primera)
	}
	if ahora, _ := m.billetera(t); ahora != crc {
		t.Fatalf("billetera CRC = %d, era %d: el reintento cobro otra vez", ahora, crc)
	}
	if ahora := saldoDelActivo(t, m, "BTC"); !ahora.Equal(btc) {
		t.Fatalf("BTC = %s, era %s: el reintento abono otra vez", ahora, btc)
	}
	compras := m.contar(t,
		`SELECT COUNT(*) FROM crypto_transactions WHERE user_id = $1::uuid AND type = 'buy'`, m.userID)
	if compras != 1 {
		t.Fatalf("compras anotadas = %d, se esperaba 1", compras)
	}
	if n := m.asientosDeLaLlave(t, pedido.IdempotencyKey); n != 1 {
		t.Fatalf("asientos de la llave = %d, se esperaba 1", n)
	}
}

// exigirSoloLaPrimeraVenta: de los 3 BTC se vendio 1, una sola vez.
func (m *montajeVenta) exigirSoloLaPrimeraVenta(t *testing.T, crc int64, llave string) {
	t.Helper()
	if ahora, _ := m.billetera(t); ahora != crc {
		t.Fatalf("billetera CRC = %d, era %d: se acredito otra venta", ahora, crc)
	}
	m.exigirSaldo(t, "BTC", 2, "se vendio 1 de 3, una sola vez")
	if n := m.ventasAnotadas(t); n != 1 {
		t.Fatalf("ventas anotadas = %d, se esperaba 1", n)
	}
	if n := m.asientosDeLaLlave(t, llave); n != 1 {
		t.Fatalf("asientos de la llave = %d, se esperaba 1", n)
	}
}

var vendeUnBTC = crypto.SellRequest{
	Asset: "BTC", Amount: d(1), Price: d(1000), ToCurrency: "CRC",
	IdempotencyKey: "crypto:sell:toque-1",
}

func TestVender_ElReintentoSinPrecioDevuelveLaVentaHecha(t *testing.T) {
	m := montarVenta(t)
	ctx := context.Background()
	m.sembrar(t, "BTC", "Bitcoin", 3)

	sinPrecio := servicioDeVenta(t, m.pool, feedSinPrecios(t))
	otra := vendeUnBTC
	otra.IdempotencyKey = "crypto:sell:otro-toque"
	_, err := sinPrecio.Sell(ctx, m.userID, &otra)
	exigirSinPrecio(t, err)

	pedido := vendeUnBTC
	primera, err := m.svc.Sell(ctx, m.userID, &pedido)
	if err != nil {
		t.Fatalf("la venta: %v", err)
	}
	crc, _ := m.billetera(t)

	reintento := vendeUnBTC
	segunda, err := sinPrecio.Sell(ctx, m.userID, &reintento)
	if err != nil {
		t.Fatalf("el reintento de una venta que ya se hizo dio %v, se esperaba la venta", err)
	}
	if segunda.ID != primera.ID || !segunda.Total.Equal(primera.Total) {
		t.Fatalf("el reintento devolvio %+v, la venta fue %+v", segunda, primera)
	}
	m.exigirSoloLaPrimeraVenta(t, crc, vendeUnBTC.IdempotencyKey)

	// La misma llave con OTRA cantidad no es este reintento: contestarle con la
	// venta vieja seria decir "vendiste" por algo que no se pidio.
	otraCantidad := vendeUnBTC
	otraCantidad.Amount = d(0.5)
	if hecha, err := sinPrecio.Sell(ctx, m.userID, &otraCantidad); err == nil {
		t.Fatalf("la llave de una venta de 1 BTC contesto a una de 0,5 con %+v", hecha)
	}
	m.exigirSoloLaPrimeraVenta(t, crc, vendeUnBTC.IdempotencyKey)
}

// El reintento de una venta que llega con el precio ya movido devuelve la venta
// que se hizo, con lo que se acredito entonces. Antes se recalculaba con el
// precio nuevo antes de mirar la llave: si la pantalla todavia mostraba el
// precio viejo, el rechazo era PRICE_MOVED; si ya lo habia refrescado, el monto
// recalculado no coincidia con el de la llave y el rechazo era
// LLAVE_REUTILIZADA. En los dos casos la persona leia que su venta no se hizo.
func TestVender_ElReintentoConElPrecioMovidoDevuelveLaVentaHecha(t *testing.T) {
	for _, caso := range []struct {
		nombre           string
		precioEnPantalla float64
	}{
		{"con el precio viejo todavia en pantalla", 1000},
		{"con el precio nuevo ya en pantalla", 2000},
	} {
		t.Run(caso.nombre, func(t *testing.T) {
			m := montarVenta(t)
			ctx := context.Background()
			m.sembrar(t, "BTC", "Bitcoin", 3)

			pedido := vendeUnBTC
			primera, err := m.svc.Sell(ctx, m.userID, &pedido)
			if err != nil {
				t.Fatalf("la venta: %v", err)
			}
			crc, _ := m.billetera(t)

			// Un segundo servicio, porque el primero guarda el precio en cache y
			// no veria el cambio.
			conOtroPrecio := servicioDeVenta(t, m.pool, feedConPrecio(t, "bitcoin", 2000))
			precios, err := conOtroPrecio.GetPrices(ctx, []string{"BTC"})
			if err != nil || precios["BTC"] == nil || precios["BTC"].Price != 2000 {
				t.Fatalf("el segundo feed no cotiza BTC a 2000 (%v): la prueba no moveria el precio", err)
			}

			reintento := vendeUnBTC
			reintento.Price = d(caso.precioEnPantalla)
			segunda, err := conOtroPrecio.Sell(ctx, m.userID, &reintento)
			if err != nil {
				t.Fatalf("el reintento con el precio movido dio %v, se esperaba la venta", err)
			}
			if segunda.ID != primera.ID || !segunda.Total.Equal(primera.Total) {
				t.Fatalf("el reintento devolvio %+v, la venta fue %+v: recalculo con el precio nuevo",
					segunda, primera)
			}
			m.exigirSoloLaPrimeraVenta(t, crc, vendeUnBTC.IdempotencyKey)
		})
	}
}

// Los dos caminos de la comprobacion de cortesia: al reintento le sigue
// alcanzando el saldo (se convirtio una parte) o ya no (se convirtio todo). En
// el primero la llave ni siquiera se miraba antes de pedir el precio.
func TestConvertir_ElReintentoSinPrecioDevuelveLaConversionHecha(t *testing.T) {
	for _, caso := range []struct {
		nombre string
		tenia  float64
	}{
		{"se convirtio una parte", 3},
		{"se convirtio todo", 1},
	} {
		t.Run(caso.nombre, func(t *testing.T) {
			m := montarVenta(t)
			ctx := context.Background()
			m.sembrar(t, "BTC", "Bitcoin", caso.tenia)
			pedido := crypto.ConvertRequest{
				FromAsset: "BTC", ToAsset: "ETH", FromAmount: d(1), Price: d(1000),
				IdempotencyKey: "crypto:convert:toque-1",
			}
			quedan := caso.tenia - 1

			sinPrecio := servicioDeVenta(t, m.pool, feedSinPrecios(t))
			otra := pedido
			otra.IdempotencyKey = "crypto:convert:otro-toque"
			_, err := sinPrecio.Convert(ctx, m.userID, &otra)
			exigirSinPrecio(t, err)

			primera, err := m.svc.Convert(ctx, m.userID, &pedido)
			if err != nil {
				t.Fatalf("la conversion: %v", err)
			}

			reintento := pedido
			segunda, err := sinPrecio.Convert(ctx, m.userID, &reintento)
			if err != nil {
				t.Fatalf("el reintento de una conversion que ya se hizo dio %v, se esperaba la conversion", err)
			}
			if segunda.ID != primera.ID || !segunda.Total.Equal(primera.Total) {
				t.Fatalf("el reintento devolvio %+v, la conversion fue %+v", segunda, primera)
			}
			m.exigirSaldo(t, "BTC", quedan, "el reintento no convierte otra vez")
			m.exigirSaldo(t, "ETH", 1, "lo que llego es lo de la primera vez")
			if n := m.conversionesAnotadas(t); n != 1 {
				t.Fatalf("conversiones anotadas = %d, se esperaba 1", n)
			}

			// La misma llave con otra cantidad ya describe otra conversion, y
			// para saberlo no hace falta el precio.
			otraCantidad := pedido
			otraCantidad.FromAmount = d(0.5)
			if _, err := sinPrecio.Convert(ctx, m.userID, &otraCantidad); !errors.Is(err, crypto.ErrLlaveDeOtraOperacion) {
				t.Fatalf("la misma llave con otra cantidad dio %v, se esperaba ErrLlaveDeOtraOperacion", err)
			}
			m.exigirSaldo(t, "BTC", quedan, "la llave de otra conversion no convierte")
			m.exigirSaldo(t, "ETH", 1, "la llave de otra conversion no abona")
		})
	}
}

func TestEnviarCripto_ElReintentoSinPrecioDevuelveElEnvioHecho(t *testing.T) {
	e := montarEnvio(t)
	ctx := context.Background()
	pedido := crypto.SendRequest{
		Asset: "BTC", Amount: seEnvia, QRData: e.qrDelReceptor, Price: d(1000),
		IdempotencyKey: "crypto:send:toque-1",
	}
	quedan := d(1).Sub(bajaDelSaldo)

	sinPrecio := servicioDeEnvio(e.pool, feedSinPrecios(t), e)
	otro := pedido
	otro.IdempotencyKey = "crypto:send:otro-toque"
	_, err := sinPrecio.Send(ctx, e.quienEnvia, &otro)
	exigirSinPrecio(t, err)

	primero, err := e.svc.Send(ctx, e.quienEnvia, &pedido)
	if err != nil {
		t.Fatalf("el envio: %v", err)
	}

	reintento := pedido
	segundo, err := sinPrecio.Send(ctx, e.quienEnvia, &reintento)
	if err != nil {
		t.Fatalf("el reintento de un envio que ya se hizo dio %v, se esperaba el envio", err)
	}
	if segundo.ID != primero.ID || !segundo.Total.Equal(primero.Total) {
		t.Fatalf("el reintento devolvio %+v, el envio fue %+v", segundo, primero)
	}
	e.exigirSaldos(t, quedan, seEnvia)
	var envios int
	if err := e.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM crypto_transactions WHERE type = 'send'`).Scan(&envios); err != nil {
		t.Fatalf("contar envios: %v", err)
	}
	if envios != 1 {
		t.Fatalf("envios anotados = %d, se esperaba 1", envios)
	}
	if e.avisos.veces != 1 || e.uif.veces != 1 {
		t.Fatalf("avisos = %d y reportes a la UIF = %d, se esperaba 1 de cada uno: el reintento los repitio",
			e.avisos.veces, e.uif.veces)
	}

	// La misma llave con otra cantidad ya describe otro envio, y para saberlo
	// no hace falta el precio.
	otraCantidad := pedido
	otraCantidad.Amount = d(0.04)
	if _, err := sinPrecio.Send(ctx, e.quienEnvia, &otraCantidad); !errors.Is(err, crypto.ErrLlaveDeOtroEnvio) {
		t.Fatalf("la misma llave con otra cantidad dio %v, se esperaba ErrLlaveDeOtroEnvio", err)
	}
	e.exigirSaldos(t, quedan, seEnvia)
}
