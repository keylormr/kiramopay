package notification

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

// Tocar un aviso solo lo marcaba leido: el registro no traia con que abrir su
// pantalla. Estas pruebas fijan que datos viajan (el activo y el movimiento, y
// nada mas), y que llegan por los tres caminos: el historial, el aviso en vivo
// y el push del telefono.

func TestDatosParaLaApp_SoloLosQueAbrenLaPantalla(t *testing.T) {
	casos := []struct {
		nombre string
		datos  map[string]any
		want   map[string]string
	}{
		{
			nombre: "alerta de precio: el activo",
			datos:  map[string]any{"activo": "BTC"},
			want:   map[string]string{"activo": "BTC"},
		},
		{
			nombre: "SINPE recibido: el movimiento, sin el monto",
			datos:  map[string]any{"monto": "₡100.00", "movimiento": "7d0f3c1e-0000-4000-8000-000000000001"},
			want:   map[string]string{"movimiento": "7d0f3c1e-0000-4000-8000-000000000001"},
		},
		{
			nombre: "cripto recibida: el nombre y el monto se quedan en el texto",
			datos:  map[string]any{"monto": "0.5", "activo": "ETH", "nombre": "Ana"},
			want:   map[string]string{"activo": "ETH"},
		},
		{
			nombre: "sin datos de pantalla",
			datos:  map[string]any{"monto": "₡100.00", "detalle": "nota"},
			want:   nil,
		},
		{
			nombre: "vacio o que no es texto no viaja",
			datos:  map[string]any{"activo": "  ", "movimiento": 42},
			want:   nil,
		},
		{
			nombre: "nil",
			datos:  nil,
			want:   nil,
		},
	}
	for _, c := range casos {
		if got := DatosParaLaApp(c.datos); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: DatosParaLaApp = %v, want %v", c.nombre, got, c.want)
		}
	}
}

func TestArmarMensajeFCM_LlevaElAvisoYSusDatos(t *testing.T) {
	m := armarMensajeFCM("token-telefono", &NotificationPayload{
		Title: "Alerta de precio: BTC",
		Body:  "BTC subió a tu precio objetivo.",
		Tag:   "price_alert",
		ID:    "aviso-1",
		// Un dato con el nombre de una clave de la app no la pisa.
		Data: map[string]string{"activo": "BTC", "url": "https://otro.sitio", "tipo": "otro"},
	})
	want := map[string]string{"url": "/", "tipo": "price_alert", "aviso": "aviso-1", "activo": "BTC"}
	if !reflect.DeepEqual(m.Message.Data, want) {
		t.Fatalf("data = %v, want %v", m.Message.Data, want)
	}
}

func TestArmarMensajeFCM_SinDatosNiIdQuedaComoAntes(t *testing.T) {
	m := armarMensajeFCM("token-telefono", &NotificationPayload{Title: "Pago recibido", Body: "₡500", Tag: "qr_cobro"})
	want := map[string]string{"url": "/", "tipo": "qr_cobro"}
	if !reflect.DeepEqual(m.Message.Data, want) {
		t.Fatalf("data = %v, want %v", m.Message.Data, want)
	}
}

// El aviso en vivo lleva los datos con la misma clave que el historial: la app
// lo pinta sin remapear (src/hooks/useNotificationsWs.ts).
func TestService_Broadcast_LlevaLosDatosDelAviso(t *testing.T) {
	svc := NewService(nil, "", "")
	cb := &captureBroadcaster{}
	svc.SetBroadcaster(cb)
	svc.broadcast("user-42", &NotificationRecord{
		ID:        "notif-1",
		Title:     "SINPE recibido",
		Body:      "Recibiste ₡100.00 por SINPE Móvil",
		Type:      "transaction",
		Datos:     map[string]string{"movimiento": "tx-9"},
		CreatedAt: time.Date(2026, time.November, 27, 14, 5, 0, 0, time.UTC),
	})
	crudo, err := json.Marshal(cb.data)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var sobre struct {
		Notification struct {
			Data map[string]string `json:"data"`
		} `json:"notification"`
	}
	if err := json.Unmarshal(crudo, &sobre); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if sobre.Notification.Data["movimiento"] != "tx-9" {
		t.Fatalf("data = %v, want movimiento tx-9: %s", sobre.Notification.Data, crudo)
	}
}

// Un registro sin datos (todos los de antes de la migracion 092) no manda
// "data": la app lo trata como un aviso viejo.
func TestNotificationRecord_SinDatosNoMandaData(t *testing.T) {
	crudo, err := json.Marshal(&NotificationRecord{ID: "n1", Title: "Aviso", CreatedAt: time.Now()})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(crudo, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, esta := m["data"]; esta {
		t.Fatalf("un aviso sin datos manda data: %s", crudo)
	}
}

func TestDatosGuardadosYLeidos(t *testing.T) {
	if v, err := datosAGuardar(nil); v != nil || err != nil {
		t.Fatalf("sin datos: %v %v, esperaba NULL", v, err)
	}
	v, err := datosAGuardar(map[string]string{"activo": "BTC"})
	if err != nil || v == nil {
		t.Fatalf("con datos: %v %v", v, err)
	}
	if got := datosLeidos([]byte(*v)); !reflect.DeepEqual(got, map[string]string{"activo": "BTC"}) {
		t.Fatalf("ida y vuelta = %v", got)
	}
	for _, crudo := range []string{"", "null", "{}", "no es json", `{"activo": 5}`} {
		if got := datosLeidos([]byte(crudo)); got != nil {
			t.Errorf("datosLeidos(%q) = %v, esperaba nil", crudo, got)
		}
	}
}
