package lightning

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// Cliente LNURL: resuelve una direccion Lightning (LUD-16), le pide una factura
// por un monto exacto (LUD-06) y consulta si se pago (LUD-21).
//
// Solo habla con los dominios de su lista, por https y sin seguir
// redirecciones. La direccion la escribe el dueno del comercio y la URL de
// verificacion la entrega el servidor LNURL: sin la lista, el servidor de
// KiramoPay haria peticiones a donde le dijeran.

var (
	// ErrDireccionInvalida: no tiene la forma usuario@dominio de LUD-16.
	ErrDireccionInvalida = errors.New("direccion lightning invalida")
	// ErrDominioNoPermitido: la direccion, la factura o la verificacion
	// apuntan a un dominio que no esta en la lista.
	ErrDominioNoPermitido = errors.New("dominio lightning no permitido")
	// ErrProveedor: el servidor de la direccion no respondio, respondio un
	// error o algo que no es LNURL.
	ErrProveedor = errors.New("el servidor lightning no respondio bien")
	// ErrFueraDeRango: el monto no esta entre el minimo y el maximo que la
	// direccion acepta.
	ErrFueraDeRango = errors.New("monto fuera del rango que acepta la direccion")
	// ErrSinVerificacion: la direccion entrego una factura sin URL de
	// verificacion (LUD-21). Sin ella no hay forma de saber si se pago, y un
	// QR cuyo pago no se puede confirmar no se muestra.
	ErrSinVerificacion = errors.New("la direccion no permite verificar el pago")
	// ErrFacturaNoCorresponde: la factura que llego no es por el monto pedido
	// o es de otra red (LUD-06 obliga a comprobar el monto).
	ErrFacturaNoCorresponde = errors.New("la factura no corresponde a lo pedido")
)

// LargoMaximoDireccion: lo que cabe en la columna.
const LargoMaximoDireccion = 320

var usuarioLUD16 = regexp.MustCompile(`^[a-z0-9._-]{1,64}$`)
var dominioValido = regexp.MustCompile(`^[a-z0-9.-]+(:[0-9]{1,5})?$`)

// tamanoMaximoRespuesta acota lo que se lee de un servidor ajeno.
const tamanoMaximoRespuesta = 64 << 10

// PedidoDePago es la respuesta de LUD-06 a la direccion.
type PedidoDePago struct {
	Callback      string
	MinMsat       int64
	MaxMsat       int64
	ComentarioMax int
}

// FacturaPedida es lo que devolvio el callback: la factura, ya leida y
// comprobada, y la URL para saber si se pago.
type FacturaPedida struct {
	Texto     string
	Factura   *Factura
	Verificar string
}

// Verificacion es la respuesta de LUD-21.
type Verificacion struct {
	Pagada   bool
	Preimage string
	Factura  string
}

// Cliente habla LNURL con los dominios permitidos.
type Cliente struct {
	http     *http.Client
	dominios map[string]bool
	red      string
}

// NuevoCliente arma el cliente. dominios son los hosts permitidos (por ejemplo
// "breez.tips" y "pay.kiramopay.com"); red es la de las facturas que acepta
// ("bc" para la red principal). hc puede ser nil.
func NuevoCliente(dominios []string, red string, hc *http.Client) *Cliente {
	permitidos := map[string]bool{}
	for _, d := range dominios {
		d = strings.ToLower(strings.TrimSpace(d))
		if d != "" {
			permitidos[d] = true
		}
	}
	if hc == nil {
		hc = &http.Client{Timeout: 8 * time.Second}
	}
	// Una copia: no se le cambia la politica de redirecciones a quien la presto.
	copia := *hc
	copia.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if red == "" {
		red = "bc"
	}
	return &Cliente{http: &copia, dominios: permitidos, red: red}
}

// SepararDireccion valida "usuario@dominio" (LUD-16) contra la lista y la
// devuelve en minusculas.
func (c *Cliente) SepararDireccion(direccion string) (usuario, dominio string, err error) {
	d := strings.ToLower(strings.TrimSpace(direccion))
	if d == "" || len(d) > LargoMaximoDireccion {
		return "", "", ErrDireccionInvalida
	}
	arroba := strings.LastIndexByte(d, '@')
	if arroba < 1 || arroba == len(d)-1 {
		return "", "", ErrDireccionInvalida
	}
	usuario, dominio = d[:arroba], d[arroba+1:]
	if !usuarioLUD16.MatchString(usuario) || !dominioValido.MatchString(dominio) {
		return "", "", ErrDireccionInvalida
	}
	if !c.dominios[dominio] {
		return "", "", ErrDominioNoPermitido
	}
	return usuario, dominio, nil
}

// NormalizarDireccion devuelve la direccion como se guarda.
func (c *Cliente) NormalizarDireccion(direccion string) (string, error) {
	u, d, err := c.SepararDireccion(direccion)
	if err != nil {
		return "", err
	}
	return u + "@" + d, nil
}

// ResolverDireccion pide a la direccion su pedido de pago (LUD-16 + LUD-06).
func (c *Cliente) ResolverDireccion(ctx context.Context, direccion string) (*PedidoDePago, error) {
	usuario, dominio, err := c.SepararDireccion(direccion)
	if err != nil {
		return nil, err
	}
	var r struct {
		respuestaDeError
		Tag            string      `json:"tag"`
		Callback       string      `json:"callback"`
		MinSendable    json.Number `json:"minSendable"`
		MaxSendable    json.Number `json:"maxSendable"`
		CommentAllowed json.Number `json:"commentAllowed"`
	}
	if err := c.pedirJSON(ctx, "https://"+dominio+"/.well-known/lnurlp/"+usuario, &r); err != nil {
		return nil, err
	}
	if err := r.comoError(); err != nil {
		return nil, err
	}
	if r.Tag != "payRequest" {
		return nil, fmt.Errorf("%w: tag %q", ErrProveedor, r.Tag)
	}
	if _, err := c.urlPermitida(r.Callback); err != nil {
		return nil, err
	}
	minimo, err1 := r.MinSendable.Int64()
	maximo, err2 := r.MaxSendable.Int64()
	if err1 != nil || err2 != nil || minimo <= 0 || maximo < minimo {
		return nil, fmt.Errorf("%w: rango invalido", ErrProveedor)
	}
	comentario := 0
	if r.CommentAllowed != "" {
		n, err := r.CommentAllowed.Int64()
		if err == nil && n > 0 && n < 2000 {
			comentario = int(n)
		}
	}
	return &PedidoDePago{Callback: r.Callback, MinMsat: minimo, MaxMsat: maximo, ComentarioMax: comentario}, nil
}

// PedirFactura pide una factura por msat milisatoshis. El comentario (LUD-12)
// se manda solo si la direccion acepta uno de ese largo.
//
// La factura que vuelve se comprueba aqui y no despues: monto exacto (LUD-06),
// red y URL de verificacion en un dominio permitido.
func (c *Cliente) PedirFactura(ctx context.Context, p *PedidoDePago, msat int64, comentario string) (*FacturaPedida, error) {
	if msat < p.MinMsat || msat > p.MaxMsat {
		return nil, ErrFueraDeRango
	}
	u, err := c.urlPermitida(p.Callback)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("amount", fmt.Sprintf("%d", msat))
	if comentario != "" && p.ComentarioMax >= utf8.RuneCountInString(comentario) {
		q.Set("comment", comentario)
	}
	u.RawQuery = q.Encode()

	var r struct {
		respuestaDeError
		PR     string `json:"pr"`
		Verify string `json:"verify"`
	}
	if err := c.pedirJSON(ctx, u.String(), &r); err != nil {
		return nil, err
	}
	if err := r.comoError(); err != nil {
		return nil, err
	}
	f, err := DecodificarFactura(r.PR)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrProveedor, err)
	}
	if f.Red != c.red || f.MontoMsat != msat {
		return nil, ErrFacturaNoCorresponde
	}
	if r.Verify == "" {
		return nil, ErrSinVerificacion
	}
	if _, err := c.urlPermitida(r.Verify); err != nil {
		return nil, err
	}
	return &FacturaPedida{Texto: textoDeLaFactura(r.PR), Factura: f, Verificar: r.Verify}, nil
}

// textoDeLaFactura es la factura como se guarda y se muestra: en minusculas y
// sin el "lightning:" que algunos proveedores le ponen delante (la pantalla le
// pone el suyo al armar el QR).
func textoDeLaFactura(pr string) string {
	t := strings.ToLower(strings.TrimSpace(pr))
	return strings.TrimPrefix(t, "lightning:")
}

// Verificar consulta la URL de LUD-21.
func (c *Cliente) Verificar(ctx context.Context, urlVerificar string) (*Verificacion, error) {
	if _, err := c.urlPermitida(urlVerificar); err != nil {
		return nil, err
	}
	var r struct {
		respuestaDeError
		Settled  bool    `json:"settled"`
		Preimage *string `json:"preimage"`
		PR       string  `json:"pr"`
	}
	if err := c.pedirJSON(ctx, urlVerificar, &r); err != nil {
		return nil, err
	}
	if err := r.comoError(); err != nil {
		return nil, err
	}
	v := &Verificacion{Pagada: r.Settled, Factura: textoDeLaFactura(r.PR)}
	if r.Preimage != nil {
		v.Preimage = strings.ToLower(strings.TrimSpace(*r.Preimage))
	}
	return v, nil
}

// PreimageCorresponde dice si el SHA-256 del preimage es el payment hash. Es la
// unica prueba de pago que acepta el servidor.
func PreimageCorresponde(preimageHex, paymentHashHex string) bool {
	pre, err := hex.DecodeString(preimageHex)
	if err != nil || len(pre) != 32 {
		return false
	}
	hash, err := hex.DecodeString(paymentHashHex)
	if err != nil || len(hash) != 32 {
		return false
	}
	suma := sha256.Sum256(pre)
	return string(suma[:]) == string(hash)
}

// urlPermitida: https, sin usuario ni clave, y en un dominio de la lista.
func (c *Cliente) urlPermitida(texto string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(texto))
	if err != nil || u.Scheme != "https" || u.User != nil || u.Host == "" {
		return nil, fmt.Errorf("%w: %q", ErrDominioNoPermitido, texto)
	}
	if !c.dominios[strings.ToLower(u.Host)] {
		return nil, fmt.Errorf("%w: %q", ErrDominioNoPermitido, u.Host)
	}
	return u, nil
}

type respuestaDeError struct {
	Status string `json:"status"`
	Reason string `json:"reason"`
}

func (r respuestaDeError) comoError() error {
	if strings.EqualFold(r.Status, "ERROR") {
		return fmt.Errorf("%w: %s", ErrProveedor, r.Reason)
	}
	return nil
}

// pedirJSON hace un GET y lee el cuerpo como JSON. LUD-01: los codigos HTTP no
// significan nada, manda el cuerpo; pero un cuerpo que no es JSON es un fallo.
func (c *Cliente) pedirJSON(ctx context.Context, direccion string, destino any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, direccion, nil)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrProveedor, err)
	}
	req.Header.Set("Accept", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrProveedor, err)
	}
	defer func() { _ = res.Body.Close() }()
	cuerpo, err := io.ReadAll(io.LimitReader(res.Body, tamanoMaximoRespuesta+1))
	if err != nil {
		return fmt.Errorf("%w: %v", ErrProveedor, err)
	}
	if len(cuerpo) > tamanoMaximoRespuesta {
		return fmt.Errorf("%w: respuesta demasiado grande", ErrProveedor)
	}
	if err := json.Unmarshal(cuerpo, destino); err != nil {
		return fmt.Errorf("%w: respuesta HTTP %d que no es JSON", ErrProveedor, res.StatusCode)
	}
	return nil
}
