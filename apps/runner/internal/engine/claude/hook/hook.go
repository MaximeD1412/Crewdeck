// Package hook is Claude Code's `PreToolUse` hook for `AskUserQuestion` (ADR
// 0004, `docs/spikes/engines.md` scenario 3), run as `crewdeck-runner hook
// pre-tool-use --session <id>`: it forwards the questions over the Session's
// control socket, waits for the Pilote's answers as long as they take, and
// prints them as the tool's updated input, which Claude reads as the user's
// answers. Any other tool goes through untouched.
package hook

import (
	"context"
	"encoding/json"
	"fmt"
	"io"

	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude/control"
)

// Tool is the tool the hook holds; the Session's settings match it.
const Tool = "AskUserQuestion"

type input struct {
	ToolName  string          `json:"tool_name"`
	ToolInput json.RawMessage `json:"tool_input"`
	ToolUseID string          `json:"tool_use_id"`
}

// PreToolUse reads the hook's input on in and, for an `AskUserQuestion`,
// asks the adapter and writes Claude's decision on out. An error leaves out
// empty: the caller exits 2, which blocks the call with its message.
func PreToolUse(ctx context.Context, in io.Reader, out io.Writer, ask func(context.Context, control.Request) (control.Reply, error)) error {
	var call input
	if err := json.NewDecoder(in).Decode(&call); err != nil {
		return fmt.Errorf("hook input: %w", err)
	}
	if call.ToolName != Tool {
		return nil
	}
	toolInput := map[string]json.RawMessage{}
	if len(call.ToolInput) > 0 {
		if err := json.Unmarshal(call.ToolInput, &toolInput); err != nil {
			return fmt.Errorf("hook tool_input: %w", err)
		}
	}
	reply, err := ask(ctx, control.Request{Kind: control.Question, ToolName: call.ToolName, ToolUseID: call.ToolUseID, Input: call.ToolInput})
	if err != nil {
		return err
	}
	if reply.Answers == nil {
		reply.Answers = map[string]string{}
	}
	answers, err := json.Marshal(reply.Answers)
	if err != nil {
		return err
	}
	toolInput["answers"] = answers
	return json.NewEncoder(out).Encode(map[string]any{"hookSpecificOutput": map[string]any{
		"hookEventName":      "PreToolUse",
		"permissionDecision": "allow",
		"updatedInput":       toolInput,
	}})
}
