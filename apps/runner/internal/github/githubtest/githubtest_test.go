package githubtest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

// recorder is a test whose failures the fake's own tests read.
type recorder struct {
	testing.TB
	mu     sync.Mutex
	errors []string
}

func (r *recorder) Errorf(format string, args ...any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.errors = append(r.errors, fmt.Sprintf(format, args...))
}

func (r *recorder) failures() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.errors...)
}

func post(t *testing.T, s *Server, operation string, variables map[string]any) (int, map[string]any, http.Header) {
	t.Helper()
	return postQuery(t, s, "query "+operation+" { x }", operation, variables)
}

func postQuery(t *testing.T, s *Server, query, operation string, variables map[string]any) (int, map[string]any, http.Header) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"query": query, "operationName": operation, "variables": variables})
	request, _ := http.NewRequest(http.MethodPost, s.URL+"/graphql", strings.NewReader(string(body)))
	request.Header.Set("Authorization", "bearer ghs_mirror")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(response.Body).Decode(&out)
	return response.StatusCode, out, response.Header
}

func login(out map[string]any) any {
	data, _ := out["data"].(map[string]any)
	viewer, _ := data["viewer"].(map[string]any)
	return viewer["login"]
}

func TestGraphQLAnswersTheMostSpecificFixtureThenTheLatestLoaded(t *testing.T) {
	s := New(t, "testdata/graphql")
	if _, out, _ := post(t, s, "Viewer", map[string]any{"login": "octo", "after": nil}); login(out) != "octo" {
		t.Errorf("octo: %v", out)
	}
	if _, out, _ := post(t, s, "Viewer", map[string]any{"login": "other"}); login(out) != "anyone" {
		t.Errorf("other: %v", out)
	}
	s.Load("testdata/override")
	_, out, _ := post(t, s, "Viewer", nil)
	if login(out) != "later" || out["errors"] == nil {
		t.Errorf("after the override: %v", out)
	}
	s.Reply("Viewer", map[string]any{"login": "octo", "page": 2}, map[string]any{"viewer": map[string]any{"login": "built"}})
	if _, out, _ := post(t, s, "Viewer", map[string]any{"login": "octo", "page": 2}); login(out) != "built" {
		t.Errorf("Reply: %v", out)
	}
	calls := s.Calls()
	if len(calls) != 4 || calls[0].Operation != "Viewer" || calls[0].Authorization != "bearer ghs_mirror" || calls[0].Variables["login"] != "octo" {
		t.Errorf("calls %+v", calls)
	}
	if s.Count("Viewer") != 4 {
		t.Errorf("Count %d", s.Count("Viewer"))
	}
}

func TestFailAnswersTheScriptedErrorsThenTheFixtures(t *testing.T) {
	s := New(t, "testdata/graphql")
	reset := time.Unix(1_800_000_000, 0)
	s.Fail("Viewer", RateLimited(reset), 1)
	s.Fail("", BadGateway(), 1)
	status, _, header := post(t, s, "Viewer", nil)
	if status != http.StatusForbidden || header.Get("X-RateLimit-Remaining") != "0" || header.Get("X-RateLimit-Reset") != "1800000000" {
		t.Errorf("rate limit: %d %v", status, header)
	}
	if status, _, _ := post(t, s, "Viewer", nil); status != http.StatusBadGateway {
		t.Errorf("502: %d", status)
	}
	if status, out, _ := post(t, s, "Viewer", nil); status != http.StatusOK || login(out) != "anyone" {
		t.Errorf("after the failures: %d %v", status, out)
	}
}

func TestRESTAnswersByMethodAndPath(t *testing.T) {
	s := New(t, "testdata/graphql")
	s.REST(http.MethodGet, "/repos/acme/atelier/issues/38/dependencies/blocked_by", http.StatusOK, `[{"number": 35}]`)
	response, err := http.Get(s.URL + "/repos/acme/atelier/issues/38/dependencies/blocked_by?per_page=100")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Errorf("status %d", response.StatusCode)
	}
	if response, _ := http.Get(s.URL + "/repos/acme/atelier/issues/39"); response.StatusCode != http.StatusNotFound {
		t.Errorf("unknown path: %d", response.StatusCode)
	}
	if calls := s.Calls(); len(calls) != 2 || calls[0].Path != "/repos/acme/atelier/issues/38/dependencies/blocked_by" || calls[0].Operation != "" {
		t.Errorf("calls %+v", calls)
	}
}

func TestASchemaMakesTheFakeRefuseWhatGitHubWouldRefuse(t *testing.T) {
	r := &recorder{TB: t}
	s := New(r)
	s.Schema(GitHubSchema)
	s.Reply("Number", map[string]any{"owner": "acme"}, map[string]any{"repository": map[string]any{"issueOrPullRequest": map[string]any{"number": 38}}})

	valid := "query Number($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issueOrPullRequest(number: $number) { ... on Issue { number } } } }"
	if _, out, _ := postQuery(t, s, valid, "Number", map[string]any{"owner": "acme", "name": "atelier", "number": 38}); out["data"] == nil || len(r.failures()) != 0 {
		t.Fatalf("a valid query: %v %v", out, r.failures())
	}
	refused := map[string]struct {
		query     string
		variables map[string]any
		reason    string
	}{
		"an unknown field": {
			"query Number($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { nameWithOwner stars } }",
			map[string]any{"owner": "acme", "name": "atelier"}, "stars",
		},
		"one name for the states of an issue and a PR": {
			"query Number($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issueOrPullRequest(number: $number) { ... on Issue { state } ... on PullRequest { state } } } }",
			map[string]any{"owner": "acme", "name": "atelier", "number": 38}, "conflict",
		},
		"a variable of another type": {
			valid, map[string]any{"owner": "acme", "name": "atelier", "number": []any{38}}, "number",
		},
		"a missing variable": {
			valid, map[string]any{"owner": "acme", "number": 38}, "name",
		},
	}
	for name, c := range refused {
		t.Run(name, func(t *testing.T) {
			before := len(r.failures())
			status, out, _ := postQuery(t, s, c.query, "Number", c.variables)
			failures := r.failures()[before:]
			if status != http.StatusOK || out["data"] != nil || out["errors"] == nil {
				t.Errorf("answer %d %v, want GitHub's errors", status, out)
			}
			if len(failures) != 1 || !strings.Contains(failures[0], c.reason) {
				t.Errorf("the test's failures %q, want one naming %q", failures, c.reason)
			}
		})
	}
}
