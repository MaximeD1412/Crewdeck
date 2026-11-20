package github_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
)

// clock is a fake clock the tests move.
type clock struct {
	mu      sync.Mutex
	now     time.Time
	waiters []waiter
}

type waiter struct {
	at time.Time
	ch chan time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

// After fires once the clock is moved to now+d.
func (c *clock) After(d time.Duration) <-chan time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch := make(chan time.Time, 1)
	if d <= 0 {
		ch <- c.now
		return ch
	}
	c.waiters = append(c.waiters, waiter{c.now.Add(d), ch})
	return ch
}

func (c *clock) advance(d time.Duration) {
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

// awaitWaiting waits for someone to wait on the clock.
func (c *clock) awaitWaiting(t *testing.T) {
	t.Helper()
	eventually(t, "a wait on the clock", func() bool {
		c.mu.Lock()
		defer c.mu.Unlock()
		return len(c.waiters) == 1
	})
}

func eventually(t *testing.T, what string, ok func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); !ok(); {
		if time.Now().After(deadline) {
			t.Fatalf("never: %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// issuer gives a new token valid 1 h at each call, as the server does.
type issuer struct {
	clock    *clock
	mu       sync.Mutex
	calls    int
	attempts int
	fail     error
}

func (i *issuer) counts() (calls, attempts int) {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.calls, i.attempts
}

func (i *issuer) fetch(context.Context) (github.Issued, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.attempts++
	if i.fail != nil {
		return github.Issued{}, i.fail
	}
	i.calls++
	return github.Issued{Token: fmt.Sprintf("ghs_%d", i.calls), ExpiresAt: i.clock.Now().Add(time.Hour)}, nil
}

func TestASessionTokenRenewsItselfTenMinutesBeforeItExpiresWithoutBeingAsked(t *testing.T) {
	c := &clock{now: time.Date(2026, 11, 19, 10, 0, 0, 0, time.UTC)}
	i := &issuer{clock: c}
	tokens := &github.SessionToken{Fetch: i.fetch, Now: c.Now, After: c.After}
	ctx := context.Background()
	if _, err := tokens.Token(ctx); err != nil {
		t.Fatal(err)
	}
	kept := make(chan struct{})
	go func() { tokens.Keep(ctx); close(kept) }()

	c.awaitWaiting(t)
	c.advance(49 * time.Minute)
	time.Sleep(20 * time.Millisecond)
	if calls, _ := i.counts(); calls != 1 {
		t.Fatalf("%d tokens fetched at 49 min, want the first alone", calls)
	}
	c.advance(time.Minute)
	eventually(t, "renewed at 50 min, unasked", func() bool { calls, _ := i.counts(); return calls == 2 })

	// The server out of reach at the next renewal: retried every minute.
	c.awaitWaiting(t)
	i.mu.Lock()
	i.fail = errors.New("the server is out of reach")
	i.mu.Unlock()
	c.advance(50 * time.Minute)
	eventually(t, "a renewal tried", func() bool { _, attempts := i.counts(); return attempts == 3 })
	c.awaitWaiting(t)
	c.advance(github.RenewRetry)
	eventually(t, "the renewal retried", func() bool { _, attempts := i.counts(); return attempts == 4 })
	if token, err := tokens.Token(ctx); err != nil || token != "ghs_2" {
		t.Fatalf("Token while the renewal fails: %q, %v, want the valid ghs_2", token, err)
	}
	c.awaitWaiting(t)
	i.mu.Lock()
	i.fail = nil
	i.mu.Unlock()
	c.advance(github.RenewRetry)
	eventually(t, "renewed once the server answers", func() bool { calls, _ := i.counts(); return calls == 3 })
	c.awaitWaiting(t)
	if token, err := tokens.Token(ctx); err != nil || token != "ghs_3" {
		t.Fatalf("Token after the renewal: %q, %v, want ghs_3", token, err)
	}

	// The Session ends: the renewals stop.
	tokens.End()
	select {
	case <-kept:
	case <-time.After(5 * time.Second):
		t.Fatal("Keep still runs after End")
	}
}

func TestASessionTokenIsFetchedOnceThenRenewedTenMinutesBeforeItExpires(t *testing.T) {
	c := &clock{now: time.Date(2026, 11, 19, 10, 0, 0, 0, time.UTC)}
	i := &issuer{clock: c}
	tokens := &github.SessionToken{Fetch: i.fetch, Now: c.Now}
	ctx := context.Background()

	first, err := tokens.Token(ctx)
	if err != nil || first != "ghs_1" {
		t.Fatalf("Token() = %q, %v, want ghs_1", first, err)
	}
	c.advance(49 * time.Minute)
	if again, _ := tokens.Token(ctx); again != "ghs_1" || i.calls != 1 {
		t.Fatalf("at 49 min: %q after %d fetches, want the same token, cached", again, i.calls)
	}
	c.advance(time.Minute + time.Second)
	if renewed, _ := tokens.Token(ctx); renewed != "ghs_2" {
		t.Fatalf("at 50 min: %q, want a renewed token", renewed)
	}
	if i.calls != 2 {
		t.Fatalf("%d fetches, want 2", i.calls)
	}
}

func TestASessionTokenWhoseRenewalFailsKeepsTheOneNotExpiredThenFails(t *testing.T) {
	c := &clock{now: time.Date(2026, 11, 19, 10, 0, 0, 0, time.UTC)}
	i := &issuer{clock: c}
	tokens := &github.SessionToken{Fetch: i.fetch, Now: c.Now}
	ctx := context.Background()
	if _, err := tokens.Token(ctx); err != nil {
		t.Fatal(err)
	}

	i.fail = errors.New("the server is away")
	c.advance(55 * time.Minute)
	if token, err := tokens.Token(ctx); err != nil || token != "ghs_1" {
		t.Fatalf("renewal failed before expiry: %q, %v, want the current token", token, err)
	}
	c.advance(5 * time.Minute)
	if token, err := tokens.Token(ctx); err == nil {
		t.Fatalf("renewal failed after expiry: %q, want an error", token)
	}
}

func TestAnEndedSessionTokenGivesNoTokenAgain(t *testing.T) {
	c := &clock{now: time.Now()}
	i := &issuer{clock: c}
	tokens := &github.SessionToken{Fetch: i.fetch, Now: c.Now}
	if _, err := tokens.Token(context.Background()); err != nil {
		t.Fatal(err)
	}

	tokens.End()

	if token, err := tokens.Token(context.Background()); !errors.Is(err, github.ErrSessionEnded) || token != "" {
		t.Fatalf("after End: %q, %v, want ErrSessionEnded", token, err)
	}
}

func TestServerTokensAsksTheSessionsTokenWithTheRunnersToken(t *testing.T) {
	expires := time.Date(2026, 11, 19, 11, 0, 0, 0, time.UTC)
	var seen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path+" "+r.Header.Get("Authorization"))
		switch r.URL.Path {
		case "/api/runner/sessions/s-1/github-token":
			_ = json.NewEncoder(w).Encode(map[string]any{"token": "ghs_secret", "expiresAt": expires})
		case "/api/runner/sessions/s-3/github-token":
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"status":422,"code":"sessions.no-repository","message":"…"}`))
		default:
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"status":422,"code":"sessions.ended","message":"Cette Session est terminée."}`))
		}
	}))
	t.Cleanup(server.Close)
	tokens := github.ServerTokens{Server: server.URL, RunnerToken: "runner-token"}

	issued, err := tokens.Fetch(context.Background(), "s-1")
	if err != nil || issued.Token != "ghs_secret" || !issued.ExpiresAt.Equal(expires) {
		t.Fatalf("Fetch = %+v, %v", issued, err)
	}
	_, err = tokens.Fetch(context.Background(), "s-2")
	if err == nil || !strings.Contains(err.Error(), "sessions.ended") {
		t.Fatalf("Fetch of an ended Session: %v, want its code", err)
	}
	if _, err = tokens.Fetch(context.Background(), "s-3"); !errors.Is(err, github.ErrNoRepository) {
		t.Fatalf("Fetch for a Projet without a repository: %v, want ErrNoRepository", err)
	}
	if _, err = tokens.Fetch(context.Background(), "s-2"); errors.Is(err, github.ErrNoRepository) {
		t.Fatalf("Fetch of an ended Session: %v, not ErrNoRepository", err)
	}
	want := []string{"POST /api/runner/sessions/s-1/github-token Bearer runner-token", "POST /api/runner/sessions/s-2/github-token Bearer runner-token",
		"POST /api/runner/sessions/s-3/github-token Bearer runner-token", "POST /api/runner/sessions/s-2/github-token Bearer runner-token"}
	if strings.Join(seen, "\n") != strings.Join(want, "\n") {
		t.Fatalf("requests %q, want %q", seen, want)
	}
}

func TestMigrationTokensAsksTheMigrationsTokenWithTheRunnersTokenAndSaysOneNotRunning(t *testing.T) {
	expires := time.Date(2026, 11, 20, 11, 0, 0, 0, time.UTC)
	var seen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path+" "+r.Header.Get("Authorization"))
		if r.URL.Path == "/api/runner/source-migrations/m-1/github-token" {
			_ = json.NewEncoder(w).Encode(map[string]any{"token": "ghs_migration", "expiresAt": expires})
			return
		}
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"status":422,"code":"source-migration.not-running","message":"…"}`))
	}))
	t.Cleanup(server.Close)
	tokens := github.MigrationTokens{Server: server.URL, RunnerToken: "runner-token"}

	token, err := tokens.Token("m-1").Token(context.Background())
	if err != nil || token != "ghs_migration" {
		t.Fatalf("Token = %q, %v", token, err)
	}
	if _, err := tokens.Fetch(context.Background(), "m-2"); !errors.Is(err, github.ErrMigrationNotRunning) || strings.Contains(err.Error(), "ghs_") {
		t.Fatalf("Fetch of a migration not running: %v", err)
	}
	want := "POST /api/runner/source-migrations/m-1/github-token Bearer runner-token\nPOST /api/runner/source-migrations/m-2/github-token Bearer runner-token"
	if strings.Join(seen, "\n") != want {
		t.Fatalf("requests %q", seen)
	}
}
