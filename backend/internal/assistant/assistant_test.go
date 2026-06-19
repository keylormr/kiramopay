package assistant

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/kiramopay/backend/internal/budget"
	"github.com/kiramopay/backend/internal/transaction"
	"github.com/kiramopay/backend/internal/wallet"
)

// ── fakes ─────────────────────────────────────────────────────────────────────

type fakeLLM struct {
	results     []*LLMResult
	calls       int
	lastTools   []FunctionDecl
	lastHistory []Message
}

func (f *fakeLLM) Generate(_ context.Context, _ string, history []Message, tools []FunctionDecl) (*LLMResult, error) {
	i := f.calls
	f.calls++
	f.lastTools = tools
	f.lastHistory = history
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

func newTestTools(w *fakeWallet, tx *fakeTx) *Tools {
	return NewTools(w, tx, &fakeBudget{})
}

// ── service gating & validation ───────────────────────────────────────────────

func TestChatUnavailableWithoutLLM(t *testing.T) {
	svc := NewService(nil, newTestTools(&fakeWallet{}, &fakeTx{}), nil)
	if svc.Available() {
		t.Fatal("expected Available() == false with nil LLM")
	}
	if _, err := svc.Chat(context.Background(), "u1", &ChatRequest{Message: "hi"}); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable, got %v", err)
	}
}

func TestChatRejectsEmptyAndOversized(t *testing.T) {
	svc := NewService(&fakeLLM{}, newTestTools(&fakeWallet{}, &fakeTx{}), nil)
	if _, err := svc.Chat(context.Background(), "u1", &ChatRequest{Message: "   "}); !errors.Is(err, ErrInvalidRequest) {
		t.Errorf("empty: expected ErrInvalidRequest, got %v", err)
	}
	big := strings.Repeat("x", maxMessageLen+1)
	if _, err := svc.Chat(context.Background(), "u1", &ChatRequest{Message: big}); !errors.Is(err, ErrInvalidRequest) {
		t.Errorf("oversized: expected ErrInvalidRequest, got %v", err)
	}
}

// ── tool-calling loop ─────────────────────────────────────────────────────────

func TestChatRunsToolThenAnswers(t *testing.T) {
	w := &fakeWallet{}
	llm := &fakeLLM{results: []*LLMResult{
		{ToolCalls: []ToolCall{{Name: "get_balance"}}}, // round 1: ask for balance
		{Text: "You have ₡15,000."},                     // round 2: final answer
	}}
	svc := NewService(llm, newTestTools(w, &fakeTx{}), nil)

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

func TestChatHandlesUnknownToolGracefully(t *testing.T) {
	llm := &fakeLLM{results: []*LLMResult{
		{ToolCalls: []ToolCall{{Name: "transfer_money", Args: map[string]any{"to": "x"}}}}, // not a real tool
		{Text: "I can't move money, but here's your balance."},
	}}
	svc := NewService(llm, newTestTools(&fakeWallet{}, &fakeTx{}), nil)
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
	svc := NewService(llm, newTestTools(&fakeWallet{}, &fakeTx{}), nil)
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

func TestToolsDeclarationsAreReadOnly(t *testing.T) {
	decls := newTestTools(&fakeWallet{}, &fakeTx{}).Declarations()
	allowed := map[string]bool{"get_balance": true, "list_transactions": true, "spending_summary": true, "list_budgets": true}
	for _, d := range decls {
		if !allowed[d.Name] {
			t.Errorf("unexpected tool advertised: %q", d.Name)
		}
	}
	if len(decls) != len(allowed) {
		t.Errorf("declared %d tools, want %d", len(decls), len(allowed))
	}
	// A write-sounding tool is simply unknown.
	if _, err := newTestTools(&fakeWallet{}, &fakeTx{}).Invoke(context.Background(), "u1", "send_money", nil); !errors.Is(err, ErrUnknownTool) {
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
	out, err := newTestTools(&fakeWallet{}, tx).Invoke(context.Background(), "u1", "spending_summary", nil)
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	m := out.(map[string]any)
	if got := m["total_outgoing"].(float64); got != 6000 { // (300k+200k+100k)/100
		t.Errorf("total_outgoing = %v, want 6000", got)
	}
}

func TestGetBalanceConvertsToMajorUnits(t *testing.T) {
	out, err := newTestTools(&fakeWallet{}, &fakeTx{}).Invoke(context.Background(), "u1", "get_balance", nil)
	if err != nil {
		t.Fatalf("invoke: %v", err)
	}
	m := out.(map[string]any)
	if m["crc"].(float64) != 15000 || m["usd"].(float64) != 50 {
		t.Errorf("balance = %v", m)
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

func TestNewGeminiClientDefaultsModel(t *testing.T) {
	c := NewGeminiClient("key", "", 0)
	if c.model != "gemini-2.0-flash" {
		t.Errorf("default model = %q", c.model)
	}
}
