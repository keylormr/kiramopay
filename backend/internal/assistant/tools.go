package assistant

import (
	"context"
	"errors"
	"fmt"

	"github.com/kiramopay/backend/internal/budget"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
)

// Reader interfaces keep the assistant decoupled from the concrete services and
// — crucially — expose ONLY read methods, so no tool can ever move money.
type (
	WalletReader interface {
		GetBalance(ctx context.Context, userID string) (*wallet.BalanceResponse, error)
	}
	TransactionReader interface {
		ListTransactions(ctx context.Context, userID string, req *transaction.ListTransactionsRequest) (*transaction.TransactionListResponse, error)
	}
	BudgetReader interface {
		List(ctx context.Context, userID string) ([]budget.BudgetRecord, error)
	}
)

// ErrUnknownTool is returned when the model requests a tool that isn't
// registered (or, by construction, isn't read-only).
var ErrUnknownTool = errors.New("assistant: unknown tool")

// Tools is the read-only tool set bound to the signed-in user's services.
type Tools struct {
	wallet WalletReader
	tx     TransactionReader
	budget BudgetReader
}

func NewTools(w WalletReader, tx TransactionReader, b BudgetReader) *Tools {
	return &Tools{wallet: w, tx: tx, budget: b}
}

// minorToMajor converts integer minor units (céntimos) to a major-unit float
// for human-readable model reasoning.
func minorToMajor(minor int64) float64 { return float64(minor) / 100 }

// Declarations advertises the available tools to the model.
func (t *Tools) Declarations() []FunctionDecl {
	emptyObject := map[string]any{"type": "object", "properties": map[string]any{}}
	return []FunctionDecl{
		{
			Name:        "get_balance",
			Description: "Get the user's current wallet balance in CRC and USD.",
			Parameters:  emptyObject,
		},
		{
			Name:        "list_transactions",
			Description: "List the user's most recent transactions, newest first. Optionally filter by type.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"limit": map[string]any{"type": "integer", "description": "How many to return (1-50, default 15)."},
					"type":  map[string]any{"type": "string", "description": "Optional transaction type filter, e.g. sinpe_send, qr_payment."},
				},
			},
		},
		{
			Name:        "spending_summary",
			Description: "Summarize the user's recent outgoing spending, totalled by transaction type, over the last N transactions.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"limit": map[string]any{"type": "integer", "description": "How many recent transactions to consider (1-200, default 50)."},
				},
			},
		},
		{
			Name:        "list_budgets",
			Description: "List the user's budgets with their limit and amount spent.",
			Parameters:  emptyObject,
		},
	}
}

// Invoke runs a read-only tool for the given user and returns a
// JSON-serializable result.
func (t *Tools) Invoke(ctx context.Context, userID, name string, args map[string]any) (any, error) {
	switch name {
	case "get_balance":
		return t.getBalance(ctx, userID)
	case "list_transactions":
		return t.listTransactions(ctx, userID, args)
	case "spending_summary":
		return t.spendingSummary(ctx, userID, args)
	case "list_budgets":
		return t.listBudgets(ctx, userID)
	default:
		return nil, ErrUnknownTool
	}
}

func (t *Tools) getBalance(ctx context.Context, userID string) (any, error) {
	if t.wallet == nil {
		return nil, ErrUnknownTool
	}
	b, err := t.wallet.GetBalance(ctx, userID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"crc": minorToMajor(b.CRC),
		"usd": minorToMajor(b.USD),
	}, nil
}

func argInt(args map[string]any, key string, def, min, max int) int {
	v, ok := args[key]
	if !ok {
		return def
	}
	var n int
	switch x := v.(type) {
	case float64:
		n = int(x)
	case int:
		n = x
	case int64:
		n = int(x)
	default:
		return def
	}
	if n < min {
		return min
	}
	if n > max {
		return max
	}
	return n
}

func argString(args map[string]any, key string) string {
	if v, ok := args[key].(string); ok {
		return v
	}
	return ""
}

func (t *Tools) listTransactions(ctx context.Context, userID string, args map[string]any) (any, error) {
	if t.tx == nil {
		return nil, ErrUnknownTool
	}
	limit := argInt(args, "limit", 15, 1, 50)
	res, err := t.tx.ListTransactions(ctx, userID, &transaction.ListTransactionsRequest{
		Limit: limit,
		Type:  argString(args, "type"),
	})
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(res.Transactions))
	for _, r := range res.Transactions {
		items = append(items, map[string]any{
			"type":         r.Type,
			"amount":       minorToMajor(r.Amount),
			"currency":     r.Currency,
			"counterparty": r.CounterpartyName,
			"status":       r.Status,
			"date":         r.CreatedAt.Format("2006-01-02"),
		})
	}
	return map[string]any{"transactions": items, "total": res.Total}, nil
}

func (t *Tools) spendingSummary(ctx context.Context, userID string, args map[string]any) (any, error) {
	if t.tx == nil {
		return nil, ErrUnknownTool
	}
	limit := argInt(args, "limit", 50, 1, 200)
	res, err := t.tx.ListTransactions(ctx, userID, &transaction.ListTransactionsRequest{Limit: limit})
	if err != nil {
		return nil, err
	}
	byType := map[string]int64{}
	var totalOut int64
	for _, r := range res.Transactions {
		if r.Status != "completed" || !isOutgoing(r.Type) {
			continue
		}
		byType[r.Type] += r.Amount
		totalOut += r.Amount
	}
	cats := make([]map[string]any, 0, len(byType))
	for typ, sum := range byType {
		cats = append(cats, map[string]any{"type": typ, "total": minorToMajor(sum)})
	}
	return map[string]any{
		"considered":     len(res.Transactions),
		"total_outgoing": minorToMajor(totalOut),
		"by_type":        cats,
	}, nil
}

func (t *Tools) listBudgets(ctx context.Context, userID string) (any, error) {
	if t.budget == nil {
		return nil, ErrUnknownTool
	}
	bs, err := t.budget.List(ctx, userID)
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(bs))
	for _, b := range bs {
		items = append(items, map[string]any{
			"label":     b.Label,
			"limit":     minorToMajor(b.AmountLimit),
			"spent":     minorToMajor(b.AmountSpent),
			"currency":  b.Currency,
			"period":    b.Period,
			"remaining": minorToMajor(b.AmountLimit - b.AmountSpent),
		})
	}
	return map[string]any{"budgets": items}, nil
}

// isOutgoing classifies a transaction type as money leaving the user — a small
// allowlist mirroring the spend-side types used elsewhere.
func isOutgoing(txType string) bool {
	switch txType {
	case "sinpe_send", "qr_payment", "bill_payment", "withdrawal", "p2p_send",
		"marketplace", "crypto_buy", "payout_sent", "escrow_fund", "recharge":
		return true
	default:
		return false
	}
}

// describe is a tiny helper for error wrapping in the orchestrator.
func describe(name string, err error) error {
	return fmt.Errorf("tool %s: %w", name, err)
}
