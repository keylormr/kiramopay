package transaction

import (
	"errors"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

// El mes de "gastado este mes" es el mes calendario de Costa Rica: el mismo
// corte de dias que usa el resumen (ZonaResumen) y la tarjeta del Inicio. Un
// gasto de las 8 p. m. del ultimo dia del mes ya es del mes siguiente en UTC,
// y contarlo con el reloj del servidor lo pasaria al mes equivocado.
func TestRangoDelMes(t *testing.T) {
	tokio := time.FixedZone("Asia/Tokyo", 9*3600)
	casos := []struct {
		nombre     string
		ahora      time.Time
		mesesAtras int
		desde      string
		hasta      string
	}{
		{"a media manana de Costa Rica", time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC), 0, "2026-10-01", "2026-11-01"},
		{"8 p. m. del ultimo dia: en UTC ya es noviembre", time.Date(2026, 11, 1, 2, 0, 0, 0, time.UTC), 0, "2026-10-01", "2026-11-01"},
		{"9 p. m. del ultimo dia de septiembre", time.Date(2026, 10, 1, 3, 0, 0, 0, time.UTC), 0, "2026-09-01", "2026-10-01"},
		{"la medianoche exacta de Costa Rica ya es el mes nuevo", time.Date(2026, 11, 1, 6, 0, 0, 0, time.UTC), 0, "2026-11-01", "2026-12-01"},
		{"un segundo antes de esa medianoche", time.Date(2026, 11, 1, 5, 59, 59, 0, time.UTC), 0, "2026-10-01", "2026-11-01"},
		{"un instante dado en otra zona se lleva a Costa Rica", time.Date(2026, 11, 1, 10, 0, 0, 0, tokio), 0, "2026-10-01", "2026-11-01"},
		{"el mes pasado", time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC), 1, "2026-09-01", "2026-10-01"},
		{"el mes pasado en enero cruza de ano", time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC), 1, "2025-12-01", "2026-01-01"},
		{"el mes pasado de marzo en ano bisiesto", time.Date(2028, 3, 10, 12, 0, 0, 0, time.UTC), 1, "2028-02-01", "2028-03-01"},
		{"diciembre cierra en enero del ano siguiente", time.Date(2026, 12, 20, 12, 0, 0, 0, time.UTC), 0, "2026-12-01", "2027-01-01"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			got, err := RangoDelMes(c.ahora, c.mesesAtras)
			if err != nil {
				t.Fatalf("RangoDelMes: %v", err)
			}
			if got.Desde != c.desde || got.Hasta != c.hasta {
				t.Errorf("rango = %s a %s, quiero %s a %s", got.Desde, got.Hasta, c.desde, c.hasta)
			}
			// Los bordes como instantes los arma ParseRangoResumen: el rango del
			// mes tiene que ser exactamente el que armaria una peticion normal
			// al resumen, no una copia que se pueda desviar.
			esperado, err := ParseRangoResumen(c.desde, c.hasta)
			if err != nil {
				t.Fatalf("ParseRangoResumen: %v", err)
			}
			if !got.Inicio.Equal(esperado.Inicio) || !got.Fin.Equal(esperado.Fin) || got.DesfaseSegundos != esperado.DesfaseSegundos {
				t.Errorf("los bordes no coinciden con los de ParseRangoResumen: %+v contra %+v", got, esperado)
			}
		})
	}
}

func TestRangoDelMes_MesesAtrasNegativoEsError(t *testing.T) {
	_, err := RangoDelMes(time.Date(2026, 10, 28, 15, 0, 0, 0, time.UTC), -1)
	if !errors.Is(err, ErrRangoResumen) {
		t.Fatalf("err = %v, quiero ErrRangoResumen", err)
	}
}

// Que cuenta como ingreso en las pantallas: la tarjeta "Gastado este mes" del
// Inicio y el analisis suman como gasto TODO lo que no es ingreso, y el
// asistente tiene que sumar lo mismo para no contestar otra cifra.
func TestEsIngresoEnPantalla(t *testing.T) {
	ingresos := []string{
		"sinpe_receive", "qr_receive", "deposit", "p2p_receive", "refund", "crypto_sell",
		"savings_withdraw", "escrow_receive", "escrow_refund", "loyalty_cashback",
		// El reembolso de un retiro rechazado: la plata vuelve a la billetera.
		// Salia como gasto en el Inicio ("todo lo demas es salida").
		"payout_refund",
	}
	for _, tipo := range ingresos {
		if !EsIngresoEnPantalla(tipo) {
			t.Errorf("%s deberia ser ingreso", tipo)
		}
	}
	gastos := []string{
		"sinpe_send", "qr_payment", "bill_payment", "recharge", "withdrawal", "p2p_send",
		"crypto_buy", "crypto_send", "escrow_fund", "payout_sent", "marketplace", "savings_deposit",
		// merchant_withdrawal la cuenta la UIF como entrada (EsEntrada) pero la
		// aplicacion la cuenta como salida: aqui manda la aplicacion, porque lo
		// que se compara es la cifra que la persona ve en pantalla.
		"merchant_withdrawal",
		"un_tipo_que_no_existe",
	}
	for _, tipo := range gastos {
		if EsIngresoEnPantalla(tipo) {
			t.Errorf("%s no deberia ser ingreso", tipo)
		}
	}
}

// La clasificacion vive dos veces: aqui y en INCOMING_TYPES del adaptador del
// front (src/api/adapters/http/transaction.http.ts). Si una cambia sin la otra,
// el asistente y la pantalla vuelven a contar dinero distinto sin que nada
// falle. Esta prueba lee el archivo del front y compara los dos conjuntos.
func TestTiposDeIngresoEnPantalla_SonLosDelFront(t *testing.T) {
	const ruta = "../../../src/api/adapters/http/transaction.http.ts"
	crudo, err := os.ReadFile(ruta)
	if err != nil {
		t.Fatalf("no se pudo leer el adaptador del front (%s): %v", ruta, err)
	}
	fuente := string(crudo)
	inicio := strings.Index(fuente, "const INCOMING_TYPES = new Set([")
	if inicio < 0 {
		t.Fatal("no encuentro INCOMING_TYPES en el adaptador del front")
	}
	cuerpo := fuente[inicio:]
	cuerpo = cuerpo[:strings.Index(cuerpo, "]);")]

	var delFront []string
	comillas := regexp.MustCompile(`'([a-z0-9_]+)'`)
	for _, linea := range strings.Split(cuerpo, "\n") {
		if i := strings.Index(linea, "//"); i >= 0 {
			linea = linea[:i]
		}
		for _, m := range comillas.FindAllStringSubmatch(linea, -1) {
			delFront = append(delFront, m[1])
		}
	}
	delBackend := append([]string(nil), TiposDeIngresoEnPantalla...)
	sort.Strings(delFront)
	sort.Strings(delBackend)
	if strings.Join(delFront, ",") != strings.Join(delBackend, ",") {
		t.Errorf("TiposDeIngresoEnPantalla = %v, INCOMING_TYPES del front = %v", delBackend, delFront)
	}
}
