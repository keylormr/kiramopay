package ledger_test

import (
	"context"
	"errors"
	"fmt"
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

// TestMerchantAccountBalance covers the shop-owned account end to end: a
// collection credits the merchant (not the owner), a withdrawal debits it, and
// the balance is derived from the journal rather than a cache.
func TestMerchantAccountBalance(t *testing.T) {
	pool := testutil.TestDB(t)
	owner := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	payer := testutil.SeedTestUser2(t, pool)
	eng := ledger.NewEngine(pool, slog.New(slog.NewTextHandler(os.Stdout, nil)))
	ctx := context.Background()

	var merchantID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO qr_merchants (user_id, name, category, qr_code, cedula, cedula_type, legal_name, verification_status)
		 VALUES ($1::uuid, 'Test Shop', 'retail', 'MRC-TEST-LEDGER', '3101999999', 'juridica', 'TEST SHOP S.A.', 'verified')
		 RETURNING id::text`, owner).Scan(&merchantID); err != nil {
		t.Fatalf("seed merchant: %v", err)
	}

	var ownerBefore int64
	if err := pool.QueryRow(ctx, `SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`, owner).Scan(&ownerBefore); err != nil {
		t.Fatalf("owner wallet before: %v", err)
	}

	// Collection: payer -1000, shop +950, fees +50 (0.5% merchant-absorbed).
	if _, err := eng.Post(ctx, &ledger.Posting{
		Description: "merchant-collection",
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: payer}, Side: ledger.Debit, AmountMinor: 1000, Currency: "CRC"},
			{Account: ledger.Account{MerchantID: merchantID}, Side: ledger.Credit, AmountMinor: 950, Currency: "CRC"},
			{Account: ledger.Account{SystemCode: ledger.SystemFeesCRC}, Side: ledger.Credit, AmountMinor: 50, Currency: "CRC"},
		},
	}); err != nil {
		t.Fatalf("collection post: %v", err)
	}

	bal, err := eng.MerchantBalance(ctx, merchantID, "CRC")
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if bal != 950 {
		t.Fatalf("after collection want 950, got %d", bal)
	}

	// Withdrawal to the owner's personal wallet.
	if _, err := eng.Post(ctx, &ledger.Posting{
		Description: "merchant-withdrawal",
		Entries: []ledger.Entry{
			{Account: ledger.Account{MerchantID: merchantID}, Side: ledger.Debit, AmountMinor: 400, Currency: "CRC"},
			{Account: ledger.Account{UserID: owner}, Side: ledger.Credit, AmountMinor: 400, Currency: "CRC"},
		},
	}); err != nil {
		t.Fatalf("withdrawal post: %v", err)
	}

	bal, err = eng.MerchantBalance(ctx, merchantID, "CRC")
	if err != nil {
		t.Fatalf("balance after withdrawal: %v", err)
	}
	if bal != 550 {
		t.Fatalf("after withdrawal want 550, got %d", bal)
	}

	// The shop's money must reach the owner's wallet ONLY through the explicit
	// withdrawal. The seeded user starts with a balance, so compare the delta:
	// exactly the 400 withdrawn, not the 950 collected.
	var ownerAfter int64
	if err := pool.QueryRow(ctx, `SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`, owner).Scan(&ownerAfter); err != nil {
		t.Fatalf("owner wallet: %v", err)
	}
	if delta := ownerAfter - ownerBefore; delta != 400 {
		t.Fatalf("owner wallet delta = %d, want exactly the 400 withdrawn", delta)
	}
}

// seedTestMerchant inserts a verified shop for ledger-level tests and returns
// its id.
func seedTestMerchant(t *testing.T, pool *pgxpool.Pool, owner, qrCode string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO qr_merchants (user_id, name, category, qr_code, cedula, cedula_type, legal_name, verification_status)
		 VALUES ($1::uuid, 'Test Shop', 'retail', $2, '3101999999', 'juridica', 'TEST SHOP S.A.', 'verified')
		 RETURNING id::text`, owner, qrCode).Scan(&id); err != nil {
		t.Fatalf("seed merchant: %v", err)
	}
	return id
}

// TestMerchantOverdraftRejected — a debit beyond the shop's journal balance
// must fail atomically and leave the journal untouched. This is the guard that
// keeps a withdrawal from minting personal money out of a shop that never
// held it.
func TestMerchantOverdraftRejected(t *testing.T) {
	pool := testutil.TestDB(t)
	owner := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	payer := testutil.SeedTestUser2(t, pool)
	eng := ledger.NewEngine(pool, slog.New(slog.NewTextHandler(os.Stdout, nil)))
	ctx := context.Background()
	merchantID := seedTestMerchant(t, pool, owner, "MRC-TEST-OVERDRAFT")

	ownerBefore := walletCRC(t, pool, owner)

	if _, err := eng.Post(ctx, &ledger.Posting{
		Description: "collection",
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: payer}, Side: ledger.Debit, AmountMinor: 100, Currency: "CRC"},
			{Account: ledger.Account{MerchantID: merchantID}, Side: ledger.Credit, AmountMinor: 100, Currency: "CRC"},
		},
	}); err != nil {
		t.Fatalf("collection: %v", err)
	}

	// More than the shop ever held.
	_, err := eng.Post(ctx, &ledger.Posting{
		Description: "overdraft",
		Entries: []ledger.Entry{
			{Account: ledger.Account{MerchantID: merchantID}, Side: ledger.Debit, AmountMinor: 150, Currency: "CRC"},
			{Account: ledger.Account{UserID: owner}, Side: ledger.Credit, AmountMinor: 150, Currency: "CRC"},
		},
	})
	if !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("overdraft: want ErrInsufficientFunds, got %v", err)
	}
	if bal, _ := eng.MerchantBalance(ctx, merchantID, "CRC"); bal != 100 {
		t.Fatalf("balance after rejected overdraft = %d, want 100 (full rollback)", bal)
	}
	if got := walletCRC(t, pool, owner); got != ownerBefore {
		t.Fatalf("owner wallet moved on a rejected overdraft: %d != %d", got, ownerBefore)
	}

	// The check-then-post shape: two full withdrawals, each covered by the
	// balance on its own read; only the first may land.
	if _, err := eng.Post(ctx, &ledger.Posting{
		Description:    "withdraw-1",
		IdempotencyKey: "wd-toctou-1",
		Entries: []ledger.Entry{
			{Account: ledger.Account{MerchantID: merchantID}, Side: ledger.Debit, AmountMinor: 100, Currency: "CRC"},
			{Account: ledger.Account{UserID: owner}, Side: ledger.Credit, AmountMinor: 100, Currency: "CRC"},
		},
	}); err != nil {
		t.Fatalf("first withdrawal: %v", err)
	}
	_, err = eng.Post(ctx, &ledger.Posting{
		Description:    "withdraw-2",
		IdempotencyKey: "wd-toctou-2",
		Entries: []ledger.Entry{
			{Account: ledger.Account{MerchantID: merchantID}, Side: ledger.Debit, AmountMinor: 100, Currency: "CRC"},
			{Account: ledger.Account{UserID: owner}, Side: ledger.Credit, AmountMinor: 100, Currency: "CRC"},
		},
	})
	if !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("second full withdrawal: want ErrInsufficientFunds, got %v", err)
	}
	if bal, _ := eng.MerchantBalance(ctx, merchantID, "CRC"); bal != 0 {
		t.Fatalf("final balance = %d, want 0 — a shop balance must never go negative", bal)
	}
	if delta := walletCRC(t, pool, owner) - ownerBefore; delta != 100 {
		t.Fatalf("owner received %d, want exactly the 100 the shop held", delta)
	}
}

// TestMerchantConcurrentWithdrawalsSingleWinner — N racing withdrawals with
// distinct idempotency keys against a balance that covers exactly one. The
// merchant row lock serializes them; exactly one may win.
func TestMerchantConcurrentWithdrawalsSingleWinner(t *testing.T) {
	pool := testutil.TestDB(t)
	owner := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	payer := testutil.SeedTestUser2(t, pool)
	eng := ledger.NewEngine(pool, slog.New(slog.NewTextHandler(os.Stdout, nil)))
	ctx := context.Background()
	merchantID := seedTestMerchant(t, pool, owner, "MRC-TEST-RACE")

	ownerBefore := walletCRC(t, pool, owner)

	if _, err := eng.Post(ctx, &ledger.Posting{
		Description: "collection",
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: payer}, Side: ledger.Debit, AmountMinor: 100, Currency: "CRC"},
			{Account: ledger.Account{MerchantID: merchantID}, Side: ledger.Credit, AmountMinor: 100, Currency: "CRC"},
		},
	}); err != nil {
		t.Fatalf("collection: %v", err)
	}

	const N = 8
	var wg sync.WaitGroup
	var wins, insufficient, other int32
	for i := 0; i < N; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := eng.Post(ctx, &ledger.Posting{
				Description:    "racing-withdrawal",
				IdempotencyKey: fmt.Sprintf("wd-race-%d", i),
				Entries: []ledger.Entry{
					{Account: ledger.Account{MerchantID: merchantID}, Side: ledger.Debit, AmountMinor: 100, Currency: "CRC"},
					{Account: ledger.Account{UserID: owner}, Side: ledger.Credit, AmountMinor: 100, Currency: "CRC"},
				},
			})
			switch {
			case err == nil:
				atomic.AddInt32(&wins, 1)
			case errors.Is(err, ledger.ErrInsufficientFunds):
				atomic.AddInt32(&insufficient, 1)
			default:
				atomic.AddInt32(&other, 1)
				t.Errorf("withdrawal #%d unexpected error: %v", i, err)
			}
		}(i)
	}
	wg.Wait()

	if wins != 1 || insufficient != N-1 || other != 0 {
		t.Fatalf("wins=%d insufficient=%d other=%d, want exactly 1/%d/0", wins, insufficient, other, N-1)
	}
	if bal, _ := eng.MerchantBalance(ctx, merchantID, "CRC"); bal != 0 {
		t.Fatalf("balance = %d, want 0 — a shop balance must never go negative", bal)
	}
	if delta := walletCRC(t, pool, owner) - ownerBefore; delta != 100 {
		t.Fatalf("owner received %d, want exactly 100 — the race must not mint money", delta)
	}
}

// TestMerchantAccountRejectsAmbiguous — an entry may name only one account kind.
func TestMerchantAccountRejectsAmbiguous(t *testing.T) {
	eng, from, _ := setup(t)
	ctx := context.Background()

	_, err := eng.Post(ctx, &ledger.Posting{
		Description: "ambiguous",
		Entries: []ledger.Entry{
			{Account: ledger.Account{UserID: from}, Side: ledger.Debit, AmountMinor: 100, Currency: "CRC"},
			{Account: ledger.Account{UserID: from, MerchantID: from}, Side: ledger.Credit, AmountMinor: 100, Currency: "CRC"},
		},
	})
	if err == nil {
		t.Fatal("expected an error for an entry naming both a user and a merchant")
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
