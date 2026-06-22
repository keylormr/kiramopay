package assistant

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNewClaudeClientValidatesModel(t *testing.T) {
	// A bogus model (URL metacharacters / spaces) falls back to the default.
	if c := NewClaudeClient("k", "bad model/../x", 0); c.model != defaultClaudeModel {
		t.Errorf("model = %q, want default %q", c.model, defaultClaudeModel)
	}
	// A clean operator-chosen model is honored (e.g. switching to Haiku for cost).
	if c := NewClaudeClient("k", "claude-haiku-4-5", 0); c.model != "claude-haiku-4-5" {
		t.Errorf("model = %q, want claude-haiku-4-5", c.model)
	}
}

func TestToAnthropicMessagesPositionalToolResults(t *testing.T) {
	history := []Message{
		{Role: RoleUser, Text: "what's my balance?"},
		{Role: RoleModel, ToolCalls: []ToolCall{{Name: "get_balance"}, {Name: "list_budgets"}}},
		{Role: RoleTool, ToolName: "get_balance", ToolResponse: map[string]any{"crc": 1500}},
		{Role: RoleTool, ToolName: "list_budgets", ToolResponse: map[string]any{"count": 2}},
		{Role: RoleModel, Text: "Here you go."},
	}
	msgs := toAnthropicMessages(history)
	if len(msgs) != 5 {
		t.Fatalf("got %d messages, want 5", len(msgs))
	}
	// Assistant tool-call turn: two tool_use blocks with minted ids.
	asst := msgs[1]
	if asst.Role != "assistant" || len(asst.Content) != 2 {
		t.Fatalf("assistant turn = %+v", asst)
	}
	if asst.Content[0].Type != "tool_use" || asst.Content[0].ID != "toolu_0" {
		t.Errorf("block0 = %+v", asst.Content[0])
	}
	if asst.Content[1].ID != "toolu_1" {
		t.Errorf("block1 id = %q, want toolu_1", asst.Content[1].ID)
	}
	// Results map back to the calls positionally.
	if msgs[2].Content[0].Type != "tool_result" || msgs[2].Content[0].ToolUseID != "toolu_0" {
		t.Errorf("result0 = %+v", msgs[2].Content[0])
	}
	if msgs[3].Content[0].ToolUseID != "toolu_1" {
		t.Errorf("result1 tool_use_id = %q, want toolu_1", msgs[3].Content[0].ToolUseID)
	}
	if !strings.Contains(msgs[2].Content[0].Content, "1500") {
		t.Errorf("result0 content = %q, want it to carry the tool output", msgs[2].Content[0].Content)
	}
}

func TestClaudeGenerateToolUseAndRequestShape(t *testing.T) {
	var gotBody anthropicRequest
	var gotKey, gotVersion string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("x-api-key")
		gotVersion = r.Header.Get("anthropic-version")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		_, _ = w.Write([]byte(`{"content":[{"type":"tool_use","id":"toolu_x","name":"get_balance","input":{}}],"stop_reason":"tool_use"}`))
	}))
	defer srv.Close()

	c := NewClaudeClient("secret-key", "claude-opus-4-8", time.Second)
	c.baseURL = srv.URL

	res, err := c.Generate(context.Background(), "system prompt",
		[]Message{{Role: RoleUser, Text: "balance?"}},
		[]FunctionDecl{{Name: "get_balance", Description: "the balance", Parameters: map[string]any{"type": "object"}}},
	)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if len(res.ToolCalls) != 1 || res.ToolCalls[0].Name != "get_balance" {
		t.Fatalf("tool calls = %+v", res.ToolCalls)
	}
	// Auth + version headers.
	if gotKey != "secret-key" {
		t.Errorf("x-api-key = %q", gotKey)
	}
	if gotVersion != anthropicVersion {
		t.Errorf("anthropic-version = %q", gotVersion)
	}
	// Body carries model, system, and a tool with input_schema (not "parameters").
	if gotBody.Model != "claude-opus-4-8" || gotBody.System != "system prompt" {
		t.Errorf("body model/system = %q / %q", gotBody.Model, gotBody.System)
	}
	if len(gotBody.Tools) != 1 || gotBody.Tools[0].InputSchema == nil {
		t.Errorf("tools = %+v", gotBody.Tools)
	}
}

func TestClaudeGenerateSurfacesHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`))
	}))
	defer srv.Close()

	c := NewClaudeClient("bad", "claude-opus-4-8", time.Second)
	c.baseURL = srv.URL
	_, err := c.Generate(context.Background(), "", []Message{{Role: RoleUser, Text: "hi"}}, nil)
	if err == nil || !strings.Contains(err.Error(), "invalid x-api-key") {
		t.Fatalf("expected the auth error message, got %v", err)
	}
}

func TestClaudeGenerateRefusalIsNeutralText(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// A safety refusal: HTTP 200, stop_reason refusal, empty content.
		_, _ = w.Write([]byte(`{"content":[],"stop_reason":"refusal"}`))
	}))
	defer srv.Close()

	c := NewClaudeClient("k", "claude-opus-4-8", time.Second)
	c.baseURL = srv.URL
	res, err := c.Generate(context.Background(), "", []Message{{Role: RoleUser, Text: "do something bad"}}, nil)
	if err != nil {
		t.Fatalf("refusal should not be an error, got %v", err)
	}
	if res.Text == "" || len(res.ToolCalls) != 0 {
		t.Errorf("refusal result = %+v, want neutral text and no tool calls", res)
	}
}
