package githubtest

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func post(t *testing.T, s *Server, operation string, variables map[string]any) (int, map[string]any, http.Header) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"query": "query " + operation + " { x }", "operationName": operation, "variables": variables})
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
