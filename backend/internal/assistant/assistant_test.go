package assistant

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/budget"
	"github.com/kiramopay/backend/internal/payment"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
)

// ── fakes ─────────────────────────────────────────────────────────────────────

type fakeLLM struct {
	results     []*LLMResult
	err         error // when set, Generate fails with it
	calls       int
	lastTools   []FunctionDecl
	lastHistory []Message
}

func (f *fakeLLM) Generate(_ context.Context, _ string, history []Message, tools []FunctionDecl) (*LLMResult, error) {
	i := f.calls
	f.calls++
	f.lastTools = tools
	f.lastHistory = history
	if f.err != nil {
		return nil, f.err
	}
	if i < len(f.results) {
		return f.results[i], nil
	}
	return &LLMResult{Text: "final"}, nil
}

type fakeWallet struct{ called bool }

func (f *fakeWallet) GetBalance(_ context.Context, _ string) (*wallet.BalanceResponse, error) {
	f.called = true
	return &wallet.BalanceResponse{CRC: 1_500_000, USD: 5_000}, nil
}

type fakeTx struct{ records []transaction.TransactionRecord }

func (f *fakeTx) ListTransactions(_ context.Context, _ string, _ *transaction.ListTransactionsRequest) (*transaction.TransactionListResponse, error) {
	return &transaction.TransactionListResponse{Transactions: f.records, Total: len(f.records)}, nil
}

type fakeBudget struct{}

func (f *fakeBudget) List(_ context.Context, _ string) ([]budget.BudgetRecord, error) {
	return []budget.BudgetRecord{
		{Label: "Food", AmountLimit: 5_000_000, AmountSpent: 2_000_000, Currency: "CRC", Period: "monthly"},
	}, nil
}

type fakeSaved struct{}

func (f *fakeSaved) GetSavedServices(_ context.Context, _ string) ([]payment.SavedServiceRecord, error) {
	return []payment.SavedServiceRecord{
		{ProviderCode: "ICE", ProviderName: "ICE Electricidad", ClientID: "123456"},
	}, nil
}

func newTestTools(w *fakeWallet, tx *fakeTx) *Tools {
	return NewTools(w, tx, &fakeBudget{}, &fakeSaved{})
}

// ── service gating & validation ───────────────────────────────────────────────

func TestChatUnavailableWithoutLLM(t *testing.T) {
	svc := NewService(nil, newTestTools(&fakeWallet{}, &fakeTx{}), nil, nil)
	if svc.Available() {
		t.Fatal("expected Available() == false with nil LLM")
	}
	if _, err := svc.Chat(context.Background(), "u1", &ChatRequest{Message: "hi"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable, got %v", err)
	}
}

func TestChatRejectsEmptyAndOversized(t *testing.T) {
	svc := NewService(&fakeLLM{}, newTestTools(&fakeWallet{}, &fakeTx{}), nil, nil)
	if _, err := svc.Chat(context.Background(), "u1", &ChatRequest{Message: "   "}); !errors.Is(err, ErrInvalidRequest) {
		t.Errorf("empty: expected ErrInvalidRequest, got %v", err)
	}
	big := strings.Repeat("x", maxMessageLen+1)
	if _, err := svc.Chat(context.Background(), "u1", &ChatRequest{Message: big}); !errors.Is(err, ErrInvalidRequest) {
		t.Errorf("oversized: expected ErrInvalidRequest, got %v", err)
	}
}

func TestChatLogsLLMErrorCause(t *testing.T) {
	// The handler maps ErrLLM to an opaque 502; the underlying cause must still
	// be logged server-side so operators can diagnose it.
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelWarn}))
	llm := &fakeLLM{err: errors.New("anthropic 401 unauthorized")}
	svc := NewService(llm, newTestTools(&fakeWallet{}, &fakeTx{}), nil, logger)

	_, err := svc.Chat(context.Background(), "u1", &ChatRequest{Message: "hi"})
	if !errors.Is(err, ErrLLM) {
		t.Fatalf("expected ErrLLM, got %v", err)
	}
	logged := buf.String()
	if !strings.Contains(logged, "anthropic 401 unauthorized") {
		t.Errorf("expected the cause to be logged, got %q", logged)
	}
}

// ── tool-calling loop ─────────────────────────────────────────────────────────

func TestChatRunsToolThenAnswers(t *testing.T) {
	w := &fakeWallet{}
	llm := &fakeLLM{results: []*LLMResult{
		{ToolCalls: []ToolCall{{Name: "get_balance"}}}, // round 1: ask for balance
		{Text: "You have ₡15,000."},                     // round 2: final answer
	}}
	svc := NewService(llm, newTestTools(w, &fakeTx{}), nil, nil)

	res, err := svc.Chat(context.Background(), "u1", &ChatRequest{Message: "what's my balance?"})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if !w.called {
		t.Error("expected the wallet tool to be invoked")
	}
	if res.Reply != "You have ₡15,000." {
		t.Errorf("reply = %q", res.Reply)
	}
	if len(res.ToolsUsed) != 1 || res.ToolsUsed[0] != "get_balance" {
		t.Errorf("tools used = %v", res.ToolsUsed)
	}
	// On the SECOND generate call the model's prior tool-call + the tool result
	// must be present in history.
	foundResp := false
	for _, m := range llm.lastHistory {
		if m.Role == RoleTool && m.ToolName == "get_balance" {
			foundResp = true
		}
	}
	if !foundResp {
		t.Error("tool response was not fed back to the model")
	}
}

func TestChatSurfacesProposalsWithoutMovingMoney(t *testing.T) {
	llm := &fakeLLM{results: []*LLMResult{
		{ToolCalls: []ToolCall{{Name: "propose_sinpe_transfer", Args: map[string]any{"phone": "88887777", "amount": 5000.0}}}},
		{Text: "I've prepared a ₡5,000 SINPE to 8888-7777 — please confirm below."},
	}}
	// Money services are nil: if a propose tool ever tried to move money it would
	// panic. It must not.
	svc := NewService(llm, newTestTools(&fakeWallet{}, &fakeTx{}), nil, nil)
	res, err := svc.Chat(context.Background(), "u1", &ChatRequest{Message: "send 5000 to 8888-7777"})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if len(res.Proposals) != 1 || res.Proposals[0].Kind != "sinpe_transfer" {
		t.Fatalf("expected 1 sinpe proposal, got %+v", res.Proposals)
	}
	if res.Proposals[0].AmountMinor != 500_000 {
		t.Errorf("amount = %d", res.Proposals[0].AmountMinor)
	}
}

func TestChatHandlesUnknownToolGracefully(t *testing.T) {
	llm := &fakeLLM{results: []*LLMResult{
		{ToolCalls: []ToolCall{{Name: "transfer_money", Args: map[string]any{"to": "x"}}}}, // not a real tool
		{Text: "I can't move money, but here's your balance."},
	}}
	svc := NewService(llm, newTestTools(&fakeWallet{}, &fakeTx{}), nil, nil)
	res, err := svc.Chat(context.Background(), "u1", &ChatRequest{Message: "send 1000"})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	if res.Reply == "" {
		t.Error("expected a final reply despite the unknown tool")
	}
}

func TestChatTerminatesAtTurnBudget(t *testing.T) {
	// A model that always asks for a tool must still terminate.
	llm := &fakeLLM{}
	llm.results = make([]*LLMResult, 0)
	for i := 0; i < defaultMaxTurns+2; i++ {
		llm.results = append(llm.results, &LLMResult{ToolCalls: []ToolCall{{Name: "get_balance"}}})
	}
	svc := NewService(llm, newTestTools(&fakeWallet{}, &fakeTx{}), nil, nil)
	res, err := svc.Chat(context.Background(), "u1", &ChatRequest{Message: "loop"})
	if err != nil {
		t.Fatalf("chat: %v", err)
	}
	// The final forced call withholds tools.
	if llm.lastTools != nil {
		t.Errorf("expected tools withheld on the forced final turn, got %d", len(llm.lastTools))
	}
	_ = res
}

// ── tools ─────────────────────────────────────────────────────────────────────

func TestToolsDeclarations(t *testing.T) {
	decls := newTestTools(&fakeWallet{}, &fakeTx{}).Declarations()
	names := map[string]bool{}
	for _, d := range decls {
		names[d.Name] = true
	}
	for _, want := range []string{
		"get_balance", "list_transactions", "spending_summary", "list_budgets",
		"list_saved_services", "propose_sinpe_transfer", "propose_bill_payment", "propose_recharge",
	} {
		if !names[want] {
			t.Errorf("missing tool %q", want)
		}
	}
	// A non-tool is unknown — and never moves money.
	if _, _, err := newTestTools(&fakeWallet{}, &fakeTx{}).Invoke(context.Background(), "u1", "delete_account", nil); !errors.Is(err, ErrUnknownTool) {
		t.Errorf("expected ErrUnknownTool, got %v", err)
	}
}

func TestSpendingSummaryAggregates(t *testing.T) {
	tx := &fakeTx{records: []transaction.TransactionRecord{
		{Type: "sinpe_send", Amount: 300_000, Status: "completed"},
		{Type: "sinpe_send", Amount: 200_000, Status: "completed"},
		{Type: "qr_payment", Amount: 100_000, Status: "completed"},
		{Type: "sinpe_receive", Amount: 999_000, Status: "completed"}, // incoming — excluded
		{Type: "qr_payment", Amount: 50_000, Status: "pending"},       // not completed — excluded
	}}
	out, _, err := newTestTools(&fakeWallet{}, tx).Invoke(context.Background(), "u1", "spending_summary", nil)
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	m := out.(map[string]any)
	if got := m["total_outgoing"].(float64); got != 6000 { // (300k+200k+100k)/100
		t.Errorf("total_outgoing = %v, want 6000", got)
	}
}

func TestGetBalanceConvertsToMajorUnits(t *testing.T) {
	out, _, err := newTestTools(&fakeWallet{}, &fakeTx{}).Invoke(context.Background(), "u1", "get_balance", nil)
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	m := out.(map[string]any)
	if m["crc"].(float64) != 15000 || m["usd"].(float64) != 50 {
		t.Errorf("balance = %v", m)
	}
}

// ── propose_* tools (Phase 3b) — prepare, never execute ───────────────────────

func TestProposeSinpeReturnsIntentNotExecution(t *testing.T) {
	out, proposal, err := newTestTools(&fakeWallet{}, &fakeTx{}).Invoke(
		context.Background(), "u1", "propose_sinpe_transfer",
		map[string]any{"phone": "88887777", "amount": 5000.0, "description": "almuerzo"},
	)
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if proposal == nil || proposal.Kind != "sinpe_transfer" {
		t.Fatalf("expected a sinpe_transfer proposal, got %+v", proposal)
	}
	if proposal.AmountMinor != 500_000 || proposal.Phone != "88887777" {
		t.Errorf("proposal = %+v", proposal)
	}
	// The model-facing result must say it is awaiting confirmation, not done.
	m := out.(map[string]any)
	if m["awaiting_user_confirmation"] != true {
		t.Errorf("result should await confirmation: %v", m)
	}
}

func TestProposeBillUsesSavedProvider(t *testing.T) {
	_, proposal, err := newTestTools(&fakeWallet{}, &fakeTx{}).Invoke(
		context.Background(), "u1", "propose_bill_payment",
		map[string]any{"provider_code": "ICE", "provider_name": "ICE Electricidad", "client_id": "123456", "amount": 12000.0},
	)
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	if proposal.Kind != "bill_payment" || proposal.ProviderCode != "ICE" || proposal.ClientID != "123456" {
		t.Errorf("proposal = %+v", proposal)
	}
}

func TestProposeRechargeValidatesOperator(t *testing.T) {
	tools := newTestTools(&fakeWallet{}, &fakeTx{})
	if _, p, err := tools.Invoke(context.Background(), "u1", "propose_recharge",
		map[string]any{"operator": "kolbi", "phone": "70001111", "amount": 3000.0}); err != nil || p == nil {
		t.Fatalf("valid recharge: err=%v p=%v", err, p)
	}
	// Bad operator / non-positive amount are rejected without a proposal.
	for _, bad := range []map[string]any{
		{"operator": "evil", "phone": "70001111", "amount": 3000.0},
		{"operator": "kolbi", "phone": "70001111", "amount": 0.0},
		{"operator": "kolbi", "phone": "", "amount": 3000.0},
	} {
		if _, p, err := tools.Invoke(context.Background(), "u1", "propose_recharge", bad); err == nil || p != nil {
			t.Errorf("expected rejection for %v (err=%v p=%v)", bad, err, p)
		}
	}
}

func TestProposeToolsDisabledWhenNotAllowed(t *testing.T) {
	tools := newTestTools(&fakeWallet{}, &fakeTx{})
	tools.allowAct = false
	if _, _, err := tools.Invoke(context.Background(), "u1", "propose_sinpe_transfer",
		map[string]any{"phone": "88887777", "amount": 5000.0}); !errors.Is(err, ErrUnknownTool) {
		t.Errorf("propose disabled: expected ErrUnknownTool, got %v", err)
	}
	for _, d := range tools.Declarations() {
		if d.Name == "propose_sinpe_transfer" {
			t.Errorf("propose tool advertised while disabled")
		}
	}
}

// ── gemini mapping (white-box) ────────────────────────────────────────────────

func TestToGeminiContentsRoles(t *testing.T) {
	contents := toGeminiContents([]Message{
		{Role: RoleUser, Text: "hi"},
		{Role: RoleModel, ToolCalls: []ToolCall{{Name: "get_balance"}}},
		{Role: RoleTool, ToolName: "get_balance", ToolResponse: map[string]any{"crc": 1.0}},
	})
	if len(contents) != 3 {
		t.Fatalf("got %d contents", len(contents))
	}
	if contents[0].Role != "user" || contents[0].Parts[0].Text != "hi" {
		t.Errorf("user turn mismapped: %+v", contents[0])
	}
	if contents[1].Role != "model" || contents[1].Parts[0].FunctionCall == nil {
		t.Errorf("model functionCall mismapped: %+v", contents[1])
	}
	if contents[2].Role != "user" || contents[2].Parts[0].FunctionResponse == nil {
		t.Errorf("tool functionResponse mismapped: %+v", contents[2])
	}
	if contents[2].Parts[0].FunctionResponse.Name != "get_balance" {
		t.Errorf("functionResponse name = %q", contents[2].Parts[0].FunctionResponse.Name)
	}
}

func TestNewGeminiClientValidatesModel(t *testing.T) {
	if c := NewGeminiClient("key", "", 0); c.model != defaultModel {
		t.Errorf("empty model = %q, want default", c.model)
	}
	if c := NewGeminiClient("key", "gemini-2.5-flash", 0); c.model != "gemini-2.5-flash" {
		t.Errorf("valid model rejected: %q", c.model)
	}
	// A model with URL metacharacters is rejected (falls back to default) so it
	// can never alter the request URL.
	for _, bad := range []string{"../../evil", "host/path", "a:b", "x?y=1", "http://evil"} {
		if c := NewGeminiClient("key", bad, 0); c.model != defaultModel {
			t.Errorf("unsafe model %q accepted as %q", bad, c.model)
		}
	}
}
