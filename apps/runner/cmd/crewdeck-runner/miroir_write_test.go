package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github/githubtest"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
	"gopkg.in/yaml.v3"
)

// The agents' writes (MIROIR-7): the same command line on the GitHub key,
// its requests recorded on the fake GitHub, and on the Local key, written in
// the folder and local.db by the running Runner; then the same answer of
// `miroir … view --json`.

const (
	ghWriteSession    = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f7a01"
	localWriteSession = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f7a02"
)

// writes makes the fixture's Runner run a Session of each Projet, Rôle
// code: the GitHub one's token, the Local one's source.write.
func (f *miroirFixture) writes(t *testing.T) {
	t.Helper()
	sessions := map[string]string{ghWriteSession: "P1", localWriteSession: "P2"}
	f.sock.Handle(github.OpSessionToken, func(_ context.Context, raw json.RawMessage) (any, error) {
		var r github.SessionTokenRequest
		if err := json.Unmarshal(raw, &r); err != nil || sessions[r.SessionID] != "P1" {
			return nil, writeCode("not-found")
		}
		return github.SessionTokenReply{Token: "ghs_session"}, nil
	})
	sourceWrites{
		running: func(id string) (string, string, bool) { p, ok := sessions[id]; return p, "code", ok },
		target:  f.locals.Target,
		fetch:   f.follower.Fetch,
		logger:  slog.New(slog.NewTextHandler(testLog{t}, nil)),
	}.Register(f.sock)
	api := miroirGitHubAPI
	miroirGitHubAPI = f.fake.URL
	t.Cleanup(func() { miroirGitHubAPI = api })
}

// inSession runs what follows as the Session id.
func inSession(t *testing.T, id string) {
	t.Helper()
	t.Setenv(session.SessionEnv, id)
	t.Setenv(github.AskpassSessionEnv, "")
}

// replyObject makes GitHub's object number the fixture file's, edited.
func (f *miroirFixture) replyObject(t *testing.T, file string, number int, edit func(o map[string]any)) {
	t.Helper()
	var fixture struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(golden(t, filepath.Join("graphql", file)), &fixture); err != nil {
		t.Fatal(err)
	}
	o := fixture.Data["repository"].(map[string]any)["issueOrPullRequest"].(map[string]any)
	o["number"] = float64(number)
	kind := "issues"
	if o["__typename"] == "PullRequest" {
		kind = "pull"
	}
	o["url"] = fmt.Sprintf("https://github.com/acme/atelier/%s/%d", kind, number)
	edit(o)
	f.fake.Reply("MirrorObject", map[string]any{"owner": "acme", "name": "atelier", "number": number}, fixture.Data)
}

func nodes(items ...any) map[string]any {
	return map[string]any{"pageInfo": map[string]any{"hasNextPage": false, "endCursor": nil}, "nodes": append([]any{}, items...)}
}

func ref(number int) map[string]any {
	return map[string]any{"number": number, "repository": map[string]any{"nameWithOwner": ghKey}}
}

// restCalls are the fake's REST requests, "METHOD /path body", each checked
// to carry the Session's token.
func restCalls(t *testing.T, f *miroirFixture) []string {
	t.Helper()
	var out []string
	for _, c := range f.fake.Calls() {
		if c.Operation != "" {
			continue
		}
		if c.Authorization != "Bearer ghs_session" {
			t.Errorf("%s %s with %q, want the Session's token", c.Method, c.Path, c.Authorization)
		}
		line := c.Method + " " + c.Path
		if c.Body != "" {
			var body any
			_ = json.Unmarshal([]byte(c.Body), &body)
			normal, _ := json.Marshal(body)
			line += " " + string(normal)
		}
		out = append(out, line)
	}
	return out
}

func goldenLines(t *testing.T, name string) []string {
	t.Helper()
	return strings.Split(strings.TrimSpace(string(golden(t, name))), "\n")
}

func TestMiroirWriteIssueCreateOnBothSourcesThenItsViewAnswersTheNewValues(t *testing.T) {
	f := newMiroirFixture(t)
	f.writes(t)
	args := []string{"issue", "create", "-t", "T", "-b", "B", "-l", "ready-for-agent", "--blocked-by", "3", "--parent", "1", "--json", "number,url"}
	view := []string{"--json", "labels,blockedBy,parent"}
	const filter = `{labels: [.labels[].name], blockedBy, parent}`

	// GitHub: the create, the dependency and the sub-issue, with the Session's token.
	f.fake.REST(http.MethodPost, "/repos/acme/atelier/issues", http.StatusCreated, `{"id": 9016, "number": 16, "html_url": "https://github.com/acme/atelier/issues/16"}`)
	f.fake.REST(http.MethodGet, "/repos/acme/atelier/issues/3", http.StatusOK, `{"id": 9003, "number": 3}`)
	f.fake.REST(http.MethodPost, "/repos/acme/atelier/issues/16/dependencies/blocked_by", http.StatusCreated, `{}`)
	f.fake.REST(http.MethodPost, "/repos/acme/atelier/issues/1/sub_issues", http.StatusCreated, `{}`)
	f.replyObject(t, "object-14.json", 16, func(o map[string]any) {
		o["title"], o["body"] = "T", "B"
		o["labels"] = nodes(map[string]any{"name": "ready-for-agent"})
		o["blockedBy"] = nodes(ref(3))
		o["parent"] = ref(1)
	})
	inSession(t, ghWriteSession)
	out, stderr, err := runMiroir(t, githubDir(t), args...)
	if err != nil || stderr != "" {
		t.Fatalf("issue create on GitHub: %v\n%s", err, stderr)
	}
	if got := jq(t, []byte(out), "."); !reflect.DeepEqual(got, map[string]any{"number": 16.0, "url": "https://github.com/acme/atelier/issues/16"}) {
		t.Errorf("--json number,url: %v", got)
	}
	if got, want := restCalls(t, f), goldenLines(t, "write/issue-create-github.txt"); !reflect.DeepEqual(got, want) {
		t.Errorf("GitHub's requests\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	ghView, stderr, err := runMiroir(t, githubDir(t), append([]string{"issue", "view", "16"}, view...)...)
	if err != nil {
		t.Fatalf("issue view 16: %v\n%s", err, stderr)
	}

	// Local: the Ticket's file, ready, its blocker and parent, the next number of the counter, no commit.
	commits := gitIn(t, f.folder, "rev-list", "--count", "--all")
	inSession(t, localWriteSession)
	dir := f.sessionDir(t)
	out, stderr, err = runMiroir(t, dir, args...)
	if err != nil || stderr != "" {
		t.Fatalf("issue create on Local: %v\n%s", err, stderr)
	}
	created := jq(t, []byte(out), ".").(map[string]any)
	if created["number"] != 15.0 {
		t.Fatalf("created %v, want the counter's next number, 15", created)
	}
	file, err := os.ReadFile(filepath.Join(f.folder, "tickets", "15-t.md"))
	if err != nil {
		t.Fatal(err)
	}
	var front map[string]any
	if parts := strings.SplitN(string(file), "---\n", 3); len(parts) != 3 || yaml.Unmarshal([]byte(parts[1]), &front) != nil {
		t.Fatalf("tickets/15-t.md:\n%s", file)
	}
	if want := map[string]any{"number": 15, "title": "T", "ready": true, "blocked_by": []any{3}, "parent": 1}; !reflect.DeepEqual(front, want) {
		t.Errorf("tickets/15-t.md's front matter %v, want %v (ready-for-agent as ready, not a label)", front, want)
	}
	if created["url"] != "file://"+filepath.ToSlash(filepath.Join(f.folder, "tickets", "15-t.md")) {
		t.Errorf("url %v", created["url"])
	}
	if after := gitIn(t, f.folder, "rev-list", "--count", "--all"); after != commits {
		t.Errorf("the folder has %s commits, %s before", after, commits)
	}
	localView, stderr, err := runMiroir(t, dir, append([]string{"issue", "view", "15"}, view...)...)
	if err != nil {
		t.Fatalf("issue view 15: %v\n%s", err, stderr)
	}

	// The same answer on both, right after the write.
	want := jq(t, golden(t, "write/issue-view-created.json"), ".")
	for name, answer := range map[string]string{"GitHub": ghView, "Local": localView} {
		if got := jq(t, []byte(answer), filter); !reflect.DeepEqual(got, want) {
			t.Errorf("%s's view | jq = %v, want %v", name, got, want)
		}
	}
	if a, b := keysOf(t, ghView), keysOf(t, localView); !reflect.DeepEqual(a, b) {
		t.Errorf("the views' fields differ: %v, %v", a, b)
	}
}

func TestMiroirWriteIssueCloseNotPlannedWithACommentThenReopenOnBothSources(t *testing.T) {
	f := newMiroirFixture(t)
	f.writes(t)
	const filter = `{state, stateReason, comments: [.comments[] | .body]}`
	view := []string{"issue", "view", "14", "--json", "state,stateReason,comments"}
	closed := map[string]any{"state": "CLOSED", "stateReason": "NOT_PLANNED", "comments": []any{"x"}}
	reopened := map[string]any{"state": "OPEN", "stateReason": "REOPENED", "comments": []any{"x"}}

	// GitHub.
	f.fake.REST(http.MethodPost, "/repos/acme/atelier/issues/14/comments", http.StatusCreated, `{"id": 1}`)
	f.fake.REST(http.MethodPatch, "/repos/acme/atelier/issues/14", http.StatusOK, `{}`)
	comment := map[string]any{"id": "IC_14_1", "author": map[string]any{"login": "crewdeck[bot]"}, "body": "x",
		"url": "https://github.com/acme/atelier/issues/14#issuecomment-1", "createdAt": "2026-11-20T10:00:00Z", "updatedAt": "2026-11-20T10:00:00Z"}
	f.replyObject(t, "object-14.json", 14, func(o map[string]any) {
		o["issueState"], o["stateReason"], o["closedAt"], o["comments"] = "CLOSED", "NOT_PLANNED", "2026-11-20T10:00:00Z", nodes(comment)
	})
	inSession(t, ghWriteSession)
	gh := githubDir(t)
	if _, stderr, err := runMiroir(t, gh, "issue", "close", "14", "-r", "not planned", "-c", "x"); err != nil {
		t.Fatalf("issue close: %v\n%s", err, stderr)
	}
	out, _, _ := runMiroir(t, gh, view...)
	if got := jq(t, []byte(out), filter); !reflect.DeepEqual(got, closed) {
		t.Errorf("GitHub closed: %v", got)
	}
	f.replyObject(t, "object-14.json", 14, func(o map[string]any) {
		o["stateReason"], o["comments"] = "REOPENED", nodes(comment)
	})
	if _, stderr, err := runMiroir(t, gh, "issue", "reopen", "14"); err != nil {
		t.Fatalf("issue reopen: %v\n%s", err, stderr)
	}
	out, _, _ = runMiroir(t, gh, view...)
	if got := jq(t, []byte(out), filter); !reflect.DeepEqual(got, reopened) {
		t.Errorf("GitHub reopened: %v", got)
	}
	want := []string{
		`POST /repos/acme/atelier/issues/14/comments {"body":"x"}`,
		`PATCH /repos/acme/atelier/issues/14 {"state":"closed","state_reason":"not_planned"}`,
		`PATCH /repos/acme/atelier/issues/14 {"state":"open"}`,
	}
	if got := restCalls(t, f); !reflect.DeepEqual(got, want) {
		t.Errorf("GitHub's requests\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}

	// Local: the same command lines.
	inSession(t, localWriteSession)
	dir := f.sessionDir(t)
	if _, stderr, err := runMiroir(t, dir, "issue", "close", "14", "-r", "not planned", "-c", "x"); err != nil {
		t.Fatalf("Local issue close: %v\n%s", err, stderr)
	}
	out, _, _ = runMiroir(t, dir, view...)
	if got := jq(t, []byte(out), filter); !reflect.DeepEqual(got, closed) {
		t.Errorf("Local closed: %v", got)
	}
	if file, _ := os.ReadFile(filepath.Join(f.folder, "tickets", "14-le-readme.md")); !strings.Contains(string(file), "state_reason: not_planned") {
		t.Errorf("the Ticket's file:\n%s", file)
	}
	if c := jq(t, []byte(out), `[.comments[] | .author.login]`); !reflect.DeepEqual(c, []any{"code"}) {
		t.Errorf("the comment's author %v, want the Session's Rôle", c)
	}
	if _, stderr, err := runMiroir(t, dir, "issue", "reopen", "14"); err != nil {
		t.Fatalf("Local issue reopen: %v\n%s", err, stderr)
	}
	out, _, _ = runMiroir(t, dir, view...)
	if got := jq(t, []byte(out), `{state, comments: [.comments[] | .body]}`); !reflect.DeepEqual(got, map[string]any{"state": "OPEN", "comments": []any{"x"}}) {
		t.Errorf("Local reopened: %v", got)
	}
}

func TestMiroirWriteLocalPrCreateRefusesThenRecordsTheFoldersHeadAndReviewAtIt(t *testing.T) {
	f := newMiroirFixture(t)
	f.writes(t)
	inSession(t, localWriteSession)
	dir := f.sessionDir(t)
	gitIn(t, dir, "checkout", "--quiet", "-b", "feat/15-x")
	writeFiles(t, dir, map[string]string{"x.txt": "x\n"})
	gitIn(t, dir, "add", "x.txt")
	gitIn(t, dir, "commit", "--quiet", "-m", "feat : x")
	create := []string{"pr", "create", "-H", "feat/15-x", "-t", "Le x", "-b", "Closes #14", "-l", "conception", "--json", "number,url"}

	_, stderr, err := runMiroir(t, dir, create...)
	if !isExit(err, 1) || stderr != "La branche feat/15-x n'est pas dans le dossier : git push d'abord.\n" {
		t.Fatalf("a branch not pushed: %v %q", err, stderr)
	}
	gitIn(t, dir, "push", "--quiet", "origin", "feat/15-x")
	head := gitIn(t, f.folder, "rev-parse", "feat/15-x")
	out, stderr, err := runMiroir(t, dir, create...)
	if err != nil {
		t.Fatalf("pr create: %v\n%s", err, stderr)
	}
	if got := jq(t, []byte(out), "."); !reflect.DeepEqual(got, map[string]any{"number": 15.0, "url": localKey + "#15"}) {
		t.Errorf("created %v", got)
	}
	_, stderr, err = runMiroir(t, dir, create...)
	if !isExit(err, 1) || stderr != "Un changement est déjà ouvert pour feat/15-x : #15.\n" {
		t.Errorf("a second open change: %v %q", err, stderr)
	}

	// Its review, CHANGES_REQUESTED at the head of that moment; then the current branch's PR, without a number.
	if _, stderr, err := runMiroir(t, dir, "pr", "review", "15", "-r", "-b", "x"); err != nil {
		t.Fatalf("pr review: %v\n%s", err, stderr)
	}
	out, _, err = runMiroir(t, dir, "pr", "view", "15", "--json", "state,headRefName,headRefOid,baseRefName,labels,reviews,author")
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"state": "OPEN", "headRefName": "feat/15-x", "headRefOid": head, "baseRefName": "main", "author": "code",
		"labels": []any{"conception"}, "reviews": []any{map[string]any{"author": "code", "state": "CHANGES_REQUESTED", "body": "x", "commit": head}}}
	filter := `{state, headRefName, headRefOid, baseRefName, author: .author.login, labels: [.labels[].name], reviews: [.reviews[] | {author: .author.login, state, body, commit: .commit.oid}]}`
	if got := jq(t, []byte(out), filter); !reflect.DeepEqual(got, want) {
		t.Errorf("pr view 15 | jq = %v\nwant %v", got, want)
	}
	if out, stderr, err := runMiroir(t, dir, "pr", "comment", "-b", "Une remarque."); err != nil || out != localKey+"#15\n" {
		t.Fatalf("pr comment of the current branch: %q %v\n%s", out, err, stderr)
	}

	// Closed with its branch deleted from the folder.
	if _, stderr, err := runMiroir(t, dir, "pr", "close", "15", "-d", "-c", "Remplacé."); err != nil {
		t.Fatalf("pr close: %v\n%s", err, stderr)
	}
	out, _, _ = runMiroir(t, dir, "pr", "view", "15", "--json", "state,comments")
	if got := jq(t, []byte(out), `{state, comments: [.comments[] | .body]}`); !reflect.DeepEqual(got, map[string]any{"state": "CLOSED", "comments": []any{"Une remarque.", "Remplacé."}}) {
		t.Errorf("closed: %v", got)
	}
	if branches := gitIn(t, f.folder, "branch", "--list", "feat/15-x"); branches != "" {
		t.Errorf("the branch is still in the folder: %q", branches)
	}
}

func TestMiroirWriteGithubPrCreateAndReviewGiveTheShapesOfLocals(t *testing.T) {
	f := newMiroirFixture(t)
	f.writes(t)
	inSession(t, ghWriteSession)
	f.fake.REST(http.MethodPost, "/repos/acme/atelier/pulls", http.StatusCreated, `{"id": 7020, "number": 20, "html_url": "https://github.com/acme/atelier/pull/20"}`)
	f.fake.REST(http.MethodPatch, "/repos/acme/atelier/issues/20", http.StatusOK, `{}`)
	f.fake.REST(http.MethodPost, "/repos/acme/atelier/pulls/20/reviews", http.StatusOK, `{"id": 1}`)
	const head = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	pull := func(reviews ...any) func(o map[string]any) {
		return func(o map[string]any) {
			o["title"], o["body"], o["headRefName"], o["headRefOid"] = "Le x", "Closes #14", "feat/15-x", head
			o["labels"], o["reviews"], o["commits"] = nodes(map[string]any{"name": "conception"}), nodes(reviews...), nodes()
		}
	}
	f.replyObject(t, "object-7.json", 20, pull())
	gh := githubDir(t)
	out, stderr, err := runMiroir(t, gh, "pr", "create", "-H", "feat/15-x", "-t", "Le x", "-b", "Closes #14", "-l", "conception")
	if err != nil || out != "https://github.com/acme/atelier/pull/20\n" {
		t.Fatalf("pr create: %q %v\n%s", out, err, stderr)
	}
	f.replyObject(t, "object-7.json", 20, pull(map[string]any{"id": "PRR_20", "author": map[string]any{"login": "crewdeck[bot]"},
		"state": "CHANGES_REQUESTED", "body": "x", "commit": map[string]any{"oid": head}, "submittedAt": "2026-11-20T10:00:00Z"}))
	if _, stderr, err := runMiroir(t, gh, "pr", "review", "20", "-r", "-b", "x"); err != nil {
		t.Fatalf("pr review: %v\n%s", err, stderr)
	}
	want := []string{
		`POST /repos/acme/atelier/pulls {"base":"develop","body":"Closes #14","draft":false,"head":"feat/15-x","title":"Le x"}`,
		`PATCH /repos/acme/atelier/issues/20 {"labels":["conception"]}`,
		`POST /repos/acme/atelier/pulls/20/reviews {"body":"x","commit_id":"` + head + `","event":"REQUEST_CHANGES"}`,
	}
	if got := restCalls(t, f); !reflect.DeepEqual(got, want) {
		t.Errorf("GitHub's requests\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	fields := []string{"pr", "view", "20", "--json", "state,headRefName,headRefOid,labels,reviews,isDraft"}
	ghView, _, err := runMiroir(t, gh, fields...)
	if err != nil {
		t.Fatal(err)
	}

	// The same command lines on the Local key.
	inSession(t, localWriteSession)
	dir := f.sessionDir(t)
	gitIn(t, dir, "checkout", "--quiet", "-b", "feat/15-x")
	gitIn(t, dir, "push", "--quiet", "origin", "feat/15-x")
	if _, stderr, err := runMiroir(t, dir, "pr", "create", "-H", "feat/15-x", "-t", "Le x", "-b", "Closes #14", "-l", "conception"); err != nil {
		t.Fatalf("Local pr create: %v\n%s", err, stderr)
	}
	if _, stderr, err := runMiroir(t, dir, "pr", "review", "15", "-r", "-b", "x"); err != nil {
		t.Fatalf("Local pr review: %v\n%s", err, stderr)
	}
	fields[2] = "15"
	localView, _, err := runMiroir(t, dir, fields...)
	if err != nil {
		t.Fatal(err)
	}
	const filter = `{state, headRefName, isDraft, labels: [.labels[].name], reviews: [.reviews[] | {state, body}], reviewKeys: [.reviews[] | keys], labelKeys: [.labels[] | keys]}`
	want2 := jq(t, golden(t, "write/pr-view-reviewed.json"), ".")
	for name, answer := range map[string]string{"GitHub": ghView, "Local": localView} {
		if got := jq(t, []byte(answer), filter); !reflect.DeepEqual(got, want2) {
			t.Errorf("%s's view | jq = %v\nwant %v", name, got, want2)
		}
	}
}

func TestMiroirWriteOutsideASessionMergeAndOtherCommandsExitOne(t *testing.T) {
	f := newMiroirFixture(t)
	f.writes(t)
	dir := f.sessionDir(t)
	inSession(t, "")
	for _, args := range [][]string{
		{"issue", "create", "-t", "T"},
		{"issue", "comment", "12", "-b", "x"},
		{"pr", "review", "7", "-a"},
	} {
		_, stderr, err := runMiroir(t, dir, args...)
		if !isExit(err, 1) || stderr != notInSession+"\n" {
			t.Errorf("%v outside a Session: %v %q", args, err, stderr)
		}
	}
	// A Session id the Runner does not run is outside too, on both Sources.
	inSession(t, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f7aff")
	for _, d := range []string{dir, githubDir(t)} {
		if _, stderr, err := runMiroir(t, d, "issue", "comment", "12", "-b", "x"); !isExit(err, 1) || stderr != notInSession+"\n" {
			t.Errorf("an unknown Session: %v %q", err, stderr)
		}
	}
	// A Session writes its own Projet only.
	inSession(t, localWriteSession)
	if _, stderr, err := runMiroir(t, dir, "--repo", "local/P9", "issue", "comment", "12", "-b", "x"); err == nil {
		t.Errorf("another Projet's key: %q", stderr)
	}

	inSession(t, localWriteSession)
	_, stderr, err := runMiroir(t, dir, "pr", "merge", "7", "--squash")
	if !isExit(err, 1) || stderr != "Le merge passe par Crewdeck.\n" {
		t.Errorf("pr merge: %v %q", err, stderr)
	}
	_, stderr, err = runMiroir(t, dir, "pr", "ready", "7")
	if !isExit(err, 1) || !strings.HasPrefix(stderr, "miroir pr ready n'existe pas") {
		t.Errorf("pr ready: %v %q", err, stderr)
	}
	// Local refuses what it has not: an assignee, an unknown milestone.
	_, stderr, err = runMiroir(t, dir, "issue", "create", "-t", "T", "-a", "octo")
	if !isExit(err, 1) || stderr != "Pas d'assignation sur un Projet Local.\n" {
		t.Errorf("an assignee: %v %q", err, stderr)
	}
	_, stderr, err = runMiroir(t, dir, "issue", "edit", "12", "--milestone", "M9")
	if !isExit(err, 1) || stderr != "Le jalon M9 n'existe pas dans tickets/milestones.yml.\n" {
		t.Errorf("an unknown milestone: %v %q", err, stderr)
	}
	if _, err := os.Stat(filepath.Join(f.folder, "tickets", "15-t.md")); err == nil {
		t.Error("a refused create wrote its Ticket")
	}
}

func TestMiroirWriteGithubRefusalExitsOneWithItsMessage(t *testing.T) {
	f := newMiroirFixture(t)
	f.writes(t)
	inSession(t, ghWriteSession)
	f.fake.REST(http.MethodPost, "/repos/acme/atelier/pulls", http.StatusUnprocessableEntity,
		`{"message": "Validation Failed", "errors": [{"resource": "PullRequest", "code": "custom", "message": "A pull request already exists for acme:feat/12-x."}]}`)
	out, stderr, err := runMiroir(t, githubDir(t), "pr", "create", "-H", "feat/12-x", "-t", "x")
	want := "HTTP 422: Validation Failed (" + f.fake.URL + "/repos/acme/atelier/pulls)\nA pull request already exists for acme:feat/12-x.\n"
	if !isExit(err, 1) || stderr != want || out != "" {
		t.Errorf("a refusal: %v\n%q\nwant\n%q", err, stderr, want)
	}
	if n := f.fake.Count("MirrorObject"); n != 0 {
		t.Errorf("%d fetches after a refusal", n)
	}
}

func TestMiroirWriteAFailedRefreshLeavesTheWriteDoneAndExitsZero(t *testing.T) {
	f := newMiroirFixture(t)
	f.writes(t)
	inSession(t, ghWriteSession)
	f.fake.REST(http.MethodPost, "/repos/acme/atelier/issues/12/comments", http.StatusCreated, `{"id": 1}`)
	f.fake.Fail("MirrorObject", githubtest.BadGateway(), 10)
	out, stderr, err := runMiroir(t, githubDir(t), "issue", "comment", "12", "-b", "x")
	if err != nil || stderr != "" || out != "https://github.com/acme/atelier/issues/12\n" {
		t.Fatalf("a comment whose refresh fails: %q %v %q", out, err, stderr)
	}
	if got := restCalls(t, f); !reflect.DeepEqual(got, []string{`POST /repos/acme/atelier/issues/12/comments {"body":"x"}`}) {
		t.Errorf("requests %v", got)
	}
	if f.fake.Count("MirrorObject") == 0 {
		t.Error("no refresh asked")
	}
}

// A create whose refresh fails still prints the URL GitHub answered (R1-3).
func TestMiroirWriteAFailedRefreshAfterACreateKeepsGithubsURL(t *testing.T) {
	f := newMiroirFixture(t)
	f.writes(t)
	inSession(t, ghWriteSession)
	f.fake.REST(http.MethodPost, "/repos/acme/atelier/issues", http.StatusCreated, `{"id": 9016, "number": 16, "html_url": "https://github.com/acme/atelier/issues/16"}`)
	f.fake.REST(http.MethodPost, "/repos/acme/atelier/pulls", http.StatusCreated, `{"id": 7020, "number": 20, "html_url": "https://github.com/acme/atelier/pull/20"}`)
	f.fake.Fail("MirrorObject", githubtest.BadGateway(), 100)
	out, stderr, err := runMiroir(t, githubDir(t), "issue", "create", "-t", "T", "--json", "number,url")
	if err != nil || stderr != "" {
		t.Fatalf("issue create: %v %q", err, stderr)
	}
	if got := jq(t, []byte(out), "."); !reflect.DeepEqual(got, map[string]any{"number": 16.0, "url": "https://github.com/acme/atelier/issues/16"}) {
		t.Errorf("--json number,url: %v", got)
	}
	out, stderr, err = runMiroir(t, githubDir(t), "pr", "create", "-H", "feat/15-x", "-t", "x")
	if err != nil || out != "https://github.com/acme/atelier/pull/20\n" {
		t.Errorf("pr create: %q %v %q", out, err, stderr)
	}
}

// The Runner answers before runner.sock's deadline, however long the
// refresh would take (R1-2).
func TestMiroirWriteLocalRefreshLeavesTimeToAnswerBeforeTheSocketsDeadline(t *testing.T) {
	f := newMiroirFixture(t)
	f.stop()
	f.serve(t, &localsock.Server{Timeout: 2 * time.Second})
	f.writes(t)
	sourceWrites{
		running: func(string) (string, string, bool) { return "P2", "code", true },
		target:  f.locals.Target,
		fetch: func(ctx context.Context, _ string, _ int) error {
			<-ctx.Done()
			return ctx.Err()
		},
	}.Register(f.sock)
	inSession(t, localWriteSession)
	dir := f.sessionDir(t)
	out, stderr, err := runMiroir(t, dir, "issue", "comment", "12", "-b", "Lent.")
	if err != nil || stderr != "" {
		t.Fatalf("a comment whose refresh hangs: %q %v %q", out, err, stderr)
	}
}

// issue edit and pr edit take gh's -b and -F, stdin included (R1-5).
func TestMiroirWriteEditsTakeTheShortBodyFlags(t *testing.T) {
	f := newMiroirFixture(t)
	f.writes(t)
	inSession(t, localWriteSession)
	dir := f.sessionDir(t)
	body := func(args ...string) any {
		t.Helper()
		out, stderr, err := runMiroir(t, dir, args...)
		if err != nil {
			t.Fatalf("%v: %v\n%s", args, err, stderr)
		}
		return jq(t, []byte(out), ".body")
	}
	if _, stderr, err := runMiroir(t, dir, "issue", "edit", "12", "-b", "Par -b."); err != nil {
		t.Fatalf("issue edit -b: %v %q", err, stderr)
	}
	if got := body("issue", "view", "12", "--json", "body"); got != "Par -b." {
		t.Errorf("issue edit -b: %v", got)
	}
	if _, stderr, err := runMiroirIn(t, dir, "Par stdin.", "issue", "edit", "12", "-F", "-"); err != nil {
		t.Fatalf("issue edit -F -: %v %q", err, stderr)
	}
	if got := body("issue", "view", "12", "--json", "body"); got != "Par stdin." {
		t.Errorf("issue edit -F -: %v", got)
	}
	writeFiles(t, dir, map[string]string{"corps.md": "Par fichier."})
	if _, stderr, err := runMiroir(t, dir, "pr", "edit", "7", "-F", "corps.md"); err != nil {
		t.Fatalf("pr edit -F: %v %q", err, stderr)
	}
	if got := body("pr", "view", "7", "--json", "body"); got != "Par fichier." {
		t.Errorf("pr edit -F: %v", got)
	}
}

// A body over the limit is refused before anything is written, not cut (R1-1).
func TestMiroirWriteRefusesABodyOverItsLimitBeforeWriting(t *testing.T) {
	f := newMiroirFixture(t)
	f.writes(t)
	inSession(t, localWriteSession)
	dir := f.sessionDir(t)
	ticket := filepath.Join(f.folder, "tickets", "12-le-panier.md")
	before, _ := os.ReadFile(ticket)
	big := strings.Repeat("x", bodyLimit+1)
	writeFiles(t, dir, map[string]string{"gros.md": big})
	refused := func(err error) bool {
		return isExit(err, 1) && err.Error() == "Le corps dépasse 1 Mio : rien n'est écrit."
	}
	if _, _, err := runMiroir(t, dir, "issue", "edit", "12", "-F", "gros.md"); !refused(err) {
		t.Errorf("a file over the limit: %v", err)
	}
	if _, _, err := runMiroirIn(t, dir, big, "issue", "comment", "12", "-F", "-"); !refused(err) {
		t.Errorf("stdin over the limit: %v", err)
	}
	if after, _ := os.ReadFile(ticket); string(after) != string(before) {
		t.Errorf("the Ticket changed:\n%s", after)
	}
	out, _, _ := runMiroir(t, dir, "issue", "view", "12", "--json", "comments")
	if n := jq(t, []byte(out), ".comments | length"); n != 1 {
		t.Errorf("%v comments, want the fixture's one", n)
	}
	// Exactly the limit is written.
	writeFiles(t, dir, map[string]string{"juste.md": big[:bodyLimit]})
	if _, stderr, err := runMiroir(t, dir, "issue", "edit", "12", "-F", "juste.md"); err != nil {
		t.Errorf("a file at the limit: %v %q", err, stderr)
	}
}

// Reopening a Local change refuses while another is open on its branch (R1-4).
func TestMiroirWriteLocalPrReopenRefusesWhileAnotherChangeIsOpenOnItsBranch(t *testing.T) {
	f := newMiroirFixture(t)
	f.writes(t)
	inSession(t, localWriteSession)
	dir := f.sessionDir(t)
	gitIn(t, dir, "checkout", "--quiet", "-b", "feat/15-x")
	gitIn(t, dir, "push", "--quiet", "origin", "feat/15-x")
	create := []string{"pr", "create", "-H", "feat/15-x", "-t", "x", "--json", "number"}
	out, stderr, err := runMiroir(t, dir, create...)
	if err != nil {
		t.Fatalf("A: %v %q", err, stderr)
	}
	a := int(jq(t, []byte(out), ".number").(float64))
	if _, stderr, err := runMiroir(t, dir, "pr", "close", fmt.Sprint(a)); err != nil {
		t.Fatalf("close A: %v %q", err, stderr)
	}
	out, stderr, err = runMiroir(t, dir, create...)
	if err != nil {
		t.Fatalf("B: %v %q", err, stderr)
	}
	b := int(jq(t, []byte(out), ".number").(float64))
	_, stderr, err = runMiroir(t, dir, "pr", "reopen", fmt.Sprint(a))
	if want := fmt.Sprintf("Un changement est déjà ouvert pour feat/15-x : #%d.\n", b); !isExit(err, 1) || stderr != want {
		t.Errorf("reopen A beside B: %v %q, want %q", err, stderr, want)
	}
	out, _, _ = runMiroir(t, dir, "pr", "view", fmt.Sprint(a), "--json", "state")
	if got := jq(t, []byte(out), ".state"); got != "CLOSED" {
		t.Errorf("A is %v", got)
	}
	// Once B is closed, A reopens.
	if _, stderr, err := runMiroir(t, dir, "pr", "close", fmt.Sprint(b)); err != nil {
		t.Fatalf("close B: %v %q", err, stderr)
	}
	if _, stderr, err := runMiroir(t, dir, "pr", "reopen", fmt.Sprint(a)); err != nil {
		t.Errorf("reopen A alone: %v %q", err, stderr)
	}
}

// isExit says whether err ends the command with code.
func isExit(err error, code int) bool {
	var silent silentExit
	if errors.As(err, &silent) {
		return int(silent) == code
	}
	var exit *exitError
	return errors.As(err, &exit) && exit.code == code
}

// testLog writes the Runner's log in the test's.
type testLog struct{ t *testing.T }

func (l testLog) Write(p []byte) (int, error) {
	l.t.Helper()
	l.t.Log(strings.TrimSpace(string(p)))
	return len(p), nil
}
