package session_test

import (
	"context"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"io/fs"
	"net/http"
	"net/http/cgi"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
)

// TestMain lets this test binary serve as git's askpass, as crewdeck-runner does.
func TestMain(m *testing.M) {
	if github.IsAskpass(os.Args[1:]) {
		os.Exit(github.RunAskpass(os.Args[1], os.Stdout, os.Stderr))
	}
	os.Exit(m.Run())
}

// fakeClock is the clock the tests move.
type fakeClock struct {
	mu      sync.Mutex
	now     time.Time
	waiters []clockWaiter
}

type clockWaiter struct {
	at time.Time
	ch chan time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

// After fires once the clock is moved to now+d.
func (c *fakeClock) After(d time.Duration) <-chan time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch := make(chan time.Time, 1)
	if d <= 0 {
		ch <- c.now
		return ch
	}
	c.waiters = append(c.waiters, clockWaiter{c.now.Add(d), ch})
	return ch
}

func (c *fakeClock) waiting() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.waiters)
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	kept := c.waiters[:0]
	for _, w := range c.waiters {
		if w.at.After(c.now) {
			kept = append(kept, w)
			continue
		}
		w.ch <- c.now
	}
	c.waiters = kept
	c.mu.Unlock()
}

// tokenServer stands for the server's route: a new token valid 1 h at each call.
type tokenServer struct {
	clock *fakeClock
	mu    sync.Mutex
	asked []string
}

func (s *tokenServer) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.asked)
}

func (s *tokenServer) issue(_ context.Context, sessionID string) (github.Issued, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.asked = append(s.asked, sessionID)
	return github.Issued{Token: fmt.Sprintf("ghs_%d", len(s.asked)), ExpiresAt: s.clock.Now().Add(time.Hour)}, nil
}

// httpsGitHub serves the remote's bare repositories over HTTPS, as GitHub
// does a private one: every request refused without the basic auth of
// x-access-token and a token issued, the tokens of the accepted pushes kept.
type httpsGitHub struct {
	url    string
	mu     sync.Mutex
	pushes []string
	used   []string
}

func newHTTPSGitHub(t *testing.T, r *remote) *httpsGitHub {
	t.Helper()
	bare := filepath.Join(r.root, "acme", "shop.git")
	git(t, bare, "config", "uploadpack.allowFilter", "true")
	git(t, bare, "config", "http.receivepack", "true")
	gitPath, err := exec.LookPath("git")
	if err != nil {
		t.Fatal(err)
	}
	backend := &cgi.Handler{Path: gitPath, Args: []string{"http-backend"}, Env: []string{"GIT_PROJECT_ROOT=" + r.root, "GIT_HTTP_EXPORT_ALL=1"}}
	g := &httpsGitHub{}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		token, ok := strings.CutPrefix(req.Header.Get("Authorization"), "Basic ")
		decoded, _ := base64.StdEncoding.DecodeString(token)
		user, password, _ := strings.Cut(string(decoded), ":")
		if !ok || user != "x-access-token" || !strings.HasPrefix(password, "ghs_") {
			w.Header().Set("WWW-Authenticate", `Basic realm="github"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		g.mu.Lock()
		g.used = append(g.used, password)
		if strings.HasSuffix(req.URL.Path, "/git-receive-pack") {
			g.pushes = append(g.pushes, password)
		}
		g.mu.Unlock()
		backend.ServeHTTP(w, req)
	}))
	t.Cleanup(server.Close)
	ca := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GIT_SSL_CAINFO", ca)
	g.url = server.URL
	return g
}

func (g *httpsGitHub) pushed() []string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return append([]string(nil), g.pushes...)
}

// serveSocket serves the manager's ops on runner.sock in home.
func serveSocket(t *testing.T, m *session.Manager, home string) string {
	t.Helper()
	sock := &localsock.Server{}
	m.ServeGitHubTokens(sock)
	socket := filepath.Join(home, localsock.SocketName)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = sock.Serve(ctx, socket)
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})
	for i := 0; i < 200; i++ {
		if _, err := os.Stat(socket); err == nil {
			return socket
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("runner.sock is not served")
	return ""
}

// agentPush commits a file in the worktree and pushes it as the Moteur
// would, with the Moteur's environment.
func agentPush(t *testing.T, opts engine.StartOptions, file string) error {
	t.Helper()
	if err := os.WriteFile(filepath.Join(opts.Dir, file), []byte(file+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, opts.Dir, "add", file)
	git(t, opts.Dir, "commit", "-m", file)
	cmd := exec.Command("git", "push", "origin", "HEAD:refs/heads/feat/12-panier")
	cmd.Dir = opts.Dir
	cmd.Env = append(os.Environ(), opts.Env...)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%v: %s", err, out)
	}
	return nil
}

func TestASessionClonesAndPushesThroughTheAskpassWithItsTokenRenewedAndNoCredentialInAnyFile(t *testing.T) {
	// No Git identity nor credential helper of the machine's.
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	s := newSetup(t, question("q-1"))
	gh := newHTTPSGitHub(t, s.remote)
	clock := &fakeClock{now: time.Date(2026, 11, 19, 10, 0, 0, 0, time.UTC)}
	tokens := &tokenServer{clock: clock}
	runner, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	var engines engine.Registry
	engines.Register(s.engine)
	m, err := session.New(session.Config{Home: s.home, Engines: &engines, GitHubURL: gh.url, GitHubTokens: tokens.issue, Now: clock.Now, After: clock.After, RunnerPath: runner, Send: s.reports.send})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	socket := serveSocket(t, m, s.home)

	m.Start(start(firstID, "feat/12-panier"))
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateWaiting)

	opts := s.engine.Runs()[0].Options()
	if err := agentPush(t, opts, "panier.txt"); err != nil {
		t.Fatalf("the agent's push: %v", err)
	}
	if pushed := gh.pushed(); len(pushed) != 1 || pushed[0] != "ghs_1" {
		t.Fatalf("pushes with %q, want one with the Session's token ghs_1", pushed)
	}

	// 50 min later, 10 min left: renewed, unasked; the next push has it.
	waitFor(t, "the renewal's wait", func() bool { return clock.waiting() == 1 })
	clock.advance(49 * time.Minute)
	time.Sleep(20 * time.Millisecond)
	if n := tokens.count(); n != 1 {
		t.Fatalf("%d tokens asked at 49 min, want the first alone", n)
	}
	clock.advance(time.Minute)
	waitFor(t, "the token renewed at 50 min, unasked", func() bool { return tokens.count() == 2 })
	clock.advance(time.Minute)
	if err := agentPush(t, opts, "caisse.txt"); err != nil {
		t.Fatalf("the agent's push after the renewal: %v", err)
	}
	if pushed := gh.pushed(); len(pushed) != 2 || pushed[1] != "ghs_2" {
		t.Fatalf("pushes with %q, want the second with the renewed token ghs_2", pushed)
	}
	if head := git(t, filepath.Join(s.remote.root, "acme", "shop.git"), "log", "-1", "--format=%s", "feat/12-panier"); head != "caisse.txt" {
		t.Fatalf("the remote's branch is at %q, want the second push", head)
	}
	if strings.Join(tokens.asked, ",") != firstID+","+firstID {
		t.Fatalf("tokens asked for %q, want the Session's at its start then at its renewal", tokens.asked)
	}

	// No credential in any remote URL nor any file of the Runner's.
	if url := git(t, opts.Dir, "remote", "get-url", "origin"); url != gh.url+"/acme/shop.git" {
		t.Fatalf("the remote URL is %q", url)
	}
	_ = filepath.WalkDir(s.home, func(path string, d fs.DirEntry, err error) error {
		if err != nil || !d.Type().IsRegular() {
			return nil
		}
		if data, _ := os.ReadFile(path); strings.Contains(string(data), "ghs_") || strings.Contains(strings.ToLower(string(data)), "extraheader") {
			t.Errorf("%s holds a credential", path)
		}
		return nil
	})

	// The Session ended, its token is given no more.
	m.Stop(firstID)
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateStopped)
	if token, err := github.SessionTokenOf(context.Background(), socket, firstID); err == nil {
		t.Fatalf("a stopped Session's token: %q", token)
	}
}

func TestTheMoteursPathStartsWithTheSessionsGhAndMirrorShims(t *testing.T) {
	s := newSetup(t, question("q-1"))
	clock := &fakeClock{now: time.Now()}
	tokens := &tokenServer{clock: clock}
	var engines engine.Registry
	engines.Register(s.engine)
	m, err := session.New(session.Config{Home: s.home, Engines: &engines, GitHubURL: s.remote.url(), GitHubTokens: tokens.issue, RunnerPath: "/opt/crewdeck/crewdeck-runner", Send: s.reports.send})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)

	m.Start(start(firstID, "feat/12-panier"))
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateWaiting)

	opts := s.engine.Runs()[0].Options()
	bin := filepath.Join(s.home, "sessions", firstID, "bin")
	env := map[string]string{}
	for _, kv := range opts.Env {
		k, v, _ := strings.Cut(kv, "=")
		env[k] = v
	}
	if !strings.HasPrefix(env["PATH"], bin+string(os.PathListSeparator)) {
		t.Fatalf("PATH %q, want the Session's bin first", env["PATH"])
	}
	if env["GIT_ASKPASS"] != "/opt/crewdeck/crewdeck-runner" || env[github.AskpassSessionEnv] != firstID || env["GIT_TERMINAL_PROMPT"] != "0" {
		t.Fatalf("env %q, want git's askpass for the Session", opts.Env)
	}
	for name, want := range map[string]string{"gh": `'/opt/crewdeck/crewdeck-runner' gh -- "$@"`, "mirror": `'/opt/crewdeck/crewdeck-runner' miroir "$@"`} {
		shim := filepath.Join(bin, name)
		info, err := os.Stat(shim)
		if err != nil || info.Mode().Perm()&0o100 == 0 {
			t.Fatalf("the %s shim: %v, %v", name, info, err)
		}
		if data, _ := os.ReadFile(shim); !strings.Contains(string(data), "exec "+want) {
			t.Fatalf("the %s shim is %q, want it to exec %s", name, data, want)
		}
	}
}

func TestASessionWhoseProjetLostItsRepositoryEndsCloneFailed(t *testing.T) {
	s := newSetup(t, question("q-1"))
	var engines engine.Registry
	engines.Register(s.engine)
	noRepository := func(context.Context, string) (github.Issued, error) {
		return github.Issued{}, fmt.Errorf("the server: %w", github.ErrNoRepository)
	}
	m, err := session.New(session.Config{Home: s.home, Engines: &engines, GitHubURL: s.remote.url(), GitHubTokens: noRepository, Send: s.reports.send})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)

	m.Start(start(firstID, "feat/12-panier"))

	// Never on the machine's credentials: no clone, no Moteur.
	ended := s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)
	if ended.Error == nil || *ended.Error != contracts.RunnerSessionStateErrorCloneFailed || len(s.engine.Runs()) != 0 {
		t.Fatalf("ended %+v, want clone-failed before any Moteur", ended)
	}
	if _, err := os.Stat(filepath.Join(s.home, "sessions", firstID, "bin")); err == nil {
		t.Fatal("the shims of a Session that never ran were written")
	}
}

func TestASessionWhoseTokenIsRefusedEndsCloneFailed(t *testing.T) {
	s := newSetup(t, question("q-1"))
	var engines engine.Registry
	engines.Register(s.engine)
	refused := func(context.Context, string) (github.Issued, error) {
		return github.Issued{}, fmt.Errorf("github: the Session's token: 422 sessions.ended")
	}
	m, err := session.New(session.Config{Home: s.home, Engines: &engines, GitHubURL: s.remote.url(), GitHubTokens: refused, Send: s.reports.send})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)

	m.Start(start(firstID, "feat/12-panier"))

	ended := s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)
	if ended.Error == nil || *ended.Error != contracts.RunnerSessionStateErrorCloneFailed || len(s.engine.Runs()) != 0 {
		t.Fatalf("ended %+v, want clone-failed before any Moteur", ended)
	}
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); !ok(); {
		if time.Now().After(deadline) {
			t.Fatalf("never: %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}
