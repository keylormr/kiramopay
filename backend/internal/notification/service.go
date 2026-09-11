package notification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/google/uuid"
)

// Broadcaster fans a real-time message out to all of a user's live WebSocket
// connections. Implemented by the websocket hub; optional so notifications keep
// working (history + web-push) when no hub is wired (e.g. in tests).
type Broadcaster interface {
	SendToUser(userID string, data any)
}

// Service handles push notification operations.
type Service struct {
	repo            *Repository
	vapidPublicKey  string
	vapidPrivateKey string
	broadcaster     Broadcaster
}

// NewService creates a new notification service.
func NewService(repo *Repository, vapidPublicKey, vapidPrivateKey string) *Service {
	return &Service{
		repo:            repo,
		vapidPublicKey:  vapidPublicKey,
		vapidPrivateKey: vapidPrivateKey,
	}
}

// SetBroadcaster wires the real-time WebSocket hub. Once set, SendToUser also
// pushes each notification live to the user's open sockets.
func (s *Service) SetBroadcaster(b Broadcaster) {
	s.broadcaster = b
}

// ClavePublica devuelve la clave VAPID publica y si el web push esta habilitado
// (las dos claves configuradas). La pantalla la pide al servidor en vez de
// tenerla fija en el build: asi hay una sola fuente, y sin claves la opcion
// directamente no se ofrece.
func (s *Service) ClavePublica() (string, bool) {
	return s.vapidPublicKey, s.vapidPublicKey != "" && s.vapidPrivateKey != ""
}

// Subscribe saves or updates a push subscription.
func (s *Service) Subscribe(ctx context.Context, userID string, req *SubscribeRequest) error {
	if err := req.normalizar(); err != nil {
		return err
	}
	// Se valida al suscribir, no solo al enviar: un endpoint que apunta a la
	// red interna no tiene por que quedar guardado (SSRF).
	if err := validatePushEndpoint(req.Endpoint); err != nil {
		return err
	}
	sub := &PushSubscription{
		ID:       uuid.New().String(),
		UserID:   userID,
		Endpoint: req.Endpoint,
		Auth:     req.Auth,
		P256dh:   req.P256dh,
	}
	return s.repo.SaveSubscription(ctx, sub)
}

// Unsubscribe removes a push subscription.
func (s *Service) Unsubscribe(ctx context.Context, userID, endpoint string) error {
	return s.repo.DeleteSubscription(ctx, userID, endpoint)
}

// SendToUser persists a notification, pushes it live over any open WebSocket
// connections, and delivers web push to the user's registered subscriptions.
func (s *Service) SendToUser(ctx context.Context, userID string, payload *NotificationPayload) error {
	// Persist to history first; the id generated here is reused for the live WS
	// push so the client can reconcile it against the record it later syncs.
	record := &NotificationRecord{
		ID:        uuid.New().String(),
		UserID:    userID,
		Title:     payload.Title,
		Body:      payload.Body,
		Type:      payload.Tag,
		CreatedAt: time.Now().UTC(),
	}
	if err := s.repo.InsertNotification(ctx, record); err != nil {
		slog.Error("failed to save notification history", "error", err)
	}

	// Real-time delivery to any open sockets for this user. Independent of
	// web-push subscriptions, so a foregrounded app gets it instantly even
	// without a registered push endpoint.
	s.broadcast(userID, record)

	// Best-effort web push to registered browser subscriptions.
	subs, err := s.repo.GetSubscriptionsByUser(ctx, userID)
	if err != nil {
		return err
	}

	payloadBytes, _ := json.Marshal(payload)

	for _, sub := range subs {
		vencida, err := s.sendWebPush(sub, payloadBytes)
		if vencida {
			// El servicio de push dijo que esta suscripcion ya no existe (el
			// navegador la revoco o se desinstalo). Antes se reintentaba en
			// cada aviso, para siempre. Es una credencial muerta: se borra.
			if derr := s.repo.DeleteSubscription(ctx, sub.UserID, sub.Endpoint); derr != nil {
				slog.Error("no se pudo borrar una suscripcion vencida", "error", derr)
			}
			continue
		}
		if err != nil {
			slog.Error("push notification failed",
				"endpoint", sub.Endpoint,
				"error", err,
			)
		}
	}

	return nil
}

// realtimeNotification mirrors the frontend Notification shape exactly so the
// WebSocket payload is consumed without any client-side remapping (see
// src/hooks/useNotificationsWs.ts and src/types/notification.types.ts).
type realtimeNotification struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Message string `json:"message"`
	Type    string `json:"type"`
	Date    string `json:"date"`
	Read    bool   `json:"read"`
}

// realtimeEnvelope is the {type:"notification", notification:{…}} frame the
// frontend WebSocket hook expects.
type realtimeEnvelope struct {
	Type         string               `json:"type"`
	Notification realtimeNotification `json:"notification"`
}

// broadcast pushes a just-created notification to the user's live WebSocket
// connections in the exact shape the frontend renders. No-op when no hub is
// wired.
func (s *Service) broadcast(userID string, record *NotificationRecord) {
	if s.broadcaster == nil {
		return
	}
	s.broadcaster.SendToUser(userID, realtimeEnvelope{
		Type: "notification",
		Notification: realtimeNotification{
			ID:      record.ID,
			Title:   record.Title,
			Message: record.Body,
			Type:    record.Type,
			// Matches the REST adapter's es-CR short date (d/m/yyyy) so a live
			// notification renders identically to one synced from history.
			Date: record.CreatedAt.Format("2/1/2006"),
			Read: false,
		},
	})
}

// sendWebPush delivers a web push notification to a single subscription using
// VAPID. Push is disabled (no-op) when VAPID keys are not configured — the
// notification is still persisted to history, which the app reads on sync.
//
// Devuelve vencida = true cuando el servicio de push responde que la
// suscripcion ya no existe (404 o 410): el que llama la borra.
func (s *Service) sendWebPush(sub *PushSubscription, payload []byte) (vencida bool, err error) {
	if s.vapidPublicKey == "" || s.vapidPrivateKey == "" {
		return false, nil
	}
	// The endpoint is client-supplied; only deliver to a public https push
	// service so a forged subscription can't point us at internal infra (SSRF).
	if err := validatePushEndpoint(sub.Endpoint); err != nil {
		return false, err
	}
	resp, err := webpush.SendNotification(payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{Auth: sub.Auth, P256dh: sub.P256dh},
	}, &webpush.Options{
		Subscriber:      "mailto:noreply@kiramopay.com",
		VAPIDPublicKey:  s.vapidPublicKey,
		VAPIDPrivateKey: s.vapidPrivateKey,
		TTL:             86400,
	})
	if err != nil {
		return false, err
	}
	defer resp.Body.Close() //nolint:errcheck
	if suscripcionVencida(resp.StatusCode) {
		return true, fmt.Errorf("push endpoint returned %d", resp.StatusCode)
	}
	if resp.StatusCode >= 400 {
		return false, fmt.Errorf("push endpoint returned %d", resp.StatusCode)
	}
	return false, nil
}

// suscripcionVencida: 404 y 410 son la forma en que los servicios de push
// (FCM, Mozilla, Apple) dicen que la suscripcion ya no existe. Cualquier otro
// error puede ser pasajero y no justifica borrarla.
func suscripcionVencida(status int) bool {
	return status == 404 || status == 410
}

// validatePushEndpoint rejects non-public push endpoints (SSRF guard, mirroring
// the webhook dispatcher's protection).
func validatePushEndpoint(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return errors.New("notification: push endpoint must be a public https url")
	}
	ips, err := net.LookupIP(u.Hostname())
	if err != nil || len(ips) == 0 {
		return errors.New("notification: push endpoint host does not resolve")
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() ||
			ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return errors.New("notification: push endpoint resolves to a non-public address")
		}
	}
	return nil
}

// ListHistory returns paginated notifications for a user.
func (s *Service) ListHistory(ctx context.Context, userID string, limit, offset int) ([]*NotificationRecord, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	return s.repo.ListNotifications(ctx, userID, limit, offset)
}

// MarkRead marks a notification as read.
func (s *Service) MarkRead(ctx context.Context, userID, notifID string) error {
	return s.repo.MarkRead(ctx, userID, notifID)
}

// MarkAllRead marks all of the user's unread notifications as read.
func (s *Service) MarkAllRead(ctx context.Context, userID string) error {
	return s.repo.MarkAllRead(ctx, userID)
}

// NotifyUser persists a notification to the user's history and attempts web-push
// delivery. Best-effort: a push failure does not fail the call (history is the
// source of truth the app reads on sync). Implements the consumer-side
// notifier interface used by domains like SINPE.
func (s *Service) NotifyUser(ctx context.Context, userID, title, body, tag string) error {
	return s.SendToUser(ctx, userID, &NotificationPayload{Title: title, Body: body, Tag: tag})
}
