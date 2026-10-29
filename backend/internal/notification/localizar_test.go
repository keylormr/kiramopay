package notification_test

import (
	"strings"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/notification"
)

// Un aviso se guarda ya escrito, en el idioma que la cuenta tenia ese dia: los
// anteriores a la migracion 074 estan todos en espanol, y la persona que hoy usa
// la app en ingles los lee en espanol en la campana. Localizar reconoce un aviso
// del catalogo por su texto (en cualquiera de los siete idiomas) y lo vuelve a
// escribir en el idioma de quien lo lee. Lo que no reconoce no se toca: nunca
// inventa una traduccion.

// Cualquier aviso del catalogo, guardado en cualquier idioma, se lee igual que
// si se hubiera escrito en el idioma de quien lo lee.
func TestLocalizar_CadaAvisoEntreCadaParDeIdiomas(t *testing.T) {
	datos := datosCompletos()
	for _, clave := range notification.ClavesDeAvisos() {
		for _, guardado := range notification.Idiomas {
			titulo, cuerpo := notification.Texto(clave, guardado, datos)
			for _, destino := range notification.Idiomas {
				esperadoT, esperadoC := notification.Texto(clave, destino, datos)
				gotT, gotC, ok := notification.Localizar(titulo, cuerpo, destino)
				if !ok {
					t.Errorf("%s guardado en %s: no se reconocio (%q / %q)", clave, guardado, titulo, cuerpo)
					continue
				}
				if gotT != esperadoT || gotC != esperadoC {
					t.Errorf("%s de %s a %s:\n  se obtuvo   %q / %q\n  se esperaba %q / %q",
						clave, guardado, destino, gotT, gotC, esperadoT, esperadoC)
				}
			}
		}
	}
}

// Los textos de antes de la 074, tal como los escribia cada modulo: el monto sin
// miles ("₡1500.00"), el cobro QR con el monto y la nota.
func TestLocalizar_LosAvisosViejosEnEspanol(t *testing.T) {
	casos := []struct {
		nombre, idioma                 string
		titulo, cuerpo                 string
		esperadoTitulo, esperadoCuerpo string
	}{
		{
			"sinpe recibido", "en",
			"SINPE recibido", "Recibiste ₡1500.00 por SINPE Móvil",
			"SINPE received", "You received ₡1500.00 via SINPE Móvil",
		},
		{
			"cobro con QR: solo cambia el titulo", "en",
			"Pago recibido", "CRC 500.00 — mesa 4",
			"Payment received", "CRC 500.00 — mesa 4",
		},
		{
			"cripto recibida", "fr",
			"Te enviaron cripto", "Recibiste 0.50000000 BTC",
			"Crypto reçue", "Vous avez reçu 0.50000000 BTC",
		},
		{
			"alerta de precio", "pt",
			"Alerta de precio: ETH", "ETH bajó a tu precio objetivo. Abre KiramoPay para ver el detalle.",
			"Alerta de preço: ETH", "ETH caiu até o seu preço-alvo. Abra o KiramoPay para ver os detalhes.",
		},
		{
			"escrow: la descripcion trae sus propios dos puntos y parentesis", "en",
			"El plazo de entrega está por vencer", "Compra: bicicleta (usada) (₡25,000.00): si el vendedor no marca la entrega antes del 14/10/2026 a las 18:05, se te devuelve el pago.",
			"The delivery deadline is about to expire", "Compra: bicicleta (usada) (₡25,000.00): if the seller doesn't mark it as delivered before 10/14/2026 at 6:05 PM, your payment is returned to you.",
		},
		{
			"escrow cerrado, el monto y la descripcion se conservan", "ja",
			"Se te pagó un escrow", "Laptop: $1,200.00. El comprador no reclamó dentro del plazo.",
			"エスクローの代金が支払われました", "Laptop：$1,200.00。購入者が期限内に異議を申し立てませんでした。",
		},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			titulo, cuerpo, ok := notification.Localizar(c.titulo, c.cuerpo, c.idioma)
			if !ok {
				t.Fatalf("no se reconocio %q / %q", c.titulo, c.cuerpo)
			}
			if titulo != c.esperadoTitulo || cuerpo != c.esperadoCuerpo {
				t.Fatalf("se obtuvo %q / %q, se esperaba %q / %q", titulo, cuerpo, c.esperadoTitulo, c.esperadoCuerpo)
			}
		})
	}
}

// El plazo se guardo con el orden y la hora del idioma de ese dia; al cambiar de
// idioma se vuelve a escribir con los del nuevo, sin dejar el "a las" del
// espanol en medio de una frase en ingles.
func TestLocalizar_LaFechaDelPlazoCambiaDeFormato(t *testing.T) {
	limite := time.Date(2026, 10, 14, 18, 5, 0, 0, time.UTC)
	datos := notification.Datos{"descripcion": "Bicicleta", "monto": "₡25,000.00", "limite": limite}
	titulo, cuerpo := notification.Texto("escrow_entrega_marcada", "es", datos)

	_, enIngles, ok := notification.Localizar(titulo, cuerpo, "en")
	if !ok {
		t.Fatal("no se reconocio el aviso")
	}
	if want := "10/14/2026 at 6:05 PM"; !strings.Contains(enIngles, want) || strings.Contains(enIngles, "a las") {
		t.Fatalf("%q: esperaba la fecha %q y nada del espanol", enIngles, want)
	}
}

func TestLocalizar_SinFechaSeEscribeEnElIdiomaNuevo(t *testing.T) {
	datos := notification.Datos{"descripcion": "Bicicleta", "monto": "₡25,000.00", "limite": time.Time{}}
	titulo, cuerpo := notification.Texto("escrow_entrega_por_vencer_vendedor", "es", datos)

	_, enIngles, ok := notification.Localizar(titulo, cuerpo, "en")
	if !ok || !strings.Contains(enIngles, "(no date)") || strings.Contains(enIngles, "(sin fecha)") {
		t.Fatalf("ok=%v, %q: esperaba (no date)", ok, enIngles)
	}
}

// Cripto recibida con y sin remitente son dos avisos distintos que empiezan
// igual: el que lleva "de <nombre>" no se confunde con el otro.
func TestLocalizar_CriptoConYSinRemitente(t *testing.T) {
	_, conNombre, ok := notification.Localizar("Te enviaron cripto", "Recibiste 0.5 BTC de Ana Mora", "en")
	if !ok || conNombre != "You received 0.5 BTC from Ana Mora" {
		t.Fatalf("ok=%v, %q", ok, conNombre)
	}
	_, sinNombre, ok := notification.Localizar("Te enviaron cripto", "Recibiste 0.5 BTC", "en")
	if !ok || sinNombre != "You received 0.5 BTC" {
		t.Fatalf("ok=%v, %q", ok, sinNombre)
	}
}

func TestLocalizar_LoQueNoReconoceNoSeToca(t *testing.T) {
	casos := []struct{ nombre, titulo, cuerpo string }{
		{"un aviso que no esta en el catalogo", "Bienvenido a KiramoPay", "Gracias por registrarte"},
		{"el titulo es de un aviso y el cuerpo no", "SINPE recibido", "Recibiste algo distinto"},
		{"el cuerpo es de un aviso y el titulo no", "Otro titulo", "Recibiste ₡1,000.00 por SINPE Móvil"},
		{"vacio", "", ""},
		// Lo que la persona escribio en una nota no se confunde con una plantilla.
		{"texto de la persona", "Pago de la renta", "Recibiste ₡1,000.00 por SINPE Móvil, gracias"},
	}
	for _, c := range casos {
		t.Run(c.nombre, func(t *testing.T) {
			titulo, cuerpo, ok := notification.Localizar(c.titulo, c.cuerpo, "en")
			if ok {
				t.Fatalf("se reconocio %q / %q como %q / %q", c.titulo, c.cuerpo, titulo, cuerpo)
			}
			if titulo != c.titulo || cuerpo != c.cuerpo {
				t.Fatalf("devolvio %q / %q; sin reconocer tenia que devolver el original", titulo, cuerpo)
			}
		})
	}
}

// Un idioma que la app no tiene no cambia nada: el servidor no adivina.
func TestLocalizar_IdiomaQueLaAppNoTieneNoCambiaNada(t *testing.T) {
	for _, idioma := range []string{"", "xx", "EN", "de"} {
		titulo, cuerpo, ok := notification.Localizar("SINPE recibido", "Recibiste ₡1,000.00 por SINPE Móvil", idioma)
		if ok || titulo != "SINPE recibido" || cuerpo != "Recibiste ₡1,000.00 por SINPE Móvil" {
			t.Errorf("idioma %q: ok=%v, %q / %q", idioma, ok, titulo, cuerpo)
		}
	}
}

// El aviso que ya esta en el idioma pedido se reconoce y queda igual.
func TestLocalizar_ElQueYaEstaEnElIdiomaQuedaIgual(t *testing.T) {
	titulo, cuerpo, ok := notification.Localizar("SINPE received", "You received ₡1,000.00 via SINPE Móvil", "en")
	if !ok || titulo != "SINPE received" || cuerpo != "You received ₡1,000.00 via SINPE Móvil" {
		t.Fatalf("ok=%v, %q / %q", ok, titulo, cuerpo)
	}
}
