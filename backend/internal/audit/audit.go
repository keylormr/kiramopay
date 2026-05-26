package audit

import (
	"context"
	"log/slog"
	"time"
)

// Event represents an audit log entry.
type Event struct {
	UserID       string
	Action       string
	ResourceType string
	ResourceID   string
	IPAddress    string
	UserAgent    string
	Details      map[string]interface{}
	RiskLevel    string
}

// Logger provides asynchronous audit logging.
type Logger struct {
	repo   *Repository
	events chan Event
	done   chan struct{}
}

// NewLogger creates a buffered async audit logger.
func NewLogger(repo *Repository, bufferSize int) *Logger {
	l := &Logger{
		repo:   repo,
		events: make(chan Event, bufferSize),
		done:   make(chan struct{}),
	}
	go l.drain()
	return l
}

// drain processes queued events in the background.
func (l *Logger) drain() {
	batch := make([]Event, 0, 50)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case evt, ok := <-l.events:
			if !ok {
				// Channel closed, flush remaining
				if len(batch) > 0 {
					l.flush(batch)
				}
				close(l.done)
				return
			}
			batch = append(batch, evt)
			if len(batch) >= 50 {
				l.flush(batch)
				batch = batch[:0]
			}

		case <-ticker.C:
			if len(batch) > 0 {
				l.flush(batch)
				batch = batch[:0]
			}
		}
	}
}

func (l *Logger) flush(events []Event) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, evt := range events {
		if err := l.repo.Insert(ctx, &evt); err != nil {
			slog.Error("audit log insert failed", "error", err, "action", evt.Action)
		}
	}
}

// Log queues an audit event for async persistence.
func (l *Logger) Log(evt Event) {
	select {
	case l.events <- evt:
	default:
		slog.Warn("audit log buffer full, dropping event", "action", evt.Action)
	}
}

// LogLogin logs a login attempt.
func (l *Logger) LogLogin(userID, ip, userAgent string, success bool) {
	action := "login_success"
	risk := "low"
	if !success {
		action = "login_failed"
		risk = "medium"
	}
	l.Log(Event{
		UserID:       userID,
		Action:       action,
		ResourceType: "session",
		IPAddress:    ip,
		UserAgent:    userAgent,
		Details:      map[string]interface{}{"success": success},
		RiskLevel:    risk,
	})
}

// LogTransfer logs a money transfer.
func (l *Logger) LogTransfer(userID, txID string, amount int64, currency, ip string) {
	risk := "low"
	if amount > 50000000 { // > 500,000 CRC
		risk = "high"
	} else if amount > 10000000 { // > 100,000 CRC
		risk = "medium"
	}
	l.Log(Event{
		UserID:       userID,
		Action:       "transfer",
		ResourceType: "transaction",
		ResourceID:   txID,
		IPAddress:    ip,
		Details: map[string]interface{}{
			"amount":   amount,
			"currency": currency,
		},
		RiskLevel: risk,
	})
}

// LogPinChange logs a PIN change.
func (l *Logger) LogPinChange(userID, ip string) {
	l.Log(Event{
		UserID:       userID,
		Action:       "pin_change",
		ResourceType: "user",
		ResourceID:   userID,
		IPAddress:    ip,
		RiskLevel:    "medium",
	})
}

// LogCardCreated logs virtual card creation.
func (l *Logger) LogCardCreated(userID, cardID, ip string) {
	l.Log(Event{
		UserID:       userID,
		Action:       "card_created",
		ResourceType: "card",
		ResourceID:   cardID,
		IPAddress:    ip,
		RiskLevel:    "low",
	})
}

// Stop flushes remaining events and stops the logger.
func (l *Logger) Stop() {
	close(l.events)
	<-l.done
}
