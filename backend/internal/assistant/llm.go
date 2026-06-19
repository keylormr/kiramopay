package assistant

import "context"

// Message is one provider-neutral conversation turn the orchestrator feeds to
// the LLM. Exactly one shape is meaningful per Role:
//   - RoleUser  / RoleModel: Text (and, for the model, ToolCalls it requested)
//   - RoleTool:              ToolName + ToolResponse (the result of a tool call)
type Message struct {
	Role         Role
	Text         string
	ToolCalls    []ToolCall
	ToolName     string
	ToolResponse any
}

// ToolCall is the model asking to invoke a named tool with arguments.
type ToolCall struct {
	Name string
	Args map[string]any
}

// FunctionDecl is a tool advertised to the model (JSON-schema parameters).
type FunctionDecl struct {
	Name        string
	Description string
	Parameters  map[string]any
}

// LLMResult is one model response: either final Text, or ToolCalls to execute
// (never both meaningfully — if ToolCalls is non-empty the orchestrator runs
// them and calls Generate again).
type LLMResult struct {
	Text      string
	ToolCalls []ToolCall
}

// LLM is the provider-neutral model interface. The Gemini HTTP client
// implements it; tests supply a deterministic fake. A nil LLM means the
// assistant is disabled (no API key configured).
type LLM interface {
	Generate(ctx context.Context, system string, history []Message, tools []FunctionDecl) (*LLMResult, error)
}
