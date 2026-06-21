package assistant

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/kiramopay/backend/internal/observability"
)

// ClaudeClient calls Anthropic's Messages API (/v1/messages) with tool use. It
// implements LLM and mirrors GeminiClient: raw HTTP through the otel-instrumented
// observability.HTTPClient, behind the provider-neutral LLM interface. Construct
// it only when an API key is present (main.go gates on that), so the assistant's
// LLM interface stays a true nil when unconfigured.
type ClaudeClient struct {
	apiKey  string
	model   string
	baseURL string
	client  *http.Client
}

const (
	defaultClaudeModel = "claude-opus-4-8"
	anthropicVersion   = "2023-06-01"
	claudeMaxTokens    = 1024
)

// NewClaudeClient wires the client. model defaults to the latest Opus and is
// allowlist-validated (reusing the same safeModel pattern as the Gemini client).
// The caller must ensure apiKey is non-empty.
func NewClaudeClient(apiKey, model string, timeout time.Duration) *ClaudeClient {
	if model == "" || !safeModel.MatchString(model) {
		model = defaultClaudeModel
	}
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &ClaudeClient{
		apiKey:  apiKey,
		model:   model,
		baseURL: "https://api.anthropic.com",
		client:  observability.HTTPClient(timeout),
	}
}

// ── Anthropic wire types (response only; the request body is built as maps so
// heterogeneous content blocks serialize exactly, e.g. a tool_use with empty
// input still emits `"input": {}`). ──────────────────────────────────────────

type claudeResponse struct {
	Content []struct {
		Type  string         `json:"type"`
		Text  string         `json:"text"`
		ID    string         `json:"id"`
		Name  string         `json:"name"`
		Input map[string]any `json:"input"`
	} `json:"content"`
	StopReason string `json:"stop_reason"`
	Error      *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error"`
}

// Generate implements LLM.
func (g *ClaudeClient) Generate(ctx context.Context, system string, history []Message, tools []FunctionDecl) (*LLMResult, error) {
	reqBody := map[string]any{
		"model":      g.model,
		"max_tokens": claudeMaxTokens,
		"messages":   toClaudeMessages(history),
	}
	if system != "" {
		reqBody["system"] = system
	}
	if len(tools) > 0 {
		decls := make([]map[string]any, 0, len(tools))
		for _, t := range tools {
			params := t.Parameters
			if params == nil {
				params = map[string]any{"type": "object", "properties": map[string]any{}}
			}
			decls = append(decls, map[string]any{
				"name":         t.Name,
				"description":  t.Description,
				"input_schema": params,
			})
		}
		reqBody["tools"] = decls
	}

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	// The endpoint is a hardcoded constant host (g.baseURL is set to the Anthropic
	// API host in the constructor; only tests override it) and the model lives in
	// the request body, not the URL — so there is no user-controllable SSRF here.
	url := g.baseURL + "/v1/messages"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload)) // #nosec G704 -- constant API host, no URL-injected input
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("anthropic-version", anthropicVersion)
	// Header (not query param) so the key never lands in URLs, logs, or spans.
	httpReq.Header.Set("x-api-key", g.apiKey)

	resp, err := g.client.Do(httpReq) // #nosec G704 -- constant API host, no URL-injected input
	if err != nil {
		return nil, fmt.Errorf("anthropic request: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var cr claudeResponse
	if err := json.Unmarshal(raw, &cr); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	if resp.StatusCode >= 400 {
		if cr.Error != nil {
			return nil, fmt.Errorf("anthropic %d: %s", resp.StatusCode, cr.Error.Message)
		}
		return nil, fmt.Errorf("anthropic http %d", resp.StatusCode)
	}

	var (
		text  string
		calls []ToolCall
	)
	for _, part := range cr.Content {
		switch part.Type {
		case "text":
			text += part.Text
		case "tool_use":
			calls = append(calls, ToolCall{Name: part.Name, Args: part.Input})
		}
	}
	// A safety refusal returns 200 with stop_reason "refusal" and (usually) empty
	// content — surface a brief, neutral message rather than an empty reply.
	if cr.StopReason == "refusal" && text == "" && len(calls) == 0 {
		text = "No puedo ayudar con eso."
	}
	return &LLMResult{Text: text, ToolCalls: calls}, nil
}

// toClaudeMessages maps the provider-neutral history to Anthropic messages.
// Anthropic roles are "user"/"assistant"; a model tool-call turn becomes an
// assistant message of tool_use blocks (each assigned an id), and the following
// tool results become a user message of tool_result blocks referencing those ids
// positionally (the orchestrator always appends tool results in call order).
func toClaudeMessages(history []Message) []map[string]any {
	out := make([]map[string]any, 0, len(history))
	var pendingIDs []string // tool_use ids from the most recent assistant tool turn
	toolIdx := 0
	counter := 0

	i := 0
	for i < len(history) {
		m := history[i]
		switch m.Role {
		case RoleUser:
			out = append(out, map[string]any{
				"role":    "user",
				"content": []map[string]any{{"type": "text", "text": m.Text}},
			})
			i++

		case RoleModel:
			if len(m.ToolCalls) > 0 {
				blocks := make([]map[string]any, 0, len(m.ToolCalls))
				pendingIDs = pendingIDs[:0]
				for _, c := range m.ToolCalls {
					id := fmt.Sprintf("toolu_%d", counter)
					counter++
					pendingIDs = append(pendingIDs, id)
					input := c.Args
					if input == nil {
						input = map[string]any{}
					}
					blocks = append(blocks, map[string]any{
						"type":  "tool_use",
						"id":    id,
						"name":  c.Name,
						"input": input,
					})
				}
				toolIdx = 0
				out = append(out, map[string]any{"role": "assistant", "content": blocks})
			} else {
				out = append(out, map[string]any{
					"role":    "assistant",
					"content": []map[string]any{{"type": "text", "text": m.Text}},
				})
			}
			i++

		case RoleTool:
			// Group consecutive tool results into one user message.
			blocks := []map[string]any{}
			for i < len(history) && history[i].Role == RoleTool {
				id := ""
				if toolIdx < len(pendingIDs) {
					id = pendingIDs[toolIdx]
					toolIdx++
				}
				blocks = append(blocks, map[string]any{
					"type":        "tool_result",
					"tool_use_id": id,
					"content":     toolResultString(history[i].ToolResponse),
				})
				i++
			}
			out = append(out, map[string]any{"role": "user", "content": blocks})
		}
	}

	// Anthropic requires the first message to be from the user — drop any leading
	// assistant messages (defensive; the orchestrator builds user-first history).
	for len(out) > 0 && out[0]["role"] == "assistant" {
		out = out[1:]
	}
	return out
}

// toolResultString renders a tool result as a string (Anthropic's tool_result
// content accepts a string).
func toolResultString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}
