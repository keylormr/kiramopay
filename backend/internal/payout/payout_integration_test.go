package payout

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
)

// fundWallet gives a user an opening balance through the ledger (debit RESERVE
// / credit user), keeping the journal and the wallet cache consistent.
func fundWallet(t *testing.T, eng *ledger.Engine, userID string, amount int64) {
	t.Helper()
	_, err := eng.Post(context.Background(), &ledger.Posting{
		Description: "TEST_OPENING_BALANCE",
		CreatedBy:   userID,
		Entries: []ledger.Entry{
			{Account: ledger.Account{SystemCode: ledger.SystemReserveCRC}, Side: ledger.Debit, AmountMinor: amount, Currency: "CRC"},
			{Account: ledger.Account{UserID: userID}, Side: ledger.Credit, AmountMinor: amount, Currency: "CRC"},
		},
	})
	if err != nil {
		t.Fatalf("fund wallet: %v", err)
	}
}

func walletCRC(t *testing.T, pool *pgxpool.Pool, userID string) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(context.Background(),
		`SELECT balance_crc FROM wallets WHERE user_id = $1::uuid`, userID).Scan(&bal); err != nil {
		t.Fatalf("read wallet: %v", err)
	}
	return bal
}

// systemBalance returns the signed balance of a system account from the journal.
func systemBalance(t *testing.T, pool *pgxpool.Pool, code string) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor ELSE -je.amount_minor END), 0)
		FROM journal_entries je
		JOIN ledger_accounts la ON la.id = je.account_id
		WHERE la.code = $1`, code).Scan(&bal); err != nil {
		t.Fatalf("read system account %s: %v", code, err)
	}
	return bal
}

func countTx(t *testing.T, pool *pgxpool.Pool, userID, txType string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM transactions WHERE user_id = $1::uuid AND type = $2 AND status = 'completed'`,
		userID, txType).Scan(&n); err != nil {
		t.Fatalf("count tx: %v", err)
	}
	return n
}

const mockExternalCRC = "SYSTEM:EXTERNAL:MOCK:CRC"

func setup(t *testing.T) (*pgxpool.Pool, *Service, *MockRail, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	user := testutil.SeedTestUser(t, pool, "702650930", "dummy")

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	eng := ledger.NewEngine(pool, logger)

	reg := NewRegistry()
	mock := NewMockRail()
	if err := reg.Register(mock); err != nil {
		t.Fatalf("register: %v", err)
	}
	txSvc := transaction.NewService(
		transaction.NewRepository(pool), wallet.NewRepository(pool), eng, &transaction.Options{})
	svc := NewService(NewRepository(pool), eng, reg, &Options{History: txSvc, Logger: logger})

	fundWallet(t, eng, user, 1_000_000) // 10,000.00 CRC
	return pool, svc, mock, user
}

func req(account string, amount int64, idem string) *CreateRequest {
	return &CreateRequest{
		Rail: "mock", AmountMinor: amount, Currency: "CRC",
		Destination:    Destination{Type: "bank_account", Account: account, Name: "Beneficiary"},
		IdempotencyKey: idem,
	}
}

func TestPayoutCompleted(t *testing.T) {
	pool, svc, _, user := setup(t)
	ctx := context.Background()

	before := walletCRC(t, pool, user)
	p, err := svc.Create(ctx, user, req("00012345", 250_000, "idem-ok"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if p.Status != StatusCompleted {
		t.Fatalf("status = %s, want completed", p.Status)
	}
	if p.ExternalID == "" {
		t.Errorf("expected external id set")
	}
	if got := walletCRC(t, pool, user); got != before-250_000 {
		t.Errorf("wallet = %d, want %d", got, before-250_000)
	}
	// Money left the platform: the rail's external liability holds it.
	if got := systemBalance(t, pool, mockExternalCRC); got != 250_000 {
		t.Errorf("external account = %d, want 250000", got)
	}
	if got := countTx(t, pool, user, "payout_sent"); got != 1 {
		t.Errorf("payout_sent history rows = %d, want 1", got)
	}
}

func TestPayoutFailedRefunds(t *testing.T) {
	pool, svc, _, user := setup(t)
	ctx := context.Background()

	before := walletCRC(t, pool, user)
	p, err := svc.Create(ctx, user, req("fail-999", 120_000, "idem-fail"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if p.Status != StatusFailed {
		t.Fatalf("status = %s, want failed", p.Status)
	}
	// Money was returned: wallet whole, external account flat.
	if got := walletCRC(t, pool, user); got != before {
		t.Errorf("wallet = %d, want %d (refunded)", got, before)
	}
	if got := systemBalance(t, pool, mockExternalCRC); got != 0 {
		t.Errorf("external account = %d, want 0 after refund", got)
	}
	if got := countTx(t, pool, user, "payout_sent"); got != 1 {
		t.Errorf("payout_sent rows = %d, want 1", got)
	}
	if got := countTx(t, pool, user, "payout_refund"); got != 1 {
		t.Errorf("payout_refund rows = %d, want 1", got)
	}
}

func TestPayoutInsufficient(t *testing.T) {
	pool, svc, _, user := setup(t)
	ctx := context.Background()
	_ = pool
	// SeedTestUser starts with a large balance; exceed it.
	if _, err := svc.Create(ctx, user, req("00099", 9_999_000_000, "idem-big")); !errors.Is(err, ErrInsufficient) {
		t.Errorf("expected ErrInsufficient, got %v", err)
	}
}

func TestPayoutIdempotentReplay(t *testing.T) {
	pool, svc, _, user := setup(t)
	ctx := context.Background()

	before := walletCRC(t, pool, user)
	p1, err := svc.Create(ctx, user, req("00077", 70_000, "idem-dup"))
	if err != nil {
		t.Fatalf("create 1: %v", err)
	}
	p2, err := svc.Create(ctx, user, req("00077", 70_000, "idem-dup"))
	if err != nil {
		t.Fatalf("create 2: %v", err)
	}
	if p1.ID != p2.ID {
		t.Errorf("idempotent replay returned different ids: %s vs %s", p1.ID, p2.ID)
	}
	// The wallet was debited exactly once.
	if got := walletCRC(t, pool, user); got != before-70_000 {
		t.Errorf("wallet = %d, want %d (single debit)", got, before-70_000)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM payouts WHERE user_id = $1::uuid`, user).Scan(&n); err != nil {
		t.Fatalf("count payouts: %v", err)
	}
	if n != 1 {
		t.Errorf("payout rows = %d, want 1", n)
	}
}

func TestPayoutPendingThenRefresh(t *testing.T) {
	pool, svc, mock, user := setup(t)
	ctx := context.Background()

	before := walletCRC(t, pool, user)
	p, err := svc.Create(ctx, user, req("pending-55", 90_000, "idem-pend"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if p.Status != StatusProcessing {
		t.Fatalf("status = %s, want processing", p.Status)
	}
	// Funds are held off the user's wallet while the rail settles.
	if got := walletCRC(t, pool, user); got != before-90_000 {
		t.Errorf("wallet = %d, want %d", got, before-90_000)
	}
	if got := systemBalance(t, pool, mockExternalCRC); got != 90_000 {
		t.Errorf("external = %d, want 90000 while pending", got)
	}

	// Rail confirms settlement; refresh advances to completed (no extra money moves).
	mock.Settle(p.ExternalID)
	out, err := svc.Refresh(ctx, user, p.ID)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if out.Status != StatusCompleted {
		t.Errorf("status after refresh = %s, want completed", out.Status)
	}
	if got := walletCRC(t, pool, user); got != before-90_000 {
		t.Errorf("wallet after settle = %d, want %d", got, before-90_000)
	}
	if got := systemBalance(t, pool, mockExternalCRC); got != 90_000 {
		t.Errorf("external after settle = %d, want 90000", got)
	}
}

func TestPayoutPollerReconciles(t *testing.T) {
	pool, svc, mock, user := setup(t)
	ctx := context.Background()

	p, err := svc.Create(ctx, user, req("pending-1", 40_000, "idem-poll"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if p.Status != StatusProcessing {
		t.Fatalf("status = %s, want processing", p.Status)
	}
	mock.Fail(p.ExternalID) // rail ultimately rejects

	before := walletCRC(t, pool, user)
	advanced, err := svc.reconcileStuck(ctx, 0, 100) // grace 0 → pick it up now
	if err != nil {
		t.Fatalf("reconcileStuck: %v", err)
	}
	if advanced != 1 {
		t.Errorf("advanced = %d, want 1", advanced)
	}
	out, _ := svc.repo.Get(ctx, p.ID)
	if out.Status != StatusFailed {
		t.Errorf("status = %s, want failed", out.Status)
	}
	// Rejected settlement refunded the user.
	if got := walletCRC(t, pool, user); got != before+40_000 {
		t.Errorf("wallet after poller refund = %d, want %d", got, before+40_000)
	}
	if got := systemBalance(t, pool, mockExternalCRC); got != 0 {
		t.Errorf("external after refund = %d, want 0", got)
	}
}

func TestPayoutAmbiguousStaysProcessing(t *testing.T) {
	pool, svc, _, user := setup(t)
	ctx := context.Background()

	before := walletCRC(t, pool, user)
	p, err := svc.Create(ctx, user, req("err-timeout", 30_000, "idem-amb"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// Transport ambiguity must NOT refund (avoid double-spend); money stays held.
	if p.Status != StatusProcessing {
		t.Errorf("status = %s, want processing", p.Status)
	}
	if p.ExternalID != "" {
		t.Errorf("ambiguous send should leave external id empty, got %q", p.ExternalID)
	}
	if got := walletCRC(t, pool, user); got != before-30_000 {
		t.Errorf("wallet = %d, want %d (held, not refunded)", got, before-30_000)
	}
	if got := systemBalance(t, pool, mockExternalCRC); got != 30_000 {
		t.Errorf("external = %d, want 30000 (held)", got)
	}
}

// fakeMFA always requires MFA and never has a verified challenge.
type fakeMFA struct{}

func (fakeMFA) IsMFARequired(int64, string) bool { return true }
func (fakeMFA) HasVerifiedMFA(context.Context, string, string) (bool, error) {
	return false, nil
}

func TestPayoutMFAGate(t *testing.T) {
	pool := testutil.TestDB(t)
	user := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	eng := ledger.NewEngine(pool, logger)
	reg := NewRegistry()
	_ = reg.Register(NewMockRail())
	svc := NewService(NewRepository(pool), eng, reg, &Options{MFA: fakeMFA{}})
	fundWallet(t, eng, user, 100_000_000)

	ctx := context.Background()
	if _, err := svc.Create(ctx, user, req("00012345", 50_000_000, "idem-mfa")); !errors.Is(err, ErrMFARequired) {
		t.Fatalf("expected ErrMFARequired, got %v", err)
	}
	// No money moved, no rail account touched.
	if got := systemBalance(t, pool, mockExternalCRC); got != 0 {
		t.Errorf("external = %d, want 0 (gated before posting)", got)
	}
}
