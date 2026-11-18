package qrpayment

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/shopspring/decimal"

	"github.com/kiramopay/backend/internal/lightning"
)

// Cobrar con Lightning en la billetera propia del comercio (fase 2).
//
// Un turista paga el cobro del mostrador con cualquier billetera Lightning y el
// bitcoin llega a la billetera propia del comercio: las llaves estan en el
// telefono del dueno, no aqui. El servidor:
//
//   - cotiza el monto en sats con su propio precio (nunca el del telefono);
//   - le pide la factura a la direccion Lightning del comercio, que hospeda el
//     proveedor de la billetera (Breez), y comprueba que sea por ese monto;
//   - guarda la factura, su payment hash y la URL de verificacion (LUD-21);
//   - y marca el cobro pagado SOLO cuando esa URL devuelve un preimage cuyo
//     SHA-256 es el payment hash. Sin preimage no hay "pagado" ni comprobante.
//
// No recibe, no guarda y no mueve bitcoin, y no toca el libro: un cobro por
// Lightning no suma al saldo del negocio en KiramoPay.
//
// En produccion espera el criterio del abogado (Ley 10961): se abre con
// COBRO_LIGHTNING=abierto, y los comercios cuyo dueno es una cuenta de
// demostracion lo ven siempre, igual que la billetera propia.

var (
	// ErrLightningNoDisponible: la bandera lo tiene en espera para este
	// comercio, el servidor no lo tiene configurado o el cobro no es de un
	// comercio.
	ErrLightningNoDisponible = errors.New("cobrar con lightning no esta disponible")
	// ErrLightningSinDireccion: el comercio todavia no vinculo la direccion de
	// su billetera propia.
	ErrLightningSinDireccion = errors.New("el comercio no tiene direccion lightning")
	// ErrSinpeMovilInvalido: no es un celular de Costa Rica de 8 digitos.
	ErrSinpeMovilInvalido = errors.New("numero de sinpe movil invalido")
	// ErrPrecioLightning y ErrPrecioLightningViejo: sin precio del bitcoin, o
	// con uno que ya no sirve, no se cotiza. Los traduce quien arma el
	// cotizador, para que este paquete no dependa del de cripto.
	ErrPrecioLightning      = errors.New("no hay precio del bitcoin para cotizar")
	ErrPrecioLightningViejo = errors.New("el precio del bitcoin no esta confirmado")
)

// Estados de una factura Lightning de un cobro.
const (
	EstadoLightningPendiente = "pending"
	EstadoLightningPagada    = "paid"
	EstadoLightningVencida   = "expired"

	PagadoPorLightning = "lightning"
)

const (
	// VigenciaCotizacionLightning: lo que dura el precio en la pantalla del
	// cajero (decision del dueno del 18-11-2026: 10 minutos, sin margen).
	VigenciaCotizacionLightning = 10 * time.Minute
	// vidaMinimaDeLaFactura: una factura que vence antes no se muestra.
	vidaMinimaDeLaFactura = 2 * time.Minute
	// reusoMinimo: si la cotizacion vigente vence en menos que esto, se pide
	// otra en vez de devolver la misma.
	reusoMinimo = 30 * time.Second
	// esperaEntreConsultas: la pantalla pregunta cada pocos segundos; la URL de
	// verificacion se consulta a lo sumo una vez en este plazo por factura.
	esperaEntreConsultas = 3 * time.Second
	// esperaDelBarrido: el barrido consulta las pendientes con esta pausa.
	esperaDelBarrido = 30 * time.Second
	// graciaDespuesDeVencer: una factura vencida se sigue consultando un rato,
	// por si se pago en el ultimo segundo, antes de darla por vencida.
	graciaDespuesDeVencer = 15 * time.Minute
	// limiteDeConsulta: lo maximo que una consulta del cajero espera al
	// proveedor.
	limiteDeConsulta = 4 * time.Second
)

// Cotizacion es el precio de un bitcoin en la moneda del cobro, y con que se
// armo: el precio en dolares y el tipo de cambio (cero si el cobro es en
// dolares).
type Cotizacion struct {
	PrecioBTC decimal.Decimal
	BTCUSD    decimal.Decimal
	TasaUSD   decimal.Decimal
}

// ProveedorLightning es el cliente LNURL. *lightning.Cliente lo cumple; las
// pruebas usan el mismo cliente contra un servidor de mentira.
type ProveedorLightning interface {
	NormalizarDireccion(direccion string) (string, error)
	ResolverDireccion(ctx context.Context, direccion string) (*lightning.PedidoDePago, error)
	PedirFactura(ctx context.Context, p *lightning.PedidoDePago, msat int64, comentario string) (*lightning.FacturaPedida, error)
	Verificar(ctx context.Context, url string) (*lightning.Verificacion, error)
}

// OpcionesLightning cablea el cobro con Lightning. nil en Options lo deja
// apagado: ErrLightningNoDisponible.
type OpcionesLightning struct {
	Proveedor ProveedorLightning
	// Cotizar da el precio de un bitcoin en la moneda (CRC o USD). Errores:
	// ErrPrecioLightning o ErrPrecioLightningViejo.
	Cotizar func(ctx context.Context, moneda string) (Cotizacion, error)
	// EnEspera lo deja cerrado salvo para comercios de cuentas demo.
	EnEspera bool
	Logger   *slog.Logger
	// Ahora se puede fijar en pruebas; nil es time.Now.
	Ahora func() time.Time
}

// MediosDeCobro: como cobra el comercio fuera del libro.
type MediosDeCobro struct {
	// LightningEnabled: la bandera deja cobrar con Lightning a este comercio.
	LightningEnabled bool   `json:"lightning_enabled"`
	LightningAddress string `json:"lightning_address,omitempty"`
	SinpeMovil       string `json:"sinpe_movil,omitempty"`
	// CanEdit: quien pregunta es el dueno.
	CanEdit bool `json:"can_edit"`
}

// GuardarMediosRequest cambia lo que venga; un campo ausente queda igual y uno
// vacio se quita.
type GuardarMediosRequest struct {
	LightningAddress *string `json:"lightning_address"`
	SinpeMovil       *string `json:"sinpe_movil"`
	// Actor es desde donde se pidio el cambio, para el rastro. No viene en el
	// cuerpo: lo pone el handler.
	Actor ActorContext `json:"-"`
}

// AccionMediosDeCobro es el rastro de un cambio en como cobra el comercio
// fuera del libro. La direccion Lightning es a donde va el dinero: cambiarla
// con una sesion robada desviaria cada cobro siguiente, y tiene que quedar
// quien lo hizo y desde donde.
const AccionMediosDeCobro = "merchant_payment_methods_changed"

// CobroLightning es una factura Lightning de un cobro, como la ve el cajero.
type CobroLightning struct {
	ID               string          `json:"id"`
	ChargeID         string          `json:"charge_id"`
	Invoice          string          `json:"invoice"`
	PaymentHash      string          `json:"payment_hash"`
	Sats             int64           `json:"sats"`
	FiatAmount       int64           `json:"fiat_amount"`
	Currency         string          `json:"currency"`
	BTCPrice         decimal.Decimal `json:"btc_price"`
	QuoteExpiresAt   time.Time       `json:"quote_expires_at"`
	InvoiceExpiresAt time.Time       `json:"invoice_expires_at"`
	Status           string          `json:"status"`
	PaidAt           *time.Time      `json:"paid_at,omitempty"`
	CreatedAt        time.Time       `json:"created_at"`

	// Lo que el servidor guarda y no le muestra al cajero.
	MerchantID       string              `json:"-"`
	CreatedBy        string              `json:"-"`
	LightningAddress string              `json:"-"`
	AmountMsat       int64               `json:"-"`
	BTCUSD           decimal.Decimal     `json:"-"`
	TasaUSD          decimal.NullDecimal `json:"-"`
	VerifyURL        string              `json:"-"`
}

// VentaLightning es un cobro pagado por Lightning, como lo ve el contador.
type VentaLightning struct {
	ChargeID     string          `json:"charge_id"`
	Note         string          `json:"note"`
	FiatAmount   int64           `json:"fiat_amount"`
	Currency     string          `json:"currency"`
	Sats         int64           `json:"sats"`
	BTCPrice     decimal.Decimal `json:"btc_price"`
	PaymentHash  string          `json:"payment_hash"`
	PaidAt       time.Time       `json:"paid_at"`
	ChargeStatus string          `json:"charge_status"`
}

func (s *Service) ahora() time.Time {
	if s.ln != nil && s.ln.Ahora != nil {
		return s.ln.Ahora()
	}
	return time.Now()
}

func (s *Service) logLightning() *slog.Logger {
	if s.ln != nil && s.ln.Logger != nil {
		return s.ln.Logger
	}
	return slog.Default()
}

// lightningAbierto dice si la bandera deja cobrar con Lightning al comercio.
func (s *Service) lightningAbierto(ctx context.Context, m *Merchant) (bool, error) {
	if s.ln == nil || s.ln.Proveedor == nil || s.ln.Cotizar == nil {
		return false, nil
	}
	if !s.ln.EnEspera {
		return true, nil
	}
	return s.repo.EsCuentaDemo(ctx, m.UserID)
}

// ── Medios de cobro ─────────────────────────────────────────────────────────

// MediosDelComercio los lee cualquiera del equipo: el cajero necesita saber si
// puede ofrecer Lightning y el numero de SINPE que tiene que decir.
func (s *Service) MediosDelComercio(ctx context.Context, userID, merchantID string) (*MediosDeCobro, error) {
	m, err := s.requireRole(ctx, merchantID, userID, RoleOwner, RoleManager, RoleCashier)
	if err != nil {
		return nil, noEncontradoSiNoEsCierre(err)
	}
	medios, err := s.repo.LeerMediosDeCobro(ctx, merchantID)
	if err != nil {
		return nil, err
	}
	abierto, err := s.lightningAbierto(ctx, m)
	if err != nil {
		return nil, err
	}
	medios.LightningEnabled = abierto
	medios.CanEdit = m.UserID == userID
	return medios, nil
}

var noEsDigito = regexp.MustCompile(`[^0-9]`)

// NormalizarSinpeMovil deja 8 digitos: quita espacios, guiones y el +506.
func NormalizarSinpeMovil(texto string) (string, error) {
	d := noEsDigito.ReplaceAllString(texto, "")
	if len(d) == 11 && strings.HasPrefix(d, "506") {
		d = d[3:]
	}
	if len(d) != 8 || d[0] < '5' || d[0] > '8' {
		return "", ErrSinpeMovilInvalido
	}
	return d, nil
}

// GuardarMediosDeCobro: solo el dueno. La direccion Lightning se comprueba
// contra la lista de dominios y preguntandole al servidor de la direccion si
// existe, antes de guardarla.
func (s *Service) GuardarMediosDeCobro(ctx context.Context, userID, merchantID string, req *GuardarMediosRequest) (*MediosDeCobro, error) {
	m, err := s.requireRole(ctx, merchantID, userID, RoleOwner)
	if err != nil {
		return nil, noEncontradoSiNoEsCierre(err)
	}
	actuales, err := s.repo.LeerMediosDeCobro(ctx, merchantID)
	if err != nil {
		return nil, err
	}
	direccion, sinpe := actuales.LightningAddress, actuales.SinpeMovil

	if req.SinpeMovil != nil {
		sinpe = ""
		if strings.TrimSpace(*req.SinpeMovil) != "" {
			if sinpe, err = NormalizarSinpeMovil(*req.SinpeMovil); err != nil {
				return nil, err
			}
		}
	}
	if req.LightningAddress != nil {
		direccion = ""
		if strings.TrimSpace(*req.LightningAddress) != "" {
			if s.ln == nil || s.ln.Proveedor == nil {
				return nil, ErrLightningNoDisponible
			}
			if direccion, err = s.ln.Proveedor.NormalizarDireccion(*req.LightningAddress); err != nil {
				return nil, err
			}
			if direccion != actuales.LightningAddress {
				if _, err := s.ln.Proveedor.ResolverDireccion(ctx, direccion); err != nil {
					return nil, err
				}
			}
		}
	}
	var cambios []string
	if direccion != actuales.LightningAddress {
		cambios = append(cambios, "lightning_address")
	}
	if sinpe != actuales.SinpeMovil {
		cambios = append(cambios, "sinpe_movil")
	}
	if err := s.repo.GuardarMediosDeCobro(ctx, merchantID, userID, direccion, sinpe, cambios, req.Actor); err != nil {
		return nil, err
	}
	return s.MediosDelComercio(ctx, userID, m.ID)
}

// noEncontradoSiNoEsCierre: el rol que no alcanza y el comercio que no existe
// se responden igual, para no decir que comercios existen. El cierre si se dice.
//
// requireRole dice "merchant not found" sin un error centinela, y con ese mismo
// texto que ErrComercioNoEncontrado. Cualquier otro error (la base que no
// contesta al leer el rol) sigue como es, y sale como un 500: no es un comercio
// que no existe.
func noEncontradoSiNoEsCierre(err error) error {
	if errors.Is(err, ErrComercioCerrado) || errors.Is(err, ErrComercioNoEncontrado) {
		return err
	}
	if err.Error() == ErrComercioNoEncontrado.Error() {
		return ErrComercioNoEncontrado
	}
	return err
}

// ── Factura de un cobro ─────────────────────────────────────────────────────

// CrearFacturaLightning da la factura Lightning de un cobro pendiente del
// comercio. Si ya hay una con la cotizacion vigente, devuelve esa: tocar otra
// vez el boton no crea otra factura.
func (s *Service) CrearFacturaLightning(ctx context.Context, userID, chargeID string) (*CobroLightning, error) {
	cobro, err := s.repo.GetCharge(ctx, chargeID)
	if err != nil {
		return nil, ErrQRInvalido
	}
	if err := s.puedeAdministrarCobro(ctx, userID, cobro); err != nil {
		return nil, err
	}
	if cobro.MerchantID == "" {
		return nil, ErrLightningNoDisponible
	}
	ahora := s.ahora()
	if cobro.Status != EstadoCobroPendiente || !ahora.Before(cobro.ExpiresAt) {
		return nil, errorDelEstado(cobro, ahora)
	}
	m, err := s.repo.GetMerchant(ctx, cobro.MerchantID)
	if err != nil {
		return nil, err
	}
	abierto, err := s.lightningAbierto(ctx, m)
	if err != nil {
		return nil, err
	}
	if !abierto {
		return nil, ErrLightningNoDisponible
	}
	medios, err := s.repo.LeerMediosDeCobro(ctx, m.ID)
	if err != nil {
		return nil, err
	}
	if medios.LightningAddress == "" {
		return nil, ErrLightningSinDireccion
	}

	if vigente, err := s.repo.FacturaLightningVigente(ctx, cobro.ID, ahora.Add(reusoMinimo)); err != nil {
		return nil, err
	} else if vigente != nil && vigente.LightningAddress == medios.LightningAddress {
		return vigente, nil
	}

	cot, err := s.ln.Cotizar(ctx, cobro.Currency)
	if err != nil {
		return nil, err
	}
	sats, err := lightning.SatsPara(cobro.Amount, cot.PrecioBTC)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrPrecioLightning, err)
	}
	pedido, err := s.ln.Proveedor.ResolverDireccion(ctx, medios.LightningAddress)
	if err != nil {
		return nil, err
	}
	// El comentario (LUD-12) llega a la billetera del comercio con el pago: asi
	// el dueno sabe de que venta es cada entrada.
	pedida, err := s.ln.Proveedor.PedirFactura(ctx, pedido, sats*1000, "KiramoPay "+cobro.ID[:8])
	if err != nil {
		return nil, err
	}
	if !pedida.Factura.Vence.After(ahora.Add(vidaMinimaDeLaFactura)) {
		return nil, fmt.Errorf("%w: la factura vence enseguida", lightning.ErrFacturaNoCorresponde)
	}

	// La cotizacion dura lo que dure lo primero que venza: sus 10 minutos, la
	// factura o el cobro. Un cobro que vence antes no se ofrece por mas tiempo.
	venceCotizacion := ahora.Add(VigenciaCotizacionLightning)
	if pedida.Factura.Vence.Before(venceCotizacion) {
		venceCotizacion = pedida.Factura.Vence
	}
	if cobro.ExpiresAt.Before(venceCotizacion) {
		venceCotizacion = cobro.ExpiresAt
	}
	f := &CobroLightning{
		ChargeID:         cobro.ID,
		MerchantID:       m.ID,
		CreatedBy:        userID,
		LightningAddress: medios.LightningAddress,
		Invoice:          pedida.Texto,
		PaymentHash:      pedida.Factura.PaymentHash,
		AmountMsat:       sats * 1000,
		Sats:             sats,
		FiatAmount:       cobro.Amount,
		Currency:         cobro.Currency,
		BTCPrice:         cot.PrecioBTC,
		BTCUSD:           cot.BTCUSD,
		VerifyURL:        pedida.Verificar,
		QuoteExpiresAt:   venceCotizacion,
		InvoiceExpiresAt: pedida.Factura.Vence,
		Status:           EstadoLightningPendiente,
	}
	if cot.TasaUSD.IsPositive() {
		f.TasaUSD = decimal.NewNullDecimal(cot.TasaUSD)
	}
	if err := s.repo.GuardarFacturaLightning(ctx, f); err != nil {
		return nil, err
	}
	return f, nil
}

// errorDelEstado es el motivo por el que un cobro ya no acepta una factura.
func errorDelEstado(c *QRCharge, ahora time.Time) error {
	switch c.Status {
	case EstadoCobroPagado:
		return ErrCobroYaPagado
	case EstadoCobroCancelado:
		return ErrCobroCancelado
	case EstadoCobroReemplazado:
		return ErrCobroReemplazado
	case EstadoCobroVencido:
		return ErrCobroVencido
	}
	if !ahora.Before(c.ExpiresAt) {
		return ErrCobroVencido
	}
	return ErrQRInvalido
}

// ── Verificacion ────────────────────────────────────────────────────────────

// revisarLightningDelCobro consulta las facturas pendientes de un cobro. La
// llama la consulta del cobro, que la pantalla del cajero hace cada pocos
// segundos. Un fallo del proveedor no es un fallo de la consulta: se anota y
// la pantalla sigue esperando.
func (s *Service) revisarLightningDelCobro(ctx context.Context, chargeID string) {
	if s.ln == nil || s.ln.Proveedor == nil {
		return
	}
	ahora := s.ahora()
	pendientes, err := s.repo.FacturasLightningPorRevisar(ctx, chargeID, ahora, ahora.Add(-graciaDespuesDeVencer),
		ahora.Add(-esperaEntreConsultas), 5)
	if err != nil {
		s.logLightning().Error("lightning: no se pudieron leer las facturas del cobro", "charge_id", chargeID, "error", err)
		return
	}
	for i := range pendientes {
		s.verificarFactura(ctx, &pendientes[i], limiteDeConsulta)
	}
}

// RevisarLightningPendientes es el barrido: consulta las facturas pendientes
// que nadie miro hace rato y da por vencidas las que pasaron su gracia. Lo
// corre el Poller antes de vencer los cobros.
func (s *Service) RevisarLightningPendientes(ctx context.Context, lote int) (revisadas int, vencidas int64, err error) {
	if s.ln == nil || s.ln.Proveedor == nil {
		return 0, 0, nil
	}
	ahora := s.ahora()
	pendientes, err := s.repo.FacturasLightningPorRevisar(ctx, "", ahora, ahora.Add(-graciaDespuesDeVencer),
		ahora.Add(-esperaDelBarrido), lote)
	if err != nil {
		return 0, 0, err
	}
	for i := range pendientes {
		s.verificarFactura(ctx, &pendientes[i], 2*limiteDeConsulta)
	}
	vencidas, err = s.repo.VencerFacturasLightning(ctx, ahora.Add(-graciaDespuesDeVencer))
	return len(pendientes), vencidas, err
}

// verificarFactura consulta la URL de verificacion y, si la factura esta
// pagada con un preimage que corresponde, la marca pagada junto con su cobro.
//
// La consulta al proveedor y el marcado tienen cada uno su plazo: un proveedor
// lento no le deja la transaccion sin tiempo. Y el marcado no se corta si quien
// pidio el cobro se fue: el pago ya se comprobo y hay que dejarlo escrito.
func (s *Service) verificarFactura(ctx context.Context, f *CobroLightning, limite time.Duration) {
	log := s.logLightning()
	vctx, cancelarConsulta := context.WithTimeout(ctx, limite)
	v, err := s.ln.Proveedor.Verificar(vctx, f.VerifyURL)
	cancelarConsulta()
	if err != nil {
		log.Warn("lightning: no se pudo verificar la factura", "factura", f.ID, "error", err)
		return
	}
	if !v.Pagada {
		return
	}
	// "Pagada" sin un preimage que corresponda no es un pago: es un proveedor
	// que se equivoca o que miente, y con eso no se emite un comprobante.
	if !lightning.PreimageCorresponde(v.Preimage, f.PaymentHash) {
		log.Error("lightning: verificacion pagada con un preimage que no corresponde", "factura", f.ID)
		return
	}
	if v.Factura != "" && !strings.EqualFold(v.Factura, f.Invoice) {
		log.Error("lightning: la verificacion habla de otra factura", "factura", f.ID)
		return
	}
	mctx, cancelarMarcado := context.WithTimeout(context.WithoutCancel(ctx), limiteDeConsulta)
	defer cancelarMarcado()
	cobroPagado, err := s.repo.MarcarFacturaLightningPagada(mctx, f.ID, v.Preimage)
	if err != nil {
		log.Error("lightning: no se pudo marcar pagada", "factura", f.ID, "error", err)
		return
	}
	if !cobroPagado {
		// La plata llego, pero el cobro ya no estaba pendiente: se cancelo, se
		// reemplazo o lo pago alguien de KiramoPay. La factura queda pagada (el
		// contador la ve) y el cobro como estaba.
		log.Warn("lightning: pago sobre un cobro que ya no estaba pendiente", "factura", f.ID, "charge_id", f.ChargeID)
	}
}

// ── Lo que ve el contador ───────────────────────────────────────────────────

// VentasLightningDelMes son los cobros pagados por Lightning en un mes del
// calendario de quien mira. Dueno y gerente, como el reporte.
func (s *Service) VentasLightningDelMes(ctx context.Context, userID, merchantID, mes string, tzOffsetMin int) ([]VentaLightning, error) {
	if _, err := s.requireRoleParaLeer(ctx, merchantID, userID, RoleOwner, RoleManager); err != nil {
		return nil, noEncontradoSiNoEsCierre(err)
	}
	desde, hasta, err := ventanaDelMes(mes, tzOffsetMin)
	if err != nil {
		return nil, err
	}
	return s.repo.VentasLightning(ctx, merchantID, desde, hasta)
}

// ErrMesInvalido: el mes no viene como AAAA-MM.
var ErrMesInvalido = errors.New("el mes va como AAAA-MM")

func ventanaDelMes(mes string, tzOffsetMin int) (time.Time, time.Time, error) {
	t, err := time.Parse("2006-01", mes)
	if err != nil {
		return time.Time{}, time.Time{}, ErrMesInvalido
	}
	zona := time.FixedZone("client", -sanearDesfase(tzOffsetMin)*60)
	desde := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, zona)
	return desde, desde.AddDate(0, 1, 0), nil
}
