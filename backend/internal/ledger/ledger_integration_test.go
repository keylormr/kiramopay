package ledger_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
)

func setup(t *testing.T) (*ledger.Engine, string, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	from := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	to := testutil.SeedTestUser2(t, pool)
	eng := ledger.NewEngine(pool, slog.New(slog.NewTextHandler(os.Stdout, nil)))
	return eng, from, to
}

// TestPostBasicTransfer is the happy path: $5 from user A to user B.
func TestPostBasicTransfer(t *testing.T) {
	eng, from, to := setup(t)
	ctx := context.Background()

	_, err := eng.Post(ctx, &ledger.Posting{
		Description: "basic-transfer",
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: from}, Side: ledger.Debit, AmountMinor: 500, Currency: "CRC"},
			{Account: ledger.Account{UserID: to}, Side: ledger.Credit, AmountMinor: 500, Currency: "CRC"},
		},
	})
	if err != nil {
		t.Fatalf("post: %v", err)
	}
}

// TestPostRejectsUnbalanced — the validatePosting check must trip BEFORE any
// SQL is issued (cheap defence in depth — the DB trigger is the second one).
func TestPostRejectsUnbalanced(t *testing.T) {
	eng, from, to := setup(t)
	ctx := context.Background()

	_, err := eng.Post(ctx, &ledger.Posting{
		Description: "unbalanced",
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: from}, Side: ledger.Debit, AmountMinor: 500, Currency: "CRC"},
			{Account: ledger.Account{UserID: to}, Side: ledger.Credit, AmountMinor: 499, Currency: "CRC"},
		},
	})
	if err == nil {
		t.Fatal("unbalanced posting must be rejected")
	}
}

// TestPostIdempotencyKey — two identical posts with the same key produce
// exactly one set of journal entries.
func TestPostIdempotencyKey(t *testing.T) {
	eng, from, to := setup(t)
	ctx := context.Background()

	mk := func() *ledger.Posting {
		return &ledger.Posting{
			Description:    "idempotent",
			IdempotencyKey: "dup-key-123",
			Entries: []ledger.Entry{
				{Account: ledger.Account{UserID: from}, Side: ledger.Debit, AmountMinor: 100, Currency: "CRC"},
				{Account: ledger.Account{UserID: to}, Side: ledger.Credit, AmountMinor: 100, Currency: "CRC"},
			},
		}
	}

	id1, err := eng.Post(ctx, mk())
	if err != nil {
		t.Fatalf("first post: %v", err)
	}
	id2, err := eng.Post(ctx, mk())
	if !errors.Is(err, ledger.ErrIdempotent) {
		t.Fatalf("second post: expected ErrIdempotent, got %v", err)
	}
	if id1 != id2 {
		t.Fatalf("idempotent retry must return same posting id (got %s vs %s)", id1, id2)
	}
}

// walletCRC reads the cached CRC balance for a user wallet.
func walletCRC(t *testing.T, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(context.Background(),
		`SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&bal); err != nil {
		t.Fatalf("read wallet %s: %v", userID, err)
	}
	return bal
}

// walletDriftCRC returns cache − journal for a wallet. The test schema seeds a
// wallet balance without matching opening journal entries (migration 020 does
// that backfill; testutil does not), so the baseline drift is non-zero. The
// invariant the concurrency tests assert is that this drift does NOT CHANGE
// under load — cache and journal must move by the same amount, so no `+= delta`
// is lost or double-applied.
func walletDriftCRC(t *testing.T, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var drift int64
	if err := pool.QueryRow(context.Background(),
		`SELECT drift_crc FROM wallet_journal_drift WHERE user_id = $1::uuid`, userID).Scan(&drift); err != nil {
		t.Fatalf("read drift for %s: %v", userID, err)
	}
	return drift
}

// TestConcurrent100Transfers fires 100 parallel small transfers between two
// users and verifies the exact net movement on both wallets AND that each
// cache still equals the journal (zero drift). This is the core double-entry
// invariant under row-lock contention: the `SELECT … FOR UPDATE` + cache
// `+= delta` must serialize so no increment is lost.
func TestConcurrent100Transfers(t *testing.T) {
	pool := testutil.TestDB(t)
	from := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	to := testutil.SeedTestUser2(t, pool)
	eng := ledger.NewEngine(pool, slog.New(slog.NewTextHandler(os.Stdout, nil)))
	ctx := context.Background()

	fromBefore := walletCRC(t, pool, from)
	toBefore := walletCRC(t, pool, to)
	fromDriftBefore := walletDriftCRC(t, pool, from)
	toDriftBefore := walletDriftCRC(t, pool, to)

	const N = 100
	const each = int64(10) // 10 minor units per tx
	var wg sync.WaitGroup
	var failures int32

	for i := 0; i < N; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := eng.Post(ctx, &ledger.Posting{
				Description: "concurrent",
				Entries: []ledger.Entry{
					{Account: ledger.Account{UserID: from}, Side: ledger.Debit, AmountMinor: each, Currency: "CRC"},
					{Account: ledger.Account{UserID: to}, Side: ledger.Credit, AmountMinor: each, Currency: "CRC"},
				},
			})
			if err != nil {
				atomic.AddInt32(&failures, 1)
				t.Logf("post #%d failed: %v", i, err)
			}
		}(i)
	}
	wg.Wait()

	if failures > 0 {
		t.Fatalf("%d/%d posts failed under contention", failures, N)
	}

	// Exact net movement — no lost updates despite all 100 contending on the
	// same two wallet rows.
	if got := fromBefore - walletCRC(t, pool, from); got != N*each {
		t.Errorf("sender debited %d, want %d", got, N*each)
	}
	if got := walletCRC(t, pool, to) - toBefore; got != N*each {
		t.Errorf("receiver credited %d, want %d", got, N*each)
	}
	// Cache and journal moved by the same amount on both wallets — no increment
	// lost or double-applied under the row-lock contention.
	if d := walletDriftCRC(t, pool, from); d != fromDriftBefore {
		t.Errorf("sender drift changed under contention: before=%d after=%d", fromDriftBefore, d)
	}
	if d := walletDriftCRC(t, pool, to); d != toDriftBefore {
		t.Errorf("receiver drift changed under contention: before=%d after=%d", toDriftBefore, d)
	}
}

// TestConcurrentCreditsToHotWallet models the "hot account" scenario of
// LEDGER_HOT_ACCOUNTS.md: N concurrent postings all crediting the SAME wallet,
// each debiting a system account (which is NOT row-locked). They serialize on
// the one hot wallet row and must apply every increment exactly once, with no
// drift — the contention is real but correctness holds.
func TestConcurrentCreditsToHotWallet(t *testing.T) {
	pool := testutil.TestDB(t)
	hot := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	eng := ledger.NewEngine(pool, slog.New(slog.NewTextHandler(os.Stdout, nil)))
	ctx := context.Background()

	before := walletCRC(t, pool, hot)
	driftBefore := walletDriftCRC(t, pool, hot)

	const N = 100
	const each = int64(25)
	var wg sync.WaitGroup
	var failures int32

	for i := 0; i < N; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := eng.Post(ctx, &ledger.Posting{
				Description: "hot-credit",
				Entries: []ledger.Entry{
					{Account: ledger.Account{SystemCode: ledger.SystemReserveCRC}, Side: ledger.Debit, AmountMinor: each, Currency: "CRC"},
					{Account: ledger.Account{UserID: hot}, Side: ledger.Credit, AmountMinor: each, Currency: "CRC"},
				},
			})
			if err != nil {
				atomic.AddInt32(&failures, 1)
				t.Logf("hot-credit #%d failed: %v", i, err)
			}
		}(i)
	}
	wg.Wait()

	if failures > 0 {
		t.Fatalf("%d/%d concurrent credits to the hot wallet failed", failures, N)
	}
	if got := walletCRC(t, pool, hot) - before; got != N*each {
		t.Errorf("hot wallet credited %d, want %d (lost updates?)", got, N*each)
	}
	// Every credit landed in both the cache and the journal — drift unchanged.
	if d := walletDriftCRC(t, pool, hot); d != driftBefore {
		t.Errorf("hot wallet drift changed under contention: before=%d after=%d", driftBefore, d)
	}
}

// TestImmutableEntries — UPDATE / DELETE on journal_entries must fail.
func TestImmutableEntries(t *testing.T) {
	pool := testutil.TestDB(t)
	from := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	to := testutil.SeedTestUser2(t, pool)
	eng := ledger.NewEngine(pool, slog.New(slog.NewTextHandler(os.Stdout, nil)))
	ctx := context.Background()

	if _, err := eng.Post(ctx, &ledger.Posting{
		Description: "to-be-immutable",
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: from}, Side: ledger.Debit, AmountMinor: 1, Currency: "CRC"},
			{Account: ledger.Account{UserID: to}, Side: ledger.Credit, AmountMinor: 1, Currency: "CRC"},
		},
	}); err != nil {
		t.Fatalf("post: %v", err)
	}

	// The append-only triggers (installed by testutil, mirroring migration 020)
	// must reject every mutation of already-posted journal rows.
	mutations := []struct {
		name string
		sql  string
	}{
		{"update-entries", "UPDATE journal_entries SET amount_minor = amount_minor + 1"},
		{"delete-entries", "DELETE FROM journal_entries"},
		{"update-postings", "UPDATE journal_postings SET description = 'tampered'"},
		{"delete-postings", "DELETE FROM journal_postings"},
	}
	for _, m := range mutations {
		if _, err := pool.Exec(ctx, m.sql); err == nil {
			t.Errorf("%s: expected append-only trigger to reject the mutation, got nil error", m.name)
		} else if !strings.Contains(err.Error(), "append-only") {
			t.Errorf("%s: expected an append-only rejection, got: %v", m.name, err)
		}
	}
}
