package uif

import (
	"fmt"
	"sort"
	"strings"
)

// Alcance describe si una regla de reporte puede dispararse alguna vez, dados
// los topes de salida que la propia aplicacion le impone a sus usuarios.
//
// Por que existe: los umbrales de reporte siguen la Ley 8204, que los ata a
// US$10.000 o su equivalente. Los topes de KYC de esta aplicacion son mucho mas
// bajos —el nivel mas alto permite ₡2.000.000 y US$3.800 al dia— asi que
// NINGUN movimiento individual puede alcanzar el umbral, y el agregado del dia
// tampoco, ni sumando las dos monedas, porque el tope diario lo corta antes.
//
// Eso no es necesariamente un error: es la consecuencia de tener topes bajos.
// Lo que si es un problema es que no se vea. Un control que no puede dispararse
// y no lo dice se lee como un control que funciona y no encuentra nada.
type Alcance struct {
	// UmbralUSDMinor es el umbral de la regla, en centavos de dolar.
	UmbralUSDMinor int64
	// MaximoUSDMinor es lo maximo que los topes de KYC dejan sacar en la ventana
	// de la regla, todas las monedas juntas por su equivalente en dolares: el
	// agregado las suma, asi que el maximo tambien.
	MaximoUSDMinor int64
	Alcanzable     bool
	// SinTipoDeCambio son las monedas cuyo tope no se pudo sumar porque no hay
	// tipo de cambio: el diagnostico las nombra en vez de callarlas.
	SinTipoDeCambio []string
}

func (a Alcance) String() string {
	estado := "INALCANZABLE"
	if a.Alcanzable {
		estado = "alcanzable"
	}
	s := fmt.Sprintf("umbral US$%s, maximo que permite KYC US$%s (todas las monedas) -> %s",
		dolares(a.UmbralUSDMinor), dolares(a.MaximoUSDMinor), estado)
	if len(a.SinTipoDeCambio) > 0 {
		s += "; sin tipo de cambio para " + strings.Join(a.SinTipoDeCambio, ", ") + ", no sumadas"
	}
	return s
}

// DiagnosticoAcumulado compara el umbral de 30 dias contra el maximo que un
// usuario puede sacar en un MES. A diferencia del diario, con el nivel de KYC
// mas alto este si es alcanzable: es la regla que hace que la cola pueda
// recibir un caso.
//
// porDolar es el tipo de cambio de cada moneda (unidades por dolar); el dolar
// no lo necesita.
func DiagnosticoAcumulado(t Thresholds, maximosMensuales map[string]int64, porDolar map[string]float64) Alcance {
	max, sinTasa := sumarEnDolares(maximosMensuales, porDolar)
	return Alcance{UmbralUSDMinor: t.Acumulado30USD, MaximoUSDMinor: max, Alcanzable: max >= t.Acumulado30USD,
		SinTipoDeCambio: sinTasa}
}

// Diagnostico compara el umbral diario contra el maximo que un usuario puede
// sacar en un dia. maximosDiarios viene del nivel de KYC mas alto, por moneda.
//
// Se compara contra el umbral DIARIO porque es el mas permisivo de los dos: si
// el agregado del dia no puede alcanzarlo, un movimiento individual tampoco.
func Diagnostico(t Thresholds, maximosDiarios map[string]int64, porDolar map[string]float64) Alcance {
	max, sinTasa := sumarEnDolares(maximosDiarios, porDolar)
	return Alcance{
		UmbralUSDMinor: t.DailyUSD,
		MaximoUSDMinor: max,
		// El agregado del dia llega como mucho a la suma de los topes. Solo
		// puede CRUZAR el umbral si esa suma lo supera.
		Alcanzable:      max > t.DailyUSD,
		SinTipoDeCambio: sinTasa,
	}
}

func sumarEnDolares(porMoneda map[string]int64, porDolar map[string]float64) (int64, []string) {
	var total int64
	var sinTasa []string
	for moneda, minor := range porMoneda {
		if moneda == "USD" {
			total += minor
			continue
		}
		tasa, ok := porDolar[moneda]
		if !ok || tasa <= 0 {
			sinTasa = append(sinTasa, moneda)
			continue
		}
		total += enCentavosDeDolar(minor, tasa)
	}
	sort.Strings(sinTasa)
	return total, sinTasa
}
