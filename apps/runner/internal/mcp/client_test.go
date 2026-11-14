package mcp

import (
	"context"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/mcp/mcptest"
)

func TestMain(m *testing.M) {
	mcptest.ServeIfAsked()
	os.Exit(m.Run())
}

func names(tools []Tool) []string {
	out := []string{}
	for _, tool := range tools {
		out = append(out, tool.Name)
	}
	return out
}

// self is a stdio server: this test binary, re-executed as the fake.
func self(env map[string]string) Server {
	return Server{Name: "stitch", Transport: TransportStdio, Command: os.Args[0], Args: []string{"-test.run=^$"}, Env: env}
}

func TestListToolsOfAStdioServerFollowsItsPagesWithItsEnv(t *testing.T) {
	t.Setenv(mcptest.Env, "tools=a,b,c,d,e")
	t.Setenv(mcptest.RequireEnv, "API_KEY=s3cr3t")
	tools, err := ListTools(context.Background(), self(map[string]string{"API_KEY": "s3cr3t"}))
	if err != nil {
		t.Fatal(err)
	}
	if got := names(tools); !reflect.DeepEqual(got, []string{"a", "b", "c", "d", "e"}) {
		t.Fatalf("tools %v", got)
	}
}

func TestAStdioServerThatFailsGivesTheTailOfItsStderrWithoutItsSecrets(t *testing.T) {
	t.Setenv(mcptest.Env, "fail=needs a login, the key s3cr3t is refused")
	_, err := ListTools(context.Background(), self(map[string]string{"API_KEY": "s3cr3t"}))
	if err == nil || !strings.Contains(err.Error(), "needs a login") {
		t.Fatalf("err %v, want the server's stderr", err)
	}
	if strings.Contains(err.Error(), "s3cr3t") {
		t.Fatalf("err %v holds the secret", err)
	}
}

func TestAStdioCommandThatDoesNotExistIsAnError(t *testing.T) {
	_, err := ListTools(context.Background(), Server{Name: "x", Transport: TransportStdio, Command: "crewdeck-no-such-mcp-server"})
	if err == nil {
		t.Fatal("no error")
	}
}

func TestAStdioServerThatNeverAnswersEndsAtTheDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err := ListTools(ctx, Server{Name: "x", Transport: TransportStdio, Command: "sh", Args: []string{"-c", "sleep 30 & sleep 30"}})
	if err == nil || time.Since(started) > 5*time.Second {
		t.Fatalf("err %v after %s", err, time.Since(started))
	}
}

func TestListToolsOfAStreamableHTTPServerInJSONAndInSSE(t *testing.T) {
	for _, sse := range []bool{false, true} {
		fake := &mcptest.HTTP{Tools: []string{"get_file", "get_node", "export"}, SSE: sse}
		srv := httptest.NewServer(fake)
		tools, err := ListTools(context.Background(), Server{Name: "figma", Transport: TransportHTTP, URL: srv.URL + "/mcp", Headers: map[string]string{"Authorization": "Bearer x"}})
		srv.Close()
		if err != nil {
			t.Fatalf("sse %v: %v", sse, err)
		}
		if got := names(tools); !reflect.DeepEqual(got, []string{"get_file", "get_node", "export"}) {
			t.Fatalf("sse %v: tools %v", sse, got)
		}
		for i, h := range fake.Headers() {
			if h.Get("Authorization") != "Bearer x" {
				t.Fatalf("sse %v: request %d without the header: %v", sse, i, h)
			}
		}
		if sessions := fake.Sessions(); sessions[0] != "" || sessions[len(sessions)-1] != "session-1" {
			t.Fatalf("sse %v: sessions %v", sse, sessions)
		}
	}
}

func TestAnHTTPServerThatRefusesGivesItsStatusWithoutTheHeader(t *testing.T) {
	srv := httptest.NewServer(&mcptest.HTTP{Status: 401})
	defer srv.Close()
	_, err := ListTools(context.Background(), Server{Name: "figma", Transport: TransportHTTP, URL: srv.URL, Headers: map[string]string{"Authorization": "Bearer x"}})
	if err == nil || !strings.Contains(err.Error(), "401") || strings.Contains(err.Error(), "Bearer x") {
		t.Fatalf("err %v", err)
	}
}
