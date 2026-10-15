package notification_test

import (
	"strings"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/notification"
)

// Los avisos y los push salian en espanol en cualquier idioma: cada modulo
// escribia su titulo y su cuerpo fijos. Ahora salen de un catalogo con los siete
// idiomas de la app y se escriben en el de quien los recibe.

// datosCompletos tiene un valor para cada dato que usa algun aviso, todos
// distintos entre si para poder buscarlos en el texto.
func datosCompletos() notification.Datos {
	return notification.Datos{
		"monto":       "₡12,345.67",
		"activo":      "BTC",
		"nombre":      "Ana Mora",
		"descripcion": "Bicicleta usada",
		"detalle":     "CRC 500.00 — mesa 4",
		"limite":      time.Date(2026, 10, 14, 18, 5, 0, 0, time.UTC),
	}
}

func TestTextos_CadaAvisoEnLosSieteIdiomas(t *testing.T) {
	if len(notification.Idiomas) != 7 {
		t.Fatalf("la app tiene siete idiomas, el catalogo dice %d: %v", len(notification.Idiomas), notification.Idiomas)
	}
	claves := notification.ClavesDeAvisos()
	if len(claves) == 0 {
		t.Fatal("el catalogo no tiene avisos")
	}
	datos := datosCompletos()
	for _, clave := range claves {
		esTitulo, esCuerpo := notification.Texto(clave, "es", datos)
		for _, idioma := range notification.Idiomas {
			titulo, cuerpo := notification.Texto(clave, idioma, datos)
			if strings.TrimSpace(titulo) == "" || strings.TrimSpace(cuerpo) == "" {
				t.Errorf("%s en %s: titulo %q, cuerpo %q", clave, idioma, titulo, cuerpo)
				continue
			}
			// Ningun hueco sin llenar: un {monto} que llega asi al telefono.
			for _, texto := range []string{titulo, cuerpo} {
				if strings.ContainsAny(texto, "{}") {
					t.Errorf("%s en %s quedo con un hueco sin llenar: %q", clave, idioma, texto)
				}
			}
			// Cada dato que el espanol muestra lo muestra tambien el idioma: una
			// traduccion que pierde el monto o la descripcion dice menos.
			for nombre, valor := range datos {
				s, ok := valor.(string)
				if !ok {
					continue
				}
				enEspanol := strings.Contains(esTitulo+esCuerpo, s)
				if enEspanol && !strings.Contains(titulo+cuerpo, s) {
					t.Errorf("%s en %s perdio el dato %s (%q)", clave, idioma, nombre, s)
				}
			}
			// Y no es el espanol con otra etiqueta.
			if idioma != "es" && titulo == esTitulo {
				t.Errorf("%s en %s tiene el mismo titulo que en espanol: %q", clave, idioma, titulo)
			}
		}
	}
}

func TestTextos_SinpeRecibidoEnIngles(t *testing.T) {
	titulo, cuerpo := notification.Texto("sinpe_recibido", "en", notification.Datos{"monto": "₡10,000.00"})
	if titulo != "SINPE received" {
		t.Fatalf("titulo en ingles = %q", titulo)
	}
	if cuerpo != "You received ₡10,000.00 via SINPE Móvil" {
		t.Fatalf("cuerpo en ingles = %q", cuerpo)
	}
	titulo, cuerpo = notification.Texto("sinpe_recibido", "es", notification.Datos{"monto": "₡10,000.00"})
	if titulo != "SINPE recibido" || cuerpo != "Recibiste ₡10,000.00 por SINPE Móvil" {
		t.Fatalf("en espanol = %q / %q, se esperaba el texto de siempre", titulo, cuerpo)
	}
}

// Una cuenta sin idioma guardado, o con uno que la app ya no tiene, recibe el
// espanol de siempre.
func TestTextos_IdiomaDesconocidoSaleEnEspanol(t *testing.T) {
	esT, esC := notification.Texto("sinpe_recibido", "es", notification.Datos{"monto": "₡1.00"})
	for _, idioma := range []string{"", "xx", "EN", "de"} {
		titulo, cuerpo := notification.Texto("sinpe_recibido", idioma, notification.Datos{"monto": "₡1.00"})
		if titulo != esT || cuerpo != esC {
			t.Errorf("idioma %q: %q / %q, se esperaba el espanol", idioma, titulo, cuerpo)
		}
	}
}

// La fecha del plazo va con el orden y la hora de cada idioma, como la muestra
// la app: 14/10 en espanol, 10/14 y 6:05 PM en ingles, 2026/10/14 en japones.
func TestTextos_LaFechaDelPlazoVaEnElFormatoDelIdioma(t *testing.T) {
	limite := time.Date(2026, 10, 14, 18, 5, 0, 0, time.UTC)
	datos := notification.Datos{"descripcion": "Bicicleta", "monto": "₡1.00", "limite": limite}
	casos := map[string]string{
		"es":    "14/10/2026 a las 18:05",
		"en":    "10/14/2026 at 6:05 PM",
		"fr":    "14/10/2026 à 18:05",
		"pt":    "14/10/2026 às 18:05",
		"zh-cn": "2026/10/14 18:05",
		"ja":    "2026/10/14 18:05",
		"hi":    "14/10/2026, 6:05 PM",
	}
	for idioma, fecha := range casos {
		_, cuerpo := notification.Texto("escrow_entrega_por_vencer_vendedor", idioma, datos)
		if !strings.Contains(cuerpo, fecha) {
			t.Errorf("%s: %q no trae la fecha %q", idioma, cuerpo, fecha)
		}
	}
}

func TestTextos_IdiomaValido(t *testing.T) {
	for _, idioma := range []string{"es", "en", "fr", "pt", "zh-cn", "ja", "hi"} {
		if !notification.IdiomaValido(idioma) {
			t.Errorf("%q es un idioma de la app", idioma)
		}
	}
	for _, idioma := range []string{"", "xx", "EN", "zh", "es-CR"} {
		if notification.IdiomaValido(idioma) {
			t.Errorf("%q no es un idioma de la app", idioma)
		}
	}
}

// Los avisos escriben el monto como la app: simbolo y miles con coma, que es
// la regla del dueno para todos los montos. SINPE mandaba "₡10000.00" y el
// cobro QR "CRC 500.00"; solo los de pagos protegidos lo hacian bien.
func TestMonto(t *testing.T) {
	casos := map[string]struct {
		minor  int64
		moneda string
	}{
		"₡12,500.00":    {1_250_000, "CRC"},
		"₡1,234,567.89": {123_456_789, "CRC"},
		"₡0.99":         {99, "CRC"},
		"$25.00":        {2_500, "USD"},
		"$1,000.00":     {100_000, "USD"},
		"EUR 10.50":     {1_050, "EUR"},
		"-₡5.00":        {-500, "CRC"},
	}
	for want, c := range casos {
		if got := notification.Monto(c.minor, c.moneda); got != want {
			t.Errorf("Monto(%d, %s) = %q, se esperaba %q", c.minor, c.moneda, got, want)
		}
	}
}

// Un dato que el productor no manda (o manda con otro nombre) salia como texto
// vacio dentro del aviso. DatosQueFaltan lo dice, para que las pruebas de cada
// productor lo vean.
func TestDatosQueFaltan(t *testing.T) {
	if f := notification.DatosQueFaltan(notification.AvisoSinpeRecibido, notification.Datos{"monto": "₡1.00"}); len(f) != 0 {
		t.Fatalf("con el monto no falta nada, dijo %v", f)
	}
	f := notification.DatosQueFaltan(notification.AvisoSinpeRecibido, notification.Datos{"monto ": "₡1.00"})
	if len(f) != 1 || f[0] != "monto" {
		t.Fatalf("con la clave mal escrita falta el monto, dijo %v", f)
	}
	// Un valor de un tipo que el aviso no sabe escribir tambien sale vacio.
	f = notification.DatosQueFaltan(notification.AvisoSinpeRecibido, notification.Datos{"monto": 1000})
	if len(f) != 1 || f[0] != "monto" {
		t.Fatalf("un monto que no es texto sale vacio, dijo %v", f)
	}
	if f := notification.DatosQueFaltan("no_existe", nil); len(f) == 0 {
		t.Fatal("una clave sin plantilla no puede pasar como completa")
	}
}
