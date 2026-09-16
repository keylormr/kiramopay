package transparency

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/plans"
	"github.com/kiramopay/backend/internal/qrpayment"
)

// leerFeesDe ejecuta el endpoint publico y devuelve el JSON decodificado y el
// cuerpo crudo. El handler no toca la base para esta ruta, por eso el pool va
// nulo: si algun dia la tocara, la prueba lo dira con un panico en vez de
// pasar callada.
func leerFeesDe(t *testing.T, h *Handler) (map[string]any, string) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.Fees(rec, httptest.NewRequest(http.MethodGet, "/api/v1/transparency/fees", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("codigo %d, se esperaba 200", rec.Code)
	}
	// response.JSON envuelve todo en {"success":true,"data":{...}}.
	var sobre struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sobre); err != nil {
		t.Fatalf("respuesta no es JSON: %v", err)
	}
	return sobre.Data, rec.Body.String()
}

func leerFees(t *testing.T) map[string]any {
	t.Helper()
	datos, _ := leerFeesDe(t, NewHandler(nil))
	return datos
}

// planesPorCodigo indexa los planes anunciados por su codigo.
func planesPorCodigo(t *testing.T, datos map[string]any) map[string]map[string]any {
	t.Helper()
	planes, ok := datos["plans"].(map[string]any)
	if !ok {
		t.Fatal("falta el bloque plans")
	}
	anunciados, _ := planes["announced"].([]any)
	out := map[string]map[string]any{}
	for _, a := range anunciados {
		p, _ := a.(map[string]any)
		codigo, _ := p["code"].(string)
		out[codigo] = p
	}
	return out
}

// La comision publicada tiene que ser LA constante que el cobro usa, no una
// copia. Si alguien cambia DefaultCommissionBps y olvida esta ruta, la promesa
// de "nada se cobra que no este aqui" se rompe en silencio.
func TestFees_ComisionPublicadaEsLaQueSeCobra(t *testing.T) {
	comision, ok := leerFees(t)["merchant_commission"].(map[string]any)
	if !ok {
		t.Fatal("falta merchant_commission: la unica comision que se cobra hoy no se publica")
	}
	if bps, _ := comision["bps"].(float64); int(bps) != qrpayment.DefaultCommissionBps {
		t.Errorf("bps publicados = %v, la comision real = %d", bps, qrpayment.DefaultCommissionBps)
	}
	if pct, _ := comision["pct"].(float64); pct != float64(qrpayment.DefaultCommissionBps)/100 {
		t.Errorf("pct publicado = %v, no corresponde a %d bps", pct, qrpayment.DefaultCommissionBps)
	}
	// Quien paga entrega exactamente el monto del QR: la comision la absorbe
	// el comercio. Publicar lo contrario cambiaria el precio para el pagador.
	if extra, _ := comision["payer_pays_extra"].(bool); extra {
		t.Error("se publica que el pagador paga un extra; el cobro no le suma nada")
	}
}

// La promocion de entrada publicada es la que aplica el cobro.
func TestFees_LaPromocionDeEntradaEsLaDelCobro(t *testing.T) {
	promo, ok := leerFees(t)["entry_promotion"].(map[string]any)
	if !ok {
		t.Fatal("falta entry_promotion: la promocion cambia lo que se cobra y no se publica")
	}
	if bps, _ := promo["bps"].(float64); int(bps) != qrpayment.PromoEntradaBps {
		t.Errorf("bps publicados = %v, la promocion real = %d", bps, qrpayment.PromoEntradaBps)
	}
	if meses, _ := promo["months"].(float64); int(meses) != qrpayment.PromoEntradaMeses {
		t.Errorf("meses publicados = %v, la promocion real = %d", meses, qrpayment.PromoEntradaMeses)
	}
	if pct, _ := promo["pct"].(float64); pct != float64(qrpayment.PromoEntradaBps)/100 {
		t.Errorf("pct publicado = %v", pct)
	}
	if existentes, _ := promo["existing_merchants"].(bool); existentes {
		t.Error("se publica que los comercios ya aprobados reciben la promocion; no la reciben")
	}
}

// La version anterior publicaba tres cifras que el codigo no cobra: 150 colones
// por transferencia interbancaria (ese envio se RECHAZA), un diferencial de
// cambio de 50 bps (no hay conversion en ninguna parte) y una suscripcion de
// 500 colones al mes (no hay forma de cobrar ningun plan). Publicar una tarifa
// que no se cobra es tan deshonesto como cobrar una que no se publica.
func TestFees_NoPublicaTarifasQueNoSeCobran(t *testing.T) {
	_, crudo := leerFeesDe(t, NewHandler(nil))
	for _, inventado := range []string{
		`"fee_minor":15000`,    // la tarifa interbancaria dormida
		`"spread_bps_default"`, // el diferencial de cambio que no existe
		`"price_minor":50000`,  // la suscripcion de 500 colones
	} {
		if strings.Contains(strings.ReplaceAll(crudo, " ", ""), inventado) {
			t.Errorf("se sigue publicando %s, que el codigo no cobra", inventado)
		}
	}
}

// Negocio y Cima prometian umbrales sin comision y tasas rebajadas que el cobro
// nunca aplico. Se retiraron el 13-09-2026. Y nada ofrece rendimiento.
func TestFees_NoPublicaLosPlanesRetiradosNiRendimiento(t *testing.T) {
	_, crudo := leerFeesDe(t, NewHandler(nil))
	for _, retirado := range []string{`"negocio"`, `"cima"`, "commission_free_monthly_billing", "Negocio", "Cima"} {
		if strings.Contains(crudo, retirado) {
			t.Errorf("se sigue publicando %s", retirado)
		}
	}
	if strings.Contains(strings.ToLower(crudo), "apy") {
		t.Error("se publica un APY: ningun plan ofrece rendimiento")
	}
}

// Los planes tienen precio publico pero todavia no se pueden cobrar. Decir lo
// contrario haria creer que hay cargos activos.
func TestFees_LosPlanesSeAnuncianPeroNoSeCobran(t *testing.T) {
	datos := leerFees(t)
	planes, _ := datos["plans"].(map[string]any)
	if cobrable, _ := planes["chargeable_today"].(bool); cobrable {
		t.Error("se publica que los planes ya se cobran; no hay pasarela ni suscripcion")
	}
	if estado, _ := planes["status"].(string); estado != "coming_soon" {
		t.Errorf("status = %q, se esperaba coming_soon", estado)
	}
	porCodigo := planesPorCodigo(t, datos)
	precios := map[string]float64{plans.PlanFree: 0, plans.PlanPlus: plans.PrecioPlusUSD, plans.PlanPro: plans.PrecioProUSD}
	if len(porCodigo) != len(precios) {
		t.Fatalf("se anuncian %d planes, se esperaban los 3 personales", len(porCodigo))
	}
	for codigo, precio := range precios {
		p, ok := porCodigo[codigo]
		if !ok {
			t.Errorf("falta el plan %s", codigo)
			continue
		}
		if got, _ := p["price"].(float64); got != precio {
			t.Errorf("precio de %s = %v, se esperaba %v", codigo, got, precio)
		}
	}
}

// Los topes que se publican son los que aplican los servicios.
func TestFees_LosLimitesPublicadosSonLosQueSeAplican(t *testing.T) {
	h := NewHandler(nil)
	h.SetPlanes(PlanesPublicados{
		Metas:     plans.Topes{Free: 3, Plus: 10, Pro: 0},
		Tarjetas:  plans.Topes{Free: 1, Plus: 3, Pro: 5},
		Asistente: &plans.Topes{Free: 2, Plus: 15, Pro: 50},
	})
	datos, _ := leerFeesDe(t, h)
	porCodigo := planesPorCodigo(t, datos)

	quiero := map[string][3]any{
		plans.PlanFree: {float64(3), float64(1), float64(2)},
		plans.PlanPlus: {float64(10), float64(3), float64(15)},
		plans.PlanPro:  {nil, float64(5), float64(50)},
	}
	for codigo, q := range quiero {
		limites, _ := porCodigo[codigo]["limits"].(map[string]any)
		metas, ok := limites["savings_goals_active"]
		if !ok || metas != q[0] {
			t.Errorf("%s: metas = %v, se esperaba %v (null = sin tope)", codigo, metas, q[0])
		}
		if got := limites["virtual_cards_active"]; got != q[1] {
			t.Errorf("%s: tarjetas = %v, se esperaba %v", codigo, got, q[1])
		}
		if got := limites["assistant_daily_questions"]; got != q[2] {
			t.Errorf("%s: asistente = %v, se esperaba %v", codigo, got, q[2])
		}
	}
}

// Sin asistente configurado, su cuota no es un beneficio que se entregue.
func TestFees_SinAsistenteNoSePublicaSuCuota(t *testing.T) {
	porCodigo := planesPorCodigo(t, leerFees(t))
	for codigo, p := range porCodigo {
		limites, _ := p["limits"].(map[string]any)
		if _, ok := limites["assistant_daily_questions"]; ok {
			t.Errorf("%s publica la cuota del asistente sin asistente configurado", codigo)
		}
	}
	// Y sin SetPlanes valen los topes de fabrica.
	limites, _ := porCodigo[plans.PlanFree]["limits"].(map[string]any)
	if limites["savings_goals_active"] != float64(plans.TopesMetasDeAhorro.Free) ||
		limites["virtual_cards_active"] != float64(plans.TopesTarjetas.Free) {
		t.Errorf("topes de fabrica del gratuito: %v", limites)
	}
}

// Lo que ningun plan incluye se declara, no se calla.
func TestFees_LoQueNoSeIncluyeSeDeclara(t *testing.T) {
	planes, _ := leerFees(t)["plans"].(map[string]any)
	lista, _ := planes["not_included"].([]any)
	declarados := map[string]bool{}
	for _, v := range lista {
		s, _ := v.(string)
		declarados[s] = true
	}
	for _, requerido := range []string{
		"Tarjeta fisica", "Retiros en cajeros", "Seguros", "Fondo de garantia de depositos",
		"Rendimiento o intereses sobre el dinero guardado", "Mejor tipo de cambio",
		"Transferencias a otros bancos", "Limites de tarjeta mas altos",
	} {
		if !declarados[requerido] {
			t.Errorf("no se declara que no se incluye: %s", requerido)
		}
	}
}

func TestFees_LaAnaliticaDelComercioSeAnunciaPeroNoSeCobra(t *testing.T) {
	a, ok := leerFees(t)["merchant_analytics"].(map[string]any)
	if !ok {
		t.Fatal("falta merchant_analytics")
	}
	if cobrable, _ := a["chargeable_today"].(bool); cobrable {
		t.Error("se publica que la analitica ya se cobra")
	}
	if precio, _ := a["price"].(float64); precio != plans.PrecioAnaliticaUSD {
		t.Errorf("precio = %v, se esperaba %v", precio, plans.PrecioAnaliticaUSD)
	}
	if codigo, _ := a["code"].(string); codigo != qrpayment.PlanComercioAnalitica {
		t.Errorf("code = %q", codigo)
	}
}
