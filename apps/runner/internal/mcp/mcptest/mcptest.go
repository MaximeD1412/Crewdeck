// Package mcptest is a fake MCP server for the tests: over stdio (the test
// binary re-executed as the server) and over streamable HTTP, answering
// JSON or SSE. It lists the tools it is given, a page of two at a time.
package mcptest

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
)

// Env holds, in a test process, the fake's behaviour: `tools=<a,b,c>` lists
// them, `fail=<reason>` writes the reason to stderr and exits 3, `stall=<n>`
// answers tools/list with a cursor of n bytes, then reads nothing more and
// never ends (a server whose stdin fills up). A test's
// TestMain calls ServeIfAsked so that its binary, started with it, serves.
const Env = "CREWDECK_FAKE_MCP"

// RequireEnv, when set in the server's environment, names a variable whose
// value must be `<name>=<value>` in its environment too, or it fails.
const RequireEnv = "CREWDECK_FAKE_MCP_REQUIRE"

// ServeIfAsked serves on stdio and exits when Env is set; else it returns.
func ServeIfAsked() {
	spec := os.Getenv(Env)
	if spec == "" {
		return
	}
	if reason, ok := strings.CutPrefix(spec, "fail="); ok {
		fmt.Fprintln(os.Stderr, reason)
		os.Exit(3)
	}
	if size, ok := strings.CutPrefix(spec, "stall="); ok {
		n, _ := strconv.Atoi(size)
		serveStall(os.Stdin, os.Stdout, n)
	}
	if want := os.Getenv(RequireEnv); want != "" {
		name, value, _ := strings.Cut(want, "=")
		if os.Getenv(name) != value {
			fmt.Fprintf(os.Stderr, "%s is not what it should be\n", name)
			os.Exit(3)
		}
	}
	tools := strings.Split(strings.TrimPrefix(spec, "tools="), ",")
	ServeStdio(os.Stdin, os.Stdout, tools)
	os.Exit(0)
}

type request struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method"`
	Params struct {
		Cursor string `json:"cursor"`
	} `json:"params"`
}

// answer is the JSON-RPC answer to r, nil for a notification.
func answer(r request, tools []string) map[string]any {
	if len(r.ID) == 0 {
		return nil
	}
	reply := map[string]any{"jsonrpc": "2.0", "id": r.ID}
	switch r.Method {
	case "initialize":
		reply["result"] = map[string]any{
			"protocolVersion": "2025-06-18",
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "fake", "version": "1"},
		}
	case "tools/list":
		start, _ := strconv.Atoi(r.Params.Cursor)
		end := min(start+2, len(tools))
		page := []map[string]any{}
		for _, name := range tools[start:end] {
			page = append(page, map[string]any{"name": name, "inputSchema": map[string]any{"type": "object"}})
		}
		result := map[string]any{"tools": page}
		if end < len(tools) {
			result["nextCursor"] = strconv.Itoa(end)
		}
		reply["result"] = result
	default:
		reply["error"] = map[string]any{"code": -32601, "message": "unknown method " + r.Method}
	}
	return reply
}

func serveStall(in io.Reader, out io.Writer, cursor int) {
	lines := bufio.NewScanner(in)
	encoder := json.NewEncoder(out)
	for lines.Scan() {
		var r request
		if err := json.Unmarshal(lines.Bytes(), &r); err != nil {
			continue
		}
		if r.Method == "tools/list" {
			_ = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": r.ID, "result": map[string]any{"tools": []any{}, "nextCursor": strings.Repeat("c", cursor)}})
			select {}
		}
		if reply := answer(r, nil); reply != nil {
			_ = encoder.Encode(reply)
		}
	}
}

// ServeStdio answers the requests of in on out, one JSON line each, until in ends.
func ServeStdio(in io.Reader, out io.Writer, tools []string) {
	lines := bufio.NewScanner(in)
	encoder := json.NewEncoder(out)
	for lines.Scan() {
		var r request
		if err := json.Unmarshal(lines.Bytes(), &r); err != nil {
			continue
		}
		if r.Method == "tools/list" {
			// A notification of the server comes before its answer: the client skips it.
			_ = encoder.Encode(map[string]any{"jsonrpc": "2.0", "method": "notifications/message", "params": map[string]any{"level": "info", "data": "listing"}})
		}
		if reply := answer(r, tools); reply != nil {
			_ = encoder.Encode(reply)
		}
	}
}

// HTTP is a streamable HTTP server; its fields are read at each request.
type HTTP struct {
	Tools []string
	// SSE answers each request as a text/event-stream, else as JSON.
	SSE bool
	// Status, when not 0, answers every request with it.
	Status int

	mu       sync.Mutex
	headers  []http.Header
	sessions []string
}

// Headers are those of every request received.
func (h *HTTP) Headers() []http.Header {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]http.Header(nil), h.headers...)
}

// Sessions are the Mcp-Session-Id of every request received ("" for none).
func (h *HTTP) Sessions() []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]string(nil), h.sessions...)
}

func (h *HTTP) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	h.headers = append(h.headers, r.Header.Clone())
	h.sessions = append(h.sessions, r.Header.Get("Mcp-Session-Id"))
	status, sse, tools := h.Status, h.SSE, h.Tools
	h.mu.Unlock()
	if status != 0 {
		http.Error(w, "unauthorized", status)
		return
	}
	if r.Method != http.MethodPost || !strings.Contains(r.Header.Get("Accept"), "text/event-stream") || !strings.Contains(r.Header.Get("Accept"), "application/json") {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	var req request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if req.Method == "initialize" {
		w.Header().Set("Mcp-Session-Id", "session-1")
	} else if r.Header.Get("Mcp-Session-Id") != "session-1" {
		http.Error(w, "no session", http.StatusBadRequest)
		return
	}
	reply := answer(req, tools)
	if reply == nil {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	data, _ := json.Marshal(reply)
	if !sse {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(data)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	fmt.Fprintf(w, ": keep-alive\n\nevent: message\ndata: %s\n\n", `{"jsonrpc":"2.0","method":"notifications/progress","params":{}}`)
	fmt.Fprintf(w, "id: 1\nevent: message\ndata: %s\n\n", data)
}
