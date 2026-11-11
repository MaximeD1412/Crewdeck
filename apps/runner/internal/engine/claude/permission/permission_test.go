package permission_test

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude/control"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude/permission"
)

// client is Claude Code's side of the stdio MCP server.
type client struct {
	t   *testing.T
	in  io.WriteCloser
	out *bufio.Scanner
}

func start(t *testing.T, server *permission.Server) *client {
	t.Helper()
	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- server.Serve(ctx, inR, outW)
		outW.Close()
	}()
	t.Cleanup(func() {
		inW.Close()
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("Serve: %v", err)
			}
		case <-time.After(5 * time.Second):
			t.Error("Serve still running 5 s after its stdin closed")
		}
	})
	out := bufio.NewScanner(outR)
	return &client{t: t, in: inW, out: out}
}

func (c *client) send(message string) {
	c.t.Helper()
	if _, err := io.WriteString(c.in, message+"\n"); err != nil {
		c.t.Fatal(err)
	}
}

type message struct {
	ID     json.RawMessage `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code int `json:"code"`
	} `json:"error"`
}

func (c *client) read() message {
	c.t.Helper()
	got := make(chan message, 1)
	go func() {
		if c.out.Scan() {
			var m message
			if err := json.Unmarshal(c.out.Bytes(), &m); err != nil {
				c.t.Errorf("the server wrote %q: %v", c.out.Bytes(), err)
			}
			got <- m
		}
		close(got)
	}()
	select {
	case m, ok := <-got:
		if !ok {
			c.t.Fatal("the server closed its stdout")
		}
		return m
	case <-time.After(5 * time.Second):
		c.t.Fatal("nothing from the server after 5 s")
		return message{}
	}
}

func (c *client) handshake() {
	c.t.Helper()
	c.send(`{"jsonrpc":"2.0","id":"server-discover-probe-1","method":"server/discover","params":{}}`)
	if m := c.read(); m.Error == nil || m.Error.Code != -32601 {
		c.t.Fatalf("server/discover: %+v, want the error « method not found »", m)
	}
	c.send(`{"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"claude-code","version":"2.1.319"}},"jsonrpc":"2.0","id":0}`)
	init := c.read()
	var result struct {
		ProtocolVersion string `json:"protocolVersion"`
		Capabilities    struct {
			Tools *struct{} `json:"tools"`
		} `json:"capabilities"`
	}
	if err := json.Unmarshal(init.Result, &result); err != nil || result.ProtocolVersion != "2025-11-25" || result.Capabilities.Tools == nil {
		c.t.Fatalf("initialize: %s", init.Result)
	}
	c.send(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)
}

func (c *client) call(id int, toolUseID string) {
	c.t.Helper()
	c.send(`{"method":"tools/call","params":{"name":"permission","arguments":{"tool_name":"Bash","input":{"command":"touch allowed.txt","description":"Create empty file allowed.txt"},"tool_use_id":"` + toolUseID + `"},"_meta":{"claudecode/toolUseId":"` + toolUseID + `","progressToken":` + itoa(id) + `}},"jsonrpc":"2.0","id":` + itoa(id) + `}`)
}

func itoa(n int) string { return strings.TrimSpace(string(must(json.Marshal(n)))) }

func must[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}

// answerText is the text content of a tools/call result.
func answerText(t *testing.T, m message) map[string]any {
	t.Helper()
	var result struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(m.Result, &result); err != nil || len(result.Content) != 1 || result.Content[0].Type != "text" {
		t.Fatalf("tools/call result %s", m.Result)
	}
	var answer map[string]any
	if err := json.Unmarshal([]byte(result.Content[0].Text), &answer); err != nil {
		t.Fatalf("the text %q is not JSON: %v", result.Content[0].Text, err)
	}
	return answer
}

func TestToolsListGivesTheOnePermissionToolWithTheSchemaClaudeCodeCalls(t *testing.T) {
	c := start(t, &permission.Server{Ask: func(context.Context, control.Request) (control.Reply, error) { return control.Reply{}, nil }})
	c.handshake()
	c.send(`{"method":"tools/list","jsonrpc":"2.0","id":1}`)
	var listed struct {
		Tools []struct {
			Name        string `json:"name"`
			InputSchema struct {
				Type       string                     `json:"type"`
				Properties map[string]json.RawMessage `json:"properties"`
				Required   []string                   `json:"required"`
			} `json:"inputSchema"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(c.read().Result, &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Tools) != 1 || listed.Tools[0].Name != permission.ToolName {
		t.Fatalf("tools %+v", listed.Tools)
	}
	schema := listed.Tools[0].InputSchema
	for _, field := range []string{"tool_name", "input", "tool_use_id"} {
		if _, ok := schema.Properties[field]; !ok {
			t.Errorf("no property %s in %+v", field, schema)
		}
	}
	if schema.Type != "object" || strings.Join(schema.Required, ",") != "tool_name,input" {
		t.Errorf("schema %+v", schema)
	}
	if permission.PromptTool != "mcp__crewdeck__permission" {
		t.Errorf("PromptTool %q", permission.PromptTool)
	}
}

func TestACallAllowedGivesBackItsInputAndADeniedOneTheMessage(t *testing.T) {
	var asked []control.Request
	replies := []control.Reply{{Allow: true}, {Allow: false, Message: "Refusé par le Pilote."}}
	c := start(t, &permission.Server{Ask: func(_ context.Context, r control.Request) (control.Reply, error) {
		asked = append(asked, r)
		reply := replies[0]
		replies = replies[1:]
		return reply, nil
	}})
	c.handshake()

	c.call(2, "toolu_allow")
	allowed := answerText(t, c.read())
	input, _ := json.Marshal(allowed["updatedInput"])
	if allowed["behavior"] != "allow" || string(input) != `{"command":"touch allowed.txt","description":"Create empty file allowed.txt"}` {
		t.Fatalf("allowed %v", allowed)
	}
	c.call(3, "toolu_deny")
	if denied := answerText(t, c.read()); denied["behavior"] != "deny" || denied["message"] != "Refusé par le Pilote." {
		t.Fatalf("denied %v", denied)
	}
	if len(asked) != 2 || asked[0].Kind != control.Permission || asked[0].ToolName != "Bash" || asked[0].ToolUseID != "toolu_allow" || !strings.Contains(string(asked[0].Input), "touch allowed.txt") {
		t.Fatalf("asked %+v", asked)
	}
}

func TestACallThatWaitsIsKeptAliveByProgressNotifications(t *testing.T) {
	answer := make(chan control.Reply)
	c := start(t, &permission.Server{
		Progress: 20 * time.Millisecond,
		Ask: func(ctx context.Context, _ control.Request) (control.Reply, error) {
			select {
			case reply := <-answer:
				return reply, nil
			case <-ctx.Done():
				return control.Reply{}, ctx.Err()
			}
		},
	})
	c.handshake()
	c.call(2, "toolu_wait")
	for i := 1; i <= 3; i++ {
		m := c.read()
		var params struct {
			ProgressToken int `json:"progressToken"`
			Progress      int `json:"progress"`
		}
		if err := json.Unmarshal(m.Params, &params); err != nil || m.Method != "notifications/progress" || params.ProgressToken != 2 || params.Progress != i {
			t.Fatalf("message %d while waiting: %+v %s", i, m, m.Params)
		}
	}
	go func() { answer <- control.Reply{Allow: true} }()
	for {
		m := c.read()
		if m.Method == "notifications/progress" {
			continue
		}
		if string(m.ID) != "2" || answerText(t, m)["behavior"] != "allow" {
			t.Fatalf("answer %+v", m)
		}
		return
	}
}

func TestACancelledCallWithdrawsItsRequest(t *testing.T) {
	withdrawn := make(chan struct{})
	c := start(t, &permission.Server{Ask: func(ctx context.Context, _ control.Request) (control.Reply, error) {
		<-ctx.Done()
		close(withdrawn)
		return control.Reply{}, ctx.Err()
	}})
	c.handshake()
	c.call(2, "toolu_cancel")
	c.send(`{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":2,"reason":"interrupted"}}`)
	select {
	case <-withdrawn:
	case <-time.After(5 * time.Second):
		t.Fatal("the request still waits 5 s after its cancellation")
	}
	c.send(`{"jsonrpc":"2.0","id":9,"method":"ping"}`)
	if m := c.read(); string(m.ID) != "9" || m.Error != nil {
		t.Fatalf("ping after the cancellation: %+v (a cancelled call gets no answer)", m)
	}
}

func TestAnAdapterThatCannotBeReachedDeniesTheCall(t *testing.T) {
	c := start(t, &permission.Server{Ask: func(context.Context, control.Request) (control.Reply, error) {
		return control.Reply{}, io.ErrUnexpectedEOF
	}})
	c.handshake()
	c.call(2, "toolu_gone")
	if denied := answerText(t, c.read()); denied["behavior"] != "deny" || !strings.Contains(denied["message"].(string), "Runner") {
		t.Fatalf("denied %v", denied)
	}
}
