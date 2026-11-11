package claude_test

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/enginetest"
)

// directives says where the fake binary plays Claude Code's waits and side
// channels in a recording, from the spike's other files: it waits for stdin
// before the `system` `init` of each user message the driver wrote, and
// before the `control_response` of each interrupt; it calls the permission
// tool right after the `tool_use` of each call the recorded MCP server
// answered, and runs the hook right after each `AskUserQuestion` the
// recorded hook answered.
func directives(t *testing.T, name string) []enginetest.Directive {
	t.Helper()
	type stdinLine struct {
		Type      string `json:"type"`
		RequestID string `json:"request_id"`
		Request   struct {
			Subtype string `json:"subtype"`
		} `json:"request"`
	}
	var users int
	interrupts := map[string]bool{}
	for _, line := range jsonLines(t, filepath.Join("testdata", name+".stdin.jsonl")) {
		var l stdinLine
		if err := json.Unmarshal(line, &l); err != nil {
			t.Fatal(err)
		}
		switch {
		case l.Type == "user":
			users++
		case l.Type == "control_request" && l.Request.Subtype == "interrupt":
			interrupts[l.RequestID] = true
		}
	}
	permissions := answeredPermissionCalls(t)
	hooks := answeredHooks(t)

	var out []enginetest.Directive
	inits := 0
	for n, line := range jsonLines(t, filepath.Join("testdata", name+".jsonl")) {
		before := n + 1
		var l struct {
			Type     string `json:"type"`
			Subtype  string `json:"subtype"`
			Response struct {
				RequestID string `json:"request_id"`
			} `json:"response"`
			Message struct {
				Content []struct {
					Type string `json:"type"`
					ID   string `json:"id"`
					Name string `json:"name"`
				} `json:"content"`
			} `json:"message"`
		}
		if err := json.Unmarshal(line, &l); err != nil {
			t.Fatal(err)
		}
		switch {
		case l.Type == "system" && l.Subtype == "init" && inits < users:
			inits++
			out = append(out, enginetest.AwaitStdin(before))
		case l.Type == "control_response" && interrupts[l.Response.RequestID]:
			out = append(out, enginetest.AwaitStdin(before))
		case l.Type == "assistant":
			for _, block := range l.Message.Content {
				if block.Type != "tool_use" {
					continue
				}
				if arguments, ok := permissions[block.ID]; ok {
					out = append(out, enginetest.Directive{Before: before + 1, Line: map[string]any{"fake": "claude-permission", "arguments": arguments}})
				}
				if input, ok := hooks[block.ID]; ok {
					out = append(out, enginetest.Directive{Before: before + 1, Line: map[string]any{"fake": "claude-hook", "input": input}})
				}
			}
		}
	}
	return out
}

// answeredPermissionCalls are the arguments of the recorded `tools/call`s
// of the permission tool that got an answer, by tool use id.
func answeredPermissionCalls(t *testing.T) map[string]json.RawMessage {
	t.Helper()
	files, _ := filepath.Glob(filepath.Join("testdata", "*.permission-tool.jsonl"))
	calls := map[string]json.RawMessage{}
	for _, file := range files {
		waiting := map[string]json.RawMessage{} // by JSON-RPC id, in one connection
		for _, line := range jsonLines(t, file) {
			var l struct {
				Direction string `json:"direction"`
				Message   struct {
					ID     json.RawMessage `json:"id"`
					Method string          `json:"method"`
					Result json.RawMessage `json:"result"`
					Params struct {
						Arguments json.RawMessage `json:"arguments"`
					} `json:"params"`
				} `json:"message"`
			}
			if json.Unmarshal(line, &l) != nil {
				continue // a line of the recorder's own
			}
			switch {
			case l.Direction == "in" && l.Message.Method == "initialize":
				waiting = map[string]json.RawMessage{}
			case l.Direction == "in" && l.Message.Method == "tools/call":
				waiting[string(l.Message.ID)] = l.Message.Params.Arguments
			case l.Direction == "out" && l.Message.Result != nil:
				if arguments, ok := waiting[string(l.Message.ID)]; ok {
					var call struct {
						ToolUseID string `json:"tool_use_id"`
					}
					if err := json.Unmarshal(arguments, &call); err != nil {
						t.Fatal(err)
					}
					calls[call.ToolUseID] = arguments
				}
			}
		}
	}
	return calls
}

// answeredHooks are the recorded inputs of the `AskUserQuestion` hook that
// answered, by tool use id.
func answeredHooks(t *testing.T) map[string]json.RawMessage {
	t.Helper()
	files, _ := filepath.Glob(filepath.Join("testdata", "*.hook.jsonl"))
	hooks := map[string]json.RawMessage{}
	for _, file := range files {
		var last json.RawMessage
		var lastID string
		for _, line := range jsonLines(t, file) {
			var l struct {
				Direction string          `json:"direction"`
				Payload   json.RawMessage `json:"payload"`
			}
			if err := json.Unmarshal(line, &l); err != nil {
				t.Fatal(err)
			}
			if l.Direction == "in" {
				var in struct {
					ToolUseID string `json:"tool_use_id"`
				}
				if err := json.Unmarshal(l.Payload, &in); err != nil {
					t.Fatal(err)
				}
				last, lastID = l.Payload, in.ToolUseID
				continue
			}
			if last != nil {
				hooks[lastID] = last
				last = nil
			}
		}
	}
	return hooks
}

func jsonLines(t *testing.T, path string) [][]byte {
	t.Helper()
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	var out [][]byte
	lines := bufio.NewScanner(file)
	lines.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for lines.Scan() {
		if len(lines.Bytes()) > 0 {
			out = append(out, append([]byte(nil), lines.Bytes()...))
		}
	}
	if err := lines.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}
