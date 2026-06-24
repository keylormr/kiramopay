package b2b_test

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/b2b"
	"github.com/kiramopay/backend/internal/escrow"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
)

// testCipher exercises the encrypted-at-rest path in every integration test.
var testCipher = b2b.NewCipher([]byte("test-secret-key-material"))

func newService(t *testing.T) (*b2b.Service, *b2b.Repository, string) {
	t.Helper()
	// Allow loopback/private webhook targets so the httptest delivery tests can
	// register and reach a local server (SSRF guard is otherwise on by default).
	t.Setenv("B2B_ALLOW_PRIVATE_WEBHOOK_TARGETS", "1")
	pool := testutil.TestDB(t)
	userID := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	repo := b2b.NewRepository(pool)
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	return b2b.NewService(repo, testCipher, nil, logger), repo, userID
}

func TestAPIKeyLifecycle(t *testing.T) {
	svc, _, userID := newService(t)
	ctx := context.Background()

	k, full, err := svc.CreateKey(ctx, userID, "checkout backend", "")
	if err != nil {
		t.Fatalf("create key: %v", err)
	}
	if full == "" || k.Prefix == "" {
		t.Fatal("expected full key and prefix")
	}
	if k.Scopes != "escrow:read,escrow:write,payout:read,payout:write" {
		t.Errorf("default scopes: got %q", k.Scopes)
	}

	// The full key authenticates to its owner with its scopes.
	got, scopes, err := svc.Authenticate(ctx, full)
	if err != nil || got != userID {
		t.Fatalf("authenticate: got (%q, %v), want (%q, nil)", got, err, userID)
	}
	if !b2b.HasScope(scopes, b2b.ScopeEscrowWrite) {
		t.Errorf("expected write scope, got %q", scopes)
	}

	// Garbage and near-misses fail.
	if _, _, err := svc.Authenticate(ctx, "kp_live_definitely_not_a_real_key_aaaaaaaaaa"); !errors.Is(err, b2b.ErrInvalidKey) {
		t.Errorf("bogus key: expected ErrInvalidKey, got %v", err)
	}

	// A read-only key carries only its scope; bogus scopes are rejected.
	ro, _, err := svc.CreateKey(ctx, userID, "reporting", "escrow:read")
	if err != nil {
		t.Fatalf("create read-only key: %v", err)
	}
	if b2b.HasScope(ro.Scopes, b2b.ScopeEscrowWrite) {
		t.Errorf("read-only key must not have write scope: %q", ro.Scopes)
	}
	if _, _, err := svc.CreateKey(ctx, userID, "bad", "admin:everything"); !errors.Is(err, b2b.ErrInvalid) {
		t.Errorf("invalid scope: expected ErrInvalid, got %v", err)
	}

	// Revocation kills it.
	if err := svc.RevokeKey(ctx, userID, k.ID); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, _, err := svc.Authenticate(ctx, full); !errors.Is(err, b2b.ErrInvalidKey) {
		t.Errorf("revoked key: expected ErrInvalidKey, got %v", err)
	}
}

func TestWebhookDeliveryEndToEnd(t *testing.T) {
	svc, repo, userID := newService(t)
	ctx := context.Background()

	var received atomic.Int32
	var gotSig, gotEvent, gotTs string
	var gotBody []byte
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(body)
		gotBody = body
		gotSig = r.Header.Get("X-Kiramopay-Signature")
		gotEvent = r.Header.Get("X-Kiramopay-Event")
		gotTs = r.Header.Get("X-Kiramopay-Timestamp")
		received.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer target.Close()

	ep, err := svc.CreateEndpoint(ctx, userID, target.URL, "escrow.funded")
	if err != nil {
		t.Fatalf("create endpoint: %v", err)
	}

	// Matching event fans out; non-matching does not.
	svc.Emit(ctx, userID, "escrow.funded", map[string]string{"id": "abc"})
	svc.Emit(ctx, userID, "escrow.released", map[string]string{"id": "abc"})

	d := b2b.NewDispatcher(repo, testCipher, time.Second, slog.New(slog.NewTextHandler(os.Stdout, nil)))
	attempted := d.RunOnce(ctx)
	if attempted != 1 {
		t.Fatalf("expected 1 delivery attempted, got %d", attempted)
	}
	if received.Load() != 1 {
		t.Fatalf("expected target to receive 1 call, got %d", received.Load())
	}
	if gotEvent != "escrow.funded" {
		t.Errorf("event header: got %q", gotEvent)
	}
	if gotTs == "" {
		t.Error("expected X-Kiramopay-Timestamp header to be set")
	}
	if want := b2b.SignWithTimestamp(ep.Secret, gotTs, gotBody); gotSig != want {
		t.Errorf("signature mismatch: got %q want %q", gotSig, want)
	}

	// The delivery is finalized.
	deliveries, err := svc.RecentDeliveries(ctx, userID, ep.ID, 10)
	if err != nil {
		t.Fatalf("recent deliveries: %v", err)
	}
	if len(deliveries) != 1 || deliveries[0].Status != "delivered" {
		t.Fatalf("expected 1 delivered row, got %+v", deliveries)
	}
}

func TestWebhookRetryOnFailure(t *testing.T) {
	svc, repo, userID := newService(t)
	ctx := context.Background()

	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer target.Close()

	ep, err := svc.CreateEndpoint(ctx, userID, target.URL, "*")
	if err != nil {
		t.Fatalf("create endpoint: %v", err)
	}
	svc.Emit(ctx, userID, "escrow.funded", map[string]string{"id": "x"})

	d := b2b.NewDispatcher(repo, testCipher, time.Second, slog.New(slog.NewTextHandler(os.Stdout, nil)))
	if n := d.RunOnce(ctx); n != 1 {
		t.Fatalf("expected 1 attempt, got %d", n)
	}

	deliveries, err := svc.RecentDeliveries(ctx, userID, ep.ID, 10)
	if err != nil {
		t.Fatalf("recent deliveries: %v", err)
	}
	if len(deliveries) != 1 {
		t.Fatalf("expected 1 delivery, got %d", len(deliveries))
	}
	got := deliveries[0]
	if got.Status != "pending" || got.Attempts != 1 {
		t.Errorf("expected pending retry with 1 attempt, got status=%s attempts=%d", got.Status, got.Attempts)
	}
	if !got.NextAttemptAt.After(time.Now().Add(20 * time.Second)) {
		t.Errorf("expected backoff into the future, got %s", got.NextAttemptAt)
	}
	// Leased-but-failed rows must not be re-attempted immediately.
	if n := d.RunOnce(ctx); n != 0 {
		t.Errorf("expected 0 due deliveries during backoff, got %d", n)
	}
}

func TestEscrowEmitsWebhookEvents(t *testing.T) {
	t.Setenv("B2B_ALLOW_PRIVATE_WEBHOOK_TARGETS", "1")
	pool := testutil.TestDB(t)
	buyer := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	seller := testutil.SeedTestUser2(t, pool)
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))

	b2bRepo := b2b.NewRepository(pool)
	b2bSvc := b2b.NewService(b2bRepo, testCipher, nil, logger)
	escrowSvc := escrow.NewService(escrow.NewRepository(pool), ledger.NewEngine(pool, logger),
		&escrow.Options{Events: b2bSvc})

	ctx := context.Background()
	sellerEp, err := b2bSvc.CreateEndpoint(ctx, seller, "https://merchant.example/hook", "*")
	if err != nil {
		t.Fatalf("create endpoint: %v", err)
	}

	if _, err := escrowSvc.Create(ctx, buyer, &escrow.CreateRequest{
		SellerID: seller, AmountMinor: 1000, Currency: "CRC", Description: "test",
	}); err != nil {
		t.Fatalf("create escrow: %v", err)
	}

	deliveries, err := b2bSvc.RecentDeliveries(ctx, seller, sellerEp.ID, 10)
	if err != nil {
		t.Fatalf("deliveries: %v", err)
	}
	if len(deliveries) != 1 || deliveries[0].EventType != "escrow.created" {
		t.Fatalf("expected 1 escrow.created delivery for the seller, got %+v", deliveries)
	}
}
