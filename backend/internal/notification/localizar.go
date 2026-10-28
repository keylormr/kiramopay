package notification

import (
	"regexp"
	"strings"
	"time"
)

// Un aviso se guarda ya escrito, en el idioma que la cuenta tenia ese dia: los
// anteriores a la migracion 074 estan todos en espanol, y quien hoy usa la app
// en ingles los lee en espanol en la campana. Localizar reconoce un aviso del
// catalogo por su texto, en cualquiera de los siete idiomas, y lo vuelve a
// escribir en el idioma de quien lo lee. Es una vista: lo guardado no cambia.
//
// Lo que no reconoce no se toca. Un texto que la persona escribio (una nota, una
// descripcion) nunca se confunde con una plantilla porque el reconocimiento pide
// el texto completo, sin sobrantes antes ni despues.

// datosDeFecha son los datos del catalogo que se guardaron como fecha y hora con
// el formato del idioma de ese dia: al cambiar de idioma se vuelven a escribir
// con el del nuevo, en vez de dejar el "a las" del espanol en una frase en ingles.
var datosDeFecha = map[string]bool{"limite": true}

// reconocible es una plantilla del catalogo, en un idioma, lista para reconocer
// un texto ya escrito y sacarle los datos con que se escribio.
type reconocible struct {
	clave, idioma                string
	titulo, cuerpo               *regexp.Regexp
	nombresTitulo, nombresCuerpo []string
	// Cuanto texto fijo tiene: entre dos plantillas que reconocen el mismo
	// texto (el aviso de cripto con remitente y el de sin remitente empiezan
	// igual), gana la que tiene mas texto fijo, que es la mas especifica.
	fijo int
}

var reconocibles = armarReconocibles()

func armarReconocibles() []reconocible {
	var out []reconocible
	for _, clave := range ClavesDeAvisos() {
		for _, idioma := range Idiomas {
			p, ok := catalogo[clave][idioma]
			if !ok {
				continue
			}
			tituloRe, nombresT, fijoT := aExpresion(p.titulo)
			cuerpoRe, nombresC, fijoC := aExpresion(p.cuerpo)
			out = append(out, reconocible{
				clave: clave, idioma: idioma,
				titulo: tituloRe, cuerpo: cuerpoRe,
				nombresTitulo: nombresT, nombresCuerpo: nombresC,
				fijo: fijoT + fijoC,
			})
		}
	}
	return out
}

// aExpresion vuelve una plantilla ("Recibiste {monto} por SINPE Móvil") una
// expresion que reconoce el texto completo y captura cada {dato}, en orden. Devuelve
// los nombres de los datos y cuantos caracteres fijos tiene.
func aExpresion(plantilla string) (*regexp.Regexp, []string, int) {
	var b strings.Builder
	var nombres []string
	fijo := 0
	b.WriteString(`(?s)^`)
	resto := plantilla
	for {
		i := strings.IndexByte(resto, '{')
		j := -1
		if i >= 0 {
			j = strings.IndexByte(resto[i:], '}')
		}
		if i < 0 || j < 0 {
			b.WriteString(regexp.QuoteMeta(resto))
			fijo += len([]rune(resto))
			break
		}
		b.WriteString(regexp.QuoteMeta(resto[:i]))
		fijo += len([]rune(resto[:i]))
		nombres = append(nombres, resto[i+1:i+j])
		// Perezoso: el dato termina en el primer texto fijo que sigue.
		b.WriteString(`(.+?)`)
		resto = resto[i+j+1:]
	}
	b.WriteString(`$`)
	return regexp.MustCompile(b.String()), nombres, fijo
}

// datosDe lee los datos de un texto contra su expresion. Si un dato aparece en
// mas de un lugar (el activo, en el titulo y en el cuerpo de la alerta de
// precio), tiene que ser el mismo en todos.
func datosDe(re *regexp.Regexp, nombres []string, texto string, acumulado map[string]string) bool {
	m := re.FindStringSubmatch(texto)
	if m == nil {
		return false
	}
	for i, nombre := range nombres {
		if previo, ok := acumulado[nombre]; ok && previo != m[i+1] {
			return false
		}
		acumulado[nombre] = m[i+1]
	}
	return true
}

// fechaGuardada devuelve la fecha que estaba escrita con el formato del idioma
// en que se guardo, o la fecha cero si decia "sin fecha". ok es false si no se
// puede leer, y el texto se conserva tal cual.
func fechaGuardada(texto, idioma string) (time.Time, bool) {
	f := formatoDeFecha[idioma]
	if texto == f.sinFecha {
		return time.Time{}, true
	}
	t, err := time.Parse(f.layout, texto)
	return t, err == nil
}

// Localizar vuelve a escribir en el idioma pedido un aviso del catalogo que se
// guardo en otro. ok dice si lo reconocio: si no, o si el idioma no es uno de la
// app, devuelve el titulo y el cuerpo que recibio, sin cambios.
func Localizar(titulo, cuerpo, idioma string) (string, string, bool) {
	if !IdiomaValido(idioma) {
		return titulo, cuerpo, false
	}

	var mejor *reconocible
	var mejorDatos map[string]string
	for i := range reconocibles {
		r := &reconocibles[i]
		if mejor != nil && r.fijo <= mejor.fijo {
			continue
		}
		datos := map[string]string{}
		if !datosDe(r.titulo, r.nombresTitulo, titulo, datos) || !datosDe(r.cuerpo, r.nombresCuerpo, cuerpo, datos) {
			continue
		}
		mejor, mejorDatos = r, datos
	}
	if mejor == nil {
		return titulo, cuerpo, false
	}

	valores := Datos{}
	for nombre, texto := range mejorDatos {
		if datosDeFecha[nombre] {
			if fecha, ok := fechaGuardada(texto, mejor.idioma); ok {
				valores[nombre] = fecha
				continue
			}
		}
		valores[nombre] = texto
	}
	// Un dato que el aviso nuevo pide y el viejo no traia no se inventa.
	if len(DatosQueFaltan(mejor.clave, valores)) > 0 {
		return titulo, cuerpo, false
	}
	nuevoTitulo, nuevoCuerpo := Texto(mejor.clave, idioma, valores)
	return nuevoTitulo, nuevoCuerpo, true
}
