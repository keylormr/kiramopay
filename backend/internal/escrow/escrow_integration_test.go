package escrow_test

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/kiramopay/backend/internal/escrow"
	"github.com/kiramopay/backend/internal/ledger"
	"github.com/kiramopay/backend/internal/testutil"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
)

// fundWallet gives a user an opening balance through the ledger (debit
// RESERVE / credit user wallet), the same shape the dev seeder uses, so the
// journal and the wallet cache stay consistent.
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

func escrowAccountBalance(t *testing.T, pool *pgxpool.Pool) int64 {
	t.Helper()
	var bal int64
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN je.direction = 'credit' THEN je.amount_minor ELSE -je.amount_minor END), 0)
		FROM journal_entries je
		JOIN ledger_accounts la ON la.id = je.account_id
		WHERE la.code = 'SYSTEM:ESCROW:CRC'`).Scan(&bal); err != nil {
		t.Fatalf("read escrow account: %v", err)
	}
	return bal
}

// mfaDePrueba es la reja de segundo factor de las pruebas.
//
// El setup pasaba `nil` en Options, asi que TODAS las pruebas de escrow corrian
// con la reja APAGADA: se podia reescribir la liquidacion entera sin que nada
// avisara de que ese camino no se estaba ejercitando. Ahora la reja esta puesta
// y `verificado` decide si deja pasar.
type mfaDePrueba struct {
	desde      int64
	verificado bool
}

func (m mfaDePrueba) IsMFARequired(amountMinor int64, _ string) bool {
	return m.desde > 0 && amountMinor >= m.desde
}

func (m mfaDePrueba) HasVerifiedMFA(context.Context, string, string) (bool, error) {
	return m.verificado, nil
}

func setup(t *testing.T) (*pgxpool.Pool, *escrow.Service, string, string) {
	t.Helper()
	return setupConMFA(t, mfaDePrueba{desde: 100_000, verificado: true})
}

func setupConMFA(t *testing.T, reja escrow.MFAEnforcer) (*pgxpool.Pool, *escrow.Service, string, string) {
	t.Helper()
	pool := testutil.TestDB(t)
	buyer := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	seller := testutil.SeedTestUser2(t, pool)

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	eng := ledger.NewEngine(pool, logger)
	svc := escrow.NewService(escrow.NewRepository(pool), eng, &escrow.Options{MFA: reja})

	fundWallet(t, eng, buyer, 1_000_000) // 10,000.00 CRC
	return pool, svc, buyer, seller
}

// La reja de segundo factor de verdad frena el fondeo. Sin esta prueba —y con el
// setup pasando nil— el camino de MFA del escrow no lo ejercitaba nadie.
func TestFondearExigeSegundoFactor(t *testing.T) {
	pool, svc, buyer, seller := setupConMFA(t, mfaDePrueba{desde: 100_000, verificado: false})
	ctx := context.Background()

	a, err := svc.Create(ctx, buyer, &escrow.CreateRequest{
		SellerID: seller, AmountMinor: 250_000, Currency: "CRC", Description: "laptop",
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	saldo0 := walletCRC(t, pool, buyer)

	if _, err := svc.Fund(ctx, buyer, a.ID); !errors.Is(err, escrow.ErrMFARequired) {
		t.Fatalf("error = %v, se esperaba ErrMFARequired", err)
	}
	if got := walletCRC(t, pool, buyer); got != saldo0 {
		t.Fatalf("saldo = %d, se esperaba %d: se movio plata sin segundo factor", got, saldo0)
	}
}

func TestEscrowFundAndRelease(t *testing.T) {
	pool, svc, buyer, seller := setup(t)
	ctx := context.Background()

	a, err := svc.Create(ctx, buyer, &escrow.CreateRequest{
		SellerID: seller, AmountMinor: 250_000, Currency: "CRC", Description: "laptop",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if a.Status != escrow.StatusPending {
		t.Fatalf("expected pending, got %s", a.Status)
	}

	buyerBefore := walletCRC(t, pool, buyer)
	sellerBefore := walletCRC(t, pool, seller)

	if _, err := svc.Fund(ctx, buyer, a.ID); err != nil {
		t.Fatalf("fund: %v", err)
	}
	if got := walletCRC(t, pool, buyer); got != buyerBefore-250_000 {
		t.Errorf("buyer wallet: got %d, want %d", got, buyerBefore-250_000)
	}
	if got := escrowAccountBalance(t, pool); got != 250_000 {
		t.Errorf("escrow account: got %d, want 250000", got)
	}

	// Double-fund must be rejected (already funded).
	if _, err := svc.Fund(ctx, buyer, a.ID); !errors.Is(err, escrow.ErrBadTransition) {
		t.Errorf("double fund: expected ErrBadTransition, got %v", err)
	}

	// Seller cannot release; buyer can.
	if _, err := svc.Release(ctx, seller, a.ID); !errors.Is(err, escrow.ErrNotBuyer) {
		t.Errorf("seller release: expected ErrNotBuyer, got %v", err)
	}
	out, err := svc.Release(ctx, buyer, a.ID)
	if err != nil {
		t.Fatalf("release: %v", err)
	}
	if out.Status != escrow.StatusReleased {
		t.Errorf("expected released, got %s", out.Status)
	}
	if got := walletCRC(t, pool, seller); got != sellerBefore+250_000 {
		t.Errorf("seller wallet: got %d, want %d", got, sellerBefore+250_000)
	}
	if got := escrowAccountBalance(t, pool); got != 0 {
		t.Errorf("escrow account after release: got %d, want 0", got)
	}
}

func TestEscrowRefundBySeller(t *testing.T) {
	pool, svc, buyer, seller := setup(t)
	ctx := context.Background()

	a, _ := svc.Create(ctx, buyer, &escrow.CreateRequest{
		SellerID: seller, AmountMinor: 100_000, Currency: "CRC", Description: "service",
	})
	buyerBefore := walletCRC(t, pool, buyer)
	if _, err := svc.Fund(ctx, buyer, a.ID); err != nil {
		t.Fatalf("fund: %v", err)
	}

	// Buyer cannot self-refund; the seller waives instead.
	if _, err := svc.Refund(ctx, buyer, a.ID); !errors.Is(err, escrow.ErrNotSeller) {
		t.Errorf("buyer refund: expected ErrNotSeller, got %v", err)
	}
	out, err := svc.Refund(ctx, seller, a.ID)
	if err != nil {
		t.Fatalf("refund: %v", err)
	}
	if out.Status != escrow.StatusRefunded {
		t.Errorf("expected refunded, got %s", out.Status)
	}
	if got := walletCRC(t, pool, buyer); got != buyerBefore {
		t.Errorf("buyer wallet after refund: got %d, want %d", got, buyerBefore)
	}
	if got := escrowAccountBalance(t, pool); got != 0 {
		t.Errorf("escrow account after refund: got %d, want 0", got)
	}
}

func TestEscrowDisputeAndResolve(t *testing.T) {
	pool, svc, buyer, seller := setup(t)
	ctx := context.Background()

	a, _ := svc.Create(ctx, buyer, &escrow.CreateRequest{
		SellerID: seller, AmountMinor: 50_000, Currency: "CRC", Description: "phone",
	})
	if _, err := svc.Fund(ctx, buyer, a.ID); err != nil {
		t.Fatalf("fund: %v", err)
	}
	if _, err := svc.Dispute(ctx, buyer, a.ID, "item not received"); err != nil {
		t.Fatalf("dispute: %v", err)
	}

	// Parties cannot move a disputed agreement themselves.
	if _, err := svc.Release(ctx, buyer, a.ID); !errors.Is(err, escrow.ErrBadTransition) {
		t.Errorf("release while disputed: expected ErrBadTransition, got %v", err)
	}
	if _, err := svc.Refund(ctx, seller, a.ID); !errors.Is(err, escrow.ErrBadTransition) {
		t.Errorf("refund while disputed: expected ErrBadTransition, got %v", err)
	}

	buyerBefore := walletCRC(t, pool, buyer)
	out, err := svc.Resolve(ctx, "admin-id", a.ID, escrow.StatusRefunded)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if out.Status != escrow.StatusRefunded {
		t.Errorf("expected refunded, got %s", out.Status)
	}
	if got := walletCRC(t, pool, buyer); got != buyerBefore+50_000 {
		t.Errorf("buyer wallet after resolution: got %d, want %d", got, buyerBefore+50_000)
	}
}

func TestEscrowHistoryRows(t *testing.T) {
	pool := testutil.TestDB(t)
	buyer := testutil.SeedTestUser(t, pool, "702650930", "dummy")
	seller := testutil.SeedTestUser2(t, pool)
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	eng := ledger.NewEngine(pool, logger)

	txSvc := transaction.NewService(
		transaction.NewRepository(pool), wallet.NewRepository(pool), eng,
		&transaction.Options{})
	svc := escrow.NewService(escrow.NewRepository(pool), eng,
		&escrow.Options{History: txSvc})
	fundWallet(t, eng, buyer, 1_000_000)

	ctx := context.Background()
	a, err := svc.Create(ctx, buyer, &escrow.CreateRequest{
		SellerID: seller, AmountMinor: 40_000, Currency: "CRC", Description: "bike",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := svc.Fund(ctx, buyer, a.ID); err != nil {
		t.Fatalf("fund: %v", err)
	}
	if _, err := svc.Release(ctx, buyer, a.ID); err != nil {
		t.Fatalf("release: %v", err)
	}

	count := func(userID, txType string) int {
		var n int
		if err := pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM transactions
			 WHERE user_id = $1::uuid AND type = $2 AND status = 'completed'`,
			userID, txType).Scan(&n); err != nil {
			t.Fatalf("count: %v", err)
		}
		return n
	}
	if got := count(buyer, "escrow_fund"); got != 1 {
		t.Errorf("buyer escrow_fund rows: got %d, want 1", got)
	}
	if got := count(seller, "escrow_receive"); got != 1 {
		t.Errorf("seller escrow_receive rows: got %d, want 1", got)
	}
}

func TestEscrowGuards(t *testing.T) {
	pool, svc, buyer, seller := setup(t)
	ctx := context.Background()
	_ = pool

	// Insufficient balance: agreement larger than the buyer's wallet
	// (SeedTestUser starts at 250,000,000 + the 1,000,000 opening posting).
	big, _ := svc.Create(ctx, buyer, &escrow.CreateRequest{
		SellerID: seller, AmountMinor: 999_000_000, Currency: "CRC", Description: "car",
	})
	if _, err := svc.Fund(ctx, buyer, big.ID); !errors.Is(err, escrow.ErrInsufficient) {
		t.Errorf("expected ErrInsufficient, got %v", err)
	}

	// Cancel works while pending, then funding is rejected.
	if _, err := svc.Cancel(ctx, seller, big.ID); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if _, err := svc.Fund(ctx, buyer, big.ID); !errors.Is(err, escrow.ErrBadTransition) {
		t.Errorf("fund after cancel: expected ErrBadTransition, got %v", err)
	}

	// A stranger can see nothing.
	stranger := "00000000-0000-0000-0000-00000000dead"
	if _, err := svc.Get(ctx, stranger, big.ID); !errors.Is(err, escrow.ErrNotParty) {
		t.Errorf("stranger get: expected ErrNotParty, got %v", err)
	}
}
