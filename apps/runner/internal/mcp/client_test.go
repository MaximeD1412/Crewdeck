package mcp

import (
	"context"
	"encoding/base64"
	"net/http"
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

func TestAnErrorThatEchoesTheTokenOfAnAuthHeaderWithoutItsSchemeHidesIt(t *testing.T) {
	cases := []struct{ header, echoed string }{
		{"Bearer s3cr3t-token", "s3cr3t-token"},
		// Basic carries user:password in base64: neither the encoding nor what it encodes shows.
		{"Basic " + base64.StdEncoding.EncodeToString([]byte("pilote:p4ssw0rd")), "p4ssw0rd"},
		{"Basic " + base64.StdEncoding.EncodeToString([]byte("pilote:p4ssw0rd")), base64.StdEncoding.EncodeToString([]byte("pilote:p4ssw0rd"))},
	}
	for _, c := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"invalid token ` + c.echoed + `"}}`))
		}))
		_, err := ListTools(context.Background(), Server{Name: "figma", Transport: TransportHTTP, URL: srv.URL, Headers: map[string]string{"Authorization": c.header}})
		srv.Close()
		if err == nil || !strings.Contains(err.Error(), "invalid token") {
			t.Fatalf("%s: err %v, want the server's message", c.header, err)
		}
		if strings.Contains(err.Error(), c.echoed) {
			t.Fatalf("%s: err %v holds the token", c.header, err)
		}
	}
}

func TestAStdioServerThatStopsReadingEndsAtTheDeadlineEvenInTheMiddleOfAWrite(t *testing.T) {
	// The next request carries the cursor back: 1 MiB, far more than a pipe holds.
	t.Setenv(mcptest.Env, "stall=1048576")
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	started := time.Now()
	go func() {
		_, err := ListTools(ctx, self(nil))
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "pas de réponse") || time.Since(started) > 5*time.Second {
			t.Fatalf("err %v after %s, want no answer at the deadline", err, time.Since(started))
		}
	case <-time.After(10 * time.Second):
		t.Fatal("ListTools still writing 10 s after its deadline")
	}
}
