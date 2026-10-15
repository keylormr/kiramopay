package qrpayment

import (
	"encoding/csv"
	"fmt"
	"io"
	"math"
	"strconv"
	"time"
)

// ── Comision efectiva ────────────────────────────────────────────────────────

// ComisionEfectiva es la comision que se cobra en un pago hecho en `ahora`:
// mientras dure la promocion de entrada, la menor entre la comision del
// comercio y PromoEntradaBps; fuera de ella, la del comercio.
//
// La menor y no la de la promocion: si un administrador le fijo a un comercio
// una comision por debajo de 0,25 %, la promocion no se la puede subir.
// promo_hasta es exclusivo: en el instante exacto del vencimiento ya no aplica.
func ComisionEfectiva(commissionBps int, promoHasta *time.Time, ahora time.Time) int {
	if promoHasta != nil && ahora.Before(*promoHasta) {
		return min(commissionBps, PromoEntradaBps)
	}
	return commissionBps
}

// ── Ventana del reporte ──────────────────────────────────────────────────────

// ventanaReporte son los instantes que delimitan un reporte y su comparacion.
// Todos se expresan en la zona del cliente; SQL los recibe como instantes.
type ventanaReporte struct {
	dias          int
	desde, hasta  time.Time // [desde, hasta]: la ventana llega hasta ahora
	anteriorDesde time.Time // [anteriorDesde, anteriorHasta)
	anteriorHasta time.Time
}

// calcularVentana arma la ventana de `days` dias de calendario en la zona del
// cliente (tzOffsetMin: minutos al OESTE de UTC, como getTimezoneOffset() de
// JS), y la ventana anterior de igual longitud: la misma, corrida `days` dias
// hacia atras. Los limites fuera de rango vuelven a los de siempre: 30 dias y
// UTC.
func calcularVentana(ahora time.Time, days, tzOffsetMin int) ventanaReporte {
	if days <= 0 || days > 365 {
		days = 30
	}
	if tzOffsetMin < -840 || tzOffsetMin > 840 {
		tzOffsetMin = 0
	}
	zona := time.FixedZone("client", -tzOffsetMin*60)
	hasta := ahora.In(zona)
	desde := time.Date(hasta.Year(), hasta.Month(), hasta.Day(), 0, 0, 0, 0, zona).
		AddDate(0, 0, -(days - 1))
	return ventanaReporte{
		dias:          days,
		desde:         desde,
		hasta:         hasta,
		anteriorDesde: desde.AddDate(0, 0, -days),
		anteriorHasta: hasta.AddDate(0, 0, -days),
	}
}

const formatoDia = "2006-01-02"

// bomUTF8 es la marca de orden de bytes de UTF-8, escrita como bytes para que
// el archivo fuente no la contenga literal.
const bomUTF8 = "\xef\xbb\xbf"

// rotulosCSV son los textos del CSV del reporte en un idioma de la app: el
// encabezado, el nombre de cada seccion, el balde sin sucursal o sin cobrador
// y el nombre del archivo. Salian en espanol en cualquier idioma.
type rotulosCSV struct {
	encabezado                                      [9]string
	dia, sucursal, cobrador, total, anterior, vacio string
	// archivo arma el nombre del archivo con las dos fechas. Solo ASCII: va en
	// la cabecera Content-Disposition.
	archivo string
}

// rotulosPorIdioma tiene los siete idiomas de la app (src/i18n/translations.ts).
// El espanol es el de siempre: un CSV sin lang sale igual que antes.
var rotulosPorIdioma = map[string]rotulosCSV{
	"es": {
		encabezado: [9]string{"seccion", "desde", "hasta", "clave", "nombre", "bruto", "comision", "neto", "cobros"},
		dia:        "dia", sucursal: "sucursal", cobrador: "cobrador", total: "total", anterior: "periodo_anterior",
		vacio: "(sin asignar)", archivo: "reporte-%s-a-%s.csv",
	},
	"en": {
		encabezado: [9]string{"section", "from", "to", "key", "name", "gross", "fee", "net", "payments"},
		dia:        "day", sucursal: "location", cobrador: "collector", total: "total", anterior: "previous_period",
		vacio: "(unassigned)", archivo: "report-%s-to-%s.csv",
	},
	"fr": {
		encabezado: [9]string{"section", "du", "au", "cle", "nom", "brut", "commission", "net", "encaissements"},
		dia:        "jour", sucursal: "succursale", cobrador: "encaisseur", total: "total", anterior: "periode_precedente",
		vacio: "(non attribué)", archivo: "rapport-%s-au-%s.csv",
	},
	"pt": {
		encabezado: [9]string{"secao", "de", "ate", "chave", "nome", "bruto", "comissao", "liquido", "cobrancas"},
		dia:        "dia", sucursal: "filial", cobrador: "cobrador", total: "total", anterior: "periodo_anterior",
		vacio: "(não atribuído)", archivo: "relatorio-%s-a-%s.csv",
	},
	"zh-cn": {
		encabezado: [9]string{"分组", "开始", "结束", "标识", "名称", "总额", "手续费", "净额", "笔数"},
		dia:        "日", sucursal: "门店", cobrador: "收款员", total: "合计", anterior: "上一周期",
		vacio: "(未分配)", archivo: "report-%s-to-%s.csv",
	},
	"ja": {
		encabezado: [9]string{"区分", "開始", "終了", "キー", "名前", "総額", "手数料", "純額", "件数"},
		dia:        "日", sucursal: "店舗", cobrador: "担当者", total: "合計", anterior: "前の期間",
		vacio: "(未割り当て)", archivo: "report-%s-to-%s.csv",
	},
	"hi": {
		encabezado: [9]string{"खंड", "से", "तक", "कुंजी", "नाम", "सकल", "शुल्क", "शुद्ध", "भुगतान"},
		dia:        "दिन", sucursal: "शाखा", cobrador: "संग्रहकर्ता", total: "कुल", anterior: "पिछली_अवधि",
		vacio: "(असाइन नहीं)", archivo: "report-%s-to-%s.csv",
	},
}

// rotulosDe devuelve los rotulos del idioma pedido; uno vacio o que la app no
// tiene, los de espanol.
func rotulosDe(idioma string) rotulosCSV {
	if r, ok := rotulosPorIdioma[idioma]; ok {
		return r
	}
	return rotulosPorIdioma["es"]
}

// NombreDelReporteCSV es el nombre del archivo del reporte en el idioma pedido.
func NombreDelReporteCSV(rep *MerchantReport, idioma string) string {
	return fmt.Sprintf(rotulosDe(idioma).archivo, rep.From, rep.To)
}

// compararTotales arma la comparacion entre la ventana actual y la anterior.
func compararTotales(v ventanaReporte, actual, anterior ReportBucket) *ReportComparison {
	return &ReportComparison{
		PreviousFrom:   v.anteriorDesde.Format(formatoDia),
		PreviousTo:     v.anteriorHasta.Format(formatoDia),
		PreviousTotals: anterior,
		Delta: ReportDelta{
			Gross:    actual.Gross - anterior.Gross,
			Fee:      actual.Fee - anterior.Fee,
			Net:      actual.Net - anterior.Net,
			Count:    actual.Count - anterior.Count,
			GrossPct: variacionPct(actual.Gross, anterior.Gross),
			NetPct:   variacionPct(actual.Net, anterior.Net),
			CountPct: variacionPct(int64(actual.Count), int64(anterior.Count)),
		},
	}
}

// variacionPct es la variacion porcentual con dos decimales. nil cuando el
// valor anterior es 0: "subio infinito por ciento" no es un dato.
func variacionPct(actual, anterior int64) *float64 {
	if anterior == 0 {
		return nil
	}
	v := math.Round(float64(actual-anterior)*10000/float64(anterior)) / 100
	return &v
}

// ── Exportacion CSV ──────────────────────────────────────────────────────────

// EscribirReporteCSV escribe el reporte en CSV para abrirlo en una hoja de
// calculo: una fila por dia, por sucursal y por cobrador, el total del
// periodo y, si hay comparacion, el total del periodo anterior.
//
// Los montos van en unidades (colones con dos decimales), no en centimos: el
// archivo lo lee una persona. Empieza con la marca de orden de bytes de UTF-8
// para que la hoja de calculo no rompa las tildes de los nombres.
//
// Los nombres de sucursal y de cobrador los escribe cualquiera (el dueno, o la
// persona al registrarse), y una hoja de calculo ejecuta como formula la celda
// que empieza con = + - @, tabulador o retorno de carro. Toda celda pasa por
// celdaSegura antes de escribirse.
func EscribirReporteCSV(w io.Writer, rep *MerchantReport) error {
	return EscribirReporteCSVEnIdioma(w, rep, "es")
}

// EscribirReporteCSVEnIdioma escribe el mismo CSV con los rotulos del idioma
// de la app (ver rotulosPorIdioma). Las columnas, su orden y los montos no
// cambian.
func EscribirReporteCSVEnIdioma(w io.Writer, rep *MerchantReport, idioma string) error {
	rot := rotulosDe(idioma)
	if _, err := io.WriteString(w, bomUTF8); err != nil {
		return err
	}
	cw := csv.NewWriter(w)
	fila := func(celdas ...string) {
		for i := range celdas {
			celdas[i] = celdaSegura(celdas[i])
		}
		_ = cw.Write(celdas) // el error queda en cw.Error(), que se revisa al final
	}
	montos := func(b ReportBucket) []string {
		return []string{monto(b.Gross), monto(b.Fee), monto(b.Net), strconv.Itoa(b.Count)}
	}

	fila(rot.encabezado[:]...)
	for _, d := range rep.Daily {
		fila(append([]string{rot.dia, d.Date, d.Date, "", ""},
			monto(d.Gross), monto(d.Fee), monto(d.Net), strconv.Itoa(d.Count))...)
	}
	for _, b := range rep.ByLocation {
		fila(append([]string{rot.sucursal, rep.From, rep.To, b.Key, nombreOVacio(b.Label, rot)}, montos(b)...)...)
	}
	for _, b := range rep.ByCollector {
		fila(append([]string{rot.cobrador, rep.From, rep.To, b.Key, nombreOVacio(b.Label, rot)}, montos(b)...)...)
	}
	fila(append([]string{rot.total, rep.From, rep.To, "", ""}, montos(rep.Totals)...)...)
	if c := rep.Comparison; c != nil {
		fila(append([]string{rot.anterior, c.PreviousFrom, c.PreviousTo, "", ""}, montos(c.PreviousTotals)...)...)
	}

	cw.Flush()
	return cw.Error()
}

// celdaSegura neutraliza la inyeccion de formulas: si la celda empieza con un
// caracter que la hoja de calculo interpreta como inicio de formula, se le
// antepone un apostrofo, que la hoja muestra como texto y no ejecuta. Lo demas
// (comillas, comas, saltos de linea) lo resuelve el escritor de CSV.
func celdaSegura(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + s
	}
	return s
}

// monto pasa centimos a unidades con dos decimales, sin punto flotante.
func monto(centimos int64) string {
	signo := ""
	if centimos < 0 {
		signo = "-"
		centimos = -centimos
	}
	return fmt.Sprintf("%s%d.%02d", signo, centimos/100, centimos%100)
}

// nombreOVacio rotula el balde de ventas sin sucursal o sin cobrador.
func nombreOVacio(nombre string, rot rotulosCSV) string {
	if nombre == "" {
		return rot.vacio
	}
	return nombre
}
