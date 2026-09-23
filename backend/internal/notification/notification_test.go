package notification

import (
	"encoding/json"
	"testing"
	"time"
)

// captureBroadcaster records the last SendToUser call for assertions.
type captureBroadcaster struct {
	userID string
	data   any
	calls  int
}

func (c *captureBroadcaster) SendToUser(userID string, data any) {
	c.userID = userID
	c.data = data
	c.calls++
}

// TestService_Broadcast_MatchesFrontendShape locks the real-time payload to the
// exact shape the frontend consumes without remapping: an envelope
// {type:"notification", notification:{id,title,message,type,date,dateISO,read}}
// where body maps to message, created_at to an es-CR short date (for older
// clients) and to dateISO, which the screen writes in the user's language.
func TestService_Broadcast_MatchesFrontendShape(t *testing.T) {
	svc := NewService(nil, "", "")
	cb := &captureBroadcaster{}
	svc.SetBroadcaster(cb)

	created := time.Date(2026, time.June, 24, 9, 30, 0, 0, time.UTC)
	svc.broadcast("user-42", &NotificationRecord{
		ID:        "notif-1",
		UserID:    "user-42",
		Title:     "SINPE recibido",
		Body:      "Recibiste 5,000 CRC",
		Type:      "transaction",
		CreatedAt: created,
	})

	if cb.calls != 1 {
		t.Fatalf("expected 1 broadcast, got %d", cb.calls)
	}
	if cb.userID != "user-42" {
		t.Fatalf("broadcast user = %q, want user-42", cb.userID)
	}

	raw, err := json.Marshal(cb.data)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var payload struct {
		Type         string `json:"type"`
		Notification struct {
			ID      string `json:"id"`
			Title   string `json:"title"`
			Message string `json:"message"`
			Type    string `json:"type"`
			Date    string `json:"date"`
			DateISO string `json:"dateISO"`
			Read    bool   `json:"read"`
		} `json:"notification"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if payload.Type != "notification" {
		t.Errorf("envelope type = %q, want notification", payload.Type)
	}
	n := payload.Notification
	if n.ID != "notif-1" {
		t.Errorf("id = %q, want notif-1", n.ID)
	}
	if n.Title != "SINPE recibido" {
		t.Errorf("title = %q", n.Title)
	}
	if n.Message != "Recibiste 5,000 CRC" {
		t.Errorf("message = %q, want the record body", n.Message)
	}
	if n.Type != "transaction" {
		t.Errorf("type = %q, want transaction", n.Type)
	}
	if n.Date != "24/6/2026" {
		t.Errorf("date = %q, want 24/6/2026 (es-CR d/m/yyyy)", n.Date)
	}
	// La fecha de maquina: la pantalla la escribe en el idioma de la persona.
	if n.DateISO != "2026-06-24T09:30:00Z" {
		t.Errorf("dateISO = %q, want 2026-06-24T09:30:00Z", n.DateISO)
	}
	if n.Read {
		t.Error("a freshly created notification must be unread")
	}

	// Exactly the seven keys the frontend reads — no extra or missing fields.
	var keyset struct {
		Notification map[string]json.RawMessage `json:"notification"`
	}
	if err := json.Unmarshal(raw, &keyset); err != nil {
		t.Fatalf("unmarshal keyset: %v", err)
	}
	want := map[string]bool{"id": true, "title": true, "message": true, "type": true, "date": true, "dateISO": true, "read": true}
	if len(keyset.Notification) != len(want) {
		t.Errorf("notification has %d keys, want %d: %v", len(keyset.Notification), len(want), keyset.Notification)
	}
	for k := range keyset.Notification {
		if !want[k] {
			t.Errorf("unexpected key %q in notification payload", k)
		}
	}
}

// TestService_Broadcast_NoBroadcasterIsNoop ensures SendToUser's live push is a
// safe no-op when no hub is wired (history + web-push still work).
func TestService_Broadcast_NoBroadcasterIsNoop(t *testing.T) {
	svc := NewService(nil, "", "")
	svc.broadcast("user-1", &NotificationRecord{ID: "x", CreatedAt: time.Now()})
}

// Las cuatro pruebas que habia aca armaban un struct y revisaban lo que
// acababan de escribir, o copiaban la regla del limite en vez de llamarla:
// pasaban igual con el codigo roto. Las de abajo prueban el contrato real.
// La suscripcion se prueba en suscripcion_test.go.

func TestLimiteDeHistorial(t *testing.T) {
	casos := []struct{ pedido, want int }{
		{0, 20},
		{-5, 20},
		{51, 20},
		{1000, 20},
		{1, 1},
		{20, 20},
		{50, 50},
	}
	for _, c := range casos {
		if got := limiteDeHistorial(c.pedido); got != c.want {
			t.Errorf("limiteDeHistorial(%d) = %d, want %d", c.pedido, got, c.want)
		}
	}
}

// El service worker (public/sw.js) lee title, body, tag y url del JSON del
// aviso. Una etiqueta renombrada lo dejaria mostrando "KiramoPay" sin texto,
// sin que nada fallara.
func TestNotificationPayload_ClavesQueLeeElServiceWorker(t *testing.T) {
	crudo, err := json.Marshal(&NotificationPayload{
		Title: "Transferencia recibida",
		Body:  "Te enviaron 5.000 colones",
		URL:   "/sinpe",
		Tag:   "sinpe_transfer",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(crudo, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	want := map[string]string{
		"title": "Transferencia recibida",
		"body":  "Te enviaron 5.000 colones",
		"url":   "/sinpe",
		"tag":   "sinpe_transfer",
	}
	for clave, valor := range want {
		if m[clave] != valor {
			t.Errorf("%s = %v, want %q", clave, m[clave], valor)
		}
	}
	// Vacios no viajan: el service worker pone su propio icono.
	for _, clave := range []string{"icon", "data"} {
		if _, esta := m[clave]; esta {
			t.Errorf("%s vacio no deberia viajar: %s", clave, crudo)
		}
	}
}

// La pantalla da por leida una notificacion que trae read_at
// (notification.http.ts): sin leer, read_at no puede viajar con valor.
func TestNotificationRecord_ReadAtDiceSiEstaLeida(t *testing.T) {
	creada := time.Date(2026, time.September, 20, 15, 30, 0, 0, time.UTC)

	var sinLeer map[string]any
	crudo, err := json.Marshal(&NotificationRecord{ID: "n1", Title: "Aviso", CreatedAt: creada})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := json.Unmarshal(crudo, &sinLeer); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if v, esta := sinLeer["read_at"]; esta && v != nil {
		t.Errorf("una notificacion sin leer trae read_at = %v", v)
	}
	if sinLeer["created_at"] != "2026-09-20T15:30:00Z" {
		t.Errorf("created_at = %v, want 2026-09-20T15:30:00Z", sinLeer["created_at"])
	}

	leidaEn := creada.Add(time.Hour)
	var leida map[string]any
	crudo, err = json.Marshal(&NotificationRecord{ID: "n1", Title: "Aviso", ReadAt: &leidaEn, CreatedAt: creada})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := json.Unmarshal(crudo, &leida); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if leida["read_at"] != "2026-09-20T16:30:00Z" {
		t.Errorf("read_at = %v, want 2026-09-20T16:30:00Z", leida["read_at"])
	}
}
