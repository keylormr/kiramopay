package sinpe

import (
	"context"
	"fmt"
	"hash/fnv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

// Contacts

func (r *Repository) GetContacts(ctx context.Context, userID string) ([]ContactRecord, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, phone, name, COALESCE(bank, ''), is_favorite, created_at
		 FROM sinpe_contacts WHERE user_id = $1 ORDER BY is_favorite DESC, name ASC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("query contacts: %w", err)
	}
	defer rows.Close()

	var contacts []ContactRecord
	for rows.Next() {
		var c ContactRecord
		if err := rows.Scan(&c.ID, &c.UserID, &c.Phone, &c.Name, &c.Bank, &c.IsFav, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan contact: %w", err)
		}
		contacts = append(contacts, c)
	}
	if contacts == nil {
		contacts = []ContactRecord{}
	}
	return contacts, nil
}

func (r *Repository) AddContact(ctx context.Context, userID string, phone, name, bank string) (*ContactRecord, error) {
	id := uuid.New().String()
	now := time.Now()

	_, err := r.db.Exec(ctx,
		`INSERT INTO sinpe_contacts (id, user_id, phone, name, bank, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (user_id, phone) DO UPDATE SET name = $4, bank = $5`,
		id, userID, phone, name, bank, now,
	)
	if err != nil {
		return nil, fmt.Errorf("add contact: %w", err)
	}

	return &ContactRecord{
		ID:        id,
		UserID:    userID,
		Phone:     phone,
		Name:      name,
		Bank:      bank,
		CreatedAt: now,
	}, nil
}

func (r *Repository) FindContactByPhone(ctx context.Context, userID, phone string) (*ContactRecord, error) {
	c := &ContactRecord{}
	err := r.db.QueryRow(ctx,
		`SELECT id, user_id, phone, name, COALESCE(bank, ''), is_favorite, created_at
		 FROM sinpe_contacts WHERE user_id = $1 AND phone = $2`,
		userID, phone,
	).Scan(&c.ID, &c.UserID, &c.Phone, &c.Name, &c.Bank, &c.IsFav, &c.CreatedAt)
	if err != nil {
		return nil, err
	}
	return c, nil
}

// History

func (r *Repository) GetHistory(ctx context.Context, userID string, limit int) ([]HistoryRecord, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := r.db.Query(ctx,
		`SELECT id, user_id, phone, contact_name, amount, fee, type, status, COALESCE(description, ''), created_at
		 FROM sinpe_history WHERE user_id = $1
		 ORDER BY created_at DESC LIMIT $2`,
		userID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("query history: %w", err)
	}
	defer rows.Close()

	var history []HistoryRecord
	for rows.Next() {
		var h HistoryRecord
		if err := rows.Scan(&h.ID, &h.UserID, &h.Phone, &h.ContactName, &h.Amount, &h.Fee, &h.Type, &h.Status, &h.Description, &h.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan history: %w", err)
		}
		history = append(history, h)
	}
	if history == nil {
		history = []HistoryRecord{}
	}
	return history, nil
}

func (r *Repository) AddHistory(ctx context.Context, record *HistoryRecord) error {
	_, err := r.db.Exec(ctx,
		`INSERT INTO sinpe_history (id, user_id, phone, contact_name, amount, fee, type, status, description, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		record.ID, record.UserID, record.Phone, record.ContactName,
		record.Amount, record.Fee, record.Type, record.Status, record.Description, record.CreatedAt,
	)
	return err
}

// Daily spent tracking for SINPE limit
func (r *Repository) GetDailySinpeSpent(ctx context.Context, userID string) (int64, error) {
	var total int64
	err := r.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount), 0) FROM sinpe_history
		 WHERE user_id = $1 AND type = 'sent' AND status = 'completed'
		 AND created_at::date = CURRENT_DATE`,
		userID,
	).Scan(&total)
	return total, err
}

// AcquireUserSendLock takes a PostgreSQL session-level advisory lock keyed by
// the user so that the daily-limit check and the subsequent debit in
// Service.Send cannot interleave across concurrent requests for the SAME user.
// The returned function MUST be called to release the lock and the connection.
func (r *Repository) AcquireUserSendLock(ctx context.Context, userID string) (func(), error) {
	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return nil, fmt.Errorf("acquire conn: %w", err)
	}
	key := advisoryKey("sinpe:send", userID)
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, key); err != nil {
		conn.Release()
		return nil, fmt.Errorf("advisory lock: %w", err)
	}
	return func() {
		// Use a detached context so the unlock runs even if the request ctx
		// was cancelled mid-flight.
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, key)
		conn.Release()
	}, nil
}

// advisoryKey derives a stable int64 advisory-lock key from a namespace + id.
func advisoryKey(namespace, id string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(namespace + ":" + id))
	return int64(h.Sum64()) // #nosec G115 -- advisory-lock key; any int64 value (incl. negative) is valid for pg_advisory_lock
}
