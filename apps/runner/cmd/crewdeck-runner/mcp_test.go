package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/maximed1412/crewdeck/apps/runner/internal/accounts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mcp"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mcp/mcptest"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
	"github.com/spf13/cobra"
)

// TestMain lets this test binary serve as a stdio Serveur MCP when it is started as one.
func TestMain(m *testing.M) {
	mcptest.ServeIfAsked()
	os.Exit(m.Run())
}

// mcpHarness runs `crewdeck-runner mcp …` on a store of its own, its
// refreshes of the running Runner counted.
type mcpHarness struct {
	// cliOf builds the CLI of each run; nil, cli.
	cliOf     func(*cobra.Command) (*mcpCLI, error)
	store     mcp.Store
	keychain  memoryKeyring
	refreshes int
}

func newMCPHarness(t *testing.T, keychain memoryKeyring) *mcpHarness {
	t.Helper()
	h := &mcpHarness{keychain: keychain}
	if keychain != nil {
		h.store = mcp.Store{Keyring: keychain, Dir: t.TempDir()}
	} else {
		h.store = mcp.Store{Keyring: noKeyring{}, Dir: t.TempDir()}
	}
	return h
}

func (h *mcpHarness) cli(cmd *cobra.Command) (*mcpCLI, error) {
	return &mcpCLI{
		out:   cmd.OutOrStdout(),
		store: h.store,
		list:  mcp.ListTools,
		refresh: func(context.Context) error {
			h.refreshes++
			return nil
		},
		now: func() time.Time { return time.Date(2026, 11, 14, 9, 0, 0, 0, time.UTC) },
	}, nil
}

// run executes `mcp <args>`, giving its output, its error's message and its exit code.
func (h *mcpHarness) run(t *testing.T, args ...string) (string, string, int) {
	t.Helper()
	cliOf := h.cliOf
	if cliOf == nil {
		cliOf = h.cli
	}
	cmd := mcpCommand(cliOf)
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SilenceErrors, cmd.SilenceUsage = true, true
	cmd.SetArgs(args)
	err := cmd.ExecuteContext(context.Background())
	if err == nil {
		return out.String(), "", 0
	}
	return out.String(), err.Error(), exitCode(err)
}

// self is this test binary as a stdio server's command.
func self() []string { return []string{"--", os.Args[0], "-test.run=^$"} }

func TestMCPAddOfAStdioServerKeepsItsEnvInTheKeychainAndPrintsItsToolCount(t *testing.T) {
	t.Setenv(mcptest.Env, "tools=generate_screen,list_projects,export")
	t.Setenv(mcptest.RequireEnv, "API_KEY=s3cr3t")
	h := newMCPHarness(t, memoryKeyring{})

	out, msg, code := h.run(t, append([]string{"add", "stitch", "--env", "API_KEY=s3cr3t"}, self()...)...)
	if code != 0 {
		t.Fatalf("add: %d %s", code, msg)
	}
	if !strings.Contains(out, "Serveur MCP stitch déclaré : 3 outils.") {
		t.Fatalf("add printed %q", out)
	}
	path := filepath.Join(h.store.Dir, mcp.FileName)
	data, _ := os.ReadFile(path)
	if info, err := os.Stat(path); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("mcp.json %v, %v: want mode 600", info, err)
	}
	if strings.Contains(string(data), "s3cr3t") || !strings.Contains(string(data), `"keychain": true`) {
		t.Fatalf("mcp.json %s", data)
	}
	if h.keychain["crewdeck-runner/mcp:stitch:env:API_KEY"] != "s3cr3t" {
		t.Fatalf("keychain %v", h.keychain)
	}
	if h.refreshes != 1 {
		t.Fatalf("refreshes %d, want 1", h.refreshes)
	}
}

func TestMCPAddWithAKeychainThatFailsKeepsTheValueInTheFileOnly(t *testing.T) {
	t.Setenv(mcptest.Env, "tools=a")
	h := newMCPHarness(t, nil)
	if _, msg, code := h.run(t, append([]string{"add", "stitch", "--env", "API_KEY=s3cr3t"}, self()...)...); code != 0 {
		t.Fatalf("add: %d %s", code, msg)
	}
	data, _ := os.ReadFile(filepath.Join(h.store.Dir, mcp.FileName))
	if !strings.Contains(string(data), `"value": "s3cr3t"`) {
		t.Fatalf("mcp.json %s", data)
	}
	entries, _ := os.ReadDir(h.store.Dir)
	for _, entry := range entries {
		// mcp.json, and its lock, which holds nothing.
		if info, err := entry.Info(); entry.Name() != mcp.FileName && (err != nil || entry.Name() != mcp.FileName+".lock" || info.Size() != 0) {
			t.Fatalf("the Runner's folder holds %v, want mcp.json and its empty lock only", entries)
		}
	}
}

func TestMCPAddOfAnHTTPServerSendsItsHeaderInJSONAndSSE(t *testing.T) {
	for _, sse := range []bool{false, true} {
		fake := &mcptest.HTTP{Tools: []string{"get_file", "get_node", "export", "comments"}, SSE: sse}
		srv := httptest.NewServer(fake)
		h := newMCPHarness(t, memoryKeyring{})
		out, msg, code := h.run(t, "add", "figma", "--url", srv.URL+"/mcp", "--header", "Authorization: Bearer x")
		srv.Close()
		if code != 0 || !strings.Contains(out, "Serveur MCP figma déclaré : 4 outils.") {
			t.Fatalf("sse %v: add %d %q %s", sse, code, out, msg)
		}
		for _, header := range fake.Headers() {
			if header.Get("Authorization") != "Bearer x" {
				t.Fatalf("sse %v: a request without the header: %v", sse, header)
			}
		}
		if h.keychain["crewdeck-runner/mcp:figma:header:Authorization"] != "Bearer x" {
			t.Fatalf("keychain %v", h.keychain)
		}
	}
}

func TestMCPAddOfAServerThatFailsDeclaresItFailedAndTestMakesItReadyOnceFixed(t *testing.T) {
	t.Setenv(mcptest.Env, "fail=please log in first")
	h := newMCPHarness(t, memoryKeyring{})

	_, msg, code := h.run(t, append([]string{"add", "stitch"}, self()...)...)
	if code != 1 || !strings.Contains(msg, "Serveur MCP stitch déclaré, mais le test a échoué : ") || !strings.Contains(msg, "please log in first") {
		t.Fatalf("add: %d %q", code, msg)
	}
	listed, _, _ := h.run(t, "list")
	if !strings.Contains(listed, "stitch  stdio  en échec") {
		t.Fatalf("list %q", listed)
	}
	if _, msg, code := h.run(t, "test", "stitch"); code != 1 || !strings.Contains(msg, "please log in first") {
		t.Fatalf("test of the broken server: %d %q", code, msg)
	}

	t.Setenv(mcptest.Env, "tools=generate_screen,export")
	out, msg, code := h.run(t, "test", "stitch")
	if code != 0 || out != "generate_screen\nexport\n" {
		t.Fatalf("test: %d %q %s", code, out, msg)
	}
	declared, _ := h.store.Load()
	if declared[0].State != mcp.StateReady || *declared[0].ToolCount != 2 || declared[0].TestedAt == nil {
		t.Fatalf("declared %+v", declared[0])
	}
	if h.refreshes != 3 {
		t.Fatalf("refreshes %d, want one per add and test", h.refreshes)
	}
}

func TestMCPListPrintsNoSecretAndItsJSONTheReportedFields(t *testing.T) {
	t.Setenv(mcptest.Env, "tools=a,b,c,d,e,f,g,h,i,j,k,l")
	fake := &mcptest.HTTP{Tools: []string{"a", "b", "c", "d"}}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	h := newMCPHarness(t, memoryKeyring{})
	h.run(t, append([]string{"add", "stitch", "--env", "API_KEY=s3cr3t"}, self()...)...)
	h.run(t, "add", "figma", "--url", srv.URL, "--header", "Authorization: Bearer x")

	out, _, code := h.run(t, "list")
	want := "figma   http   4 outils   Authorization: ***\nstitch  stdio  12 outils  API_KEY=***\n"
	if code != 0 || out != want {
		t.Fatalf("list %q, want %q", out, want)
	}
	out, _, _ = h.run(t, "list", "--json")
	var listed []map[string]any
	if err := json.Unmarshal([]byte(out), &listed); err != nil {
		t.Fatalf("list --json %q: %v", out, err)
	}
	if len(listed) != 2 || listed[0]["name"] != "figma" || listed[0]["transport"] != "http" || listed[0]["state"] != "ready" || listed[0]["toolCount"] != float64(4) || len(listed[0]) != 4 {
		t.Fatalf("list --json %s", out)
	}
	for _, secret := range []string{"s3cr3t", "Bearer x", srv.URL, os.Args[0]} {
		if strings.Contains(out, secret) {
			t.Fatalf("list --json %s holds %q", out, secret)
		}
	}
}

func TestMCPListWithoutAnyServer(t *testing.T) {
	h := newMCPHarness(t, memoryKeyring{})
	if out, _, _ := h.run(t, "list"); out != "Aucun Serveur MCP déclaré sur ce Runner.\n" {
		t.Fatalf("list %q", out)
	}
	if out, _, _ := h.run(t, "list", "--json"); out != "[]\n" {
		t.Fatalf("list --json %q", out)
	}
}

func TestMCPRemoveDeletesTheKeychainEntriesAndRefusesAnUnknownName(t *testing.T) {
	t.Setenv(mcptest.Env, "tools=a")
	h := newMCPHarness(t, memoryKeyring{"crewdeck-runner/codex": "sk-proj"})
	h.run(t, append([]string{"add", "stitch", "--env", "API_KEY=s3cr3t", "--env", "TOKEN=t0k3n"}, self()...)...)

	out, msg, code := h.run(t, "remove", "stitch")
	if code != 0 || out != "Serveur MCP stitch retiré.\n" {
		t.Fatalf("remove: %d %q %s", code, out, msg)
	}
	if len(h.keychain) != 1 {
		t.Fatalf("keychain %v, want the API key only", h.keychain)
	}
	if _, msg, code := h.run(t, "remove", "stitch"); code != 1 || msg != "stitch n’est pas déclaré sur ce Runner." {
		t.Fatalf("remove twice: %d %q", code, msg)
	}
	if _, msg, code := h.run(t, "test", "stitch"); code != 1 || msg != "stitch n’est pas déclaré sur ce Runner." {
		t.Fatalf("test of an unknown name: %d %q", code, msg)
	}
	if h.refreshes != 2 {
		t.Fatalf("refreshes %d, want one per add and remove", h.refreshes)
	}
}

func TestMCPAddRefusesBadNamesADuplicateAndBadFlags(t *testing.T) {
	t.Setenv(mcptest.Env, "tools=a")
	h := newMCPHarness(t, memoryKeyring{})
	h.run(t, append([]string{"add", "stitch"}, self()...)...)
	nameRule := "Un nom de Serveur MCP s’écrit en minuscules, chiffres et tirets, 40 caractères au plus."
	cases := []struct {
		args []string
		code int
		msg  string
	}{
		{append([]string{"add", "Stitch"}, self()...), 2, nameRule},
		{append([]string{"add", strings.Repeat("a", 41)}, self()...), 2, nameRule},
		{append([]string{"add", "crewdeck"}, self()...), 2, "crewdeck est le nom du serveur de permissions du Runner : choisis-en un autre."},
		{append([]string{"add", "stitch"}, self()...), 1, "stitch est déjà déclaré : crewdeck-runner mcp remove stitch d’abord."},
		{append([]string{"add", "other", "--env", "API_KEY"}, self()...), 2, "--env attend NOM=valeur : « API_KEY » n’a pas de =."},
		{[]string{"add", "other", "--url", "https://x.test", "--header", "Authorization Bearer"}, 2, "--header attend « Nom: valeur » : « Authorization Bearer » n’a pas de :."},
		{[]string{"add", "other", "--url", "ftp://x.test"}, 2, "--url attend une adresse http:// ou https://."},
		{append([]string{"add", "other", "--url", "https://x.test"}, self()...), 2, "Donne soit --url <url>, soit -- <commande> [args…], pas les deux."},
		{[]string{"add", "other"}, 2, "Donne la commande du serveur après -- (crewdeck-runner mcp add <nom> -- <commande>), ou son adresse avec --url."},
	}
	for _, c := range cases {
		if _, msg, code := h.run(t, c.args...); code != c.code || msg != c.msg {
			t.Errorf("%v: %d %q, want %d %q", c.args, code, msg, c.code, c.msg)
		}
	}
	if names, _ := h.store.Names(); len(names) != 1 {
		t.Fatalf("declared %v, want stitch only", names)
	}
	if out, _, code := h.run(t, append([]string{"add", strings.Repeat("a", 40)}, self()...)...); code != 0 {
		t.Fatalf("a name of 40 characters: %d %q", code, out)
	}
}

func TestMCPAddRefusesTheServerAfterTheHundredth(t *testing.T) {
	h := newMCPHarness(t, memoryKeyring{})
	for i := range mcp.MaxServers {
		if err := h.store.Add(mcp.Server{Name: fmt.Sprintf("server-%03d", i), Transport: mcp.TransportStdio, Command: "x"}); err != nil {
			t.Fatal(err)
		}
	}
	_, msg, code := h.run(t, append([]string{"add", "stitch", "--env", "API_KEY=s3cr3t"}, self()...)...)
	if want := "Ce Runner a déjà 100 Serveurs MCP, le plus qu’il puisse déclarer : retires-en un (crewdeck-runner mcp remove <nom>) d’abord."; code != 1 || msg != want {
		t.Fatalf("%d %q, want 1 %q", code, msg, want)
	}
	if len(h.keychain) != 0 || h.refreshes != 0 {
		t.Fatalf("keychain %v, %d refreshes, want none", h.keychain, h.refreshes)
	}
}

func TestAfterMCPAddTheRunningRunnerSendsTheNamesOfItsServersAndNoSecret(t *testing.T) {
	messages := make(chan string, 8)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		ctx := r.Context()
		if _, _, err := conn.Read(ctx); err != nil { // hello
			return
		}
		accepted := `{"type":"hello.accepted","id":"019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a00","at":"2026-11-11T08:00:00.000Z","runnerId":"019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01","protocolVersion":1}`
		if err := conn.Write(ctx, websocket.MessageText, []byte(accepted)); err != nil {
			return
		}
		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			if strings.Contains(string(data), `"type":"mcp.servers"`) {
				messages <- string(data)
			}
		}
	}))
	t.Cleanup(srv.Close)
	figma := &mcptest.HTTP{Tools: []string{"get_file", "export"}}
	figmaSrv := httptest.NewServer(figma)
	t.Cleanup(figmaSrv.Close)
	home := t.TempDir()
	t.Setenv(state.HomeEnv, home)
	linkedHome(t, home, srv.URL)
	previous := runnerEngines
	runnerEngines = func(accounts.Store) *engine.Registry { return &engine.Registry{} }
	t.Cleanup(func() { runnerEngines = previous })

	ctx, cancel := context.WithCancel(context.Background())
	var log syncBuffer
	root := newRootCommand()
	root.SetErr(&log)
	root.SetArgs([]string{"run"})
	done := make(chan error, 1)
	go func() { done <- root.ExecuteContext(ctx) }()

	await := func(what string) string {
		t.Helper()
		select {
		case data := <-messages:
			return data
		case <-time.After(5 * time.Second):
			t.Fatalf("no mcp.servers %s", what)
			return ""
		}
	}
	if data := await("once accepted"); !strings.Contains(data, `"servers":[]`) {
		t.Fatalf("mcp.servers %s", data)
	}

	t.Setenv(mcptest.Env, "tools=generate_screen")
	h := newMCPHarness(t, memoryKeyring{})
	h.store.Dir = home
	socket := filepath.Join(home, accounts.SocketName)
	cli := h.cli
	h.cliOf = func(cmd *cobra.Command) (*mcpCLI, error) {
		c, err := cli(cmd)
		c.refresh = func(ctx context.Context) error {
			_, err := accounts.Refresh(ctx, socket)
			return err
		}
		return c, err
	}
	if _, msg, code := h.run(t, append([]string{"add", "stitch", "--env", "API_KEY=s3cr3t"}, self()...)...); code != 0 {
		t.Fatalf("add stitch: %s", msg)
	}
	data := await("after add stitch")
	if _, msg, code := h.run(t, "add", "figma", "--url", figmaSrv.URL+"/mcp?token=u5l", "--header", "Authorization: Bearer x"); code != 0 {
		t.Fatalf("add figma: %s", msg)
	}
	data = await("after add figma")

	var message contracts.RunnerMcpServers
	if err := json.Unmarshal([]byte(data), &message); err != nil {
		t.Fatalf("mcp.servers %s: %v", data, err)
	}
	if len(message.Servers) != 2 || message.Servers[0].Name != "figma" || message.Servers[0].Transport != "http" || message.Servers[0].ToolCount != float64(2) ||
		message.Servers[1].Name != "stitch" || message.Servers[1].State != "ready" {
		t.Fatalf("mcp.servers %s", data)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("run did not stop")
	}
	for _, secret := range []string{"s3cr3t", "API_KEY", "Bearer x", "Authorization", "u5l", figmaSrv.URL, os.Args[0], "generate_screen"} {
		if strings.Contains(data, secret) || strings.Contains(log.String(), secret) {
			t.Fatalf("%q in the message %s or the log %s", secret, data, log.String())
		}
	}
}

// syncBuffer is a log written by the Runner's goroutines while the test reads it.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}
