package assistant

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewClaudeClientValidatesModel(t *testing.T) {
	if c := NewClaudeClient("k", "", 0); c.model != defaultClaudeModel {
		t.Errorf("empty model = %q, want default", c.model)
	}
	if c := NewClaudeClient("k", "claude-haiku-4-5", 0); c.model != "claude-haiku-4-5" {
		t.Errorf("valid model rejected: %q", c.model)
	}
	for _, bad := range []string{"../evil", "a/b", "x?y=1", "http://evil"} {
		if c := NewClaudeClient("k", bad, 0); c.model != defaultClaudeModel {
			t.Errorf("unsafe model %q accepted as %q", bad, c.model)
		}
	}
}

func TestToClaudeMessagesMapping(t *testing.T) {
	msgs := toClaudeMessages([]Message{
		{Role: RoleUser, Text: "what's my balance?"},
		{Role: RoleModel, ToolCalls: []ToolCall{{Name: "get_balance"}}},
		{Role: RoleTool, ToolName: "get_balance", ToolResponse: map[string]any{"crc": 15000.0}},
	})
	if len(msgs) != 3 {
		t.Fatalf("got %d messages", len(msgs))
	}
	// user text
	if msgs[0]["role"] != "user" {
		t.Errorf("msg0 role = %v", msgs[0]["role"])
	}
	// assistant tool_use with a non-empty id and an input object (even with no args)
	asst := msgs[1]
	if asst["role"] != "assistant" {
		t.Fatalf("msg1 role = %v", asst["role"])
	}
	useBlock := asst["content"].([]map[string]any)[0]
	if useBlock["type"] != "tool_use" || useBlock["name"] != "get_balance" {
		t.Errorf("tool_use block = %+v", useBlock)
	}
	id, _ := useBlock["id"].(string)
	if id == "" {
		t.Error("tool_use must carry an id")
	}
	if _, ok := useBlock["input"].(map[string]any); !ok {
		t.Error("tool_use must carry an input object even with no args")
	}
	// user tool_result referencing the SAME id
	resBlock := msgs[2]["content"].([]map[string]any)[0]
	if resBlock["type"] != "tool_result" || resBlock["tool_use_id"] != id {
		t.Errorf("tool_result block = %+v (want tool_use_id %q)", resBlock, id)
	}
	if _, ok := resBlock["content"].(string); !ok {
		t.Error("tool_result content must be a string")
	}
}

func TestToClaudeMessagesDropsLeadingAssistant(t *testing.T) {
	msgs := toClaudeMessages([]Message{
		{Role: RoleModel, Text: "stray assistant"},
		{Role: RoleUser, Text: "hi"},
	})
	if len(msgs) != 1 || msgs[0]["role"] != "user" {
		t.Errorf("expected leading assistant dropped, got %+v", msgs)
	}
}

func TestClaudeGenerateParsesToolUseThenText(t *testing.T) {
	var lastBody map[string]any
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "secret" || r.Header.Get("anthropic-version") != anthropicVersion {
			t.Errorf("missing/incorrect auth headers: %v", r.Header)
		}
		raw, _ := io.ReadAll(r.Body)
		lastBody = map[string]any{}
		_ = json.Unmarshal(raw, &lastBody)
		w.Header().Set("Content-Type", "application/json")
		if calls == 0 {
			calls++
			_, _ = w.Write([]byte(`{"stop_reason":"tool_use","content":[{"type":"tool_use","id":"toolu_x","name":"get_balance","input":{}}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"stop_reason":"end_turn","content":[{"type":"text","text":"You have ₡15,000."}]}`))
	}))
	defer srv.Close()

	c := NewClaudeClient("secret", "claude-haiku-4-5", 0)
	c.baseURL = srv.URL

	// Round 1: tool call.
	r1, err := c.Generate(context.Background(), "sys", []Message{{Role: RoleUser, Text: "balance?"}}, []FunctionDecl{{Name: "get_balance", Description: "d"}})
	if err != nil {
		t.Fatalf("generate 1: %v", err)
	}
	if len(r1.ToolCalls) != 1 || r1.ToolCalls[0].Name != "get_balance" {
		t.Fatalf("round1 tool calls = %+v", r1.ToolCalls)
	}
	// The request must carry the system prompt and the tool with input_schema.
	if lastBody["system"] != "sys" {
		t.Errorf("system not sent: %v", lastBody["system"])
	}
	tools, _ := lastBody["tools"].([]any)
	if len(tools) != 1 {
		t.Fatalf("tools not sent: %v", lastBody["tools"])
	}
	if _, ok := tools[0].(map[string]any)["input_schema"]; !ok {
		t.Error("tool must use input_schema")
	}

	// Round 2: final text.
	r2, err := c.Generate(context.Background(), "sys", []Message{
		{Role: RoleUser, Text: "balance?"},
		{Role: RoleModel, ToolCalls: []ToolCall{{Name: "get_balance"}}},
		{Role: RoleTool, ToolName: "get_balance", ToolResponse: map[string]any{"crc": 15000.0}},
	}, nil)
	if err != nil {
		t.Fatalf("generate 2: %v", err)
	}
	if r2.Text != "You have ₡15,000." {
		t.Errorf("round2 text = %q", r2.Text)
	}
}

func TestClaudeGenerateSurfacesAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`))
	}))
	defer srv.Close()
	c := NewClaudeClient("bad", "claude-haiku-4-5", 0)
	c.baseURL = srv.URL
	if _, err := c.Generate(context.Background(), "", []Message{{Role: RoleUser, Text: "hi"}}, nil); err == nil {
		t.Fatal("expected an error from a 401 response")
	}
}

func TestClaudeRefusalFallsBackToNeutralText(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"stop_reason":"refusal","content":[]}`))
	}))
	defer srv.Close()
	c := NewClaudeClient("k", "claude-haiku-4-5", 0)
	c.baseURL = srv.URL
	res, err := c.Generate(context.Background(), "", []Message{{Role: RoleUser, Text: "hi"}}, nil)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if res.Text == "" {
		t.Error("a refusal with empty content should yield a neutral message, not an empty reply")
	}
}
