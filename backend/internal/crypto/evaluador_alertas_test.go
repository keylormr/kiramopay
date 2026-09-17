package crypto

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

// Estas pruebas no tocan la base: el almacen es un doble en memoria que aplica
// alertaCumplida, la misma regla que la consulta de CumplirAlertas (esa se
// prueba contra Postgres en evaluador_alertas_integration_test.go).

func dec(v string) decimal.Decimal { return decimal.RequireFromString(v) }

func TestAlertaCumplida_CruceHaciaArribaYHaciaAbajo(t *testing.T) {
	casos := []struct {
		nombre    string
		direccion string
		objetivo  string
		precio    string
		quiere    bool
	}{
		{"arriba: todavia debajo", "above", "100", "99.99", false},
		{"arriba: toca el objetivo", "above", "100", "100", true},
		{"arriba: lo pasa", "above", "100", "100.01", true},
		{"abajo: todavia encima", "below", "100", "100.01", false},
		{"abajo: toca el objetivo", "below", "100", "100", true},
		{"abajo: lo pasa", "below", "100", "99.99", true},
		{"sin precio no se cumple nada", "below", "100", "0", false},
		{"precio negativo no es precio", "below", "100", "-1", false},
		{"direccion desconocida", "sideways", "100", "100", false},
	}
	for _, c := range casos {
		if got := alertaCumplida(c.direccion, dec(c.objetivo), dec(c.precio)); got != c.quiere {
			t.Errorf("%s: alertaCumplida = %v, se esperaba %v", c.nombre, got, c.quiere)
		}
	}
}

// ── Dobles ──────────────────────────────────────────────────────────────────

type preciosFijos map[string]decimal.Decimal

func (p preciosFijos) PreciosVigentes() map[string]decimal.Decimal { return p }

// Un precio fijo no se refresca: el doble existe para las pruebas donde el
// cache ya esta al dia, y ahi el barrido no debe salir al proveedor.
func (p preciosFijos) RefrescarPrecios(context.Context) error {
	return errors.New("preciosFijos no deberia refrescar")
}

// feedDeMentira imita a PriceService para el refresco: arranca sin precios (el
// cache vencido se ve como "ningun precio vigente") y cada refresco los deja
// disponibles, contandose. `falla` simula un proveedor caido: el refresco
// devuelve error y no deja precios, como GetPrices degradando al cache.
type feedDeMentira struct {
	mu          sync.Mutex
	vigentes    map[string]decimal.Decimal
	alRefrescar map[string]decimal.Decimal
	refrescos   int
	falla       error
}

func (f *feedDeMentira) PreciosVigentes() map[string]decimal.Decimal {
	f.mu.Lock()
	defer f.mu.Unlock()
	copia := make(map[string]decimal.Decimal, len(f.vigentes))
	for k, v := range f.vigentes {
		copia[k] = v
	}
	return copia
}

func (f *feedDeMentira) RefrescarPrecios(context.Context) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.refrescos++
	if f.falla != nil {
		return f.falla
	}
	f.vigentes = f.alRefrescar
	return nil
}

func (f *feedDeMentira) veces() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.refrescos
}

// vencer: los precios que habia dejan de estar vigentes (nadie con la app
// abierta y el cache paso su edad maxima).
func (f *feedDeMentira) vencer() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.vigentes = nil
}

// sanar: el proveedor vuelve a responder.
func (f *feedDeMentira) sanar() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.falla = nil
}

// relojDePrueba mueve el tiempo a mano: probar el intervalo de refresco con
// esperas reales pediria una hora por caso.
type relojDePrueba struct {
	mu sync.Mutex
	t  time.Time
}

func (r *relojDePrueba) ahora() time.Time {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.t
}

func (r *relojDePrueba) avanzar(d time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.t = r.t.Add(d)
}

type almacenEnMemoria struct {
	mu        sync.Mutex
	alertas   []PriceAlertRecord
	fallaCon  map[string]error
	consultas []string
}

func (a *almacenEnMemoria) CumplirAlertas(_ context.Context, activo string, precio decimal.Decimal, limite int) ([]PriceAlertRecord, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.consultas = append(a.consultas, activo)
	if err := a.fallaCon[activo]; err != nil {
		return nil, err
	}
	var cumplidas []PriceAlertRecord
	for i := range a.alertas {
		al := &a.alertas[i]
		if len(cumplidas) == limite {
			break
		}
		if !al.Active || al.Asset != activo || !alertaCumplida(al.Direction, al.TargetPrice, precio) {
			continue
		}
		ahora := time.Now()
		p := precio
		al.Active, al.Status, al.TriggeredAt, al.TriggeredPrice = false, AlertaCumplida, &ahora, &p
		cumplidas = append(cumplidas, *al)
	}
	return cumplidas, nil
}

type aviso struct{ usuario, titulo, cuerpo, etiqueta string }

type buzon struct {
	mu     sync.Mutex
	avisos []aviso
	falla  error
}

func (b *buzon) NotifyUser(_ context.Context, userID, title, body, tag string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.avisos = append(b.avisos, aviso{userID, title, body, tag})
	return b.falla
}

func (b *buzon) total() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.avisos)
}

// candadoLibre corre siempre y cuenta cuantas veces se pidio.
type candadoLibre struct{ pedidos int }

func (c *candadoLibre) correr(ctx context.Context, fn func(context.Context) error) (bool, error) {
	c.pedidos++
	return true, fn(ctx)
}

func candadoOcupado(context.Context, func(context.Context) error) (bool, error) {
	return false, nil
}

// candadoDeCluster imita a pg_try_advisory_lock: no espera, y quien lo
// encuentra tomado se va sin correr nada.
type candadoDeCluster struct {
	mu     sync.Mutex
	tomado bool
}

func (c *candadoDeCluster) correr(ctx context.Context, fn func(context.Context) error) (bool, error) {
	c.mu.Lock()
	if c.tomado {
		c.mu.Unlock()
		return false, nil
	}
	c.tomado = true
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		c.tomado = false
		c.mu.Unlock()
	}()
	return true, fn(ctx)
}

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

func alerta(id, usuario, activo, direccion, objetivo string) PriceAlertRecord {
	return PriceAlertRecord{ID: id, UserID: usuario, Asset: activo, Direction: direccion,
		TargetPrice: dec(objetivo), Active: true, Status: AlertaActiva}
}

// ── Evaluador ───────────────────────────────────────────────────────────────

func TestEvaluador_CumpleHaciaArribaYHaciaAbajoYAvisaUnaVez(t *testing.T) {
	almacen := &almacenEnMemoria{alertas: []PriceAlertRecord{
		alerta("a1", "ana", "BTC", "above", "100"), // 101: se cumple
		alerta("a2", "ana", "BTC", "above", "200"), // 101: no
		alerta("a3", "beto", "ETH", "below", "50"), // 49: se cumple
		alerta("a4", "beto", "ETH", "below", "40"), // 49: no
	}}
	avisos := &buzon{}
	candado := &candadoLibre{}
	e := nuevoEvaluador(preciosFijos{"BTC": dec("101"), "ETH": dec("49")}, almacen, avisos,
		candado.correr, time.Minute, 0, silencio)

	if n := e.vuelta(context.Background()); n != 2 {
		t.Fatalf("primera vuelta cumplio %d alertas, se esperaban 2", n)
	}
	if avisos.total() != 2 {
		t.Fatalf("avisos = %+v, se esperaban 2", avisos.avisos)
	}
	quiere := map[string]aviso{
		"ana":  {"ana", "Alerta de precio: BTC", "BTC subió a tu precio objetivo. Abre KiramoPay para ver el detalle.", EtiquetaAvisoDeAlerta},
		"beto": {"beto", "Alerta de precio: ETH", "ETH bajó a tu precio objetivo. Abre KiramoPay para ver el detalle.", EtiquetaAvisoDeAlerta},
	}
	for _, av := range avisos.avisos {
		if av != quiere[av.usuario] {
			t.Errorf("aviso = %+v, se esperaba %+v", av, quiere[av.usuario])
		}
	}

	// La segunda vuelta con los mismos precios no repite nada.
	if n := e.vuelta(context.Background()); n != 0 {
		t.Fatalf("segunda vuelta cumplio %d alertas, se esperaban 0", n)
	}
	if avisos.total() != 2 {
		t.Fatalf("la segunda vuelta volvio a avisar: %+v", avisos.avisos)
	}
	if candado.pedidos != 2 {
		t.Fatalf("el candado se pidio %d veces, se esperaban 2", candado.pedidos)
	}
}

// Sin ningun precio vigente no hay nada que decidir: ni se consulta la base ni
// se pide el candado, que queda libre para una instancia con precios al dia.
func TestEvaluador_SinPreciosNoEvaluaNiPideElCandado(t *testing.T) {
	almacen := &almacenEnMemoria{alertas: []PriceAlertRecord{alerta("a1", "ana", "BTC", "above", "1")}}
	avisos := &buzon{}
	candado := &candadoLibre{}
	e := nuevoEvaluador(preciosFijos{}, almacen, avisos, candado.correr, time.Minute, 0, silencio)

	if n := e.vuelta(context.Background()); n != 0 {
		t.Fatalf("sin precios se cumplieron %d alertas", n)
	}
	if candado.pedidos != 0 || len(almacen.consultas) != 0 || avisos.total() != 0 {
		t.Fatalf("sin precios: candado %d, consultas %v, avisos %d; se esperaba nada",
			candado.pedidos, almacen.consultas, avisos.total())
	}
}

// Un precio vencido se trata como ausente: el barrido usa PreciosVigentes, que
// aplica el mismo corte de edad que el camino de compra y venta.
func TestEvaluador_UnPrecioViejoNoDecideNada(t *testing.T) {
	ps := NewPriceService()
	ps.cacheTTL = time.Minute
	sembrarPrecio(ps, "BTC", 65000, time.Hour)     // viejo: se cumpliria
	sembrarPrecio(ps, "ETH", 3000, 10*time.Second) // fresco: no se cumple
	almacen := &almacenEnMemoria{alertas: []PriceAlertRecord{
		alerta("a1", "ana", "BTC", "above", "60000"),
		alerta("a2", "ana", "ETH", "above", "4000"),
	}}
	avisos := &buzon{}
	e := nuevoEvaluador(ps, almacen, avisos, (&candadoLibre{}).correr, time.Minute, 0, silencio)

	if n := e.vuelta(context.Background()); n != 0 {
		t.Fatalf("con BTC vencido se cumplieron %d alertas", n)
	}
	if len(almacen.consultas) != 1 || almacen.consultas[0] != "ETH" {
		t.Fatalf("consultas = %v, solo ETH tiene precio vigente", almacen.consultas)
	}
	if !almacen.alertas[0].Active || avisos.total() != 0 {
		t.Fatal("la alerta de BTC se cumplio con un precio de hace una hora")
	}
}

func TestEvaluador_OtraInstanciaTieneElCandado(t *testing.T) {
	almacen := &almacenEnMemoria{alertas: []PriceAlertRecord{alerta("a1", "ana", "BTC", "above", "1")}}
	avisos := &buzon{}
	e := nuevoEvaluador(preciosFijos{"BTC": dec("5")}, almacen, avisos, candadoOcupado, time.Minute, 0, silencio)

	if n := e.vuelta(context.Background()); n != 0 {
		t.Fatalf("sin el candado se cumplieron %d alertas", n)
	}
	if len(almacen.consultas) != 0 || avisos.total() != 0 {
		t.Fatal("sin el candado no se toca ninguna alerta")
	}
}

// Un activo cuya consulta falla no deja sin evaluar a los demas.
func TestEvaluador_UnActivoQueFallaNoFrenaALosDemas(t *testing.T) {
	almacen := &almacenEnMemoria{
		alertas: []PriceAlertRecord{
			alerta("a1", "ana", "BTC", "above", "1"),
			alerta("a2", "ana", "ETH", "above", "1"),
		},
		fallaCon: map[string]error{"BTC": errors.New("conexion perdida")},
	}
	avisos := &buzon{}
	e := nuevoEvaluador(preciosFijos{"BTC": dec("5"), "ETH": dec("5")}, almacen, avisos,
		(&candadoLibre{}).correr, time.Minute, 0, silencio)

	if n := e.vuelta(context.Background()); n != 1 {
		t.Fatalf("se cumplieron %d alertas, se esperaba 1 (la de ETH)", n)
	}
	if avisos.total() != 1 || avisos.avisos[0].titulo != "Alerta de precio: ETH" {
		t.Fatalf("avisos = %+v, se esperaba el de ETH", avisos.avisos)
	}
}

// Un aviso que no sale no devuelve la alerta a activa: quedo cumplida y se ve
// en la pantalla.
func TestEvaluador_UnAvisoFallidoNoReactivaLaAlerta(t *testing.T) {
	almacen := &almacenEnMemoria{alertas: []PriceAlertRecord{alerta("a1", "ana", "BTC", "above", "1")}}
	avisos := &buzon{falla: errors.New("push caido")}
	e := nuevoEvaluador(preciosFijos{"BTC": dec("5")}, almacen, avisos, (&candadoLibre{}).correr, time.Minute, 0, silencio)

	if n := e.vuelta(context.Background()); n != 1 {
		t.Fatalf("se cumplieron %d alertas, se esperaba 1", n)
	}
	if n := e.vuelta(context.Background()); n != 0 || avisos.total() != 1 {
		t.Fatalf("el fallo del aviso hizo repetir la alerta: vuelta %d, avisos %d", n, avisos.total())
	}
}

// ── Refresco propio del barrido ─────────────────────────────────────────────
//
// El cache lo llena el broadcaster del WebSocket, que solo corre mientras
// alguien tiene la app abierta. Sin nadie conectado el cache se vence y una
// alerta no se cumplia nunca: por eso el barrido se permite UNA llamada al
// proveedor por intervalo cuando no tiene nada vigente.

// Cache vencido y el intervalo cumplido: una sola llamada, y despues se evalua
// con lo que llego.
func TestEvaluador_ConElCacheVencidoRefrescaUnaVezYEvalua(t *testing.T) {
	feed := &feedDeMentira{alRefrescar: map[string]decimal.Decimal{"BTC": dec("101")}}
	almacen := &almacenEnMemoria{alertas: []PriceAlertRecord{
		alerta("a1", "ana", "BTC", "above", "100"),
	}}
	avisos := &buzon{}
	reloj := &relojDePrueba{t: time.Now()}
	e := nuevoEvaluador(feed, almacen, avisos, (&candadoLibre{}).correr, time.Minute, time.Hour, silencio)
	e.ahora = reloj.ahora

	if n := e.vuelta(context.Background()); n != 1 {
		t.Fatalf("la vuelta cumplio %d alertas, se esperaba 1 con los precios recien traidos", n)
	}
	if feed.veces() != 1 {
		t.Fatalf("refrescos = %d, se esperaba exactamente 1", feed.veces())
	}
	if avisos.total() != 1 {
		t.Fatalf("avisos = %+v, se esperaba 1", avisos.avisos)
	}
	if e.UltimaRevision().IsZero() {
		t.Fatal("la revision no quedo anotada: /health no podria decir cuando se reviso")
	}

	// Los precios se vuelven a vencer antes de que toque el intervalo: la vuelta
	// espera su turno en vez de gastar otra llamada.
	feed.vencer()
	if n := e.vuelta(context.Background()); n != 0 || feed.veces() != 1 {
		t.Fatalf("dentro del intervalo: vuelta %d, refrescos %d; se esperaba 0 y 1", n, feed.veces())
	}

	// Cumplido el intervalo, vuelve a traerlos.
	reloj.avanzar(time.Hour)
	if n := e.vuelta(context.Background()); n != 0 || feed.veces() != 2 {
		t.Fatalf("pasado el intervalo: vuelta %d, refrescos %d; se esperaba 0 y 2", n, feed.veces())
	}
	if avisos.total() != 1 {
		t.Fatalf("la alerta ya cumplida volvio a avisar: %+v", avisos.avisos)
	}
}

// Con el cache al dia el barrido no gasta cuota: evalua con lo que ya hay, que
// es como venia funcionando.
func TestEvaluador_ConElCacheAlDiaNoGastaCuota(t *testing.T) {
	feed := &feedDeMentira{
		vigentes:    map[string]decimal.Decimal{"BTC": dec("101")},
		alRefrescar: map[string]decimal.Decimal{"BTC": dec("101")},
	}
	almacen := &almacenEnMemoria{alertas: []PriceAlertRecord{
		alerta("a1", "ana", "BTC", "above", "100"),
	}}
	e := nuevoEvaluador(feed, almacen, &buzon{}, (&candadoLibre{}).correr, time.Minute, time.Hour, silencio)

	if n := e.vuelta(context.Background()); n != 1 {
		t.Fatalf("la vuelta cumplio %d alertas, se esperaba 1", n)
	}
	if feed.veces() != 0 {
		t.Fatalf("refrescos = %d: con precios vigentes no se sale al proveedor", feed.veces())
	}
}

// ALERTAS_REFRESCO_HORAS=0 deja el barrido como estaba: sin precios vigentes ni
// siquiera pide el candado.
func TestEvaluador_ConElRefrescoApagadoNuncaSaleAlProveedor(t *testing.T) {
	feed := &feedDeMentira{alRefrescar: map[string]decimal.Decimal{"BTC": dec("101")}}
	almacen := &almacenEnMemoria{alertas: []PriceAlertRecord{
		alerta("a1", "ana", "BTC", "above", "100"),
	}}
	candado := &candadoLibre{}
	reloj := &relojDePrueba{t: time.Now()}
	e := nuevoEvaluador(feed, almacen, &buzon{}, candado.correr, time.Minute, 0, silencio)
	e.ahora = reloj.ahora

	for i := 0; i < 3; i++ {
		if n := e.vuelta(context.Background()); n != 0 {
			t.Fatalf("vuelta %d cumplio %d alertas con el refresco apagado", i, n)
		}
		reloj.avanzar(24 * time.Hour)
	}
	if feed.veces() != 0 || candado.pedidos != 0 {
		t.Fatalf("refresco apagado: refrescos %d, candado %d; se esperaba nada", feed.veces(), candado.pedidos)
	}
	if e.RefrescoCada() != 0 {
		t.Fatalf("RefrescoCada = %s, se esperaba 0 para que el arranque lo diga", e.RefrescoCada())
	}
}

// Dos instancias barriendo a la vez gastan UNA llamada, no dos: el refresco va
// dentro del candado de cluster. La que no lo consigue se va sin tocar nada.
func TestEvaluador_DosInstanciasEnParaleloRefrescanUnaSolaVez(t *testing.T) {
	feed := &feedDeMentira{alRefrescar: map[string]decimal.Decimal{"BTC": dec("101")}}
	almacen := &almacenEnMemoria{alertas: []PriceAlertRecord{
		alerta("a1", "ana", "BTC", "above", "100"),
	}}
	avisos := &buzon{}
	candado := &candadoDeCluster{}

	// La que entra se queda dentro hasta que la otra haya intentado. Sin esta
	// cita, la prueba pasaria por el orden del reloj y no por el candado.
	adentro := make(chan struct{})
	laOtraYaIntento := make(chan struct{})
	candadoConCita := func(ctx context.Context, fn func(context.Context) error) (bool, error) {
		return candado.correr(ctx, func(c context.Context) error {
			close(adentro)
			<-laOtraYaIntento
			return fn(c)
		})
	}

	lider := nuevoEvaluador(feed, almacen, avisos, candadoConCita, time.Minute, time.Hour, silencio)
	seguidora := nuevoEvaluador(feed, almacen, avisos, candado.correr, time.Minute, time.Hour, silencio)

	listo := make(chan int, 1)
	go func() { listo <- lider.vuelta(context.Background()) }()

	<-adentro
	if n := seguidora.vuelta(context.Background()); n != 0 {
		t.Errorf("la instancia sin candado cumplio %d alertas", n)
	}
	close(laOtraYaIntento)

	if n := <-listo; n != 1 {
		t.Fatalf("la instancia con el candado cumplio %d alertas, se esperaba 1", n)
	}
	if feed.veces() != 1 {
		t.Fatalf("refrescos = %d, se esperaba 1: las dos instancias gastaron cuota", feed.veces())
	}
	if avisos.total() != 1 {
		t.Fatalf("avisos = %+v, se esperaba 1", avisos.avisos)
	}
	if !seguidora.UltimaRevision().IsZero() {
		t.Error("la instancia que no consiguio el candado anoto una revision que no hizo")
	}
}

// Un proveedor caido no deja la vuelta a medias (no marca ni avisa nada), no se
// convierte en una llamada por minuto, y cuando el proveedor vuelve la alerta
// se cumple UNA sola vez.
func TestEvaluador_UnProveedorCaidoNoDejaLaVueltaAMedias(t *testing.T) {
	feed := &feedDeMentira{
		alRefrescar: map[string]decimal.Decimal{"BTC": dec("101")},
		falla:       errors.New("429 del proveedor"),
	}
	almacen := &almacenEnMemoria{alertas: []PriceAlertRecord{
		alerta("a1", "ana", "BTC", "above", "100"),
	}}
	avisos := &buzon{}
	reloj := &relojDePrueba{t: time.Now()}
	e := nuevoEvaluador(feed, almacen, avisos, (&candadoLibre{}).correr, time.Minute, time.Hour, silencio)
	e.ahora = reloj.ahora

	if n := e.vuelta(context.Background()); n != 0 {
		t.Fatalf("con el proveedor caido se cumplieron %d alertas", n)
	}
	if len(almacen.consultas) != 0 || avisos.total() != 0 || !almacen.alertas[0].Active {
		t.Fatalf("el refresco fallido toco alertas: consultas %v, avisos %d, activa %v",
			almacen.consultas, avisos.total(), almacen.alertas[0].Active)
	}
	if !e.UltimaRevision().IsZero() {
		t.Error("se anoto una revision que no llego a comparar nada")
	}

	// El intento gastado cuenta igual: un proveedor caido no puede quemar la
	// cuota del mes a una llamada por minuto.
	if n := e.vuelta(context.Background()); n != 0 || feed.veces() != 1 {
		t.Fatalf("tras el fallo: vuelta %d, refrescos %d; se esperaba 0 y 1", n, feed.veces())
	}

	feed.sanar()
	reloj.avanzar(time.Hour)
	if n := e.vuelta(context.Background()); n != 1 || avisos.total() != 1 {
		t.Fatalf("recuperado el proveedor: vuelta %d, avisos %d; se esperaba 1 y 1", n, avisos.total())
	}
	if n := e.vuelta(context.Background()); n != 0 || avisos.total() != 1 {
		t.Fatalf("el fallo anterior hizo repetir el aviso: vuelta %d, avisos %d", n, avisos.total())
	}
}

// El texto sale en la pantalla de bloqueo: ningun monto, ni el objetivo ni el
// precio con que se cumplio.
func TestTextoDelAviso_NoLlevaMontos(t *testing.T) {
	precio := dec("64999.5")
	for _, dir := range []string{"above", "below"} {
		a := &PriceAlertRecord{Asset: "BTC", Direction: dir, TargetPrice: dec("65000"), TriggeredPrice: &precio}
		titulo, cuerpo := textoDelAviso(a)
		if regexp.MustCompile(`[0-9$₡]`).MatchString(titulo + cuerpo) {
			t.Fatalf("%s: el aviso lleva montos: %q / %q", dir, titulo, cuerpo)
		}
	}
}

// ── Precios vigentes ────────────────────────────────────────────────────────

func TestPreciosVigentes_SoloLosQueEstanAlDia(t *testing.T) {
	ps := NewPriceService()
	ps.cacheTTL = time.Minute
	sembrarPrecio(ps, "BTC", 65000, 10*time.Second) // fresco
	sembrarPrecio(ps, "ETH", 3000, time.Hour)       // viejo
	sembrarPrecio(ps, "SOL", 0, 0)                  // sin precio
	ps.mu.Lock()
	ps.cache["ADA"] = &PriceData{Symbol: "ADA", Price: 1} // sin sello ni exito previo
	ps.mu.Unlock()

	vigentes := ps.PreciosVigentes()
	if len(vigentes) != 1 || !vigentes["BTC"].Equal(dec("65000")) {
		t.Fatalf("PreciosVigentes = %v, se esperaba solo BTC a 65000", vigentes)
	}
}

// PreciosVigentes no sale al proveedor aunque el cache este vencido: la cuota
// de la clave la administra el broadcaster.
func TestPreciosVigentes_NuncaLlamaAlProveedor(t *testing.T) {
	ps := NewPriceService()
	ps.SetBaseURL("http://127.0.0.1:1") // cualquier llamada fallaria y abriria el breaker
	if got := ps.PreciosVigentes(); len(got) != 0 {
		t.Fatalf("cache vacio: PreciosVigentes = %v", got)
	}
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	if ps.consecutiveFailures != 0 || ps.lastStatus != 0 {
		t.Fatalf("PreciosVigentes intento llamar al proveedor (fallos %d, status %d)",
			ps.consecutiveFailures, ps.lastStatus)
	}
}

// ── Crear una alerta que ya se cumple ───────────────────────────────────────

func TestValidarAlerta_RechazaLaQueYaSeCumple(t *testing.T) {
	ps := NewPriceService()
	ps.cacheTTL = time.Minute
	sembrarPrecio(ps, "BTC", 1000, 0)
	s := &Service{prices: ps}

	casos := []struct {
		direccion, objetivo string
		quiere              error
	}{
		{"above", "900", ErrAlertaYaCumplida},
		{"above", "1000", ErrAlertaYaCumplida},
		{"above", "1100", nil},
		{"below", "1100", ErrAlertaYaCumplida},
		{"below", "1000", ErrAlertaYaCumplida},
		{"below", "900", nil},
	}
	for _, c := range casos {
		a := PriceAlertRecord{Asset: "BTC", Direction: c.direccion, TargetPrice: dec(c.objetivo)}
		if err := s.validarAlerta(context.Background(), &a); !errors.Is(err, c.quiere) {
			t.Errorf("%s %s con BTC a 1000: err = %v, se esperaba %v", c.direccion, c.objetivo, err, c.quiere)
		}
	}
}

// Sin precio vigente no se puede saber si ya se cumple: la alerta se acepta, y
// el barrido la resolvera cuando haya precio.
func TestValidarAlerta_SinPrecioVigenteNoSeRechazaPorYaCumplida(t *testing.T) {
	ps := NewPriceService()
	ps.cacheTTL = time.Minute
	sembrarPrecio(ps, "BTC", 1000, time.Hour)
	s := &Service{prices: ps}

	a := PriceAlertRecord{Asset: "BTC", Direction: "above", TargetPrice: dec("900")}
	if err := s.validarAlerta(context.Background(), &a); err != nil {
		t.Fatalf("con el precio vencido la alerta se rechazo: %v", err)
	}
}
