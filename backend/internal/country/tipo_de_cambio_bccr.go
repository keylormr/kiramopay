package country

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// El dolar sale del Banco Central de Costa Rica (BCCR) por el SDDE, su Sistema
// de Divulgacion de Datos Economicos. Hacienda republica ese mismo tipo de
// referencia, y queda de respaldo: con BCCR_TOKEN cargado la fuente es el BCCR
// y, si falla, Hacienda; sin el token, Hacienda como hasta ahora.
//
// ES EL SDDE Y NO EL SERVICIO VIEJO. El web service SOAP del BCCR
// (wsindicadoreseconomicos.asmx) esta muerto: devuelve 503, y la direccion que
// anuncia su propio catalogo devuelve 404. El SDDE es REST, JSON y Bearer, y lo
// unico que hace falta es el token.

// URLBCCR es la ruta base del SDDE. La grafia NO es indiferente: "sddE" con la E
// mayuscula al final y "Bccr.Ge.SDDE..." exactamente asi. Probadas
// "SDDE/...Bccr.GE..." y "SDDE/...Bccr.Ge...", las dos devuelven 404.
const URLBCCR = "https://apim.bccr.fi.cr/sddE/api/Bccr.Ge.SDDE.Publico.Indicadores.API"

// VariableTokenBCCR es la variable de entorno con el Bearer que el BCCR entrega
// al registrarse. Solo se nombra aqui: su valor no se escribe en el codigo, ni
// en los registros, ni en las respuestas.
const VariableTokenBCCR = "BCCR_TOKEN" // #nosec G101 -- es el NOMBRE de la variable de entorno, no una credencial

// Los dos nombres con que la fila guardada y /health dicen de donde salio el
// tipo de cambio de una pasada.
const (
	NombreFuenteBCCR     = "bccr"
	NombreFuenteHacienda = "hacienda"
)

const (
	// El cuadro 1 es "Tipo cambio de compra y de venta del dolar de los Estados
	// Unidos de America": trae las dos puntas en una sola llamada, el indicador
	// 317 (compra) y el 318 (venta).
	cuadroTipoDeCambio = "1"
	indicadorCompra    = "317"
	indicadorVenta     = "318"

	// Se piden los ultimos diez dias y no solo hoy: asi el registro se completa
	// solo despues de un rato sin consultar, y una correccion del BCCR sobre un
	// dia anterior entra sin trabajo aparte. Un fin de semana no deja huecos: el
	// servicio repite el valor del ultimo dia habil.
	diasQueSePiden = 10

	// El BCCR responde en formato AAAA/MM/DD en la consulta y AAAA-MM-DD en la
	// serie.
	formatoDeConsulta = "2006/01/02"
	formatoDeSerie    = "2006-01-02"
)

// zonaCostaRica: el dia que cuenta para el BCCR es el de Costa Rica (UTC-6 todo
// el ano, sin horario de verano), no el del servidor, que corre en UTC. A las 8
// de la noche en Costa Rica el servidor ya esta en el dia siguiente.
var zonaCostaRica = time.FixedZone("America/Costa_Rica", -6*60*60)

// FuenteBCCR lee el tipo de cambio de compra y de venta del dolar en el SDDE.
type FuenteBCCR struct {
	// URL sustituye la ruta base; vacia usa URLBCCR. Existe para las pruebas.
	URL string
	// Token es el Bearer del BCCR.
	Token  string
	Client *http.Client
	// Ahora sustituye el reloj; nil usa time.Now. Existe para las pruebas.
	Ahora func() time.Time
}

// NewFuenteBCCR arma la fuente con un tiempo de espera propio: una fuente
// colgada no puede dejar colgado al actualizador.
func NewFuenteBCCR(token string) *FuenteBCCR {
	return &FuenteBCCR{Token: strings.TrimSpace(token), Client: &http.Client{Timeout: 20 * time.Second}}
}

// Obtener trae la cotizacion mas reciente que tenga las dos puntas.
//
// Un dia al que le falta una de las dos se descarta: media cotizacion no es una
// cotizacion, y guardarla dejaria una fila con un cero que despues nadie sabria
// distinguir de un dato real.
func (f *FuenteBCCR) Obtener(ctx context.Context) (*Cotizacion, error) {
	if strings.TrimSpace(f.Token) == "" {
		return nil, fmt.Errorf("bccr: falta %s", VariableTokenBCCR)
	}
	base := f.URL
	if base == "" {
		base = URLBCCR
	}
	ahora := time.Now
	if f.Ahora != nil {
		ahora = f.Ahora
	}
	hoy := ahora().In(zonaCostaRica)
	parametros := url.Values{
		"fechaInicio": {hoy.AddDate(0, 0, -diasQueSePiden).Format(formatoDeConsulta)},
		"fechaFin":    {hoy.Format(formatoDeConsulta)},
		"idioma":      {"es"},
	}
	destino := fmt.Sprintf("%s/cuadro/%s/series?%s", base, cuadroTipoDeCambio, parametros.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, destino, nil)
	if err != nil {
		return nil, fmt.Errorf("bccr: %s", f.sinToken(err.Error()))
	}
	req.Header.Set("Authorization", "Bearer "+f.Token)
	req.Header.Set("Accept", "application/json")

	cliente := f.Client
	if cliente == nil {
		cliente = &http.Client{Timeout: 20 * time.Second}
	}
	res, err := cliente.Do(req)
	if err != nil {
		return nil, fallaPasajera{fmt.Errorf("bccr: %s", f.sinToken(err.Error()))}
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		// 401 es el token vencido o mal copiado y 404 es casi siempre la ruta:
		// los dos se arreglan en la configuracion, no reintentando, asi que NO son
		// fallas pasajeras. El cuerpo no se copia al error: termina en /health y en
		// los registros, y un servidor que devuelve el encabezado que recibio
		// escribiria el token ahi.
		err := fmt.Errorf("bccr: HTTP %d%s", res.StatusCode, pistaDelEstado(res.StatusCode))
		if estadoPasajero(res.StatusCode) {
			err = fallaPasajera{err}
		}
		return nil, err
	}

	cuerpo, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, fallaPasajera{fmt.Errorf("bccr: %s", f.sinToken(err.Error()))}
	}
	c, err := leerSerieBCCR(cuerpo)
	if err != nil {
		return nil, fmt.Errorf("bccr: %s", f.sinToken(err.Error()))
	}
	return c, nil
}

// sinToken quita el token de un texto que viene de afuera antes de que llegue a
// un error: lo que dice un servidor remoto no es de fiar.
func (f *FuenteBCCR) sinToken(texto string) string {
	if f.Token != "" {
		texto = strings.ReplaceAll(texto, f.Token, "***")
	}
	return texto
}

func pistaDelEstado(codigo int) string {
	switch codigo {
	case http.StatusUnauthorized, http.StatusForbidden:
		return " (token rechazado: revisar " + VariableTokenBCCR + ")"
	case http.StatusNotFound:
		return " (ruta no encontrada: revisar la direccion del servicio)"
	}
	return ""
}

// respuestaBCCR es la forma que publica el estandar del SDDE.
type respuestaBCCR struct {
	Estado  bool   `json:"estado"`
	Mensaje string `json:"mensaje"`
	Datos   []struct {
		Indicadores []struct {
			Codigo string `json:"codigoIndicador"`
			Series []struct {
				Fecha string   `json:"fecha"`
				Valor *float64 `json:"valorDatoPorPeriodo"`
			} `json:"series"`
		} `json:"indicadores"`
	} `json:"datos"`
}

var errBCCRSinDato = errors.New("el servicio no devolvio ningun dia con compra y venta")

// leerSerieBCCR arma la cotizacion a partir de la respuesta del servicio.
//
//   - estado:false es un rechazo aunque el HTTP sea 200: sus datos no se leen.
//   - Compra y venta llegan en listas separadas y se juntan por fecha.
//   - Un valor nulo o en cero se ignora, y con el un dia al que le falte una de
//     las dos puntas.
//   - Se toma la fecha mas reciente que quede completa.
func leerSerieBCCR(cuerpo []byte) (*Cotizacion, error) {
	var r respuestaBCCR
	if err := json.Unmarshal(cuerpo, &r); err != nil {
		return nil, fmt.Errorf("respuesta ilegible: %w", err)
	}
	if !r.Estado {
		return nil, fmt.Errorf("el servicio rechazo la consulta: %s", recortar(r.Mensaje, 200))
	}

	type dia struct{ compra, venta float64 }
	porFecha := map[string]*dia{}
	for _, cuadro := range r.Datos {
		for _, ind := range cuadro.Indicadores {
			if ind.Codigo != indicadorCompra && ind.Codigo != indicadorVenta {
				continue
			}
			for _, s := range ind.Series {
				if s.Valor == nil || *s.Valor <= 0 || len(s.Fecha) < len(formatoDeSerie) {
					continue
				}
				fecha := s.Fecha[:len(formatoDeSerie)]
				if _, err := time.Parse(formatoDeSerie, fecha); err != nil {
					continue
				}
				d := porFecha[fecha]
				if d == nil {
					d = &dia{}
					porFecha[fecha] = d
				}
				if ind.Codigo == indicadorCompra {
					d.compra = *s.Valor
				} else {
					d.venta = *s.Valor
				}
			}
		}
	}

	var fechas []string
	for fecha, d := range porFecha {
		if d.compra > 0 && d.venta > 0 {
			fechas = append(fechas, fecha)
		}
	}
	if len(fechas) == 0 {
		return nil, errBCCRSinDato
	}
	sort.Strings(fechas) // AAAA-MM-DD ordena como las fechas
	ultima := fechas[len(fechas)-1]
	fecha, _ := time.Parse(formatoDeSerie, ultima)
	d := porFecha[ultima]
	return &Cotizacion{Compra: d.compra, Venta: d.venta, Fecha: fecha, Fuente: NombreFuenteBCCR}, nil
}

func recortar(s string, limite int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > limite {
		s = s[:limite] + "..."
	}
	return s
}

// FuenteConRespaldo es la fuente del dolar que usa la aplicacion: la Principal
// (el BCCR) y, si falla o devuelve algo que no puede ser un tipo de cambio del
// colon, el Respaldo (Hacienda). La Principal es nil cuando no hay token: el
// dolar sale de Hacienda y Faltantes dice que variable hace falta.
//
// El euro va aparte y sigue saliendo de Hacienda.
type FuenteConRespaldo struct {
	Principal FuenteTipoDeCambio
	Respaldo  FuenteTipoDeCambio
	Euro      FuenteEuro
	// Falta son los nombres de las variables de entorno que no estan cargadas.
	// Solo nombres: jamas un valor.
	Falta []string
}

// NewFuenteDelDolar arma la fuente con el token del BCCR que traiga el entorno.
// Un token vacio o en blanco deja el dolar en Hacienda y lo dice en Faltantes.
func NewFuenteDelDolar(tokenBCCR string) *FuenteConRespaldo {
	hacienda := NewFuenteHacienda()
	f := &FuenteConRespaldo{Respaldo: hacienda, Euro: hacienda}
	if token := strings.TrimSpace(tokenBCCR); token != "" {
		f.Principal = NewFuenteBCCR(token)
	} else {
		f.Falta = []string{VariableTokenBCCR}
	}
	return f
}

// Faltantes enumera lo que hay que configurar para que el dolar salga del BCCR.
func (f *FuenteConRespaldo) Faltantes() []string {
	return append([]string(nil), f.Falta...)
}

// Obtener trae el dolar de la Principal y, si no sirve, del Respaldo. La
// cotizacion devuelta dice de donde salio (Fuente) y, si salio del respaldo,
// por que no salio de la Principal (FallaPrincipal).
func (f *FuenteConRespaldo) Obtener(ctx context.Context) (*Cotizacion, error) {
	if f.Principal == nil {
		return f.delRespaldo(ctx, nil)
	}
	c, err := f.Principal.Obtener(ctx)
	if err == nil {
		err = validarCotizacion(c, time.Now())
	}
	if err == nil {
		return c, nil
	}
	return f.delRespaldo(ctx, err)
}

func (f *FuenteConRespaldo) delRespaldo(ctx context.Context, fallaPrincipal error) (*Cotizacion, error) {
	if f.Respaldo == nil {
		if fallaPrincipal != nil {
			return nil, fallaPrincipal
		}
		return nil, errors.New("tipo de cambio: no hay ninguna fuente configurada")
	}
	c, err := f.Respaldo.Obtener(ctx)
	if err == nil && fallaPrincipal != nil {
		// Con el BCCR de por medio, el respaldo se valida aqui para que el error
		// de una pasada que falla diga las dos fallas y no solo la ultima.
		err = validarCotizacion(c, time.Now())
	}
	if err != nil {
		if fallaPrincipal == nil {
			return nil, err
		}
		return nil, combinarFallas(fallaPrincipal, err)
	}
	if fallaPrincipal == nil {
		return c, nil
	}
	copia := *c
	copia.FallaPrincipal = fallaPrincipal
	return &copia, nil
}

// combinarFallas junta la falla de la Principal y la del Respaldo en un solo
// error que las dice a las dos. Solo es pasajero si lo son ambas: un token que el
// BCCR rechaza no se arregla esperando, aunque Hacienda tambien este caida con
// un 503 que si.
func combinarFallas(principal, respaldo error) error {
	err := fmt.Errorf("%v; respaldo: %v", principal, respaldo)
	if esFallaPasajera(principal) && esFallaPasajera(respaldo) {
		return fallaPasajera{err}
	}
	return err
}
