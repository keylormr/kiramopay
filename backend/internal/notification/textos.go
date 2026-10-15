package notification

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// Los avisos y los push salian en espanol en cualquier idioma: cada modulo
// escribia su titulo y su cuerpo fijos. Ahora cada modulo dice QUE aviso es
// (una clave de este catalogo) y con que datos, y el aviso se escribe en el
// idioma que la cuenta tiene guardado (users.language, migracion 074).

// Idiomas son los de la app (src/i18n/translations.ts). El espanol es el de
// siempre: una cuenta sin idioma guardado, o con uno que la app no tiene,
// recibe los avisos en espanol.
var Idiomas = []string{"es", "en", "fr", "pt", "zh-cn", "ja", "hi"}

// IdiomaValido dice si la app tiene ese idioma, escrito como lo escribe ella.
func IdiomaValido(idioma string) bool {
	for _, i := range Idiomas {
		if i == idioma {
			return true
		}
	}
	return false
}

// Datos son los valores de un aviso. Un texto se escribe tal cual; una fecha
// (time.Time, ya en la zona en que se quiere mostrar) con el formato del
// idioma, y la fecha cero como "sin fecha".
type Datos = map[string]any

// Claves de los avisos. Cada modulo usa la suya; un error de tipeo no compila.
const (
	AvisoSinpeRecibido  = "sinpe_recibido"
	AvisoQRPagoRecibido = "qr_pago_recibido"
	AvisoCriptoRecibida = "cripto_recibida"
	// Con el nombre de quien envia, cuando se pudo leer.
	AvisoCriptoRecibidaDe  = "cripto_recibida_de"
	AvisoAlertaPrecioSubio = "alerta_precio_subio"
	AvisoAlertaPrecioBajo  = "alerta_precio_bajo"

	AvisoEscrowEntregaMarcada             = "escrow_entrega_marcada"
	AvisoEscrowEntregaPorVencerVendedor   = "escrow_entrega_por_vencer_vendedor"
	AvisoEscrowEntregaPorVencerComprador  = "escrow_entrega_por_vencer_comprador"
	AvisoEscrowRevisionPorVencerComprador = "escrow_revision_por_vencer_comprador"
	AvisoEscrowRevisionPorVencerVendedor  = "escrow_revision_por_vencer_vendedor"
	AvisoEscrowPagadoVendedor             = "escrow_pagado_vendedor"
	AvisoEscrowPagadoComprador            = "escrow_pagado_comprador"
	AvisoEscrowDevueltoComprador          = "escrow_devuelto_comprador"
	AvisoEscrowDevueltoVendedor           = "escrow_devuelto_vendedor"
)

type plantilla struct{ titulo, cuerpo string }

// catalogo tiene cada aviso en los siete idiomas. Las palabras son las de la
// app: el escrow es "pago protegido" fuera del espanol, como en su pantalla.
var catalogo = map[string]map[string]plantilla{
	AvisoSinpeRecibido: {
		"es":    {"SINPE recibido", "Recibiste {monto} por SINPE Móvil"},
		"en":    {"SINPE received", "You received {monto} via SINPE Móvil"},
		"fr":    {"SINPE reçu", "Vous avez reçu {monto} par SINPE Móvil"},
		"pt":    {"SINPE recebido", "Você recebeu {monto} por SINPE Móvil"},
		"zh-cn": {"已收到 SINPE 转账", "您通过 SINPE Móvil 收到 {monto}"},
		"ja":    {"SINPEを受け取りました", "SINPE Móvilで{monto}を受け取りました"},
		"hi":    {"SINPE प्राप्त हुआ", "आपको SINPE Móvil से {monto} प्राप्त हुए"},
	},
	// El cuerpo es el monto y la nota del cobro: no tiene palabras que traducir.
	AvisoQRPagoRecibido: {
		"es":    {"Pago recibido", "{detalle}"},
		"en":    {"Payment received", "{detalle}"},
		"fr":    {"Paiement reçu", "{detalle}"},
		"pt":    {"Pagamento recebido", "{detalle}"},
		"zh-cn": {"已收到付款", "{detalle}"},
		"ja":    {"支払いを受け取りました", "{detalle}"},
		"hi":    {"भुगतान प्राप्त हुआ", "{detalle}"},
	},
	AvisoCriptoRecibida: {
		"es":    {"Te enviaron cripto", "Recibiste {monto} {activo}"},
		"en":    {"You were sent crypto", "You received {monto} {activo}"},
		"fr":    {"Crypto reçue", "Vous avez reçu {monto} {activo}"},
		"pt":    {"Enviaram cripto para você", "Você recebeu {monto} {activo}"},
		"zh-cn": {"有人向您发送了加密货币", "您收到了 {monto} {activo}"},
		"ja":    {"暗号資産が届きました", "{monto} {activo}を受け取りました"},
		"hi":    {"आपको क्रिप्टो भेजा गया", "आपको {monto} {activo} प्राप्त हुए"},
	},
	AvisoCriptoRecibidaDe: {
		"es":    {"Te enviaron cripto", "Recibiste {monto} {activo} de {nombre}"},
		"en":    {"You were sent crypto", "You received {monto} {activo} from {nombre}"},
		"fr":    {"Crypto reçue", "Vous avez reçu {monto} {activo} de la part de {nombre}"},
		"pt":    {"Enviaram cripto para você", "Você recebeu {monto} {activo} de {nombre}"},
		"zh-cn": {"有人向您发送了加密货币", "您收到了来自 {nombre} 的 {monto} {activo}"},
		"ja":    {"暗号資産が届きました", "{nombre}さんから{monto} {activo}を受け取りました"},
		"hi":    {"आपको क्रिप्टो भेजा गया", "आपको {nombre} से {monto} {activo} प्राप्त हुए"},
	},
	// Sin montos: el texto sale en la pantalla de bloqueo (ver
	// crypto.avisoDeAlerta).
	AvisoAlertaPrecioSubio: {
		"es":    {"Alerta de precio: {activo}", "{activo} subió a tu precio objetivo. Abre KiramoPay para ver el detalle."},
		"en":    {"Price alert: {activo}", "{activo} rose to your target price. Open KiramoPay to see the details."},
		"fr":    {"Alerte de prix : {activo}", "{activo} est monté à votre prix cible. Ouvrez KiramoPay pour voir le détail."},
		"pt":    {"Alerta de preço: {activo}", "{activo} subiu até o seu preço-alvo. Abra o KiramoPay para ver os detalhes."},
		"zh-cn": {"价格提醒：{activo}", "{activo} 已涨至您的目标价格。打开 KiramoPay 查看详情。"},
		"ja":    {"価格アラート：{activo}", "{activo}が目標価格まで上昇しました。詳細はKiramoPayでご確認ください。"},
		"hi":    {"मूल्य अलर्ट: {activo}", "{activo} आपके लक्ष्य मूल्य तक बढ़ गया। विवरण देखने के लिए KiramoPay खोलें।"},
	},
	AvisoAlertaPrecioBajo: {
		"es":    {"Alerta de precio: {activo}", "{activo} bajó a tu precio objetivo. Abre KiramoPay para ver el detalle."},
		"en":    {"Price alert: {activo}", "{activo} fell to your target price. Open KiramoPay to see the details."},
		"fr":    {"Alerte de prix : {activo}", "{activo} est descendu à votre prix cible. Ouvrez KiramoPay pour voir le détail."},
		"pt":    {"Alerta de preço: {activo}", "{activo} caiu até o seu preço-alvo. Abra o KiramoPay para ver os detalhes."},
		"zh-cn": {"价格提醒：{activo}", "{activo} 已跌至您的目标价格。打开 KiramoPay 查看详情。"},
		"ja":    {"価格アラート：{activo}", "{activo}が目標価格まで下落しました。詳細はKiramoPayでご確認ください。"},
		"hi":    {"मूल्य अलर्ट: {activo}", "{activo} आपके लक्ष्य मूल्य तक गिर गया। विवरण देखने के लिए KiramoPay खोलें।"},
	},
	AvisoEscrowEntregaMarcada: {
		"es":    {"El vendedor marcó la entrega", "{descripcion}: {monto}. Tienes hasta el {limite} para liberar el pago o reclamar; si no haces nada, se le paga al vendedor."},
		"en":    {"The seller marked it as delivered", "{descripcion}: {monto}. You have until {limite} to release the payment or open a dispute; if you do nothing, the seller gets paid."},
		"fr":    {"Le vendeur a marqué la livraison", "{descripcion} : {monto}. Vous avez jusqu'au {limite} pour libérer le paiement ou ouvrir un litige ; sans action de votre part, le vendeur sera payé."},
		"pt":    {"O vendedor marcou a entrega", "{descripcion}: {monto}. Você tem até {limite} para liberar o pagamento ou abrir uma disputa; se não fizer nada, o vendedor será pago."},
		"zh-cn": {"卖方已标记交付", "{descripcion}：{monto}。您可在 {limite} 前放款或提出争议；如不操作，款项将支付给卖方。"},
		"ja":    {"販売者が納品済みにしました", "{descripcion}：{monto}。{limite}までに支払いを確定するか異議を申し立ててください。何もしない場合は販売者に支払われます。"},
		"hi":    {"विक्रेता ने डिलीवरी दर्ज की", "{descripcion}: {monto}. भुगतान जारी करने या विवाद खोलने के लिए आपके पास {limite} तक का समय है; कुछ न करने पर विक्रेता को भुगतान कर दिया जाएगा।"},
	},
	AvisoEscrowEntregaPorVencerVendedor: {
		"es":    {"Tu plazo de entrega está por vencer", "{descripcion} ({monto}): si no marcas la entrega antes del {limite}, se le devuelve el pago al comprador."},
		"en":    {"Your delivery deadline is about to expire", "{descripcion} ({monto}): if you don't mark it as delivered before {limite}, the payment goes back to the buyer."},
		"fr":    {"Votre délai de livraison arrive à échéance", "{descripcion} ({monto}) : si vous ne marquez pas la livraison avant le {limite}, le paiement sera rendu à l'acheteur."},
		"pt":    {"Seu prazo de entrega está para vencer", "{descripcion} ({monto}): se você não marcar a entrega até {limite}, o pagamento será devolvido ao comprador."},
		"zh-cn": {"您的交付期限即将到期", "{descripcion}（{monto}）：如果您未在 {limite} 前标记已交付，款项将退还给买方。"},
		"ja":    {"あなたの納品期限が近づいています", "{descripcion}（{monto}）：{limite}までに納品済みにしないと、代金は購入者に返金されます。"},
		"hi":    {"आपकी डिलीवरी की समय-सीमा खत्म होने वाली है", "{descripcion} ({monto}): यदि आप {limite} से पहले डिलीवरी दर्ज नहीं करते, तो भुगतान खरीदार को वापस कर दिया जाएगा।"},
	},
	AvisoEscrowEntregaPorVencerComprador: {
		"es":    {"El plazo de entrega está por vencer", "{descripcion} ({monto}): si el vendedor no marca la entrega antes del {limite}, se te devuelve el pago."},
		"en":    {"The delivery deadline is about to expire", "{descripcion} ({monto}): if the seller doesn't mark it as delivered before {limite}, your payment is returned to you."},
		"fr":    {"Le délai de livraison arrive à échéance", "{descripcion} ({monto}) : si le vendeur ne marque pas la livraison avant le {limite}, votre paiement vous sera rendu."},
		"pt":    {"O prazo de entrega está para vencer", "{descripcion} ({monto}): se o vendedor não marcar a entrega até {limite}, o pagamento será devolvido a você."},
		"zh-cn": {"交付期限即将到期", "{descripcion}（{monto}）：如果卖方未在 {limite} 前标记已交付，款项将退还给您。"},
		"ja":    {"販売者の納品期限が近づいています", "{descripcion}（{monto}）：販売者が{limite}までに納品済みにしないと、代金はあなたに返金されます。"},
		"hi":    {"डिलीवरी की समय-सीमा खत्म होने वाली है", "{descripcion} ({monto}): यदि विक्रेता {limite} से पहले डिलीवरी दर्ज नहीं करता, तो भुगतान आपको वापस कर दिया जाएगा।"},
	},
	AvisoEscrowRevisionPorVencerComprador: {
		"es":    {"Tu plazo para revisar está por vencer", "{descripcion} ({monto}): si no liberas el pago ni reclamas antes del {limite}, se le paga al vendedor."},
		"en":    {"Your review period is about to end", "{descripcion} ({monto}): if you don't release the payment or open a dispute before {limite}, the seller gets paid."},
		"fr":    {"Votre délai de vérification arrive à échéance", "{descripcion} ({monto}) : si vous ne libérez pas le paiement et n'ouvrez pas de litige avant le {limite}, le vendeur sera payé."},
		"pt":    {"Seu prazo para revisar está para vencer", "{descripcion} ({monto}): se você não liberar o pagamento nem abrir uma disputa até {limite}, o vendedor será pago."},
		"zh-cn": {"您的确认期限即将到期", "{descripcion}（{monto}）：如果您未在 {limite} 前放款或提出争议，款项将支付给卖方。"},
		"ja":    {"あなたの確認期限が近づいています", "{descripcion}（{monto}）：{limite}までに支払いを確定するか異議を申し立てないと、販売者に支払われます。"},
		"hi":    {"आपकी जाँच की समय-सीमा खत्म होने वाली है", "{descripcion} ({monto}): यदि आप {limite} से पहले भुगतान जारी नहीं करते या विवाद नहीं खोलते, तो विक्रेता को भुगतान कर दिया जाएगा।"},
	},
	AvisoEscrowRevisionPorVencerVendedor: {
		"es":    {"El plazo de revisión está por vencer", "{descripcion} ({monto}): si el comprador no reclama antes del {limite}, se te paga."},
		"en":    {"The review period is about to end", "{descripcion} ({monto}): if the buyer doesn't open a dispute before {limite}, you get paid."},
		"fr":    {"Le délai de vérification arrive à échéance", "{descripcion} ({monto}) : si l'acheteur n'ouvre pas de litige avant le {limite}, vous serez payé."},
		"pt":    {"O prazo de revisão está para vencer", "{descripcion} ({monto}): se o comprador não abrir uma disputa até {limite}, você será pago."},
		"zh-cn": {"确认期限即将到期", "{descripcion}（{monto}）：如果买方未在 {limite} 前提出争议，款项将支付给您。"},
		"ja":    {"購入者の確認期限が近づいています", "{descripcion}（{monto}）：購入者が{limite}までに異議を申し立てなければ、あなたに支払われます。"},
		"hi":    {"जाँच की समय-सीमा खत्म होने वाली है", "{descripcion} ({monto}): यदि खरीदार {limite} से पहले विवाद नहीं खोलता, तो आपको भुगतान कर दिया जाएगा।"},
	},
	AvisoEscrowPagadoVendedor: {
		"es":    {"Se te pagó un escrow", "{descripcion}: {monto}. El comprador no reclamó dentro del plazo."},
		"en":    {"You were paid for a protected payment", "{descripcion}: {monto}. The buyer didn't open a dispute in time."},
		"fr":    {"Un paiement protégé vous a été versé", "{descripcion} : {monto}. L'acheteur n'a pas ouvert de litige dans le délai."},
		"pt":    {"Você recebeu um pagamento protegido", "{descripcion}: {monto}. O comprador não abriu disputa dentro do prazo."},
		"zh-cn": {"一笔保障付款已支付给您", "{descripcion}：{monto}。买方未在期限内提出争议。"},
		"ja":    {"エスクローの代金が支払われました", "{descripcion}：{monto}。購入者が期限内に異議を申し立てませんでした。"},
		"hi":    {"आपको एक सुरक्षित भुगतान मिला", "{descripcion}: {monto}. खरीदार ने समय-सीमा में विवाद नहीं खोला।"},
	},
	AvisoEscrowPagadoComprador: {
		"es":    {"Se le pagó al vendedor", "{descripcion}: {monto}. Venció tu plazo para reclamar."},
		"en":    {"The seller was paid", "{descripcion}: {monto}. Your time to open a dispute ran out."},
		"fr":    {"Le vendeur a été payé", "{descripcion} : {monto}. Votre délai pour ouvrir un litige a expiré."},
		"pt":    {"O vendedor foi pago", "{descripcion}: {monto}. Seu prazo para abrir uma disputa venceu."},
		"zh-cn": {"款项已支付给卖方", "{descripcion}：{monto}。您提出争议的期限已过。"},
		"ja":    {"販売者に支払われました", "{descripcion}：{monto}。異議申立ての期限が過ぎました。"},
		"hi":    {"विक्रेता को भुगतान कर दिया गया", "{descripcion}: {monto}. विवाद खोलने की आपकी समय-सीमा समाप्त हो गई।"},
	},
	AvisoEscrowDevueltoComprador: {
		"es":    {"Se te devolvió un escrow", "{descripcion}: {monto}. El vendedor no marcó la entrega dentro del plazo."},
		"en":    {"A protected payment was returned to you", "{descripcion}: {monto}. The seller didn't mark it as delivered in time."},
		"fr":    {"Un paiement protégé vous a été rendu", "{descripcion} : {monto}. Le vendeur n'a pas marqué la livraison dans le délai."},
		"pt":    {"Um pagamento protegido foi devolvido a você", "{descripcion}: {monto}. O vendedor não marcou a entrega dentro do prazo."},
		"zh-cn": {"一笔保障付款已退还给您", "{descripcion}：{monto}。卖方未在期限内标记已交付。"},
		"ja":    {"エスクローの代金が返金されました", "{descripcion}：{monto}。販売者が期限内に納品済みにしませんでした。"},
		"hi":    {"एक सुरक्षित भुगतान आपको वापस कर दिया गया", "{descripcion}: {monto}. विक्रेता ने समय-सीमा में डिलीवरी दर्ज नहीं की।"},
	},
	AvisoEscrowDevueltoVendedor: {
		"es":    {"Se le devolvió el pago al comprador", "{descripcion}: {monto}. Venció tu plazo para marcar la entrega."},
		"en":    {"The payment was returned to the buyer", "{descripcion}: {monto}. Your time to mark it as delivered ran out."},
		"fr":    {"Le paiement a été rendu à l'acheteur", "{descripcion} : {monto}. Votre délai pour marquer la livraison a expiré."},
		"pt":    {"O pagamento foi devolvido ao comprador", "{descripcion}: {monto}. Seu prazo para marcar a entrega venceu."},
		"zh-cn": {"款项已退还给买方", "{descripcion}：{monto}。您标记交付的期限已过。"},
		"ja":    {"購入者に返金されました", "{descripcion}：{monto}。納品済みにする期限が過ぎました。"},
		"hi":    {"भुगतान खरीदार को वापस कर दिया गया", "{descripcion}: {monto}. डिलीवरी दर्ज करने की आपकी समय-सीमा समाप्त हो गई।"},
	},
}

// formatoDeFecha es el orden de la fecha y la hora de cada idioma, como los
// escribe la app (src/utils/periodos.ts, localeDe): dia/mes en espanol, mes/dia
// y 12 horas en ingles, ano/mes/dia en chino y japones.
var formatoDeFecha = map[string]struct{ layout, sinFecha string }{
	"es":    {"02/01/2006 a las 15:04", "(sin fecha)"},
	"en":    {"01/02/2006 at 3:04 PM", "(no date)"},
	"fr":    {"02/01/2006 à 15:04", "(sans date)"},
	"pt":    {"02/01/2006 às 15:04", "(sem data)"},
	"zh-cn": {"2006/01/02 15:04", "（无日期）"},
	"ja":    {"2006/01/02 15:04", "（日付なし）"},
	"hi":    {"02/01/2006, 3:04 PM", "(कोई तारीख नहीं)"},
}

// ClavesDeAvisos devuelve las claves del catalogo, ordenadas.
func ClavesDeAvisos() []string {
	claves := make([]string, 0, len(catalogo))
	for c := range catalogo {
		claves = append(claves, c)
	}
	sort.Strings(claves)
	return claves
}

// Texto devuelve el titulo y el cuerpo del aviso en el idioma pedido (en
// espanol si la app no tiene ese idioma), con cada {dato} reemplazado.
func Texto(clave, idioma string, datos Datos) (titulo, cuerpo string) {
	if !IdiomaValido(idioma) {
		idioma = "es"
	}
	porIdioma, ok := catalogo[clave]
	if !ok {
		// No pasa: las claves son constantes. Antes que un aviso con la clave
		// cruda, el nombre de la app.
		return "KiramoPay", ""
	}
	p, ok := porIdioma[idioma]
	if !ok {
		p = porIdioma["es"]
	}
	return llenar(p.titulo, idioma, datos), llenar(p.cuerpo, idioma, datos)
}

// Monto escribe el monto como lo muestra la app: simbolo y miles con coma, que
// es la regla del dueno para todos los montos. Todos los avisos lo usan: SINPE
// escribia "₡10000.00" y el cobro QR "CRC 500.00".
func Monto(minor int64, moneda string) string {
	simbolo := moneda + " "
	switch moneda {
	case "CRC":
		simbolo = "₡"
	case "USD":
		simbolo = "$"
	}
	signo := ""
	if minor < 0 {
		signo, minor = "-", -minor
	}
	enteros := fmt.Sprintf("%d", minor/100)
	var b strings.Builder
	for i, c := range enteros {
		if i > 0 && (len(enteros)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(c)
	}
	return fmt.Sprintf("%s%s%s.%02d", signo, simbolo, b.String(), minor%100)
}

// DatosQueFaltan dice que datos de la plantilla del aviso no vienen, o vienen
// de un tipo que el aviso no sabe escribir: los dos salen como texto vacio y
// nadie se entera. Es para las pruebas de cada productor. Una clave sin
// plantilla devuelve la clave misma.
func DatosQueFaltan(clave string, datos Datos) []string {
	porIdioma, ok := catalogo[clave]
	if !ok {
		return []string{clave}
	}
	vistos := map[string]bool{}
	var faltan []string
	for _, p := range porIdioma {
		for _, nombre := range append(nombresEn(p.titulo), nombresEn(p.cuerpo)...) {
			if vistos[nombre] {
				continue
			}
			vistos[nombre] = true
			switch datos[nombre].(type) {
			case string, time.Time:
			default:
				faltan = append(faltan, nombre)
			}
		}
	}
	sort.Strings(faltan)
	return faltan
}

// nombresEn son los {dato} de una plantilla.
func nombresEn(plantilla string) []string {
	var out []string
	resto := plantilla
	for {
		i := strings.IndexByte(resto, '{')
		if i < 0 {
			return out
		}
		j := strings.IndexByte(resto[i:], '}')
		if j < 0 {
			return out
		}
		out = append(out, resto[i+1:i+j])
		resto = resto[i+j+1:]
	}
}

// llenar reemplaza cada {dato} de la plantilla en una sola pasada: lo que se
// inserta no se vuelve a leer, asi que una descripcion escrita por la persona
// que diga "{monto}" queda tal cual.
func llenar(plantilla, idioma string, datos Datos) string {
	var b strings.Builder
	resto := plantilla
	for {
		i := strings.IndexByte(resto, '{')
		if i < 0 {
			b.WriteString(resto)
			return b.String()
		}
		j := strings.IndexByte(resto[i:], '}')
		if j < 0 {
			b.WriteString(resto)
			return b.String()
		}
		b.WriteString(resto[:i])
		nombre := resto[i+1 : i+j]
		b.WriteString(valor(datos[nombre], idioma))
		resto = resto[i+j+1:]
	}
}

func valor(v any, idioma string) string {
	switch x := v.(type) {
	case string:
		return x
	case time.Time:
		f := formatoDeFecha[idioma]
		if x.IsZero() {
			return f.sinFecha
		}
		return x.Format(f.layout)
	default:
		return ""
	}
}
