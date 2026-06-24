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

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/google/uuid"
)

// Service handles push notification operations.
type Service struct {
	repo            *Repository
	vapidPublicKey  string
	vapidPrivateKey string
}

// NewService creates a new notification service.
func NewService(repo *Repository, vapidPublicKey, vapidPrivateKey string) *Service {
	return &Service{
		repo:            repo,
		vapidPublicKey:  vapidPublicKey,
		vapidPrivateKey: vapidPrivateKey,
	}
}

// Subscribe saves or updates a push subscription.
func (s *Service) Subscribe(ctx context.Context, userID string, req *SubscribeRequest) error {
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

// SendToUser sends a push notification to all of a user's subscriptions.
func (s *Service) SendToUser(ctx context.Context, userID string, payload *NotificationPayload) error {
	subs, err := s.repo.GetSubscriptionsByUser(ctx, userID)
	if err != nil {
		return err
	}

	// Persist notification history
	record := &NotificationRecord{
		ID:     uuid.New().String(),
		UserID: userID,
		Title:  payload.Title,
		Body:   payload.Body,
		Type:   payload.Tag,
	}
	if err := s.repo.InsertNotification(ctx, record); err != nil {
		slog.Error("failed to save notification history", "error", err)
	}

	payloadBytes, _ := json.Marshal(payload)

	for _, sub := range subs {
		if err := s.sendWebPush(sub, payloadBytes); err != nil {
			slog.Error("push notification failed",
				"endpoint", sub.Endpoint,
				"error", err,
			)
		}
	}

	return nil
}

// sendWebPush delivers a web push notification to a single subscription using
// VAPID. Push is disabled (no-op) when VAPID keys are not configured — the
// notification is still persisted to history, which the app reads on sync.
func (s *Service) sendWebPush(sub *PushSubscription, payload []byte) error {
	if s.vapidPublicKey == "" || s.vapidPrivateKey == "" {
		return nil
	}
	// The endpoint is client-supplied; only deliver to a public https push
	// service so a forged subscription can't point us at internal infra (SSRF).
	if err := validatePushEndpoint(sub.Endpoint); err != nil {
		return err
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
		return err
	}
	defer resp.Body.Close() //nolint:errcheck
	if resp.StatusCode >= 400 {
		return fmt.Errorf("push endpoint returned %d", resp.StatusCode)
	}
	return nil
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
