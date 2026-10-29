package contract_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// La app le habla de "tu" a la persona. El dueno pidio sacar el voseo (#275) y
// el front ya lo comprueba (src/i18n/__tests__/textosConsistentes.test.ts), pero
// los correos, los SMS y los mensajes de error que arma el servidor seguian con
// "podes", "tenes", "escribinos", "fuiste vos". Esos textos son lo que la persona
// lee: los correos de la eliminacion de cuenta son la respuesta escrita que exige
// la Ley 8968.
//
// Esta prueba lee el codigo de todo backend/internal y revisa cada texto entre
// comillas (los comentarios no cuentan: nadie los lee en la app). Asi atrapa
// tambien el texto nuevo que alguien escriba manana, en el paquete que sea.
//
// Dos precauciones:
//   - El texto del servidor suele ir sin tildes (ASCII), y ahi "pagalo" es
//     igual en tuteo ("págalo") y en voseo. Solo se marcan las formas que no
//     existen en tuteo: "podes", "tenes", "queres", "a vos mismo", "escribinos".
//   - Las formas con tilde final ("ignorá", "esperá") solo existen en voseo.
//     "estás" y "sos" no se marcan: la primera es igual en tuteo.
var voseo = regexp.MustCompile(`(?i)(?:^|[^\p{L}])(` + strings.Join([]string{
	// El pronombre, en las frases en que aparece en un texto para la persona.
	// "vos" suelto no se marca: en frances "vos" es "sus" y el filtro de alcance
	// del asistente rechaza en ese idioma.
	`fuiste vos`, `fue vos`, `a vos`, `con vos`, `para vos`, `si vos`, `vos mismo`, `vos misma`, `vos quien`,
	// El presente: "vos podes" en vez de "tu puedes".
	`podés`, `tenés`, `querés`, `sabés`, `hacés`, `decís`, `venís`, `enviás`, `cambiás`, `considerás`,
	`resolvás`, `ingresás`, `elegís`, `ponés`, `vivís`,
	// El imperativo con tilde final.
	`ignorá`, `esperá`, `entrá`, `usá`, `volvé`, `restablecé`, `reactivá`, `abrí`, `cambiá`, `confirmá`,
	`revisá`, `escaneá`, `agregá`, `tocá`, `elegí`, `escribí`, `mirá`, `probá`, `hacé`, `poné`, `decí`,
	`tené`, `andá`, `pasá`, `seguí`, `ingresá`, `verificá`, `intentá`, `guardá`, `cargá`, `compartí`,
	`iniciá`, `pedí`, `avisá`, `creá`, `apretá`, `cerrá`, `descargá`, `actualizá`, `conectá`, `registrá`,
	`eliminá`, `borrá`, `enviá`, `mandá`, `pagá`, `cobrá`, `retirá`, `comprá`, `vendé`, `convertí`,
	`cancelá`, `aprobá`, `rechazá`,
	// El imperativo con el pronombre pegado: en voseo va sin tilde ("envialo") y
	// en tuteo la lleva ("envíalo"). Solo las que no se confunden con el ASCII.
	`escribinos`, `avisanos`, `contanos`, `mandanos`, `llamanos`, `ayudanos`, `dejanos`, `decinos`,
	`pedinos`, `contactanos`, `comunicate`, `pedile`, `pedila`, `pedilo`, `ponele`, `ponelo`, `decile`,
	`decilo`, `mandale`, `mandalo`, `avisale`, `escribile`, `contale`, `mostrale`, `mostralo`, `pasale`,
	`pasalo`, `revisalos?`, `revisalas?`, `imprimilos?`, `pegalos?`, `copialos?`, `guardalos?`, `usalos?`,
	`fijate`, `acordate`, `asegurate`, `registrate`, `cambiala`, `cambialo`, `envialo`, `envialas`,
	`retiralo`, `retirala`, `gastalo`, `vendelas`, `cerralo`, `cancelalos`,
	// Sin tilde, que no existen en tuteo: "puedes", "tienes", "quieres", "vuelve".
	`podes`, `tenes`, `queres`, `volve`, `elegi`,
}, "|") + `)(?:[^\p{L}]|$)`)

var codigoDeError = regexp.MustCompile(`^[A-Z0-9_]+$`)

func TestLosTextosDelServidorTutean(t *testing.T) {
	raiz := ".." // backend/internal
	revisados := 0
	err := filepath.WalkDir(raiz, func(ruta string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(ruta, ".go") || strings.HasSuffix(ruta, "_test.go") {
			return nil
		}
		fset := token.NewFileSet()
		archivo, err := parser.ParseFile(fset, ruta, nil, 0)
		if err != nil {
			return err
		}
		revisados++
		ast.Inspect(archivo, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			texto, err := strconv.Unquote(lit.Value)
			if err != nil {
				return true
			}
			// Un codigo de error ("NO_PODES_PAGARTE") es un identificador que el
			// front traduce, no un texto que alguien lea.
			if codigoDeError.MatchString(texto) {
				return true
			}
			if m := voseo.FindStringSubmatch(texto); m != nil {
				t.Errorf("%s: voseo %q en %q", fset.Position(lit.Pos()), m[1], resumen(texto))
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	// Si la ruta cambiara y no se leyera nada, la prueba pasaria sin revisar nada.
	if revisados < 50 {
		t.Fatalf("se leyeron %d archivos de %s: la prueba no esta mirando el servidor", revisados, raiz)
	}
}

// La lista de formas tiene que reconocer el voseo que dice reconocer: sin esto,
// un error de escritura en la lista deja pasar justo lo que debe atrapar.
func TestElDetectorDeVoseoReconoceLoQueDebe(t *testing.T) {
	for _, texto := range []string{
		"tenés saldo en tu billetera",
		"Si no fuiste vos, no lo uses.",
		"o escribinos a soporte@kiramopay.com",
		"Si cambiás de opinión",
		"ignorá este mensaje",
		"no podes pagarte a vos mismo",
		"indica cuanto queres pagar",
		"cambiala cuanto antes",
		"cerralo o esperá a que se liquide",
	} {
		if !voseo.MatchString(texto) {
			t.Errorf("no reconoce el voseo de %q", texto)
		}
	}
	for _, texto := range []string{
		"tienes saldo en tu billetera",
		"Si no fuiste tú, no lo uses.",
		"o escríbenos a soporte@kiramopay.com",
		"Si cambias de opinión",
		"ignora este mensaje",
		"no puedes pagarte a ti mismo",
		"cierra o espera a que se liquide",
		"Posez-moi vos questions sur votre solde",
		"estás creando tu cuenta",
		"pagalo desde Pagar con QR",
	} {
		if voseo.MatchString(texto) {
			t.Errorf("marca como voseo %q, que esta bien", texto)
		}
	}
}

func resumen(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > 110 {
		return s[:110] + "..."
	}
	return s
}
