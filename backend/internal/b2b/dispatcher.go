package b2b

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/kiramopay/backend/internal/middleware"
)

// Dispatcher drains the webhook outbox: every tick it leases a batch of due
// deliveries, POSTs them (HMAC-signed) and records the outcome with
// exponential backoff on failure. Run is meant to live in a goroutine like
// the reconcile worker.
type Dispatcher struct {
	repo     *Repository
	cipher   *Cipher
	client   *http.Client
	interval time.Duration
	batch    int
	logger   *slog.Logger
}

func NewDispatcher(repo *Repository, cipher *Cipher, interval time.Duration, logger *slog.Logger) *Dispatcher {
	if interval <= 0 {
		interval = 15 * time.Second
	}
	if cipher == nil {
		cipher = NewCipher(nil)
	}
	return &Dispatcher{
		repo:     repo,
		cipher:   cipher,
		client:   newWebhookClient(10 * time.Second),
		interval: interval,
		batch:    50,
		logger:   logger,
	}
}

// Run blocks until ctx is cancelled.
func (d *Dispatcher) Run(ctx context.Context) {
	t := time.NewTicker(d.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			d.RunOnce(ctx)
		}
	}
}

// RunOnce processes one batch; returns how many deliveries were attempted.
func (d *Dispatcher) RunOnce(ctx context.Context) int {
	due, err := d.repo.DueDeliveries(ctx, d.batch)
	if err != nil {
		d.log("webhook outbox query failed", "error", err)
		return 0
	}
	for i := range due {
		d.send(ctx, &due[i])
	}
	return len(due)
}

func (d *Dispatcher) send(ctx context.Context, dd *DueDelivery) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, dd.URL, bytes.NewReader(dd.Payload))
	if err != nil {
		d.fail(ctx, dd, nil, fmt.Sprintf("build request: %v", err))
		return
	}
	secret, err := d.cipher.Decrypt(dd.Secret)
	if err != nil {
		d.fail(ctx, dd, nil, fmt.Sprintf("decrypt secret: %v", err))
		return
	}
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "KiramoPay-Webhooks/1.0")
	req.Header.Set("X-Kiramopay-Event", dd.EventType)
	req.Header.Set("X-Kiramopay-Delivery", dd.ID)
	req.Header.Set("X-Kiramopay-Timestamp", ts)
	req.Header.Set("X-Kiramopay-Signature", SignWithTimestamp(secret, ts, dd.Payload))

	resp, err := d.client.Do(req)
	if err != nil {
		d.fail(ctx, dd, nil, err.Error())
		return
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096)) // drain for keep-alive

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if err := d.repo.MarkDelivered(ctx, dd.ID, resp.StatusCode); err != nil {
			d.log("mark delivered failed", "error", err, "delivery", dd.ID)
		}
		return
	}
	code := resp.StatusCode
	d.fail(ctx, dd, &code, fmt.Sprintf("endpoint returned %d", resp.StatusCode))
}

func (d *Dispatcher) fail(ctx context.Context, dd *DueDelivery, code *int, msg string) {
	middleware.RecordWebhookDeliveryFailed()
	retryIn := int(Backoff(dd.Attempts + 1).Seconds())
	if err := d.repo.MarkAttemptFailed(ctx, dd.ID, code, msg, retryIn); err != nil {
		d.log("mark attempt failed", "error", err, "delivery", dd.ID)
	}
}

func (d *Dispatcher) log(msg string, args ...any) {
	if d.logger != nil {
		d.logger.Warn(msg, args...)
	}
}
