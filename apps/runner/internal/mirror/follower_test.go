package mirror

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github/githubtest"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
)

const (
	runnerToken = "rnr_test-token"
	messageID   = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a00"
	atelierID   = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01"
	outilsID    = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02"
	issuedToken = "ghs_miroir_7"
)

var (
	followedAtelier = Project{Repository: "acme/atelier", ProjectID: atelierID, GitHubRepoID: 101, InstallationID: 7, DisplayName: "Atelier", IntegrationBranch: "develop"}
	followedOutils  = Project{Repository: "acme/outils", ProjectID: outilsID, GitHubRepoID: 102, InstallationID: 7, DisplayName: "Outils", IntegrationBranch: "main"}
)

// fakeClock is the follower's time, moved by the test.
type fakeClock struct {
	mu     sync.Mutex
	now    time.Time
	timers []*fakeTimer
}

type fakeTimer struct {
	at      time.Time
	fired   chan time.Time
	stopped bool
}

func newClock() *fakeClock { return &fakeClock{now: now} }

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Timer(d time.Duration) (<-chan time.Time, func()) {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := &fakeTimer{at: c.now.Add(d), fired: make(chan time.Time, 1)}
	if d <= 0 {
		t.fired <- c.now
		return t.fired, func() {}
	}
	c.timers = append(c.timers, t)
	return t.fired, func() {
		c.mu.Lock()
		t.stopped = true
		c.mu.Unlock()
	}
}

// Advance moves the time by d and fires the timers due.
func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
	kept := c.timers[:0]
	for _, t := range c.timers {
		switch {
		case t.stopped:
		case !t.at.After(c.now):
			t.fired <- c.now
		default:
			kept = append(kept, t)
		}
	}
	c.timers = kept
}

// runnerServer is the server's side of the Runner's protocol: it reads each
// hello, accepts it, and answers each mirror.token with tokens, unless the
// test answers itself.
type runnerServer struct {
	t      *testing.T
	url    string
	clock  *fakeClock
	hellos chan contracts.RunnerHello

	mu      sync.Mutex
	conn    *websocket.Conn
	ctx     context.Context
	asked   int
	answer  func(n int) any // the answer to the nth mirror.token; nil sends none
	onHello func(conn *websocket.Conn)
	refuse  bool // refuse the connections, as a server out of reach
}

func newRunnerServer(t *testing.T, clock *fakeClock) *runnerServer {
	t.Helper()
	s := &runnerServer{t: t, clock: clock, hellos: make(chan contracts.RunnerHello, 16)}
	s.answer = func(int) any { return s.issued(clock.Now().Add(time.Hour)) }
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		refuse := s.refuse
		s.mu.Unlock()
		if refuse || r.Header.Get("Authorization") != "Bearer "+runnerToken {
			http.Error(w, "refused", http.StatusBadRequest)
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		ctx := r.Context()
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var hello contracts.RunnerHello
		if err := json.Unmarshal(data, &hello); err != nil {
			t.Errorf("hello: %v", err)
			return
		}
		write(ctx, conn, stamp(protocol.TypeHelloAccepted, map[string]any{"runnerId": messageID, "protocolVersion": contracts.ProtocolVersion}))
		s.mu.Lock()
		s.conn, s.ctx = conn, ctx
		onHello := s.onHello
		s.mu.Unlock()
		s.hellos <- hello
		if onHello != nil {
			onHello(conn)
		}
		for {
			_, data, err := conn.Read(ctx)
			if err != nil {
				return
			}
			var m struct{ Type string }
			_ = json.Unmarshal(data, &m)
			if m.Type != protocol.TypeMirrorToken {
				continue
			}
			s.mu.Lock()
			s.asked++
			n, answer := s.asked, s.answer
			s.mu.Unlock()
			if reply := answer(n); reply != nil {
				write(ctx, conn, reply)
			}
		}
	}))
	t.Cleanup(srv.Close)
	s.url = srv.URL
	return s
}

func write(ctx context.Context, conn *websocket.Conn, message any) {
	data, _ := json.Marshal(message)
	_ = conn.Write(ctx, websocket.MessageText, data)
}

func stamp(typ string, fields map[string]any) map[string]any {
	m := map[string]any{"type": typ, "id": messageID, "at": now.Format(time.RFC3339Nano)}
	for k, v := range fields {
		m[k] = v
	}
	return m
}

func (s *runnerServer) issued(expiresAt time.Time) any {
	return stamp(protocol.TypeMirrorTokenIssued, map[string]any{"tokens": []any{map[string]any{
		"installationId": 7, "token": issuedToken, "expiresAt": expiresAt.Format(time.RFC3339), "repositories": []string{"acme/atelier", "acme/outils"},
	}}})
}

// send sends message on the current connection.
func (s *runnerServer) send(message any) {
	s.t.Helper()
	s.mu.Lock()
	conn, ctx := s.conn, s.ctx
	s.mu.Unlock()
	if conn == nil {
		s.t.Fatal("no connection")
	}
	write(ctx, conn, message)
}

// drop closes the current connection, without a close frame.
func (s *runnerServer) drop() {
	s.mu.Lock()
	conn := s.conn
	s.conn = nil
	s.mu.Unlock()
	if conn != nil {
		conn.CloseNow()
	}
}

func (s *runnerServer) set(fn func(s *runnerServer)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(s)
}

// sendLive makes each connection's replay end at once with mirror.live { seq }.
func (s *runnerServer) sendLive(seq int) {
	s.set(func(s *runnerServer) {
		s.onHello = func(conn *websocket.Conn) {
			write(context.Background(), conn, stamp(protocol.TypeMirrorLive, map[string]any{"seq": seq}))
		}
	})
}

func (s *runnerServer) tokensAsked() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.asked
}

func (s *runnerServer) awaitHello() contracts.RunnerHello {
	s.t.Helper()
	select {
	case hello := <-s.hellos:
		return hello
	case <-time.After(5 * time.Second):
		s.t.Fatal("no hello")
		return contracts.RunnerHello{}
	}
}

func changed(seq int, project Project, kind string, number any, sha any) any {
	return stamp(protocol.TypeGitHubChanged, map[string]any{"change": map[string]any{
		"seq": seq, "projectId": project.ProjectID, "repository": project.Repository, "kind": kind,
		"action": nil, "number": number, "ref": nil, "sha": sha, "at": now.Format(time.RFC3339),
	}})
}

func mirrorProjects(projects ...Project) any {
	list := []any{}
	for _, p := range projects {
		list = append(list, map[string]any{"projectId": p.ProjectID, "repository": p.Repository, "githubRepoId": p.GitHubRepoID,
			"installationId": p.InstallationID, "displayName": p.DisplayName, "integrationBranch": p.IntegrationBranch,
			"sources": map[string]any{"ticket": "github", "code": "github"}, "nameSealed": nil})
	}
	return stamp(protocol.TypeMirrorProjects, map[string]any{"projects": list})
}

// follow runs a follower of store, and its client, until the test ends or stop is called.
func follow(t *testing.T, store *Store, fake *githubtest.Server, server *runnerServer) (f *Follower, stop func()) {
	t.Helper()
	return followThrough(t, store, fake, server, nil)
}

// followThrough is follow, GitHub reached through transport (nil for the default).
func followThrough(t *testing.T, store *Store, fake *githubtest.Server, server *runnerServer, transport http.RoundTripper) (f *Follower, stop func()) {
	t.Helper()
	client := &Client{BaseURL: fake.URL, Logger: testLogger}
	if transport != nil {
		client.HTTP = &http.Client{Transport: transport, Timeout: 10 * time.Second}
	}
	f, err := NewFollower(FollowerConfig{Store: store, GitHub: client, Logger: testLogger, Clock: server.clock,
		Backoff: protocol.Backoff{Min: time.Second, Max: 4 * time.Second, Rand: func() float64 { return 0.999999 }}})
	if err != nil {
		t.Fatalf("NewFollower: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	pc := f.NewClient(protocol.Config{
		Server:  server.url,
		Token:   runnerToken,
		Machine: protocol.Machine{RunnerVersion: "0.1.0", Machine: "atelier", OS: contracts.RunnerHelloOsLinux, Arch: contracts.RunnerHelloArchAmd64},
		Logger:  testLogger,
		Backoff: protocol.Backoff{Min: 10 * time.Millisecond, Max: 20 * time.Millisecond},
	})
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); _ = pc.Run(ctx) }()
	go func() { defer wg.Done(); _ = f.Run(ctx) }()
	var once sync.Once
	stop = func() {
		once.Do(func() {
			cancel()
			wg.Wait()
		})
	}
	t.Cleanup(stop)
	return f, stop
}

// followed is a store of the Projets, with the cursor (none if negative).
func followedStore(t *testing.T, cursor int64, projects ...Project) (*Store, string) {
	t.Helper()
	store, path := openStore(t)
	if err := store.PutProjects(projects); err != nil {
		t.Fatal(err)
	}
	if cursor >= 0 {
		if err := store.Update(func(tx *sql.Tx) error { return SetMeta(tx, MetaMirrorAfter, itoa(cursor)) }); err != nil {
			t.Fatal(err)
		}
	}
	return store, path
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

// eventually waits until ok holds.
func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("never: %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func cursorOf(t *testing.T, store *Store) any {
	t.Helper()
	cursor, err := store.Cursor()
	if err != nil {
		t.Fatal(err)
	}
	if cursor == nil {
		return nil
	}
	return *cursor
}

func awaitCursor(t *testing.T, store *Store, want int64) {
	t.Helper()
	eventually(t, "the cursor at "+itoa(want), func() bool { return cursorOf(t, store) == want })
}

// awaitFilled waits for the start's reconciliations.
func awaitFilled(t *testing.T, path string, n int64) {
	t.Helper()
	eventually(t, "the Projets filled", func() bool {
		return count(t, path, "SELECT count(*) FROM projects WHERE filled_at IS NOT NULL") == n
	})
}

func objectsFetched(fake *githubtest.Server) []any {
	var numbers []any
	for _, call := range fake.Calls() {
		if call.Operation == "MirrorObject" {
			numbers = append(numbers, call.Variables["number"])
		}
	}
	return numbers
}

func TestEachHelloCarriesTheCursorWhichTheAppliedEnvelopesMove(t *testing.T) {
	clock := newClock()
	server := newRunnerServer(t, clock)
	fake := newFake(t, "testdata/graphql")
	store, path := followedStore(t, 3, followedAtelier)

	_, stop := follow(t, store, fake, server)
	if hello := server.awaitHello(); hello.MirrorAfter != float64(3) {
		t.Fatalf("mirrorAfter %v, want 3", hello.MirrorAfter)
	}
	awaitFilled(t, path, 1)
	server.send(changed(4, followedAtelier, "issue", 38, nil))
	server.send(changed(5, followedAtelier, "issue", 40, nil))
	awaitCursor(t, store, 5)
	stop()

	follow(t, store, fake, server)
	if hello := server.awaitHello(); hello.MirrorAfter != float64(5) {
		t.Errorf("after a restart, mirrorAfter %v, want 5", hello.MirrorAfter)
	}
}

// advanceUntil moves the clock by step until ok holds, and says by how much.
func advanceUntil(t *testing.T, clock *fakeClock, step time.Duration, what string, ok func() bool) time.Duration {
	t.Helper()
	var moved time.Duration
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("never: %s (the clock moved %s)", what, moved)
		}
		clock.Advance(step)
		moved += step
		time.Sleep(5 * time.Millisecond)
	}
	return moved
}

func TestEachEnvelopeFetchesWhatItNamesWithTheMiroirsToken(t *testing.T) {
	clock := newClock()
	server := newRunnerServer(t, clock)
	fake := newFake(t, "testdata/graphql")
	store, path := followedStore(t, 0, followedAtelier)
	follow(t, store, fake, server)
	server.awaitHello()
	awaitFilled(t, path, 1)
	fake.Reset()

	server.send(changed(1, followedAtelier, "issue", 38, nil))
	server.send(changed(2, followedAtelier, "pull", 45, nil))
	server.send(changed(3, followedAtelier, "check", nil, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"))
	// A commit no PR of the copy has: nothing to fetch.
	server.send(changed(4, followedAtelier, "check", nil, "ffffffffffffffffffffffffffffffffffffffff"))
	server.send(changed(5, followedAtelier, "label", nil, nil))
	server.send(changed(6, followedAtelier, "push", nil, nil))
	awaitCursor(t, store, 6)

	if fetched := objectsFetched(fake); len(fetched) != 2 || fetched[0] != float64(38) || fetched[1] != float64(45) {
		t.Errorf("objects fetched %v, want 38 then 45", fetched)
	}
	var checked []any
	for _, call := range fake.Calls() {
		if call.Operation == "MirrorChecks" {
			checked = append(checked, call.Variables["oid"])
		}
		if call.Authorization != "bearer "+issuedToken {
			t.Errorf("%s with %q, want the « Miroir » token", call.Operation, call.Authorization)
		}
	}
	if len(checked) != 2 {
		t.Errorf("checks fetched for %v, want the PR's head then the check's commit", checked)
	}
	for _, op := range []string{"MirrorLabels", "MirrorMilestones", "MirrorReleases"} {
		if n := fake.Count(op); n != 1 {
			t.Errorf("%d %s, want 1", n, op)
		}
	}
	// A check envelope leaves the rollup to the next walk.
	assertRows(t, path, "SELECT state FROM checks_read WHERE sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'", [][]any{{nil}})
}

func TestAnEnvelopeOfAnObjectGoneDeletesItAndCountsAsApplied(t *testing.T) {
	clock := newClock()
	server := newRunnerServer(t, clock)
	fake := newFake(t, "testdata/graphql")
	store, path := followedStore(t, 0, followedAtelier)
	follow(t, store, fake, server)
	server.awaitHello()
	awaitFilled(t, path, 1)
	fake.Reply("MirrorObject", map[string]any{"owner": "acme", "name": "atelier", "number": 39}, map[string]any{"repository": map[string]any{"issueOrPullRequest": nil}})

	server.send(changed(1, followedAtelier, "issue", 39, nil))
	awaitCursor(t, store, 1)
	if n := count(t, path, "SELECT count(*) FROM issues WHERE number = 39"); n != 0 {
		t.Error("#39 survived its deletion")
	}
}

func TestAnEnvelopeReceivedTwiceIsAppliedOnce(t *testing.T) {
	clock := newClock()
	server := newRunnerServer(t, clock)
	fake := newFake(t, "testdata/graphql")
	store, path := followedStore(t, 0, followedAtelier)
	follow(t, store, fake, server)
	server.awaitHello()
	awaitFilled(t, path, 1)
	fake.Reset()

	server.send(changed(1, followedAtelier, "issue", 38, nil))
	server.send(changed(1, followedAtelier, "issue", 38, nil))
	server.send(changed(2, followedAtelier, "issue", 40, nil))
	awaitCursor(t, store, 2)
	if fetched := objectsFetched(fake); len(fetched) != 2 {
		t.Errorf("objects fetched %v, want 38 once then 40", fetched)
	}
}

func TestARateLimitHoldsItsProjetUntilRetryAtWhileTheOtherGoesOn(t *testing.T) {
	clock := newClock()
	server := newRunnerServer(t, clock)
	fake := newFake(t, "testdata/graphql", "testdata/outils")
	store, path := followedStore(t, 0, followedAtelier, followedOutils)
	follow(t, store, fake, server)
	server.awaitHello()
	awaitFilled(t, path, 2)
	fake.Reset()

	retryAt := clock.Now().Add(10 * time.Minute)
	fake.Fail("MirrorObject", githubtest.RateLimited(retryAt), 1)
	server.send(changed(1, followedAtelier, "issue", 38, nil))
	eventually(t, "#38 refused", func() bool { return fake.Count("MirrorObject") == 1 })
	server.send(changed(2, followedOutils, "issue", 3, nil))
	server.send(changed(3, followedAtelier, "issue", 40, nil))
	eventually(t, "outils's envelope applied", func() bool {
		return len(query(t, path, "SELECT value FROM meta WHERE key = 'mirror_applied' AND value = '2'")) == 1
	})
	time.Sleep(50 * time.Millisecond)
	if fetched := objectsFetched(fake); len(fetched) != 2 || fetched[1] != float64(3) {
		t.Errorf("objects fetched %v, want #38 refused then outils's #3 only", fetched)
	}
	if cursor := cursorOf(t, store); cursor != int64(0) {
		t.Errorf("cursor %v passed the held envelope", cursor)
	}

	clock.Advance(time.Minute)
	time.Sleep(50 * time.Millisecond)
	if n := len(objectsFetched(fake)); n != 2 {
		t.Errorf("%d objects fetched before RetryAt, want 2", n)
	}
	clock.Advance(10 * time.Minute)
	awaitCursor(t, store, 3)
	if fetched := objectsFetched(fake); len(fetched) != 4 || fetched[2] != float64(38) || fetched[3] != float64(40) {
		t.Errorf("objects fetched %v, want #38 then #40 after RetryAt", fetched)
	}
	assertRows(t, path, "SELECT value FROM meta WHERE key = 'mirror_applied'", [][]any{{""}})
	// One line per envelope applied or failed, by its repository, kind, number, seq, duration and class.
	for _, line := range []string{
		`"msg":"mirror envelope failed","repository":"acme/atelier","kind":"issue","number":38,"seq":1,"duration_ms":0,"class":"limited"`,
		`"msg":"mirror envelope applied","repository":"acme/outils","kind":"issue","number":3,"seq":2,"duration_ms":0`,
	} {
		if !strings.Contains(logs.String(), line) {
			t.Errorf("the log lacks %s", line)
		}
	}
}

func TestAFailedFetchIsRetriedAfterTheBackoff(t *testing.T) {
	clock := newClock()
	server := newRunnerServer(t, clock)
	fake := newFake(t, "testdata/graphql")
	store, path := followedStore(t, 0, followedAtelier)
	follow(t, store, fake, server)
	server.awaitHello()
	awaitFilled(t, path, 1)
	fake.Reset()

	fake.Fail("MirrorObject", githubtest.BadGateway(), 2)
	server.send(changed(1, followedAtelier, "issue", 38, nil))
	eventually(t, "#38 refused", func() bool { return fake.Count("MirrorObject") == 1 })
	// 1 s, then 2 s.
	waited := advanceUntil(t, clock, 100*time.Millisecond, "#38 applied", func() bool { return cursorOf(t, store) == int64(1) })
	if waited < 3*time.Second-200*time.Millisecond {
		t.Errorf("applied after %s, want the backoff's 1 s then 2 s", waited)
	}
}

func TestAResyncReconcilesEveryProjetThenFollowsLive(t *testing.T) {
	clock := newClock()
	server := newRunnerServer(t, clock)
	fake := newFake(t, "testdata/graphql", "testdata/outils")
	store, path := followedStore(t, 5, followedAtelier, followedOutils)
	// outils's reconciliation fails until its walk answers again.
	fake.ReplyErrors("MirrorIssues", map[string]any{"owner": "acme", "name": "outils", "after": nil}, []any{map[string]any{"type": "INTERNAL", "message": "Erreur interne"}})
	server.set(func(s *runnerServer) {
		s.onHello = func(conn *websocket.Conn) {
			ctx := context.Background()
			write(ctx, conn, stamp(protocol.TypeMirrorResync, nil))
			write(ctx, conn, stamp(protocol.TypeMirrorLive, map[string]any{"seq": 9}))
			write(ctx, conn, changed(10, followedAtelier, "issue", 38, nil))
		}
	})
	follow(t, store, fake, server)
	server.awaitHello()
	eventually(t, "atelier reconciled", func() bool {
		return count(t, path, "SELECT count(*) FROM projects WHERE repository = 'acme/atelier' AND filled_at IS NOT NULL") == 1
	})
	time.Sleep(50 * time.Millisecond)
	if cursor := cursorOf(t, store); cursor != int64(5) {
		t.Errorf("cursor %v before every reconciliation finished, want 5", cursor)
	}
	// atelier's live envelope waits for the resync's end.
	if fetched := objectsFetched(fake); len(fetched) != 5 {
		t.Errorf("objects fetched %v, want the reconciliation's 5 only", fetched)
	}

	fake.Load("testdata/outils")
	advanceUntil(t, clock, 500*time.Millisecond, "outils reconciled", func() bool {
		return count(t, path, "SELECT count(*) FROM projects WHERE filled_at IS NOT NULL") == 2
	})
	awaitCursor(t, store, 10)
	if fetched := objectsFetched(fake); len(fetched) != 7 || fetched[6] != float64(38) {
		t.Errorf("objects fetched %v, want the reconciliations' then the live envelope's #38", fetched)
	}
}

func TestTheTokenIsAskedAfterEachHelloAndMirrorProjectsAndRenewedBeforeItsExpiry(t *testing.T) {
	clock := newClock()
	server := newRunnerServer(t, clock)
	fake := newFake(t, "testdata/graphql", "testdata/outils")
	store, path := followedStore(t, 0, followedAtelier)
	follow(t, store, fake, server)
	server.awaitHello()
	eventually(t, "the token asked after hello.accepted", func() bool { return server.tokensAsked() == 1 })
	awaitFilled(t, path, 1)

	server.send(mirrorProjects(followedAtelier, followedOutils))
	eventually(t, "the token asked after mirror.projects", func() bool { return server.tokensAsked() == 2 })
	// The new Projet starts unfilled and gets its reconciliation.
	awaitFilled(t, path, 2)

	// Issued at +0 for an hour: renewed at +50 min.
	time.Sleep(50 * time.Millisecond)
	clock.Advance(49 * time.Minute)
	time.Sleep(50 * time.Millisecond)
	if n := server.tokensAsked(); n != 2 {
		t.Errorf("%d tokens asked 11 min before the expiry, want 2", n)
	}
	clock.Advance(time.Minute)
	eventually(t, "the token renewed 10 min before its expiry", func() bool { return server.tokensAsked() == 3 })

	// The connection drops: the next hello asks it again.
	server.drop()
	server.awaitHello()
	eventually(t, "the token asked after a new hello.accepted", func() bool { return server.tokensAsked() == 4 })
}

func TestAFailedOrUnansweredTokenRequestIsRetriedAfterTheBackoff(t *testing.T) {
	clock := newClock()
	server := newRunnerServer(t, clock)
	fake := newFake(t, "testdata/graphql")
	store, path := followedStore(t, 0, followedAtelier)
	issued := server.answer
	server.set(func(s *runnerServer) {
		s.answer = func(n int) any {
			switch n {
			case 1:
				return stamp(protocol.TypeMirrorTokenFailed, map[string]any{"code": "github_unavailable"})
			case 2:
				return nil // no answer
			}
			return issued(n)
		}
	})
	follow(t, store, fake, server)
	server.awaitHello()
	eventually(t, "the token asked", func() bool { return server.tokensAsked() == 1 })
	// Nothing read GitHub without a token.
	time.Sleep(50 * time.Millisecond)
	if n := len(fake.Calls()); n != 0 {
		t.Errorf("%d calls to GitHub without a token", n)
	}
	waited := advanceUntil(t, clock, 100*time.Millisecond, "the failure retried", func() bool { return server.tokensAsked() == 2 })
	if waited < 900*time.Millisecond {
		t.Errorf("retried after %s, want the backoff's 1 s", waited)
	}
	waited = advanceUntil(t, clock, time.Second, "the unanswered request retried", func() bool { return server.tokensAsked() == 3 })
	if waited < TokenTimeout {
		t.Errorf("retried after %s, want %s and the backoff", waited, TokenTimeout)
	}
	awaitFilled(t, path, 1)
}

func TestAProjetsFreshnessFollowsItsCopy(t *testing.T) {
	clock := newClock()
	server := newRunnerServer(t, clock)
	fake := newFake(t, "testdata/graphql")
	store, path := followedStore(t, 0, followedAtelier)
	server.sendLive(0)
	server.set(func(s *runnerServer) { s.answer = func(int) any { return nil } })
	f, _ := follow(t, store, fake, server)
	server.awaitHello()

	state := func() Freshness {
		t.Helper()
		freshness, err := f.State("acme/atelier")
		if err != nil {
			t.Fatal(err)
		}
		return freshness
	}
	if got := state(); got.State != FreshnessFilling || !got.SyncedAt.IsZero() {
		t.Errorf("before its first reconciliation: %+v, want filling", got)
	}
	if _, err := f.State("acme/inconnu"); !errors.Is(err, ErrNotAProject) {
		t.Errorf("State of a repository no Projet's = %v, want ErrNotAProject", err)
	}

	server.send(server.issued(clock.Now().Add(time.Hour)))
	awaitFilled(t, path, 1)
	eventually(t, "live", func() bool { return state().State == FreshnessLive })
	if got := state(); !got.SyncedAt.Equal(now) {
		t.Errorf("syncedAt %v, want the reconciliation's %v", got.SyncedAt, now)
	}

	// An envelope waits behind a rate limit: late, since the reconciliation.
	clock.Advance(time.Minute)
	fake.Fail("MirrorObject", githubtest.RateLimited(clock.Now().Add(time.Hour)), 1)
	server.send(changed(1, followedAtelier, "issue", 38, nil))
	eventually(t, "late while the envelope waits", func() bool { return state().State == FreshnessLate })
	if got := state(); !got.SyncedAt.Equal(now) {
		t.Errorf("syncedAt %v, want %v", got.SyncedAt, now)
	}
	clock.Advance(time.Hour)
	awaitCursor(t, store, 1)
	eventually(t, "live once applied", func() bool { return state().State == FreshnessLive })
	if got := state(); !got.SyncedAt.Equal(now.Add(61 * time.Minute)) {
		t.Errorf("syncedAt %v, want the envelope's", got.SyncedAt)
	}
	assertRows(t, path, "SELECT synced_at FROM projects", [][]any{{"2026-11-12T11:01:00Z"}})

	// The socket closes, and the server stays out of reach.
	server.set(func(s *runnerServer) { s.refuse = true })
	server.drop()
	eventually(t, "late once disconnected", func() bool { return state().State == FreshnessLate })
}

func TestTheReconciliationRunsAtStartAndEvery15MinutesAndCatchesALostEnvelope(t *testing.T) {
	clock := newClock()
	server := newRunnerServer(t, clock)
	fake := newFake(t, "testdata/graphql")
	store, path := followedStore(t, 0, followedAtelier)
	follow(t, store, fake, server)
	server.awaitHello()
	awaitFilled(t, path, 1)

	// #38 edited on GitHub, its envelope lost.
	fake.Load("testdata/changed")
	fake.Reset()
	time.Sleep(50 * time.Millisecond)
	clock.Advance(14 * time.Minute)
	time.Sleep(50 * time.Millisecond)
	if n := fake.Count("MirrorIssues"); n != 0 {
		t.Errorf("reconciled after 14 min (%d walks)", n)
	}
	clock.Advance(time.Minute)
	eventually(t, "#38 caught", func() bool {
		rows := query(t, path, "SELECT title FROM issues WHERE number = 38")
		return len(rows) == 1 && rows[0][0] == "Le store du Miroir, revu"
	})
	eventually(t, "synced at +15 min", func() bool {
		rows := query(t, path, "SELECT synced_at FROM projects")
		return len(rows) == 1 && rows[0][0] == "2026-11-12T10:15:00Z"
	})
}

func TestMirrorProjectsRemovesAProjetNoLongerFollowed(t *testing.T) {
	clock := newClock()
	server := newRunnerServer(t, clock)
	fake := newFake(t, "testdata/graphql", "testdata/outils")
	store, path := followedStore(t, 0, followedAtelier, followedOutils)
	f, _ := follow(t, store, fake, server)
	server.awaitHello()
	awaitFilled(t, path, 2)

	server.send(mirrorProjects(followedOutils))
	eventually(t, "atelier removed", func() bool {
		return count(t, path, "SELECT count(*) FROM issues WHERE repository = 'acme/atelier'") == 0
	})
	if _, err := f.State("acme/atelier"); !errors.Is(err, ErrNotAProject) {
		t.Errorf("State of a removed Projet = %v, want ErrNotAProject", err)
	}
	// Its envelopes count as applied.
	fake.Reset()
	server.send(changed(1, followedAtelier, "issue", 38, nil))
	server.send(changed(2, followedOutils, "issue", 3, nil))
	awaitCursor(t, store, 2)
	if fetched := objectsFetched(fake); len(fetched) != 1 || fetched[0] != float64(3) {
		t.Errorf("objects fetched %v, want outils's #3 only", fetched)
	}
}

func TestAResyncAdoptsTheServersSeqEvenBelowTheStoredCursor(t *testing.T) {
	clock := newClock()
	server := newRunnerServer(t, clock)
	fake := newFake(t, "testdata/graphql")
	// A cursor of another server, ahead of this one's counter.
	store, path := followedStore(t, 100, followedAtelier)
	server.set(func(s *runnerServer) {
		s.onHello = func(conn *websocket.Conn) {
			ctx := context.Background()
			write(ctx, conn, stamp(protocol.TypeMirrorResync, nil))
			write(ctx, conn, stamp(protocol.TypeMirrorLive, map[string]any{"seq": 5}))
			write(ctx, conn, changed(6, followedAtelier, "issue", 38, nil))
		}
	})
	f, stop := follow(t, store, fake, server)
	if hello := server.awaitHello(); hello.MirrorAfter != float64(100) {
		t.Fatalf("mirrorAfter %v, want 100", hello.MirrorAfter)
	}
	awaitFilled(t, path, 1)
	awaitCursor(t, store, 6)
	if fetched := objectsFetched(fake); len(fetched) != 6 || fetched[5] != float64(38) {
		t.Errorf("objects fetched %v, want the reconciliation's then the live envelope's #38", fetched)
	}
	// The envelopes after it are this server's, applied too.
	server.send(changed(7, followedAtelier, "issue", 40, nil))
	awaitCursor(t, store, 7)
	eventually(t, "live", func() bool {
		freshness, err := f.State("acme/atelier")
		return err == nil && freshness.State == FreshnessLive
	})
	stop()

	server.set(func(s *runnerServer) { s.onHello = nil })
	follow(t, store, fake, server)
	if hello := server.awaitHello(); hello.MirrorAfter != float64(7) {
		t.Errorf("after a restart, mirrorAfter %v, want 7", hello.MirrorAfter)
	}
}

// heldObject holds GitHub's answer to the first MirrorObject of number once
// armed, until released.
type heldObject struct {
	number   int
	armed    atomic.Bool
	held     chan struct{}
	released chan struct{}
}

func holdObject(number int) *heldObject {
	return &heldObject{number: number, held: make(chan struct{}, 1), released: make(chan struct{})}
}

func (h *heldObject) RoundTrip(r *http.Request) (*http.Response, error) {
	body, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(bytes.NewReader(body))
	var request struct {
		OperationName string `json:"operationName"`
		Variables     struct {
			Number int `json:"number"`
		} `json:"variables"`
	}
	if json.Unmarshal(body, &request) == nil && request.OperationName == "MirrorObject" && request.Variables.Number == h.number && h.armed.CompareAndSwap(true, false) {
		h.held <- struct{}{}
		<-h.released
	}
	return http.DefaultTransport.RoundTrip(r)
}

func (h *heldObject) await(t *testing.T) {
	t.Helper()
	select {
	case <-h.held:
	case <-time.After(5 * time.Second):
		t.Fatalf("#%d never fetched", h.number)
	}
}

func TestMirrorProjectsWhileAnEnvelopeIsAppliedChangesNothingOfIt(t *testing.T) {
	clock := newClock()
	server := newRunnerServer(t, clock)
	fake := newFake(t, "testdata/graphql")
	store, path := followedStore(t, 0, followedAtelier)
	hold := holdObject(38)
	followThrough(t, store, fake, server, hold)
	server.awaitHello()
	awaitFilled(t, path, 1)

	hold.armed.Store(true)
	server.send(changed(1, followedAtelier, "issue", 38, nil))
	hold.await(t)
	// The Projet renamed while its envelope is fetched.
	renamed := followedAtelier
	renamed.DisplayName = "Atelier renommé"
	asked := server.tokensAsked()
	server.send(mirrorProjects(renamed))
	eventually(t, "mirror.projects handled", func() bool { return server.tokensAsked() > asked })
	close(hold.released)
	awaitCursor(t, store, 1)
	assertRows(t, path, "SELECT display_name FROM projects", [][]any{{"Atelier renommé"}})
}

func TestAnEnvelopeOfTheServerBeforeAResyncMovesNoCursorOfTheNext(t *testing.T) {
	clock := newClock()
	server := newRunnerServer(t, clock)
	fake := newFake(t, "testdata/graphql")
	store, path := followedStore(t, 100, followedAtelier)
	hold := holdObject(38)
	followThrough(t, store, fake, server, hold)
	server.awaitHello()
	awaitFilled(t, path, 1)

	// 101 is fetched when the server changes: the next one's counter is at 5.
	hold.armed.Store(true)
	server.send(changed(101, followedAtelier, "issue", 38, nil))
	hold.await(t)
	server.send(stamp(protocol.TypeMirrorResync, nil))
	server.send(stamp(protocol.TypeMirrorLive, map[string]any{"seq": 5}))
	// Handled in order: once mirror.projects is, so are the resync and its live.
	asked := server.tokensAsked()
	server.send(mirrorProjects(followedAtelier))
	eventually(t, "mirror.projects handled", func() bool { return server.tokensAsked() > asked })
	close(hold.released)
	awaitCursor(t, store, 5)

	// The next server's own 101 is applied, not taken for the one before.
	fetched := len(objectsFetched(fake))
	for seq := 6; seq <= 101; seq++ {
		server.send(changed(seq, followedAtelier, "issue", 40, nil))
	}
	awaitCursor(t, store, 101)
	if got := len(objectsFetched(fake)) - fetched; got != 96 {
		t.Errorf("%d envelopes fetched after the resync, want 96", got)
	}
}
