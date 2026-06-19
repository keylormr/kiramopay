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

// GeminiClient calls Google's Gemini generateContent API with function calling.
// It implements LLM. Construct it only when an API key is present (main.go
// gates on that) so the assistant's LLM interface stays a true nil when
// unconfigured.
type GeminiClient struct {
	apiKey  string
	model   string
	baseURL string
	client  *http.Client
}

// NewGeminiClient wires the client. model defaults to a current flash model.
// The caller must ensure apiKey is non-empty.
func NewGeminiClient(apiKey, model string, timeout time.Duration) *GeminiClient {
	if model == "" {
		model = "gemini-2.0-flash"
	}
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	return &GeminiClient{
		apiKey:  apiKey,
		model:   model,
		baseURL: "https://generativelanguage.googleapis.com/v1beta",
		client:  observability.HTTPClient(timeout),
	}
}

// ── Gemini wire types ────────────────────────────────────────────────────────

type geminiPart struct {
	Text             string              `json:"text,omitempty"`
	FunctionCall     *geminiFunctionCall `json:"functionCall,omitempty"`
	FunctionResponse *geminiFunctionResp `json:"functionResponse,omitempty"`
}

type geminiFunctionCall struct {
	Name string         `json:"name"`
	Args map[string]any `json:"args,omitempty"`
}

type geminiFunctionResp struct {
	Name     string         `json:"name"`
	Response map[string]any `json:"response"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiFuncDecl struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
}

type geminiTool struct {
	FunctionDeclarations []geminiFuncDecl `json:"functionDeclarations"`
}

type geminiRequest struct {
	SystemInstruction *geminiContent  `json:"systemInstruction,omitempty"`
	Contents          []geminiContent `json:"contents"`
	Tools             []geminiTool    `json:"tools,omitempty"`
	GenerationConfig  map[string]any  `json:"generationConfig,omitempty"`
}

type geminiResponse struct {
	Candidates []struct {
		Content      geminiContent `json:"content"`
		FinishReason string        `json:"finishReason"`
	} `json:"candidates"`
	PromptFeedback *struct {
		BlockReason string `json:"blockReason"`
	} `json:"promptFeedback,omitempty"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// Generate implements LLM.
func (g *GeminiClient) Generate(ctx context.Context, system string, history []Message, tools []FunctionDecl) (*LLMResult, error) {
	reqBody := geminiRequest{
		Contents: toGeminiContents(history),
		GenerationConfig: map[string]any{
			"temperature":     0.2,
			"maxOutputTokens": 1024,
		},
	}
	if system != "" {
		reqBody.SystemInstruction = &geminiContent{Parts: []geminiPart{{Text: system}}}
	}
	if len(tools) > 0 {
		decls := make([]geminiFuncDecl, 0, len(tools))
		for _, t := range tools {
			// FunctionDecl and geminiFuncDecl differ only in struct tags.
			decls = append(decls, geminiFuncDecl(t))
		}
		reqBody.Tools = []geminiTool{{FunctionDeclarations: decls}}
	}

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	url := fmt.Sprintf("%s/models/%s:generateContent", g.baseURL, g.model)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	// Header (not query param) so the key never lands in URLs, logs, or spans.
	httpReq.Header.Set("x-goog-api-key", g.apiKey)

	resp, err := g.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("gemini request: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	var gr geminiResponse
	if err := json.Unmarshal(raw, &gr); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	if resp.StatusCode >= 400 {
		if gr.Error != nil {
			return nil, fmt.Errorf("gemini %d: %s", resp.StatusCode, gr.Error.Message)
		}
		return nil, fmt.Errorf("gemini http %d", resp.StatusCode)
	}
	if gr.PromptFeedback != nil && gr.PromptFeedback.BlockReason != "" {
		return nil, fmt.Errorf("gemini blocked: %s", gr.PromptFeedback.BlockReason)
	}
	if len(gr.Candidates) == 0 {
		return &LLMResult{}, nil
	}

	var (
		text  string
		calls []ToolCall
	)
	for _, part := range gr.Candidates[0].Content.Parts {
		if part.Text != "" {
			text += part.Text
		}
		if part.FunctionCall != nil {
			calls = append(calls, ToolCall{Name: part.FunctionCall.Name, Args: part.FunctionCall.Args})
		}
	}
	return &LLMResult{Text: text, ToolCalls: calls}, nil
}

// toGeminiContents maps provider-neutral messages to Gemini contents. Gemini
// roles are "user" and "model"; tool results are sent as a functionResponse
// part inside a "user"-role content.
func toGeminiContents(history []Message) []geminiContent {
	out := make([]geminiContent, 0, len(history))
	for _, m := range history {
		switch m.Role {
		case RoleUser:
			out = append(out, geminiContent{Role: "user", Parts: []geminiPart{{Text: m.Text}}})
		case RoleModel:
			if len(m.ToolCalls) > 0 {
				parts := make([]geminiPart, 0, len(m.ToolCalls))
				for _, c := range m.ToolCalls {
					parts = append(parts, geminiPart{FunctionCall: &geminiFunctionCall{Name: c.Name, Args: c.Args}})
				}
				out = append(out, geminiContent{Role: "model", Parts: parts})
			} else {
				out = append(out, geminiContent{Role: "model", Parts: []geminiPart{{Text: m.Text}}})
			}
		case RoleTool:
			out = append(out, geminiContent{
				Role: "user",
				Parts: []geminiPart{{
					FunctionResponse: &geminiFunctionResp{Name: m.ToolName, Response: toObject(m.ToolResponse)},
				}},
			})
		}
	}
	return out
}

// toObject coerces a tool result into a JSON object, as Gemini requires the
// functionResponse `response` field to be a struct.
func toObject(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{"result": v}
}
