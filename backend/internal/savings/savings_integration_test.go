package savings_test

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/savings"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
	"github.com/kiramopay/backend/pkg/hash"
)

func setupSavings(t *testing.T) (*savings.Service, *pgxpool.Pool, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	l := ledger.NewEngine(pool, slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	txSvc := transaction.NewService(transaction.NewRepository(pool), wallet.NewRepository(pool), l, nil)
	svc := savings.NewService(savings.NewRepository(pool), l, txSvc)
	pinHash, _ := hash.HashPin("Kiramopay2024!")
	user := testutil.SeedTestUser(t, pool, "702650930", pinHash)
	return svc, pool, user
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

func savingsHeldCRC(t *testing.T, pool *pgxpool.Pool) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor ELSE -je.amount_minor END), 0)
		FROM journal_entries je
		JOIN ledger_accounts la ON la.id = je.account_id
		WHERE la.code = 'SYSTEM:SAVINGS:CRC'`).Scan(&bal); err != nil {
		t.Fatalf("read savings held: %v", err)
	}
	return bal
}

func newGoal(t *testing.T, svc *savings.Service, user string) *savings.Goal {
	t.Helper()
	g, err := svc.Create(context.Background(), user, &savings.CreateGoalRequest{
		Name: "Casa", TargetMinor: 100000000, Currency: "CRC", Icon: "home",
	})
	if err != nil {
		t.Fatalf("create goal: %v", err)
	}
	return g
}

// A deposit moves money from the wallet into SYSTEM:SAVINGS; a withdraw reverses
// it. The goal's saved amount tracks both, and the ledger stays balanced.
func TestSavings_DepositAndWithdraw_MovesMoney(t *testing.T) {
	svc, pool, user := setupSavings(t)
	ctx := context.Background()
	g := newGoal(t, svc, user)

	w0, s0 := walletCRC(t, pool, user), savingsHeldCRC(t, pool)
	const dep int64 = 50000

	g1, err := svc.Deposit(ctx, user, g.ID, dep, "")
	if err != nil {
		t.Fatalf("deposit: %v", err)
	}
	if g1.SavedMinor != dep {
		t.Fatalf("saved = %d, want %d", g1.SavedMinor, dep)
	}
	if got := walletCRC(t, pool, user); got != w0-dep {
		t.Fatalf("wallet = %d, want %d", got, w0-dep)
	}
	if got := savingsHeldCRC(t, pool); got != s0+dep {
		t.Fatalf("savings held = %d, want %d", got, s0+dep)
	}

	const wd int64 = 20000
	g2, err := svc.Withdraw(ctx, user, g.ID, wd, "")
	if err != nil {
		t.Fatalf("withdraw: %v", err)
	}
	if g2.SavedMinor != dep-wd {
		t.Fatalf("saved after withdraw = %d, want %d", g2.SavedMinor, dep-wd)
	}
	if got := walletCRC(t, pool, user); got != w0-(dep-wd) {
		t.Fatalf("wallet after withdraw = %d, want %d", got, w0-(dep-wd))
	}
	if got := savingsHeldCRC(t, pool); got != s0+(dep-wd) {
		t.Fatalf("savings held after withdraw = %d, want %d", got, s0+(dep-wd))
	}
}

func TestSavings_Deposit_InsufficientBalance(t *testing.T) {
	svc, pool, user := setupSavings(t)
	ctx := context.Background()
	g := newGoal(t, svc, user)
	tooMuch := walletCRC(t, pool, user) + 1
	if _, err := svc.Deposit(ctx, user, g.ID, tooMuch, ""); err == nil {
		t.Fatal("expected insufficient-balance error")
	}
}

func TestSavings_Withdraw_ExceedsSaved(t *testing.T) {
	svc, _, user := setupSavings(t)
	ctx := context.Background()
	g := newGoal(t, svc, user)
	if _, err := svc.Deposit(ctx, user, g.ID, 10000, ""); err != nil {
		t.Fatalf("deposit: %v", err)
	}
	if _, err := svc.Withdraw(ctx, user, g.ID, 20000, ""); err == nil {
		t.Fatal("expected error withdrawing more than saved")
	}
}

// The guarded decrement makes saved_minor the authoritative gate: once a goal is
// emptied, a repeat withdraw of the same amount fails instead of fabricating a
// second wallet credit (the TOCTOU money-creation path).
func TestSavings_Withdraw_NoDoubleSpend(t *testing.T) {
	svc, pool, user := setupSavings(t)
	ctx := context.Background()
	g := newGoal(t, svc, user)
	const amt int64 = 30000
	if _, err := svc.Deposit(ctx, user, g.ID, amt, ""); err != nil {
		t.Fatalf("deposit: %v", err)
	}
	wMid := walletCRC(t, pool, user)

	if _, err := svc.Withdraw(ctx, user, g.ID, amt, ""); err != nil {
		t.Fatalf("withdraw: %v", err)
	}
	// A second withdraw of the same amount must fail — the goal is empty.
	if _, err := svc.Withdraw(ctx, user, g.ID, amt, ""); err == nil {
		t.Fatal("expected second withdraw to fail (no funds to double-spend)")
	}
	// The wallet was credited exactly once.
	if got := walletCRC(t, pool, user); got != wMid+amt {
		t.Fatalf("wallet = %d, want %d (single credit)", got, wMid+amt)
	}
	// SYSTEM:SAVINGS was not driven negative.
	if got := savingsHeldCRC(t, pool); got < 0 {
		t.Fatalf("savings held went negative: %d", got)
	}
}

// A repeated deposit carrying the same Idempotency-Key moves money only once.
func TestSavings_Deposit_Idempotent(t *testing.T) {
	svc, pool, user := setupSavings(t)
	ctx := context.Background()
	g := newGoal(t, svc, user)
	w0 := walletCRC(t, pool, user)
	const amt int64 = 25000
	const key = "deposit-req-abc"

	g1, err := svc.Deposit(ctx, user, g.ID, amt, key)
	if err != nil {
		t.Fatalf("deposit: %v", err)
	}
	if g1.SavedMinor != amt {
		t.Fatalf("saved = %d, want %d", g1.SavedMinor, amt)
	}
	// Same key again: a no-op, not a second debit.
	g2, err := svc.Deposit(ctx, user, g.ID, amt, key)
	if err != nil {
		t.Fatalf("retry deposit: %v", err)
	}
	if g2.SavedMinor != amt {
		t.Fatalf("retry saved = %d, want %d (no double move)", g2.SavedMinor, amt)
	}
	if got := walletCRC(t, pool, user); got != w0-amt {
		t.Fatalf("wallet = %d, want %d (single debit)", got, w0-amt)
	}
}

// Deleting a goal returns any held savings to the wallet — nothing is stranded.
func TestSavings_Delete_RefundsHeld(t *testing.T) {
	svc, pool, user := setupSavings(t)
	ctx := context.Background()
	g := newGoal(t, svc, user)

	w0, s0 := walletCRC(t, pool, user), savingsHeldCRC(t, pool)
	if _, err := svc.Deposit(ctx, user, g.ID, 40000, ""); err != nil {
		t.Fatalf("deposit: %v", err)
	}
	if err := svc.Delete(ctx, user, g.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if got := walletCRC(t, pool, user); got != w0 {
		t.Fatalf("wallet after delete = %d, want %d (refunded)", got, w0)
	}
	if got := savingsHeldCRC(t, pool); got != s0 {
		t.Fatalf("savings held after delete = %d, want %d (released)", got, s0)
	}
	if goals, _ := svc.List(ctx, user); len(goals) != 0 {
		t.Fatalf("goal should be gone, got %d", len(goals))
	}
}
