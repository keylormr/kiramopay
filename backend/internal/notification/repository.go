package notification

import (
	"context"
	"errors"
	"log/slog"

	"github.com/jackc/pgx/v5"
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

// IdiomaDe es el idioma guardado de la cuenta (users.language, migracion 074).
// Una cuenta que no eligio ninguno, o que no se puede leer, recibe el espanol
// de siempre: un aviso en espanol es mejor que ninguno. Si la lectura falla
// por otra cosa que una cuenta inexistente, queda en el log: una cuenta en
// japones que recibe un aviso de dinero en espanol tiene que tener explicacion.
func (r *Repository) IdiomaDe(ctx context.Context, userID string) string {
	var idioma string
	err := r.db.QueryRow(ctx, `SELECT COALESCE(language, 'es') FROM users WHERE id = $1`, userID).Scan(&idioma)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("avisos: no se pudo leer el idioma de la cuenta, va en espanol", "user", userID, "err", err.Error())
		}
		return "es"
	}
	return idioma
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
		 WHERE user_id = $1 AND hidden_at IS NULL
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

// MarkRead marks a notification as read. Una oculta no se toca: ocultar congela
// el registro, y una que se oculto sin leer queda asi.
func (r *Repository) MarkRead(ctx context.Context, userID, notifID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE notification_history SET read_at = NOW()
		 WHERE id = $1 AND user_id = $2 AND hidden_at IS NULL`,
		notifID, userID,
	)
	return err
}

// OcultarNotificacion marca la notificacion como oculta para su titular. Nunca
// la borra: la fila queda, con el momento en que se oculto. Ocultarla otra vez
// conserva la primera marca. Devuelve false si no existe o es de otra cuenta.
func (r *Repository) OcultarNotificacion(ctx context.Context, userID, notifID string) (bool, error) {
	tag, err := r.db.Exec(ctx,
		`UPDATE notification_history SET hidden_at = COALESCE(hidden_at, NOW())
		 WHERE id = $1 AND user_id = $2`,
		notifID, userID,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// MarkAllRead marks every unread notification for the user as read, salvo las
// ocultas: la persona ya no las ve, y estamparlas diria que las leyo.
func (r *Repository) MarkAllRead(ctx context.Context, userID string) error {
	_, err := r.db.Exec(ctx,
		`UPDATE notification_history SET read_at = NOW()
		 WHERE user_id = $1 AND read_at IS NULL AND hidden_at IS NULL`,
		userID,
	)
	return err
}
