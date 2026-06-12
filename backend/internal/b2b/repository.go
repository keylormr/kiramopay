package b2b

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository persists API keys, webhook endpoints and the delivery outbox.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// ── API keys ──────────────────────────────────────────────────────────────

func (r *Repository) CreateKey(ctx context.Context, userID, name, prefix, hash, scopes string) (*APIKey, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO api_keys (user_id, name, prefix, key_hash, scopes)
		VALUES ($1::uuid, $2, $3, $4, $5)
		RETURNING id::text, user_id::text, name, prefix, scopes, status, last_used_at, created_at, revoked_at`,
		userID, name, prefix, hash, scopes)
	return scanKey(row)
}

func (r *Repository) ListKeys(ctx context.Context, userID string) ([]APIKey, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id::text, user_id::text, name, prefix, scopes, status, last_used_at, created_at, revoked_at
		FROM api_keys WHERE user_id = $1::uuid ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []APIKey
	for rows.Next() {
		k, err := scanKey(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *k)
	}
	return out, rows.Err()
}

// ResolveKey returns the owning user and scopes for an ACTIVE key hash and
// best-effort stamps last_used_at.
func (r *Repository) ResolveKey(ctx context.Context, hash string) (userID, scopes string, err error) {
	err = r.db.QueryRow(ctx, `
		UPDATE api_keys SET last_used_at = NOW()
		WHERE key_hash = $1 AND status = 'active'
		RETURNING user_id::text, scopes`, hash).Scan(&userID, &scopes)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrInvalidKey
	}
	return userID, scopes, err
}

// RevokeKey revokes a key owned by userID.
func (r *Repository) RevokeKey(ctx context.Context, userID, keyID string) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE api_keys SET status = 'revoked', revoked_at = NOW()
		WHERE id = $1::uuid AND user_id = $2::uuid AND status = 'active'`,
		keyID, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func scanKey(row pgx.Row) (*APIKey, error) {
	var k APIKey
	err := row.Scan(&k.ID, &k.UserID, &k.Name, &k.Prefix, &k.Scopes, &k.Status,
		&k.LastUsedAt, &k.CreatedAt, &k.RevokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &k, nil
}

// ── Webhook endpoints ─────────────────────────────────────────────────────

func (r *Repository) CreateEndpoint(ctx context.Context, userID, url, secret, events string) (*WebhookEndpoint, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO webhook_endpoints (user_id, url, secret, events)
		VALUES ($1::uuid, $2, $3, $4)
		RETURNING id::text, user_id::text, url, secret, events, status, created_at`,
		userID, url, secret, events)
	return scanEndpoint(row)
}

func (r *Repository) ListEndpoints(ctx context.Context, userID string) ([]WebhookEndpoint, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id::text, user_id::text, url, secret, events, status, created_at
		FROM webhook_endpoints WHERE user_id = $1::uuid ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WebhookEndpoint
	for rows.Next() {
		e, err := scanEndpoint(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

// ActiveEndpointsFor returns the user's active endpoints subscribed to eventType.
func (r *Repository) ActiveEndpointsFor(ctx context.Context, userID, eventType string) ([]WebhookEndpoint, error) {
	all, err := r.ListEndpoints(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]WebhookEndpoint, 0, len(all))
	for _, e := range all {
		if e.Status == "active" && EventMatches(e.Events, eventType) {
			out = append(out, e)
		}
	}
	return out, nil
}

func (r *Repository) DeleteEndpoint(ctx context.Context, userID, endpointID string) error {
	ct, err := r.db.Exec(ctx,
		`DELETE FROM webhook_endpoints WHERE id = $1::uuid AND user_id = $2::uuid`,
		endpointID, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func scanEndpoint(row pgx.Row) (*WebhookEndpoint, error) {
	var e WebhookEndpoint
	err := row.Scan(&e.ID, &e.UserID, &e.URL, &e.Secret, &e.Events, &e.Status, &e.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// ── Delivery outbox ───────────────────────────────────────────────────────

func (r *Repository) EnqueueDelivery(ctx context.Context, endpointID, eventType string, payload []byte) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO webhook_deliveries (endpoint_id, event_type, payload)
		VALUES ($1::uuid, $2, $3::jsonb)`,
		endpointID, eventType, string(payload))
	return err
}

// DueDelivery is a claimed outbox row with the endpoint's URL and secret
// joined in, ready to send.
type DueDelivery struct {
	Delivery
	URL    string
	Secret string
}

// DueDeliveries claims with a LEASE: claimed rows get next_attempt_at pushed
// 2 minutes into the future in the same statement, so a crashed dispatcher's
// batch simply becomes due again, and concurrent dispatchers (SKIP LOCKED)
// never double-send.
func (r *Repository) DueDeliveries(ctx context.Context, limit int) ([]DueDelivery, error) {
	rows, err := r.db.Query(ctx, `
		UPDATE webhook_deliveries d
		SET next_attempt_at = NOW() + interval '120 seconds'
		FROM webhook_endpoints e
		WHERE d.id IN (
			SELECT d2.id FROM webhook_deliveries d2
			JOIN webhook_endpoints e2 ON e2.id = d2.endpoint_id
			WHERE d2.status = 'pending' AND d2.next_attempt_at <= NOW()
			  AND e2.status = 'active'
			ORDER BY d2.next_attempt_at
			LIMIT $1
			FOR UPDATE OF d2 SKIP LOCKED
		) AND e.id = d.endpoint_id
		RETURNING d.id::text, d.endpoint_id::text, d.event_type, d.payload, d.status,
		          d.attempts, d.next_attempt_at, d.created_at, e.url, e.secret`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DueDelivery
	for rows.Next() {
		var d DueDelivery
		if err := rows.Scan(&d.ID, &d.EndpointID, &d.EventType, &d.Payload, &d.Status,
			&d.Attempts, &d.NextAttemptAt, &d.CreatedAt, &d.URL, &d.Secret); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// MarkDelivered finalizes a successful delivery.
func (r *Repository) MarkDelivered(ctx context.Context, id string, code int) error {
	_, err := r.db.Exec(ctx, `
		UPDATE webhook_deliveries
		SET status = 'delivered', response_code = $2, attempts = attempts + 1,
		    delivered_at = NOW(), last_error = NULL
		WHERE id = $1::uuid`, id, code)
	return err
}

// MarkAttemptFailed bumps the attempt counter; the delivery is retried after
// `retryIn`, or moved to failed once MaxAttempts is exhausted.
func (r *Repository) MarkAttemptFailed(ctx context.Context, id string, code *int, lastErr string, retryInSeconds int) error {
	_, err := r.db.Exec(ctx, `
		UPDATE webhook_deliveries
		SET attempts = attempts + 1,
		    response_code = $2,
		    last_error = LEFT($3, 500),
		    status = CASE WHEN attempts + 1 >= $5 THEN 'failed' ELSE 'pending' END,
		    next_attempt_at = NOW() + make_interval(secs => $4)
		WHERE id = $1::uuid`,
		id, code, lastErr, retryInSeconds, MaxAttempts)
	return err
}

// RecentDeliveries lists an endpoint's latest deliveries for debugging,
// scoped to the owning user.
func (r *Repository) RecentDeliveries(ctx context.Context, userID, endpointID string, limit int) ([]Delivery, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	rows, err := r.db.Query(ctx, `
		SELECT d.id::text, d.endpoint_id::text, d.event_type, d.payload, d.status,
		       d.attempts, d.next_attempt_at, d.response_code, COALESCE(d.last_error, ''),
		       d.created_at, d.delivered_at
		FROM webhook_deliveries d
		JOIN webhook_endpoints e ON e.id = d.endpoint_id
		WHERE d.endpoint_id = $1::uuid AND e.user_id = $2::uuid
		ORDER BY d.created_at DESC LIMIT $3`, endpointID, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Delivery
	for rows.Next() {
		var d Delivery
		if err := rows.Scan(&d.ID, &d.EndpointID, &d.EventType, &d.Payload, &d.Status,
			&d.Attempts, &d.NextAttemptAt, &d.ResponseCode, &d.LastError,
			&d.CreatedAt, &d.DeliveredAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
