package assistant

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/kiramopay/backend/internal/budget"
	"github.com/kiramopay/backend/internal/country"
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
	// SummaryReader es el resumen de movimientos por periodo, el mismo que
	// alimenta la tarjeta "Gastado este mes" del Inicio y la pantalla de
	// analisis. Es solo lectura.
	SummaryReader interface {
		Resumen(ctx context.Context, userID string, rango transaction.RangoResumen) (*transaction.Resumen, error)
	}
	// ExchangeRateReader son los tipos de cambio vigentes, los mismos que sirve
	// GET /exchange-rates y de donde el Inicio saca el dolar para su total.
	ExchangeRateReader interface {
		GetExchangeRates(ctx context.Context) ([]country.ExchangeRate, error)
	}
	// SavedServicesReader is read-only — it lets the model reference a user's
	// saved bill provider when *proposing* a payment, but cannot pay anything.
	//
	// ConveniosActivos no es una lectura mas: es lo que decide si el asistente
	// puede OFRECER pagar un recibo o recargar un telefono. La respuesta la da
	// el servicio de pagos, que es quien la sabe.
	SavedServicesReader interface {
		GetSavedServices(ctx context.Context, userID string) ([]payment.SavedServiceRecord, error)
		ConveniosActivos() bool
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

	// Opcionales. Sin resumen no se ofrece el gasto por periodo; sin tipo de
	// cambio el saldo se entrega por cuenta y sin total.
	resumen SummaryReader
	tasas   ExchangeRateReader
	now     func() time.Time
}

// ToolOption agrega una fuente opcional a las herramientas. Va aparte de los
// cuatro lectores obligatorios para no cambiarle la firma a NewTools.
type ToolOption func(*Tools)

// WithResumen conecta el resumen por periodo: habilita spending_by_period.
func WithResumen(r SummaryReader) ToolOption { return func(t *Tools) { t.resumen = r } }

// WithTipoDeCambio conecta los tipos de cambio para el total del saldo.
func WithTipoDeCambio(r ExchangeRateReader) ToolOption { return func(t *Tools) { t.tasas = r } }

// WithReloj fija el reloj con que se decide que mes es "este mes". Para pruebas.
func WithReloj(now func() time.Time) ToolOption { return func(t *Tools) { t.now = now } }

func NewTools(w WalletReader, tx TransactionReader, b BudgetReader, saved SavedServicesReader, opts ...ToolOption) *Tools {
	t := &Tools{wallet: w, tx: tx, budget: b, saved: saved, allowAct: true, now: time.Now}
	for _, opt := range opts {
		opt(t)
	}
	return t
}

// minorToMajor converts integer minor units (céntimos) to a major-unit float
// for human-readable model reasoning.
func minorToMajor(minor int64) float64 { return float64(minor) / 100 }

// Declarations advertises the available tools to the model.
func (t *Tools) Declarations() []FunctionDecl {
	emptyObject := map[string]any{"type": "object", "properties": map[string]any{}}
	decls := []FunctionDecl{
		{
			Name: "get_balance",
			Description: "Get the user's wallet balance. Returns each account with its own currency (CRC colones and USD dollars) " +
				"and, when the exchange rate is available, the combined total in the base currency (colones) and in USD, " +
				"the same totals the Home screen shows. Never add the accounts yourself or treat one as the other's equivalent.",
			Parameters: emptyObject,
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
			Description: t.descripcionDeResumenReciente(),
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
	if t.resumen != nil {
		decls = append(decls, FunctionDecl{
			Name: "spending_by_period",
			Description: "How much the user spent in a calendar month (Costa Rica time), counting the same movements as " +
				"\"Spent this month\" on the Home screen. Use it for any question about spending in a month. " +
				"Returns one figure per currency; never add currencies together.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"period": map[string]any{
						"type":        "string",
						"enum":        []any{PeriodThisMonth, PeriodLastMonth},
						"description": "this_month (default) or last_month.",
					},
				},
			},
		})
	}
	if !t.allowAct {
		return decls
	}
	// Phase 3b: write-INTENT tools. They PREPARE an action and return a proposal
	// the user must confirm; they never move money themselves.
	// Pagar un recibo y recargar un telefono terminan en payment.ErrSinConvenio
	// mientras no exista convenio con la empresa o el operador. Anunciarlas
	// igual hacia que el modelo las propusiera, que el usuario aceptara y que
	// el servidor dijera que no — y cada una de esas idas y vueltas gasta una
	// de las dos preguntas diarias del plan gratuito. Lo que no se puede
	// entregar no se ofrece.
	conConvenio := t.saved != nil && t.saved.ConveniosActivos()

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
	)
	if !conConvenio {
		return decls
	}
	decls = append(decls,
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
	case "spending_by_period":
		r, err := t.spendingByPeriod(ctx, userID, args)
		return r, nil, err
	case "list_budgets":
		r, err := t.listBudgets(ctx, userID)
		return r, nil, err
	case "list_saved_services":
		r, err := t.listSavedServices(ctx, userID)
		return r, nil, err
	case "propose_bill_payment", "propose_recharge":
		// Aunque no se declaren, un hilo viejo o un modelo que se las invente
		// pueden pedirlas igual. Sin convenio no existen.
		if !t.allowAct || t.saved == nil || !t.saved.ConveniosActivos() {
			return nil, nil, ErrUnknownTool
		}
		return t.propose(name, args)
	case "propose_sinpe_transfer":
		if !t.allowAct {
			return nil, nil, ErrUnknownTool
		}
		return t.propose(name, args)
	default:
		return nil, nil, ErrUnknownTool
	}
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
	// Cada moneda por su lado: sumar colones con dolares da un numero que no
	// existe. Y lo que cuenta como gasto es lo mismo que cuenta el Inicio.
	gastos := newGastoPorMoneda()
	for _, r := range res.Transactions {
		if r.Status != "completed" || transaction.EsIngresoEnPantalla(r.Type) {
			continue
		}
		gastos.sumar(r.Currency, r.Type, 1, r.Amount)
	}
	filas := make([]map[string]any, 0, 2)
	for _, f := range gastos.filas() {
		filas = append(filas, map[string]any{
			"currency":       f.moneda,
			"total_outgoing": minorToMajor(f.centimos),
			"by_type":        porTipoEnMapas(f.porTipo),
		})
	}
	return map[string]any{
		"considered":  len(res.Transactions),
		"by_currency": filas,
		"note": "Covers only the most recent movements, not a calendar period. " +
			"Each currency is totalled separately; never add them together.",
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

// describe is a tiny helper for error wrapping in the orchestrator.
func describe(name string, err error) error {
	return fmt.Errorf("tool %s: %w", name, err)
}
