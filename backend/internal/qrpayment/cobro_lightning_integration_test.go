package qrpayment_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/lightning"
	"github.com/kiramopay/backend/internal/lightning/lnprueba"
	"github.com/kiramopay/backend/internal/qrpayment"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/user"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

// Cobrar con Lightning en la billetera propia del comercio. La direccion es un
// servidor LNURL de mentira (lnprueba) y el precio, fijo: un bitcoin vale 40
// millones de colones, asi que 5.000 colones son 12.500 sats.
//
// Lo que estas pruebas cuidan: un cobro se marca pagado por Lightning SOLO con
// un preimage que corresponde al payment hash de la factura, y nunca por el
// "pagado" del proveedor a secas. Y que nada de esto toca el libro.

// reloj de las pruebas: la consulta al proveedor tiene una pausa minima entre
// una y otra, y se adelanta a mano para no dormir.
type reloj struct {
	mu sync.Mutex
	t  time.Time
}

func (r *reloj) ahora() time.Time { r.mu.Lock(); defer r.mu.Unlock(); return r.t }
func (r *reloj) avanzar(d time.Duration) {
	r.mu.Lock()
	r.t = r.t.Add(d)
	r.mu.Unlock()
}

type entornoLightning struct {
	svc   *qrpayment.Service
	pool  *pgxpool.Pool
	owner string
	ajeno string
	srv   *lnprueba.Servidor
	reloj *reloj
}

func setupLightning(t *testing.T, enEspera bool) *entornoLightning {
	t.Helper()
	pool := testutil.TestDB(t)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l, nil)
	srv := lnprueba.Nuevo(t)
	rel := &reloj{t: time.Now()}
	svc := qrpayment.NewService(qrpayment.NewRepository(pool), txSvc, user.NewRepository(pool), &qrpayment.Options{
		Lightning: &qrpayment.OpcionesLightning{
			Proveedor: srv.Cliente(),
			Cotizar: func(_ context.Context, moneda string) (qrpayment.Cotizacion, error) {
				if moneda == "USD" {
					return qrpayment.Cotizacion{PrecioBTC: decimal.NewFromInt(80_000), BTCUSD: decimal.NewFromInt(80_000)}, nil
				}
				return qrpayment.Cotizacion{PrecioBTC: decimal.NewFromInt(40_000_000), BTCUSD: decimal.NewFromInt(80_000),
					TasaUSD: decimal.NewFromInt(500)}, nil
			},
			EnEspera: enEspera,
			Ahora:    rel.ahora,
		},
	})
	pinHash, _ := hash.HashPin("Kiramopay2024!")
	ajeno := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	owner := testutil.SeedTestUser2(t, pool)
	return &entornoLightning{svc: svc, pool: pool, owner: owner, ajeno: ajeno, srv: srv, reloj: rel}
}

// comercioConLightning: comercio verificado, con la direccion vinculada, su
// rotulo y un cobro de 5.000 colones.
func (e *entornoLightning) comercioConLightning(t *testing.T) (*qrpayment.Merchant, *qrpayment.QRCharge) {
	t.Helper()
	m := comercioVerificado(t, e.svc, e.owner)
	direccion := e.srv.Direccion("soda")
	if _, err := e.svc.GuardarMediosDeCobro(context.Background(), e.owner, m.ID,
		&qrpayment.GuardarMediosRequest{LightningAddress: &direccion}); err != nil {
		t.Fatalf("vincular la direccion: %v", err)
	}
	code := rotuloDelComercio(t, e.svc, e.owner, m.ID)
	return m, cobrar(t, e.svc, e.owner, code.ID, 500_000)
}

func (e *entornoLightning) consultar(t *testing.T, userID, chargeID string) *qrpayment.QRCharge {
	t.Helper()
	e.reloj.avanzar(5 * time.Second)
	c, err := e.svc.GetCharge(context.Background(), userID, chargeID)
	if err != nil {
		t.Fatalf("consultar el cobro: %v", err)
	}
	return c
}

func TestLightning_ElCobroSePagaConElPreimageYNoTocaElLibro(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	m, cobro := e.comercioConLightning(t)

	f, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID)
	if err != nil {
		t.Fatalf("factura: %v", err)
	}
	if f.Sats != 12_500 || f.FiatAmount != 500_000 || f.Currency != "CRC" || f.Status != qrpayment.EstadoLightningPendiente {
		t.Fatalf("factura: %+v", f)
	}
	leida, err := lightning.DecodificarFactura(f.Invoice)
	if err != nil || leida.MontoMsat != 12_500_000 || leida.PaymentHash != f.PaymentHash {
		t.Fatalf("la factura no es por 12.500 sats: %+v %v", leida, err)
	}
	if e.srv.UltimoComentario != "KiramoPay "+cobro.ID[:8] {
		t.Errorf("comentario = %q", e.srv.UltimoComentario)
	}
	if got := f.QuoteExpiresAt.Sub(e.reloj.ahora()); got != qrpayment.VigenciaCotizacionLightning {
		t.Errorf("la cotizacion dura %v", got)
	}

	// Tocar otra vez no pide otra factura mientras la cotizacion sigue vigente.
	otra, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID)
	if err != nil || otra.ID != f.ID || e.srv.Pedidos != 1 {
		t.Fatalf("segunda vez: %+v %v (pedidos %d)", otra, err, e.srv.Pedidos)
	}

	// Sin pagar, sigue pendiente.
	c := e.consultar(t, e.owner, cobro.ID)
	if c.Status != qrpayment.EstadoCobroPendiente || c.Lightning == nil || c.Lightning.Status != qrpayment.EstadoLightningPendiente {
		t.Fatalf("sin pagar: %+v", c)
	}

	e.srv.Pagar(f.PaymentHash)
	c = e.consultar(t, e.owner, cobro.ID)
	if c.Status != qrpayment.EstadoCobroPagado || c.PaidVia != qrpayment.PagadoPorLightning || c.PaidAt == nil {
		t.Fatalf("pagado: %+v", c)
	}
	if c.Lightning == nil || c.Lightning.Status != qrpayment.EstadoLightningPagada || c.Lightning.PaidAt == nil {
		t.Fatalf("factura pagada: %+v", c.Lightning)
	}
	if c.PaidBy != "" || c.PaidTxID != "" {
		t.Fatalf("un cobro por Lightning no tiene pagador ni asiento: %+v", c)
	}

	// Nada en el libro ni en las ventas de KiramoPay.
	var ventas int
	if err := e.pool.QueryRow(ctx, `SELECT COUNT(*) FROM qr_payments WHERE charge_id = $1`, cobro.ID).Scan(&ventas); err != nil {
		t.Fatal(err)
	}
	if ventas != 0 {
		t.Fatalf("el cobro por Lightning dejo %d ventas en el libro", ventas)
	}

	// Y el contador lo ve, con el precio de la venta y los sats.
	mes := time.Now().In(time.FixedZone("cr", -6*3600)).Format("2006-01")
	lista, err := e.svc.VentasLightningDelMes(ctx, e.owner, m.ID, mes, 360)
	if err != nil {
		t.Fatalf("ventas del mes: %v", err)
	}
	if len(lista) != 1 || lista[0].FiatAmount != 500_000 || lista[0].Sats != 12_500 ||
		lista[0].ChargeID != cobro.ID || !lista[0].BTCPrice.Equal(decimal.NewFromInt(40_000_000)) {
		t.Fatalf("ventas del mes: %+v", lista)
	}
}

// Un proveedor que dice "pagada" con un preimage que no corresponde no produce
// un cobro pagado: no hay comprobante de un cobro que nadie recibio.
func TestLightning_UnPreimageQueNoCorrespondeNoPagaNada(t *testing.T) {
	e := setupLightning(t, false)
	_, cobro := e.comercioConLightning(t)
	f, err := e.svc.CrearFacturaLightning(context.Background(), e.owner, cobro.ID)
	if err != nil {
		t.Fatal(err)
	}
	e.srv.PreimageFalso = true
	e.srv.Pagar(f.PaymentHash)
	c := e.consultar(t, e.owner, cobro.ID)
	if c.Status != qrpayment.EstadoCobroPendiente || c.Lightning.Status != qrpayment.EstadoLightningPendiente {
		t.Fatalf("se marco pagado sin prueba de pago: %+v / %+v", c, c.Lightning)
	}
}

// La consulta del cajero no le pregunta al proveedor en cada toque.
func TestLightning_LaVerificacionTienePausa(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	_, cobro := e.comercioConLightning(t)
	if _, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.GetCharge(ctx, e.owner, cobro.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.GetCharge(ctx, e.owner, cobro.ID); err != nil {
		t.Fatal(err)
	}
	if e.srv.Verificaciones != 1 {
		t.Fatalf("dos consultas seguidas hicieron %d verificaciones", e.srv.Verificaciones)
	}
	e.reloj.avanzar(5 * time.Second)
	if _, err := e.svc.GetCharge(ctx, e.owner, cobro.ID); err != nil {
		t.Fatal(err)
	}
	if e.srv.Verificaciones != 2 {
		t.Fatalf("pasada la pausa, %d verificaciones", e.srv.Verificaciones)
	}
}

// En produccion espera: solo los comercios de una cuenta demo lo tienen.
func TestLightning_EnEsperaSoloParaCuentasDemo(t *testing.T) {
	e := setupLightning(t, true)
	ctx := context.Background()
	m, cobro := e.comercioConLightning(t)

	if _, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID); !errors.Is(err, qrpayment.ErrLightningNoDisponible) {
		t.Fatalf("en espera: %v", err)
	}
	medios, err := e.svc.MediosDelComercio(ctx, e.owner, m.ID)
	if err != nil || medios.LightningEnabled {
		t.Fatalf("medios en espera: %+v %v", medios, err)
	}
	if e.srv.Pedidos != 0 {
		t.Fatalf("en espera se pidio una factura")
	}

	if _, err := e.pool.Exec(ctx, `UPDATE users SET demo_login = true WHERE id = $1`, e.owner); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID); err != nil {
		t.Fatalf("cuenta demo: %v", err)
	}
}

func TestLightning_SinDireccionNoHayFactura(t *testing.T) {
	e := setupLightning(t, false)
	m := comercioVerificado(t, e.svc, e.owner)
	code := rotuloDelComercio(t, e.svc, e.owner, m.ID)
	cobro := cobrar(t, e.svc, e.owner, code.ID, 500_000)
	if _, err := e.svc.CrearFacturaLightning(context.Background(), e.owner, cobro.ID); !errors.Is(err, qrpayment.ErrLightningSinDireccion) {
		t.Fatalf("error %v", err)
	}
}

// El cajero cobra con Lightning, pero la direccion la pone solo el dueno.
func TestLightning_ElCajeroCobraYNoConfigura(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	m, cobro := e.comercioConLightning(t)
	cajero := seedEmployee(t, e.pool, "303330333")
	if _, err := e.svc.AddStaff(ctx, m.ID, e.owner, &qrpayment.AddStaffRequest{Cedula: "303330333", Role: "cashier"}); err != nil {
		t.Fatal(err)
	}

	if _, err := e.svc.CrearFacturaLightning(ctx, cajero, cobro.ID); err != nil {
		t.Fatalf("el cajero no pudo cobrar: %v", err)
	}
	medios, err := e.svc.MediosDelComercio(ctx, cajero, m.ID)
	if err != nil || medios.CanEdit || medios.LightningAddress == "" || !medios.LightningEnabled {
		t.Fatalf("medios del cajero: %+v %v", medios, err)
	}
	otra := "otro@" + e.srv.Host
	if _, err := e.svc.GuardarMediosDeCobro(ctx, cajero, m.ID, &qrpayment.GuardarMediosRequest{LightningAddress: &otra}); !errors.Is(err, qrpayment.ErrComercioNoEncontrado) {
		t.Fatalf("el cajero cambio la direccion: %v", err)
	}

	// Alguien de afuera no ve nada.
	ajeno := e.ajeno
	if _, err := e.svc.MediosDelComercio(ctx, ajeno, m.ID); !errors.Is(err, qrpayment.ErrComercioNoEncontrado) {
		t.Fatalf("un ajeno leyo los medios: %v", err)
	}
	if _, err := e.svc.CrearFacturaLightning(ctx, ajeno, cobro.ID); !errors.Is(err, qrpayment.ErrQRInvalido) {
		t.Fatalf("un ajeno pidio la factura: %v", err)
	}
	if _, err := e.svc.VentasLightningDelMes(ctx, cajero, m.ID, "2026-11", 360); !errors.Is(err, qrpayment.ErrComercioNoEncontrado) {
		t.Fatalf("el cajero leyo las ventas para el contador: %v", err)
	}
}

func TestLightning_UnCobroQueYaNoEstaPendienteNoDaFactura(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	_, cobro := e.comercioConLightning(t)
	if err := e.svc.CancelCharge(ctx, e.owner, cobro.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID); !errors.Is(err, qrpayment.ErrCobroCancelado) {
		t.Fatalf("error %v", err)
	}
	if e.srv.Pedidos != 0 {
		t.Fatal("se pidio una factura para un cobro cancelado")
	}
}

// La factura puede durar mas que el cobro. Si el turista pago, el barrido marca
// pagado el cobro aunque ya se hubiera vencido: la plata llego.
func TestLightning_ElBarridoMarcaPagadoUnCobroVencido(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	_, cobro := e.comercioConLightning(t)
	f, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx,
		`UPDATE qr_charges SET status = 'expired', expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, cobro.ID); err != nil {
		t.Fatal(err)
	}
	e.srv.Pagar(f.PaymentHash)
	e.reloj.avanzar(time.Minute)
	revisadas, _, err := e.svc.RevisarLightningPendientes(ctx, 25)
	if err != nil || revisadas != 1 {
		t.Fatalf("barrido: %d %v", revisadas, err)
	}
	var estado, via string
	if err := e.pool.QueryRow(ctx, `SELECT status, COALESCE(paid_via, '') FROM qr_charges WHERE id = $1`, cobro.ID).Scan(&estado, &via); err != nil {
		t.Fatal(err)
	}
	if estado != "paid" || via != "lightning" {
		t.Fatalf("cobro: %s / %s", estado, via)
	}
}

// Pagar una factura de un cobro cancelado: la factura queda pagada y el
// contador la ve, pero el cobro sigue cancelado. Decirle "pagado" a un cobro
// cancelado le borraria al cajero la razon por la que lo cancelo.
func TestLightning_PagoSobreUnCobroCanceladoQuedaEnLasVentas(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	m, cobro := e.comercioConLightning(t)
	f, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.svc.CancelCharge(ctx, e.owner, cobro.ID); err != nil {
		t.Fatal(err)
	}
	e.srv.Pagar(f.PaymentHash)
	e.reloj.avanzar(time.Minute)
	if _, _, err := e.svc.RevisarLightningPendientes(ctx, 25); err != nil {
		t.Fatal(err)
	}
	c := e.consultar(t, e.owner, cobro.ID)
	if c.Status != qrpayment.EstadoCobroCancelado || c.Lightning == nil || c.Lightning.Status != qrpayment.EstadoLightningPagada {
		t.Fatalf("cobro: %+v, factura %+v", c, c.Lightning)
	}
	mes := time.Now().In(time.FixedZone("cr", -6*3600)).Format("2006-01")
	lista, err := e.svc.VentasLightningDelMes(ctx, e.owner, m.ID, mes, 360)
	if err != nil || len(lista) != 1 || lista[0].ChargeStatus != qrpayment.EstadoCobroCancelado {
		t.Fatalf("ventas: %+v %v", lista, err)
	}
}

// Pasada la gracia despues de vencer, la factura sin pagar queda vencida.
func TestLightning_LaFacturaSinPagarVence(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	_, cobro := e.comercioConLightning(t)
	f, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID)
	if err != nil {
		t.Fatal(err)
	}
	e.reloj.avanzar(f.InvoiceExpiresAt.Sub(e.reloj.ahora()) + 16*time.Minute)
	_, vencidas, err := e.svc.RevisarLightningPendientes(ctx, 25)
	if err != nil || vencidas != 1 {
		t.Fatalf("vencidas %d, %v", vencidas, err)
	}
	// Y una vencida ya no se marca pagada aunque el proveedor cambie de idea.
	e.srv.Pagar(f.PaymentHash)
	if _, _, err := e.svc.RevisarLightningPendientes(ctx, 25); err != nil {
		t.Fatal(err)
	}
	var estado string
	if err := e.pool.QueryRow(ctx, `SELECT status FROM qr_charge_lightning WHERE id = $1`, f.ID).Scan(&estado); err != nil {
		t.Fatal(err)
	}
	if estado != qrpayment.EstadoLightningVencida {
		t.Fatalf("estado %s", estado)
	}
}

// Si el dueno cambia la direccion, la factura vigente de la anterior no se
// reusa: el bitcoin iria a la billetera de antes.
func TestLightning_CambiarLaDireccionPideOtraFactura(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	m, cobro := e.comercioConLightning(t)
	primera, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID)
	if err != nil {
		t.Fatal(err)
	}
	nueva := e.srv.Direccion("soda2")
	if _, err := e.svc.GuardarMediosDeCobro(ctx, e.owner, m.ID, &qrpayment.GuardarMediosRequest{LightningAddress: &nueva}); err != nil {
		t.Fatal(err)
	}
	segunda, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID)
	if err != nil || segunda.ID == primera.ID || e.srv.Pedidos != 2 {
		t.Fatalf("segunda: %+v %v (pedidos %d)", segunda, err, e.srv.Pedidos)
	}
}

func TestLightning_GuardarLosMediosDeCobro(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	m := comercioVerificado(t, e.svc, e.owner)
	cadena := func(s string) *string { return &s }

	if _, err := e.svc.GuardarMediosDeCobro(ctx, e.owner, m.ID,
		&qrpayment.GuardarMediosRequest{LightningAddress: cadena("soda@evil.example")}); !errors.Is(err, lightning.ErrDominioNoPermitido) {
		t.Fatalf("dominio fuera de la lista: %v", err)
	}
	e.srv.Error = "no existe"
	if _, err := e.svc.GuardarMediosDeCobro(ctx, e.owner, m.ID,
		&qrpayment.GuardarMediosRequest{LightningAddress: cadena(e.srv.Direccion("nadie"))}); !errors.Is(err, lightning.ErrProveedor) {
		t.Fatalf("direccion que no existe: %v", err)
	}
	e.srv.Error = ""
	if _, err := e.svc.GuardarMediosDeCobro(ctx, e.owner, m.ID,
		&qrpayment.GuardarMediosRequest{SinpeMovil: cadena("2222-2222")}); !errors.Is(err, qrpayment.ErrSinpeMovilInvalido) {
		t.Fatalf("un fijo como SINPE Movil: %v", err)
	}

	medios, err := e.svc.GuardarMediosDeCobro(ctx, e.owner, m.ID, &qrpayment.GuardarMediosRequest{
		LightningAddress: cadena("  SODA@" + e.srv.Host + " "), SinpeMovil: cadena("+506 8888-7777"),
	})
	if err != nil || medios.LightningAddress != "soda@"+e.srv.Host || medios.SinpeMovil != "88887777" || !medios.CanEdit {
		t.Fatalf("guardar: %+v %v", medios, err)
	}
	// Un campo ausente queda igual; uno vacio se quita.
	medios, err = e.svc.GuardarMediosDeCobro(ctx, e.owner, m.ID, &qrpayment.GuardarMediosRequest{SinpeMovil: cadena("")})
	if err != nil || medios.SinpeMovil != "" || medios.LightningAddress != "soda@"+e.srv.Host {
		t.Fatalf("quitar el SINPE: %+v %v", medios, err)
	}
}

// La cotizacion no dura mas que el cobro: uno al que le quedan 5 minutos no
// se ofrece por 10.
func TestLightning_LaCotizacionNoPasaDelCobro(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	_, cobro := e.comercioConLightning(t)
	e.reloj.avanzar(cobro.ExpiresAt.Sub(e.reloj.ahora()) - 5*time.Minute)
	f, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID)
	if err != nil {
		t.Fatal(err)
	}
	if f.QuoteExpiresAt.After(cobro.ExpiresAt) {
		t.Fatalf("la cotizacion vence %v y el cobro %v", f.QuoteExpiresAt, cobro.ExpiresAt)
	}
	if got := f.QuoteExpiresAt.Sub(e.reloj.ahora()); got > 5*time.Minute+time.Second {
		t.Fatalf("la cotizacion dura %v", got)
	}
}

// Una factura que vence enseguida no se muestra ni se guarda: no daria tiempo
// de pagarla.
func TestLightning_UnaFacturaQueVenceEnseguidaNoSeMuestra(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	_, cobro := e.comercioConLightning(t)
	e.srv.Plazo = 60
	if _, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID); !errors.Is(err, lightning.ErrFacturaNoCorresponde) {
		t.Fatalf("error %v", err)
	}
	var n int
	if err := e.pool.QueryRow(ctx, `SELECT COUNT(*) FROM qr_charge_lightning WHERE charge_id = $1`, cobro.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("guardo %d facturas (%v)", n, err)
	}
}

// "Pagada" con el preimage correcto, pero hablando de otra factura: no paga.
func TestLightning_LaVerificacionDeOtraFacturaNoPaga(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	_, cobro := e.comercioConLightning(t)
	if _, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID); err != nil {
		t.Fatal(err)
	}
	e.srv.FacturaAjena = true
	e.srv.PagarTodas()
	c := e.consultar(t, e.owner, cobro.ID)
	if e.srv.Verificaciones == 0 {
		t.Fatal("no se consulto la verificacion")
	}
	if c.Status != qrpayment.EstadoCobroPendiente || c.Lightning == nil || c.Lightning.Status != qrpayment.EstadoLightningPendiente {
		t.Fatalf("se dio por pagado: %+v", c)
	}
}

// Pasados los 10 minutos, la cotizacion vieja no se reusa: se pide otra.
func TestLightning_LaCotizacionVencidaNoSeReusa(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	_, cobro := e.comercioConLightning(t)
	primera, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID)
	if err != nil {
		t.Fatal(err)
	}
	e.reloj.avanzar(qrpayment.VigenciaCotizacionLightning)
	segunda, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID)
	if err != nil || segunda.ID == primera.ID || e.srv.Pedidos != 2 {
		t.Fatalf("segunda: %+v %v (pedidos %d)", segunda, err, e.srv.Pedidos)
	}
}

// Una factura vencida que se pago dentro de la gracia si paga el cobro: el
// pago pudo salir justo antes de vencer.
func TestLightning_PagadaDentroDeLaGracia(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	_, cobro := e.comercioConLightning(t)
	f, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID)
	if err != nil {
		t.Fatal(err)
	}
	e.reloj.avanzar(f.InvoiceExpiresAt.Sub(e.reloj.ahora()) + 5*time.Minute)
	e.srv.Pagar(f.PaymentHash)
	if _, _, err := e.svc.RevisarLightningPendientes(ctx, 25); err != nil {
		t.Fatal(err)
	}
	var estado, via string
	if err := e.pool.QueryRow(ctx,
		`SELECT l.status, COALESCE(c.paid_via, '') FROM qr_charge_lightning l
		   JOIN qr_charges c ON c.id = l.charge_id WHERE l.id = $1`, f.ID).Scan(&estado, &via); err != nil {
		t.Fatal(err)
	}
	if estado != qrpayment.EstadoLightningPagada || via != "lightning" {
		t.Fatalf("factura %s, cobro pagado por %q", estado, via)
	}
}

// Con dos facturas del cobro, se muestra la que se pago aunque haya otra mas
// nueva sin pagar.
func TestLightning_SeMuestraLaFacturaPagada(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	m, cobro := e.comercioConLightning(t)
	primera, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID)
	if err != nil {
		t.Fatal(err)
	}
	nueva := e.srv.Direccion("soda2")
	if _, err := e.svc.GuardarMediosDeCobro(ctx, e.owner, m.ID, &qrpayment.GuardarMediosRequest{LightningAddress: &nueva}); err != nil {
		t.Fatal(err)
	}
	segunda, err := e.svc.CrearFacturaLightning(ctx, e.owner, cobro.ID)
	if err != nil || segunda.ID == primera.ID {
		t.Fatalf("segunda: %+v %v", segunda, err)
	}
	e.srv.Pagar(primera.PaymentHash)
	c := e.consultar(t, e.owner, cobro.ID)
	if c.Status != qrpayment.EstadoCobroPagado || c.Lightning == nil || c.Lightning.ID != primera.ID ||
		c.Lightning.Status != qrpayment.EstadoLightningPagada {
		t.Fatalf("se muestra %+v", c.Lightning)
	}
}

// Cambiar a donde va el dinero deja rastro: quien, desde donde y que campo.
// Guardar lo mismo otra vez no deja otro.
func TestLightning_CambiarLosMediosDejaRastro(t *testing.T) {
	e := setupLightning(t, false)
	ctx := context.Background()
	m := comercioVerificado(t, e.svc, e.owner)
	direccion := e.srv.Direccion("soda")
	actor := qrpayment.ActorContext{IPAddress: "203.0.113.7", UserAgent: "prueba"}
	for i := 0; i < 2; i++ {
		if _, err := e.svc.GuardarMediosDeCobro(ctx, e.owner, m.ID,
			&qrpayment.GuardarMediosRequest{LightningAddress: &direccion, Actor: actor}); err != nil {
			t.Fatal(err)
		}
	}
	sinpe := "88887777"
	if _, err := e.svc.GuardarMediosDeCobro(ctx, e.owner, m.ID,
		&qrpayment.GuardarMediosRequest{SinpeMovil: &sinpe, Actor: actor}); err != nil {
		t.Fatal(err)
	}
	contar := func(filtro string) int {
		t.Helper()
		var n int
		if err := e.pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM audit_logs
			  WHERE action = $1 AND resource_id = $2 AND user_id = $3::uuid
			    AND host(ip_address) = '203.0.113.7' AND user_agent = 'prueba' AND `+filtro,
			qrpayment.AccionMediosDeCobro, m.ID, e.owner).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := contar(`TRUE`); n != 2 {
		t.Fatalf("%d rastros, quiero 2 (la direccion y el SINPE)", n)
	}
	if n := contar(`risk_level = 'high' AND details->'changed' @> '["lightning_address"]'`); n != 1 {
		t.Fatalf("el cambio de direccion: %d", n)
	}
	if n := contar(`risk_level = 'medium' AND details->'changed' @> '["sinpe_movil"]'`); n != 1 {
		t.Fatalf("el cambio de SINPE: %d", n)
	}
}
