package assistant

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/kiramopay/backend/internal/budget"
	"github.com/kiramopay/backend/internal/payment"
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
	// SavedServicesReader is read-only — it lets the model reference a user's
	// saved bill provider when *proposing* a payment, but cannot pay anything.
	SavedServicesReader interface {
		GetSavedServices(ctx context.Context, userID string) ([]payment.SavedServiceRecord, error)
	}
)

// ErrUnknownTool is returned when the model requests a tool that isn't
// registered (or, by construction, isn't read-only/propose-only).
var ErrUnknownTool = errors.New("assistant: unknown tool")

// Tools is the tool set bound to the signed-in user's services. Read tools
// fetch data; propose_* tools (Phase 3b) validate and return an intent — they
// NEVER call a money service.
type Tools struct {
	wallet   WalletReader
	tx       TransactionReader
	budget   BudgetReader
	saved    SavedServicesReader
	allowAct bool // whether propose_* (write-intent) tools are advertised
}

func NewTools(w WalletReader, tx TransactionReader, b BudgetReader, saved SavedServicesReader) *Tools {
	return &Tools{wallet: w, tx: tx, budget: b, saved: saved, allowAct: true}
}

// minorToMajor converts integer minor units (céntimos) to a major-unit float
// for human-readable model reasoning.
func minorToMajor(minor int64) float64 { return float64(minor) / 100 }

// Declarations advertises the available tools to the model.
func (t *Tools) Declarations() []FunctionDecl {
	emptyObject := map[string]any{"type": "object", "properties": map[string]any{}}
	decls := []FunctionDecl{
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
		{
			Name:        "list_saved_services",
			Description: "List the user's saved bill providers (name, provider code, client id) so a bill payment can reference one.",
			Parameters:  emptyObject,
		},
	}
	if !t.allowAct {
		return decls
	}
	// Phase 3b: write-INTENT tools. They PREPARE an action and return a proposal
	// the user must confirm; they never move money themselves.
	decls = append(decls,
		FunctionDecl{
			Name:        "propose_sinpe_transfer",
			Description: "Prepare a SINPE transfer for the user to confirm. Does NOT send money — the user confirms it in the app. Use only when you have a phone number and an amount.",
			Parameters: map[string]any{
				"type":     "object",
				"required": []any{"phone", "amount"},
				"properties": map[string]any{
					"phone":       map[string]any{"type": "string", "description": "Costa Rican phone number of the recipient (8 digits)."},
					"amount":      map[string]any{"type": "number", "description": "Amount in colones (major units), > 0."},
					"description": map[string]any{"type": "string", "description": "Optional note."},
				},
			},
		},
		FunctionDecl{
			Name:        "propose_bill_payment",
			Description: "Prepare a bill payment for the user to confirm. Does NOT pay — the user confirms it. Use a provider from list_saved_services.",
			Parameters: map[string]any{
				"type":     "object",
				"required": []any{"provider_code", "client_id", "amount"},
				"properties": map[string]any{
					"provider_code": map[string]any{"type": "string", "description": "Provider code from list_saved_services."},
					"provider_name": map[string]any{"type": "string", "description": "Provider display name."},
					"client_id":     map[string]any{"type": "string", "description": "The user's client/account id with that provider."},
					"amount":        map[string]any{"type": "number", "description": "Amount in colones (major units), > 0."},
					"period":        map[string]any{"type": "string", "description": "Optional billing period."},
				},
			},
		},
		FunctionDecl{
			Name:        "propose_recharge",
			Description: "Prepare a mobile top-up (recharge) for the user to confirm. Does NOT recharge — the user confirms it.",
			Parameters: map[string]any{
				"type":     "object",
				"required": []any{"operator", "phone", "amount"},
				"properties": map[string]any{
					"operator": map[string]any{"type": "string", "enum": []any{"kolbi", "claro", "movistar"}, "description": "Mobile operator."},
					"phone":    map[string]any{"type": "string", "description": "Phone number to top up (8 digits)."},
					"amount":   map[string]any{"type": "number", "description": "Amount in colones (major units), > 0."},
				},
			},
		},
	)
	return decls
}

// Invoke runs a tool and returns its LLM-facing result plus, for propose_*
// tools, the Proposal to surface to the client. Read tools return a nil
// Proposal. Propose tools NEVER move money — they only validate and echo.
func (t *Tools) Invoke(ctx context.Context, userID, name string, args map[string]any) (any, *Proposal, error) {
	switch name {
	case "get_balance":
		r, err := t.getBalance(ctx, userID)
		return r, nil, err
	case "list_transactions":
		r, err := t.listTransactions(ctx, userID, args)
		return r, nil, err
	case "spending_summary":
		r, err := t.spendingSummary(ctx, userID, args)
		return r, nil, err
	case "list_budgets":
		r, err := t.listBudgets(ctx, userID)
		return r, nil, err
	case "list_saved_services":
		r, err := t.listSavedServices(ctx, userID)
		return r, nil, err
	case "propose_sinpe_transfer", "propose_bill_payment", "propose_recharge":
		if !t.allowAct {
			return nil, nil, ErrUnknownTool
		}
		return t.propose(name, args)
	default:
		return nil, nil, ErrUnknownTool
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

func (t *Tools) listSavedServices(ctx context.Context, userID string) (any, error) {
	if t.saved == nil {
		return nil, ErrUnknownTool
	}
	svcs, err := t.saved.GetSavedServices(ctx, userID)
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(svcs))
	for _, s := range svcs {
		items = append(items, map[string]any{
			"provider_code": s.ProviderCode,
			"provider_name": s.ProviderName,
			"client_id":     s.ClientID,
			"nickname":      s.Nickname,
		})
	}
	return map[string]any{"saved_services": items}, nil
}

// propose validates a write-intent tool call and returns (a) a result the model
// sees (so it tells the user a confirmation is pending) and (b) the Proposal the
// client renders. It NEVER calls a money service.
func (t *Tools) propose(name string, args map[string]any) (any, *Proposal, error) {
	amountMajor, ok := argFloat(args, "amount")
	if !ok || amountMajor <= 0 {
		return nil, nil, ErrInvalidRequest
	}
	minor := int64(math.Round(amountMajor * 100))
	const cur = "CRC"

	switch name {
	case "propose_sinpe_transfer":
		phone := strings.TrimSpace(argString(args, "phone"))
		if phone == "" {
			return nil, nil, ErrInvalidRequest
		}
		p := &Proposal{
			Kind: "sinpe_transfer", AmountMinor: minor, Currency: cur,
			Phone: phone, Description: strings.TrimSpace(argString(args, "description")),
			Summary: fmt.Sprintf("SINPE ₡%.2f → %s", amountMajor, phone),
		}
		return proposedResult(p), p, nil

	case "propose_bill_payment":
		code := strings.TrimSpace(argString(args, "provider_code"))
		client := strings.TrimSpace(argString(args, "client_id"))
		if code == "" || client == "" {
			return nil, nil, ErrInvalidRequest
		}
		pname := strings.TrimSpace(argString(args, "provider_name"))
		display := pname
		if display == "" {
			display = code
		}
		p := &Proposal{
			Kind: "bill_payment", AmountMinor: minor, Currency: cur,
			ProviderCode: code, ProviderName: pname, ClientID: client,
			Period:  strings.TrimSpace(argString(args, "period")),
			Summary: fmt.Sprintf("Pago ₡%.2f a %s (%s)", amountMajor, display, client),
		}
		return proposedResult(p), p, nil

	case "propose_recharge":
		op := strings.ToLower(strings.TrimSpace(argString(args, "operator")))
		phone := strings.TrimSpace(argString(args, "phone"))
		if phone == "" || (op != "kolbi" && op != "claro" && op != "movistar") {
			return nil, nil, ErrInvalidRequest
		}
		p := &Proposal{
			Kind: "recharge", AmountMinor: minor, Currency: cur,
			Operator: op, Phone: phone,
			Summary: fmt.Sprintf("Recarga ₡%.2f %s → %s", amountMajor, op, phone),
		}
		return proposedResult(p), p, nil
	}
	return nil, nil, ErrUnknownTool
}

// proposedResult is what the model sees after a propose_* tool: it must convey
// that the action is PENDING the user's confirmation, not done.
func proposedResult(p *Proposal) map[string]any {
	return map[string]any{
		"status":                     "proposed",
		"summary":                    p.Summary,
		"awaiting_user_confirmation": true,
	}
}

func argFloat(args map[string]any, key string) (float64, bool) {
	switch x := args[key].(type) {
	case float64:
		return x, true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		return f, err == nil
	default:
		return 0, false
	}
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
