package migration_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// fakeGitHub is a repository's REST API for issues, as the migration uses
// it, every call recorded; before runs ahead of each call.
type fakeGitHub struct {
	mu         sync.Mutex
	issues     []*fakeIssue
	labels     []string
	milestones []fakeMilestone
	calls      []string
	nextID     int64
	token      string
	before     func(call string, query string)
}

type fakeIssue struct {
	ID          int64
	Number      int
	Title       string
	Body        string
	State       string
	StateReason *string
	Labels      []string
	Milestone   int
	Locked      bool
	PR          bool
	Comments    []fakeComment
	Parent      int
	BlockedBy   []int
}

type fakeComment struct {
	ID     int64
	Author string
	Body   string
	At     string
}

type fakeMilestone struct {
	Number int
	Title  string
	DueOn  *string
}

func newFakeGitHub(t *testing.T) (*fakeGitHub, *httptest.Server) {
	t.Helper()
	f := &fakeGitHub{nextID: 1000, token: "ghs_migration-secret"}
	server := httptest.NewServer(f)
	t.Cleanup(server.Close)
	return f, server
}

// add puts an issue (or a pull request) in the repository as it was before.
func (f *fakeGitHub) add(is fakeIssue) *fakeIssue {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextID++
	is.ID = f.nextID
	if is.Number == 0 {
		is.Number = len(f.issues) + 1
	}
	if is.State == "" {
		is.State = "open"
	}
	f.issues = append(f.issues, &is)
	return &is
}

func (f *fakeGitHub) issue(n int) *fakeIssue {
	for _, is := range f.issues {
		if is.Number == n {
			return is
		}
	}
	return nil
}

func (f *fakeGitHub) byID(id int64) *fakeIssue {
	for _, is := range f.issues {
		if is.ID == id {
			return is
		}
	}
	return nil
}

// count is how many calls were made of method and path pattern (`POST /issues`).
func (f *fakeGitHub) count(pattern string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	re := regexp.MustCompile("^" + pattern + "$")
	n := 0
	for _, c := range f.calls {
		if re.MatchString(c) {
			n++
		}
	}
	return n
}

func (f *fakeGitHub) Issues() []fakeIssue {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []fakeIssue{}
	for _, is := range f.issues {
		if !is.PR {
			out = append(out, *is)
		}
	}
	return out
}

var issuePath = regexp.MustCompile(`^/issues/(\d+)(/.*)?$`)

func (f *fakeGitHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/repos/o/r")
	call := r.Method + " " + path
	if f.before != nil {
		f.before(call, r.URL.RawQuery)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, call)
	if r.Header.Get("Authorization") != "Bearer "+f.token {
		http.Error(w, `{"message":"Bad credentials"}`, http.StatusUnauthorized)
		return
	}
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page == 0 {
		page = 1
	}
	perPage, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
	if perPage == 0 {
		perPage = 30
	}
	reply := func(status int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(v)
	}
	list := func(items []any) {
		from := min((page-1)*perPage, len(items))
		reply(http.StatusOK, items[from:min(from+perPage, len(items))])
	}

	switch {
	case call == "GET /issues":
		items := []any{}
		for _, is := range f.issues {
			items = append(items, f.render(is))
		}
		list(items)
	case call == "POST /issues":
		f.nextID++
		is := &fakeIssue{ID: f.nextID, Number: len(f.issues) + 1, Title: str(body["title"]), Body: str(body["body"]), State: "open", Labels: strs(body["labels"])}
		if m, ok := body["milestone"].(float64); ok {
			is.Milestone = int(m)
		}
		f.issues = append(f.issues, is)
		reply(http.StatusCreated, f.render(is))
	case call == "GET /labels":
		items := []any{}
		for _, l := range f.labels {
			items = append(items, map[string]any{"name": l})
		}
		list(items)
	case call == "POST /labels":
		name := str(body["name"])
		if slices.Contains(f.labels, name) {
			reply(http.StatusUnprocessableEntity, map[string]any{"message": "Validation Failed"})
			return
		}
		f.labels = append(f.labels, name)
		reply(http.StatusCreated, map[string]any{"name": name})
	case call == "GET /milestones":
		items := []any{}
		for _, m := range f.milestones {
			items = append(items, map[string]any{"number": m.Number, "title": m.Title, "due_on": m.DueOn})
		}
		list(items)
	case call == "POST /milestones":
		m := fakeMilestone{Number: len(f.milestones) + 1, Title: str(body["title"])}
		if due, ok := body["due_on"].(string); ok {
			m.DueOn = &due
		}
		f.milestones = append(f.milestones, m)
		reply(http.StatusCreated, map[string]any{"number": m.Number, "title": m.Title, "due_on": m.DueOn})
	default:
		match := issuePath.FindStringSubmatch(path)
		if match == nil {
			reply(http.StatusNotFound, map[string]any{"message": "Not Found"})
			return
		}
		n, _ := strconv.Atoi(match[1])
		is := f.issue(n)
		if is == nil {
			reply(http.StatusNotFound, map[string]any{"message": "Not Found"})
			return
		}
		f.serveIssue(r.Method, is, match[2], body, reply, list)
	}
}

func (f *fakeGitHub) serveIssue(method string, is *fakeIssue, rest string, body map[string]any, reply func(int, any), list func([]any)) {
	switch {
	case method == http.MethodGet && rest == "":
		reply(http.StatusOK, f.render(is))
	case method == http.MethodPatch && rest == "":
		if v, ok := body["title"]; ok {
			is.Title = str(v)
		}
		if v, ok := body["body"]; ok {
			is.Body = str(v)
		}
		if v, ok := body["labels"]; ok {
			is.Labels = strs(v)
		}
		if v, ok := body["milestone"]; ok {
			is.Milestone = 0
			if m, ok := v.(float64); ok {
				is.Milestone = int(m)
			}
		}
		if v, ok := body["state"]; ok {
			is.State = str(v)
			is.StateReason = nil
			if r, ok := body["state_reason"].(string); ok {
				is.StateReason = &r
			}
		}
		reply(http.StatusOK, f.render(is))
	case method == http.MethodGet && rest == "/comments":
		items := []any{}
		for _, c := range is.Comments {
			items = append(items, map[string]any{"id": c.ID, "body": c.Body, "created_at": c.At, "user": map[string]any{"login": c.Author}})
		}
		list(items)
	case method == http.MethodPost && rest == "/comments":
		f.nextID++
		is.Comments = append(is.Comments, fakeComment{ID: f.nextID, Author: "crewdeck[bot]", Body: str(body["body"]), At: "2026-11-20T10:00:00Z"})
		reply(http.StatusCreated, map[string]any{"id": f.nextID})
	case method == http.MethodGet && rest == "/sub_issues":
		items := []any{}
		for _, child := range f.issues {
			if child.Parent == is.Number {
				items = append(items, f.render(child))
			}
		}
		list(items)
	case method == http.MethodPost && rest == "/sub_issues":
		child := f.byID(int64(body["sub_issue_id"].(float64)))
		if child.Parent != 0 && body["replace_parent"] != true {
			reply(http.StatusUnprocessableEntity, map[string]any{"message": "has a parent"})
			return
		}
		child.Parent = is.Number
		reply(http.StatusCreated, f.render(is))
	case method == http.MethodDelete && rest == "/sub_issue":
		f.byID(int64(body["sub_issue_id"].(float64))).Parent = 0
		reply(http.StatusOK, f.render(is))
	case method == http.MethodGet && rest == "/dependencies/blocked_by":
		items := []any{}
		for _, b := range is.BlockedBy {
			items = append(items, f.render(f.issue(b)))
		}
		list(items)
	case method == http.MethodPost && rest == "/dependencies/blocked_by":
		blocker := f.byID(int64(body["issue_id"].(float64)))
		is.BlockedBy = append(is.BlockedBy, blocker.Number)
		reply(http.StatusCreated, f.render(is))
	case method == http.MethodDelete && strings.HasPrefix(rest, "/dependencies/blocked_by/"):
		id, _ := strconv.ParseInt(strings.TrimPrefix(rest, "/dependencies/blocked_by/"), 10, 64)
		blocker := f.byID(id)
		is.BlockedBy = slices.DeleteFunc(is.BlockedBy, func(n int) bool { return n == blocker.Number })
		reply(http.StatusOK, f.render(is))
	case method == http.MethodPost && rest == "/labels":
		for _, l := range strs(body["labels"]) {
			if !slices.Contains(is.Labels, l) {
				is.Labels = append(is.Labels, l)
			}
		}
		reply(http.StatusOK, []any{})
	case method == http.MethodPut && rest == "/lock":
		is.Locked = true
		reply(http.StatusNoContent, nil)
	default:
		reply(http.StatusNotFound, map[string]any{"message": fmt.Sprintf("Not Found: %s %s", method, rest)})
	}
}

func (f *fakeGitHub) render(is *fakeIssue) map[string]any {
	labels := []any{}
	for _, l := range is.Labels {
		labels = append(labels, map[string]any{"name": l})
	}
	children := 0
	for _, c := range f.issues {
		if c.Parent == is.Number {
			children++
		}
	}
	out := map[string]any{
		"id": is.ID, "number": is.Number, "title": is.Title, "body": is.Body, "state": is.State, "state_reason": is.StateReason,
		"locked": is.Locked, "labels": labels, "milestone": nil, "comments": len(is.Comments),
		"html_url":                   fmt.Sprintf("https://github.com/o/r/issues/%d", is.Number),
		"sub_issues_summary":         map[string]any{"total": children},
		"issue_dependencies_summary": map[string]any{"blocked_by": len(is.BlockedBy)},
	}
	for _, m := range f.milestones {
		if m.Number == is.Milestone {
			out["milestone"] = map[string]any{"number": m.Number, "title": m.Title, "due_on": m.DueOn}
		}
	}
	if is.PR {
		out["pull_request"] = map[string]any{"url": "x"}
	}
	return out
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func strs(v any) []string {
	items, _ := v.([]any)
	out := []string{}
	for _, item := range items {
		out = append(out, str(item))
	}
	return out
}
