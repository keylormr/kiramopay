package notification

import "time"

// PushSubscription represents a browser push subscription.
type PushSubscription struct {
	ID       string `json:"id"`
	UserID   string `json:"user_id"`
	Endpoint string `json:"endpoint"`
	Auth     string `json:"auth"`
	P256dh   string `json:"p256dh"`
}

// NotificationPayload is the content of a push notification.
type NotificationPayload struct {
	Title   string `json:"title"`
	Body    string `json:"body"`
	Icon    string `json:"icon,omitempty"`
	URL     string `json:"url,omitempty"`
	Tag     string `json:"tag,omitempty"`
	Data    any    `json:"data,omitempty"`
}

// NotificationRecord is a persisted notification for history.
type NotificationRecord struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Title     string    `json:"title"`
	Body      string    `json:"body"`
	Type      string    `json:"type"`
	ReadAt    *time.Time `json:"read_at,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// SubscribeRequest is the request body for subscribing.
type SubscribeRequest struct {
	Endpoint string `json:"endpoint"`
	Auth     string `json:"auth"`
	P256dh   string `json:"p256dh"`
}
