package notification

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository handles notification persistence.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository creates a new notification repository.
func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// SaveSubscription upserts a push subscription.
func (r *Repository) SaveSubscription(ctx context.Context, sub *PushSubscription) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO push_subscriptions (id, user_id, endpoint, auth_key, p256dh_key)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (endpoint) DO UPDATE SET
		   user_id = EXCLUDED.user_id,
		   auth_key = EXCLUDED.auth_key,
		   p256dh_key = EXCLUDED.p256dh_key,
		   updated_at = NOW()`,
		sub.ID, sub.UserID, sub.Endpoint, sub.Auth, sub.P256dh,
	)
	return err
}

// DeleteSubscription removes a push subscription by endpoint.
func (r *Repository) DeleteSubscription(ctx context.Context, userID, endpoint string) error {
	_, err := r.db.Exec(ctx,
		`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
		userID, endpoint,
	)
	return err
}

// GetSubscriptionsByUser returns all subscriptions for a user.
func (r *Repository) GetSubscriptionsByUser(ctx context.Context, userID string) ([]*PushSubscription, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, endpoint, auth_key, p256dh_key FROM push_subscriptions WHERE user_id = $1`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subs []*PushSubscription
	for rows.Next() {
		sub := &PushSubscription{}
		if err := rows.Scan(&sub.ID, &sub.UserID, &sub.Endpoint, &sub.Auth, &sub.P256dh); err != nil {
			return nil, err
		}
		subs = append(subs, sub)
	}
	return subs, nil
}

// InsertNotification saves a notification record.
func (r *Repository) InsertNotification(ctx context.Context, n *NotificationRecord) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO notification_history (id, user_id, title, body, type)
		 VALUES ($1, $2, $3, $4, $5)`,
		n.ID, n.UserID, n.Title, n.Body, n.Type,
	)
	return err
}

// ListNotifications returns paginated notifications for a user.
func (r *Repository) ListNotifications(ctx context.Context, userID string, limit, offset int) ([]*NotificationRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, title, body, type, read_at, created_at
		 FROM notification_history
		 WHERE user_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2 OFFSET $3`,
		userID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var notifs []*NotificationRecord
	for rows.Next() {
		n := &NotificationRecord{}
		if err := rows.Scan(&n.ID, &n.UserID, &n.Title, &n.Body, &n.Type, &n.ReadAt, &n.CreatedAt); err != nil {
			return nil, err
		}
		notifs = append(notifs, n)
	}
	return notifs, nil
}

// MarkRead marks a notification as read.
func (r *Repository) MarkRead(ctx context.Context, userID, notifID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE notification_history SET read_at = NOW() WHERE id = $1 AND user_id = $2`,
		notifID, userID,
	)
	return err
}
