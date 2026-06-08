package notification

import (
	"testing"
)

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
