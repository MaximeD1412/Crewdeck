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
	mu  sync.Mutex
	now time.Time
}

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

// issuer gives a new token valid 1 h at each call, as the server does.
type issuer struct {
	clock *clock
	mu    sync.Mutex
	calls int
	fail  error
}

func (i *issuer) fetch(context.Context) (github.Issued, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.fail != nil {
		return github.Issued{}, i.fail
	}
	i.calls++
	return github.Issued{Token: fmt.Sprintf("ghs_%d", i.calls), ExpiresAt: i.clock.Now().Add(time.Hour)}, nil
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
