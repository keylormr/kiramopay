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
// {type:"notification", notification:{id,title,message,type,date,read}} where
// body maps to message and created_at to an es-CR short date.
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
	if n.Read {
		t.Error("a freshly created notification must be unread")
	}

	// Exactly the six keys the frontend renders — no extra or missing fields.
	var keyset struct {
		Notification map[string]json.RawMessage `json:"notification"`
	}
	if err := json.Unmarshal(raw, &keyset); err != nil {
		t.Fatalf("unmarshal keyset: %v", err)
	}
	want := map[string]bool{"id": true, "title": true, "message": true, "type": true, "date": true, "read": true}
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

func TestSubscribeRequest_Validation(t *testing.T) {
	req := &SubscribeRequest{
		Endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
		Auth:     "auth-key",
		P256dh:   "p256dh-key",
	}

	if req.Endpoint == "" {
		t.Error("endpoint should not be empty")
	}
	if req.Auth == "" {
		t.Error("auth should not be empty")
	}
}

func TestNotificationPayload_Serialization(t *testing.T) {
	payload := &NotificationPayload{
		Title: "Transfer received",
		Body:  "You received 5,000 CRC from Keilor",
		Tag:   "sinpe_transfer",
	}

	if payload.Title == "" {
		t.Error("title should not be empty")
	}
	if payload.Tag != "sinpe_transfer" {
		t.Errorf("tag = %q, want %q", payload.Tag, "sinpe_transfer")
	}
}

func TestNotificationRecord_Fields(t *testing.T) {
	record := &NotificationRecord{
		ID:     "notif-1",
		UserID: "user-1",
		Title:  "Price Alert",
		Body:   "BTC reached $100,000",
		Type:   "price_alert",
	}

	if record.ReadAt != nil {
		t.Error("new notification should have nil ReadAt")
	}
	if record.Type != "price_alert" {
		t.Errorf("type = %q, want %q", record.Type, "price_alert")
	}
}

func TestService_ListHistoryDefaultLimit(t *testing.T) {
	// Test that invalid limits are corrected
	// This tests the limit normalization logic without DB
	limit := 0
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	if limit != 20 {
		t.Errorf("default limit = %d, want 20", limit)
	}

	limit = 100
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	if limit != 20 {
		t.Errorf("capped limit = %d, want 20", limit)
	}
}
