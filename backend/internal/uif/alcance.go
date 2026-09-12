package uif

import "fmt"

// Alcance describe si la regla de reporte puede dispararse alguna vez, dados los
// topes de salida que la propia aplicacion le impone a sus usuarios.
//
// Por que existe: los umbrales de reporte siguen la Ley 8204, que los ata a unos
// USD 10.000 o su equivalente. Los topes de KYC de esta aplicacion son mucho mas
// bajos —el nivel mas alto permite ₡2.000.000 y USD 3.800 al dia— asi que
// NINGUN movimiento individual puede alcanzar el umbral, y el agregado del dia
// tampoco, porque el tope diario lo corta antes. La cola de cumplimiento es
// estructuralmente incapaz de recibir un caso.
//
// Eso no es necesariamente un error: es la consecuencia de tener topes bajos.
// Lo que si es un problema es que no se vea. Un control que no puede dispararse
// y no lo dice se lee como un control que funciona y no encuentra nada.
type Alcance struct {
	Moneda         string
	UmbralMinor    int64
	MaxDiarioMinor int64
	Alcanzable     bool
}

func (a Alcance) String() string {
	estado := "INALCANZABLE"
	if a.Alcanzable {
		estado = "alcanzable"
	}
	return fmt.Sprintf("%s: umbral %d, maximo diario que permite KYC %d -> %s",
		a.Moneda, a.UmbralMinor, a.MaxDiarioMinor, estado)
}

// DiagnosticoAcumulado compara el umbral de 30 dias contra el maximo que un
// usuario puede sacar en un MES. A diferencia del diario, con el nivel de KYC
// mas alto este si es alcanzable: es la regla que hace que la cola pueda
// recibir un caso.
func DiagnosticoAcumulado(t Thresholds, maximosMensuales map[string]int64) []Alcance {
	out := make([]Alcance, 0, len(t.Acumulado30))
	for moneda, umbral := range t.Acumulado30 {
		max, hay := maximosMensuales[moneda]
		if !hay {
			continue
		}
		out = append(out, Alcance{Moneda: moneda, UmbralMinor: umbral, MaxDiarioMinor: max, Alcanzable: max >= umbral})
	}
	return out
}

// Diagnostico compara cada umbral contra el maximo que un usuario puede sacar en
// un dia. maximosDiarios viene del nivel de KYC mas alto, por moneda.
//
// Se compara contra el umbral DIARIO porque es el mas permisivo de los dos: si
// el agregado del dia no puede alcanzarlo, un movimiento individual tampoco.
func Diagnostico(t Thresholds, maximosDiarios map[string]int64) []Alcance {
	out := make([]Alcance, 0, len(t.Daily))
	for _, moneda := range []string{"CRC", "USD"} {
		umbral, hay := t.Daily[moneda]
		if !hay {
			continue
		}
		max := maximosDiarios[moneda]
		out = append(out, Alcance{
			Moneda:         moneda,
			UmbralMinor:    umbral,
			MaxDiarioMinor: max,
			// El agregado del dia llega como mucho al tope diario. Solo puede
			// CRUZAR el umbral si el tope lo supera.
			Alcanzable: max > umbral,
		})
	}
	return out
}
