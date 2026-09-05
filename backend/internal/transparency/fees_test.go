package transparency

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/qrpayment"
)

// leerFees ejecuta el endpoint publico y devuelve el JSON ya decodificado.
// El handler no toca la base para esta ruta, por eso el pool va nulo: si algun
// dia la tocara, la prueba lo dira con un panico en vez de pasar callada.
func leerFees(t *testing.T) map[string]any {
	t.Helper()
	rec := httptest.NewRecorder()
	NewHandler(nil).Fees(rec, httptest.NewRequest(http.MethodGet, "/api/v1/transparency/fees", nil))
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
	return sobre.Data
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

// La version anterior publicaba tres cifras que el codigo no cobra: 150 colones
// por transferencia interbancaria (ese envio se RECHAZA), un diferencial de
// cambio de 50 bps (no hay conversion en ninguna parte) y una suscripcion de
// 500 colones al mes (no hay forma de cobrar ningun plan). Publicar una tarifa
// que no se cobra es tan deshonesto como cobrar una que no se publica.
func TestFees_NoPublicaTarifasQueNoSeCobran(t *testing.T) {
	crudo := func() string {
		rec := httptest.NewRecorder()
		NewHandler(nil).Fees(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
		return rec.Body.String()
	}()

	for _, inventado := range []string{
		`"fee_minor":15000`,   // la tarifa interbancaria dormida
		`"spread_bps_default"`, // el diferencial de cambio que no existe
		`"price_minor":50000`,  // la suscripcion de 500 colones
	} {
		if strings.Contains(strings.ReplaceAll(crudo, " ", ""), inventado) {
			t.Errorf("se sigue publicando %s, que el codigo no cobra", inventado)
		}
	}
}

// Los planes tienen precio publico pero todavia no se pueden cobrar. Decir lo
// contrario haria creer que hay cargos activos.
func TestFees_LosPlanesSeAnuncianPeroNoSeCobran(t *testing.T) {
	planes, ok := leerFees(t)["plans"].(map[string]any)
	if !ok {
		t.Fatal("falta el bloque plans")
	}
	if cobrable, _ := planes["chargeable_today"].(bool); cobrable {
		t.Error("se publica que los planes ya se cobran; no hay pasarela ni suscripcion")
	}
	anunciados, _ := planes["announced"].([]any)
	if len(anunciados) != 3 {
		t.Fatalf("se anuncian %d planes, la pagina muestra 3 (gratuito, negocio, cima)", len(anunciados))
	}
}
