package github

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

type staticToken string

func (s staticToken) Token(context.Context) (string, error) { return string(s), nil }

// A fake of api.github.com's GET /repos/{owner}/{repo}/pulls/{number}, with the fields the Runner reads.
func fakeGitHub(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer ghs_session" || r.Header.Get("Accept") != "application/vnd.github+json" {
			http.Error(w, `{"message":"Bad credentials"}`, http.StatusUnauthorized)
			return
		}
		if r.Method != http.MethodGet || r.URL.Path != "/repos/acme/atelier/pulls/12" {
			http.Error(w, `{"message":"Not Found"}`, http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"number": 12,
			"body": "Closes #38",
			"base": {"ref": "develop", "sha": "1111111111111111111111111111111111111111"},
			"head": {"ref": "feat/38-contrats", "sha": "4b825dc642cb6eb9a060e54bf8d69288fbee4904"},
			"labels": [{"name": "conception"}, {"name": "revue-visuelle"}]
		}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestPullRequestReadsTheFactsAPrRuleChecks(t *testing.T) {
	srv := fakeGitHub(t)
	client := &Client{BaseURL: srv.URL, HTTP: srv.Client(), Tokens: staticToken("ghs_session")}

	pr, err := client.PullRequest(context.Background(), "acme/atelier", 12)
	if err != nil {
		t.Fatalf("PullRequest: %v", err)
	}
	want := &target.PullRequest{Base: "develop", Head: "feat/38-contrats", Body: "Closes #38", Labels: []string{"conception", "revue-visuelle"}, HeadSHA: "4b825dc642cb6eb9a060e54bf8d69288fbee4904"}
	if !reflect.DeepEqual(pr, want) {
		t.Fatalf("pr %+v, want %+v", pr, want)
	}
}

func TestPullRequestSaysWhyGitHubRefused(t *testing.T) {
	srv := fakeGitHub(t)
	_, err := (&Client{BaseURL: srv.URL, HTTP: srv.Client(), Tokens: staticToken("ghs_session")}).PullRequest(context.Background(), "acme/atelier", 13)
	if err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("PullRequest(13) = %v, want a 404", err)
	}
	_, err = (&Client{BaseURL: srv.URL, HTTP: srv.Client(), Tokens: staticToken("ghs_old")}).PullRequest(context.Background(), "acme/atelier", 12)
	if err == nil || !strings.Contains(err.Error(), "401") || strings.Contains(err.Error(), "ghs_old") {
		t.Fatalf("PullRequest with a bad token = %v, want a 401 without the token", err)
	}
}

func TestPullRequestRefusesARepositoryThatIsNotOwnerSlashName(t *testing.T) {
	client := &Client{BaseURL: "http://127.0.0.1:1", Tokens: staticToken("ghs_session")}
	for _, repo := range []string{"atelier", "acme/atelier/pulls", "../acme/atelier", "acme/"} {
		if _, err := client.PullRequest(context.Background(), repo, 12); err == nil {
			t.Errorf("repo %q accepted", repo)
		}
	}
}

func TestPullRequestNeedsItsToken(t *testing.T) {
	srv := fakeGitHub(t)
	failing := tokenFunc(func(context.Context) (string, error) { return "", errors.New("no token") })
	if _, err := (&Client{BaseURL: srv.URL, HTTP: srv.Client(), Tokens: failing}).PullRequest(context.Background(), "acme/atelier", 12); err == nil {
		t.Fatal("PullRequest without a token succeeded")
	}
}

type tokenFunc func(context.Context) (string, error)

func (f tokenFunc) Token(ctx context.Context) (string, error) { return f(ctx) }
