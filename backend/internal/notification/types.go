package notification

import (
	"errors"
	"strings"
	"time"
)

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
	Title string `json:"title"`
	Body  string `json:"body"`
	Icon  string `json:"icon,omitempty"`
	URL   string `json:"url,omitempty"`
	Tag   string `json:"tag,omitempty"`
	Data  any    `json:"data,omitempty"`
}

// NotificationRecord is a persisted notification for history.
type NotificationRecord struct {
	ID        string     `json:"id"`
	UserID    string     `json:"user_id"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	Type      string     `json:"type"`
	ReadAt    *time.Time `json:"read_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// SubscribeRequest is the request body for subscribing.
type SubscribeRequest struct {
	Endpoint string `json:"endpoint"`
	Auth     string `json:"auth"`
	P256dh   string `json:"p256dh"`
	// Keys es la forma en que el NAVEGADOR serializa una suscripcion
	// (PushSubscription.toJSON(): {endpoint, keys: {p256dh, auth}}). El servidor
	// solo leia la forma plana, asi que las claves llegaban vacias, se
	// guardaban vacias, y todo envio fallaba: sin claves no se puede cifrar.
	// Se aceptan las dos.
	Keys *struct {
		Auth   string `json:"auth"`
		P256dh string `json:"p256dh"`
	} `json:"keys,omitempty"`
}

// ErrSuscripcionIncompleta: faltan el endpoint o alguna de las dos claves.
var ErrSuscripcionIncompleta = errors.New("notification: subscription needs endpoint, auth and p256dh")

// normalizar deja la suscripcion en forma plana y rechaza la incompleta: una
// suscripcion sin claves se guardaba igual y fallaba en cada envio, en
// silencio.
func (r *SubscribeRequest) normalizar() error {
	r.Endpoint = strings.TrimSpace(r.Endpoint)
	if r.Keys != nil {
		if r.Auth == "" {
			r.Auth = r.Keys.Auth
		}
		if r.P256dh == "" {
			r.P256dh = r.Keys.P256dh
		}
	}
	r.Auth = strings.TrimSpace(r.Auth)
	r.P256dh = strings.TrimSpace(r.P256dh)
	if r.Endpoint == "" || r.Auth == "" || r.P256dh == "" {
		return ErrSuscripcionIncompleta
	}
	return nil
}
