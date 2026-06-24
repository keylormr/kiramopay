package notification

import (
	"context"
	"encoding/json"
	"log/slog"

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

// sendWebPush sends a web push notification to a single subscription.
func (s *Service) sendWebPush(sub *PushSubscription, payload []byte) error {
	// Web Push implementation using VAPID
	// In production, use github.com/SherClockHolmes/webpush-go
	// For now, log the attempt
	slog.Info("sending push notification",
		"endpoint", sub.Endpoint,
		"payload_size", len(payload),
	)
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
