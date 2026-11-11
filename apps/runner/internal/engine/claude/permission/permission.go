// Package permission is the MCP server behind Claude Code's
// `--permission-prompt-tool` (ADR 0004, `docs/spikes/engines.md` scenario 2):
// stdio, JSON-RPC 2.0, one tool, `permission`, whose call Claude makes for
// each tool call that needs the Pilote's leave. Run as `crewdeck-runner mcp
// permission --session <id>`, it forwards each call over the Session's
// control socket and answers what the Pilote said, however long it takes:
// it sends a progress notification while it waits, or Claude gives the call
// up after about 30 minutes of silence.
package permission

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude/control"
)

const (
	// ServerName is the server's name in the Session's `--mcp-config`.
	ServerName = "crewdeck"
	// ToolName is its one tool.
	ToolName = "permission"
	// PromptTool is the tool as `--permission-prompt-tool` names it.
	PromptTool = "mcp__" + ServerName + "__" + ToolName
	// DefaultProgress is how often a waiting call is kept alive.
	DefaultProgress = time.Minute
	// fallbackProtocol is answered to a client that names no version.
	fallbackProtocol = "2025-06-18"
)

// Server serves the tool on one stdio connection.
type Server struct {
	// Ask forwards a request to the adapter and waits for the Pilote's
	// answer; its context ends when Claude cancels the call.
	Ask func(context.Context, control.Request) (control.Reply, error)
	// Progress is how often a waiting call is kept alive; 0, DefaultProgress.
	Progress time.Duration
	// Version is the server's version, as initialize gives it.
	Version string
}

type request struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type callParams struct {
	Name      string `json:"name"`
	Arguments struct {
		ToolName  string          `json:"tool_name"`
		Input     json.RawMessage `json:"input"`
		ToolUseID string          `json:"tool_use_id"`
	} `json:"arguments"`
	Meta struct {
		ToolUseID     string          `json:"claudecode/toolUseId"`
		ProgressToken json.RawMessage `json:"progressToken"`
	} `json:"_meta"`
}

// Serve reads the client's messages on in and writes its own on out until in
// ends or ctx does; the calls still waiting are then withdrawn.
func (s *Server) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	ctx, cancel := context.WithCancel(ctx)
	conn := &connection{out: out, calls: map[string]context.CancelFunc{}}
	var wg sync.WaitGroup
	// The calls are withdrawn before they are waited for.
	defer func() {
		cancel()
		wg.Wait()
	}()

	lines := bufio.NewScanner(in)
	lines.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for lines.Scan() {
		var r request
		if err := json.Unmarshal(lines.Bytes(), &r); err != nil {
			conn.write(map[string]any{"jsonrpc": "2.0", "id": nil, "error": map[string]any{"code": -32700, "message": "parse error"}})
			continue
		}
		switch {
		case r.Method == "notifications/cancelled":
			var params struct {
				RequestID json.RawMessage `json:"requestId"`
			}
			if json.Unmarshal(r.Params, &params) == nil {
				conn.cancel(string(params.RequestID))
			}
		case len(r.ID) == 0 || string(r.ID) == "null":
			// another notification (initialized, progress of the client): nothing to answer
		case r.Method == "initialize":
			var params struct {
				ProtocolVersion string `json:"protocolVersion"`
			}
			_ = json.Unmarshal(r.Params, &params)
			if params.ProtocolVersion == "" {
				params.ProtocolVersion = fallbackProtocol
			}
			conn.result(r.ID, map[string]any{
				"protocolVersion": params.ProtocolVersion,
				"capabilities":    map[string]any{"tools": map[string]any{}},
				"serverInfo":      map[string]any{"name": ServerName, "version": s.version()},
			})
		case r.Method == "ping":
			conn.result(r.ID, map[string]any{})
		case r.Method == "tools/list":
			conn.result(r.ID, map[string]any{"tools": []any{tool}})
		case r.Method == "tools/call":
			var params callParams
			if err := json.Unmarshal(r.Params, &params); err != nil || params.Name != ToolName {
				conn.error(r.ID, -32602, fmt.Sprintf("unknown tool %q", params.Name))
				continue
			}
			callCtx := conn.track(ctx, string(r.ID))
			wg.Add(1)
			go func() {
				defer wg.Done()
				s.call(callCtx, conn, r.ID, params)
			}()
		default:
			conn.error(r.ID, -32601, "unknown method "+r.Method)
		}
	}
	return lines.Err()
}

var tool = map[string]any{
	"name":        ToolName,
	"description": "Asks the Pilote whether a tool call may run.",
	"inputSchema": map[string]any{
		"type": "object",
		"properties": map[string]any{
			"tool_name":   map[string]any{"type": "string"},
			"input":       map[string]any{"type": "object"},
			"tool_use_id": map[string]any{"type": "string"},
		},
		"required": []string{"tool_name", "input"},
	},
}

func (s *Server) version() string {
	if s.Version == "" {
		return "dev"
	}
	return s.Version
}

// call asks the adapter, keeps the call alive while the Pilote thinks, and
// answers as Claude reads it: {"behavior":"allow","updatedInput":…} or
// {"behavior":"deny","message":…}. A call Claude cancelled gets no answer.
func (s *Server) call(ctx context.Context, conn *connection, id json.RawMessage, params callParams) {
	defer conn.untrack(string(id))
	toolUseID := params.Arguments.ToolUseID
	if toolUseID == "" {
		toolUseID = params.Meta.ToolUseID
	}
	input := params.Arguments.Input
	if len(input) == 0 {
		input = json.RawMessage(`{}`)
	}

	type outcome struct {
		reply control.Reply
		err   error
	}
	done := make(chan outcome, 1)
	go func() {
		reply, err := s.Ask(ctx, control.Request{Kind: control.Permission, ToolName: params.Arguments.ToolName, ToolUseID: toolUseID, Input: input})
		done <- outcome{reply, err}
	}()

	every := s.Progress
	if every <= 0 {
		every = DefaultProgress
	}
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for progress := 1; ; {
		select {
		case <-ticker.C:
			if len(params.Meta.ProgressToken) > 0 {
				conn.write(map[string]any{"jsonrpc": "2.0", "method": "notifications/progress", "params": map[string]any{
					"progressToken": params.Meta.ProgressToken, "progress": progress, "message": "En attente du Pilote",
				}})
				progress++
			}
		case o := <-done:
			if ctx.Err() != nil {
				return
			}
			var answer map[string]any
			switch {
			case o.err != nil:
				answer = map[string]any{"behavior": "deny", "message": "Le Runner ne répond plus : l’action n’a pas été autorisée."}
			case o.reply.Allow:
				answer = map[string]any{"behavior": "allow", "updatedInput": input}
			default:
				message := o.reply.Message
				if message == "" {
					message = "Refusé par le Pilote."
				}
				answer = map[string]any{"behavior": "deny", "message": message}
			}
			text, _ := json.Marshal(answer)
			conn.result(id, map[string]any{"content": []any{map[string]any{"type": "text", "text": string(text)}}})
			return
		}
	}
}

// connection writes one message per line, from any goroutine, and keeps the
// calls in progress by their JSON-RPC id.
type connection struct {
	mu    sync.Mutex
	out   io.Writer
	calls map[string]context.CancelFunc
}

func (c *connection) write(message any) {
	data, err := json.Marshal(message)
	if err != nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	_, _ = c.out.Write(append(data, '\n'))
}

func (c *connection) result(id json.RawMessage, result any) {
	c.write(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
}

func (c *connection) error(id json.RawMessage, code int, message string) {
	c.write(map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": message}})
}

func (c *connection) track(ctx context.Context, id string) context.Context {
	callCtx, cancel := context.WithCancel(ctx)
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls[id] = cancel
	return callCtx
}

func (c *connection) untrack(id string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if cancel, ok := c.calls[id]; ok {
		cancel()
		delete(c.calls, id)
	}
}

func (c *connection) cancel(id string) {
	c.mu.Lock()
	cancel, ok := c.calls[id]
	c.mu.Unlock()
	if ok {
		cancel()
	}
}
