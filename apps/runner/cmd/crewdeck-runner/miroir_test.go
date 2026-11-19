package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/itchyny/gojq"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github/githubtest"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mirror"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// The fixtures of `crewdeck-runner miroir` (MIROIR-6): one Runner's copy
// holding a GitHub key, acme/atelier (testdata/miroir/graphql), and a Local
// Projet's key, local/P2, its Tickets in a git folder and its change, its
// comment and its review in local.db; the running Runner is a follower in
// the test's process, serving runner.sock.

const (
	ghKey    = "acme/atelier"
	localKey = "local/P2"
)

type miroirToken string

func (s miroirToken) Token(context.Context) (string, error) { return string(s), nil }

type miroirFixture struct {
	home     string // the Runner's state folder, CREWDECK_HOME
	folder   string // the Local Projet's folder
	fake     *githubtest.Server
	store    *mirror.Store
	locals   *localSources
	follower *mirror.Follower
	sock     *localsock.Server
	stop     context.CancelFunc
}

func miroirVault(t *testing.T) *keys.Vault {
	t.Helper()
	runner, _ := keys.GenerateKeyPair()
	device, _ := keys.GenerateKeyPair()
	vaultKey, _ := keys.GenerateAESKey()
	w, err := keys.SealWrap(device, keys.PublicKeyBytes(runner), vaultKey, []byte(keys.InfoVaultWrap), keys.VaultWrapAAD("run_1", 1))
	if err != nil {
		t.Fatal(err)
	}
	v, err := keys.Unlock(runner, keys.PublicKeyBytes(device), "run_1", 1, w)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

var miroirLogger = slog.New(slog.NewTextHandler(io.Discard, nil))

func gitIn(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "user.name=Pilote", "-c", "user.email=pilote@example.test",
		"-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false"}, args...)...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func writeFiles(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	for name, content := range files {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// localTickets are the Local Projet's Ticket files, the GitHub issues' twins.
var localTickets = map[string]string{
	"tickets/milestones.yml":    "- title: M1 Fondations\n- title: M2 Le panier\n  due_on: 2026-12-15\n",
	"tickets/12-le-panier.md":   "---\nnumber: 12\ntitle: Le panier\nready: true\nlabels: [priority:P1, size:S]\nmilestone: M2 Le panier\n---\n\nLe corps du douze.\n",
	"tickets/13-le-paiement.md": "---\nnumber: 13\ntitle: Le paiement\nready: true\nblocked_by: [12]\nmilestone: M2 Le panier\n---\n\nAprès le panier.\n",
	"tickets/14-le-readme.md":   "---\nnumber: 14\ntitle: Le README\nready: true\nlabels: [size:XS]\n---\n\nLe README.\n",
}

// newMiroirFixture builds the copy, filled, and starts its Runner.
func newMiroirFixture(t *testing.T) *miroirFixture {
	t.Helper()
	root := t.TempDir()
	f := &miroirFixture{home: filepath.Join(root, ".crewdeck"), folder: filepath.Join(root, "carnet")}
	t.Setenv(state.HomeEnv, f.home)
	if err := os.MkdirAll(f.home, 0o700); err != nil {
		t.Fatal(err)
	}
	f.fake = githubtest.New(t, "testdata/miroir/graphql")
	f.fake.Schema(githubtest.GitHubSchema)

	writeFiles(t, f.folder, localTickets)
	gitIn(t, f.folder, "init")
	gitIn(t, f.folder, "add", ".")
	gitIn(t, f.folder, "commit", "-m", "les Tickets")
	gitIn(t, f.folder, "checkout", "-b", "feat/12-x")
	writeFiles(t, f.folder, map[string]string{"panier.txt": "le panier\n"})
	gitIn(t, f.folder, "add", ".")
	gitIn(t, f.folder, "commit", "-m", "feat(web) : le panier")
	head := gitIn(t, f.folder, "rev-parse", "HEAD")
	gitIn(t, f.folder, "checkout", "main")

	home := state.Store{Dir: f.home}
	if err := home.Save(state.State{Server: "http://127.0.0.1:1", RunnerID: "runner-id", Token: "rnr_token",
		Projects: map[string]string{"P2": f.folder}}); err != nil {
		t.Fatal(err)
	}
	store, err := mirror.Open(filepath.Join(f.home, mirror.FileName))
	if err != nil {
		t.Fatal(err)
	}
	f.store = store
	t.Cleanup(func() { store.Close() })
	if err := store.PutProjects([]mirror.Project{
		{Repository: ghKey, ProjectID: "P1", Source: mirror.SourceGitHub, Groups: []string{mirror.GroupTicket, mirror.GroupCode},
			GitHubRepoID: 1, InstallationID: 1, DisplayName: "Atelier", IntegrationBranch: "develop"},
		{Repository: localKey, ProjectID: "P2", Source: mirror.SourceLocal, Groups: []string{mirror.GroupTicket, mirror.GroupCode},
			DisplayName: "Carnet", IntegrationBranch: "main", Folder: f.folder},
	}); err != nil {
		t.Fatal(err)
	}

	vault := miroirVault(t)
	locals, err := openLocal(home, func() *keys.Vault { return vault })
	if err != nil {
		t.Fatal(err)
	}
	f.locals = locals
	t.Cleanup(func() { locals.Close() })
	project, ok := locals.Project("P2")
	if !ok {
		t.Fatal("no Local Projet P2")
	}
	ctx := context.Background()
	if _, err := project.Scan(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := project.Comment(ctx, 12, "octo", "La limite atteinte, on attend.", ""); err != nil {
		t.Fatal(err)
	}
	db := locals.db.SQL()
	if _, err := db.Exec(`INSERT INTO changes (project_id, number, title, body, head_ref, head_oid, base_ref, state, mergeable, author, created_at, updated_at)
		VALUES ('P2', 7, 'Le panier, la PR', 'Closes #12', 'feat/12-x', ?, 'main', 'open', 'MERGEABLE', 'agent-bot', '2026-11-05T08:00:00Z', '2026-11-05T08:00:00Z')`, head); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO reviews (id, project_id, number, author, state, body, commit_oid, submitted_at)
		VALUES ('r1', 'P2', 7, 'relecteur', 'APPROVED', 'Bien.', ?, '2026-11-06T09:00:00Z')`, head); err != nil {
		t.Fatal(err)
	}

	client := &mirror.Client{BaseURL: f.fake.URL, Logger: miroirLogger}
	follower, err := mirror.NewFollower(mirror.FollowerConfig{Store: store, GitHub: client, Logger: miroirLogger,
		Locals: locals, Folders: locals.folders,
		Tokens: func(string) github.TokenSource { return miroirToken("ghs_miroir") }})
	if err != nil {
		t.Fatal(err)
	}
	f.follower = follower
	if _, err := follower.Sync(ctx, "", false); err != nil {
		t.Fatalf("fill the copy: %v", err)
	}
	f.fake.Reset()
	f.start(t)
	return f
}

// start serves runner.sock as the running Runner does.
func (f *miroirFixture) start(t *testing.T) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	f.sock = &localsock.Server{}
	f.follower.Register(f.sock)
	socket := filepath.Join(f.home, localsock.SocketName)
	done := make(chan struct{})
	go func() {
		defer close(done)
		f.sock.Serve(ctx, socket)
	}()
	f.stop = func() {
		cancel()
		<-done
	}
	t.Cleanup(f.stop)
	for i := 0; i < 200; i++ {
		if err := localsock.Call(context.Background(), socket, mirror.OpState, nil, &mirror.StateReply{}); err == nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("runner.sock does not answer")
}

// states makes the running Runner answer each key's state as given.
func (f *miroirFixture) states(t *testing.T, keys map[string]mirror.KeyState) {
	t.Helper()
	f.sock.Handle(mirror.OpState, func(context.Context, json.RawMessage) (any, error) {
		return mirror.StateReply{Connected: true, Keys: keys}, nil
	})
}

func at(d time.Duration) *string {
	s := time.Now().Add(-d).UTC().Format(time.RFC3339)
	return &s
}

// githubDir is a checkout of acme/atelier.
func githubDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	gitIn(t, dir, "init")
	gitIn(t, dir, "remote", "add", "origin", "https://github.com/acme/atelier.git")
	return dir
}

// sessionDir is a Session's worktree of the Local Projet's clone, as the
// Runner makes it (<state>/repos/local/<projectId>).
func (f *miroirFixture) sessionDir(t *testing.T) string {
	t.Helper()
	clone := filepath.Join(f.home, "repos", "local", "P2")
	if _, err := os.Stat(clone); err != nil {
		gitIn(t, f.home, "clone", "--quiet", f.folder, clone)
	}
	dir := filepath.Join(t.TempDir(), "session")
	gitIn(t, clone, "worktree", "add", "--quiet", "-b", "session-"+filepath.Base(filepath.Dir(dir)), dir)
	return dir
}

// runMiroir runs `crewdeck-runner miroir args…` in dir.
func runMiroir(t *testing.T, dir string, args ...string) (string, string, error) {
	t.Helper()
	t.Chdir(dir)
	var stdout, stderr bytes.Buffer
	root := newRoot(&machine{})
	root.SetOut(&stdout)
	root.SetErr(&stderr)
	root.SetIn(strings.NewReader(""))
	root.SetArgs(append([]string{"miroir"}, args...))
	err := root.Execute()
	return stdout.String(), stderr.String(), err
}

// jq runs filter on the JSON document.
func jq(t *testing.T, document []byte, filter string) any {
	t.Helper()
	var input any
	if err := json.Unmarshal(document, &input); err != nil {
		t.Fatalf("not JSON: %v\n%s", err, document)
	}
	query, err := gojq.Parse(filter)
	if err != nil {
		t.Fatal(err)
	}
	v, ok := query.Run(input).Next()
	if !ok {
		t.Fatal("jq: no output")
	}
	if err, ok := v.(error); ok {
		t.Fatalf("jq: %v", err)
	}
	return v
}

// miroirTestdata is absolute: the commands run in another directory.
var miroirTestdata, _ = filepath.Abs(filepath.Join("testdata", "miroir"))

func golden(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(miroirTestdata, name))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

const (
	issueFilter = `{number, title, labels: [.labels[].name], blockedBy}`
	pullFilter  = `{headRefOid, checks: [.statusCheckRollup[] | {name, status, conclusion}], reviews: [.reviews[] | {author: .author.login, state, body, commit: .commit.oid}]}`
)

func keysOf(t *testing.T, document string) []string {
	t.Helper()
	var object map[string]any
	if err := json.Unmarshal([]byte(document), &object); err != nil {
		t.Fatalf("not JSON: %v\n%s", err, document)
	}
	var out []string
	for k := range object {
		out = append(out, k)
	}
	return sortedStrings(out)
}

func sortedStrings(s []string) []string {
	out := append([]string{}, s...)
	for i := range out {
		for j := i + 1; j < len(out); j++ {
			if out[j] < out[i] {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

func TestMiroirViewPrintsTheFieldsInGhsShapesForAGitHubKey(t *testing.T) {
	f := newMiroirFixture(t)
	f.states(t, map[string]mirror.KeyState{ghKey: {State: mirror.FreshnessLive, SyncedAt: at(time.Minute)}})
	dir := githubDir(t)

	out, stderr, err := runMiroir(t, dir, "issue", "view", "12", "--json", "number,title,labels,blockedBy")
	if err != nil || stderr != "" {
		t.Fatalf("issue view: %v\n%s", err, stderr)
	}
	if got := keysOf(t, out); !reflect.DeepEqual(got, []string{"blockedBy", "labels", "number", "title"}) {
		t.Errorf("fields %v", got)
	}
	if got, want := jq(t, []byte(out), issueFilter), jq(t, golden(t, "gh-issue-view-12.json"), issueFilter); !reflect.DeepEqual(got, want) {
		t.Errorf("issue view 12 | jq = %v, gh's = %v", got, want)
	}

	out, stderr, err = runMiroir(t, dir, "pr", "view", "7", "--json", "headRefOid,statusCheckRollup,reviews")
	if err != nil || stderr != "" {
		t.Fatalf("pr view: %v\n%s", err, stderr)
	}
	if got := keysOf(t, out); !reflect.DeepEqual(got, []string{"headRefOid", "reviews", "statusCheckRollup"}) {
		t.Errorf("fields %v", got)
	}
	if got, want := jq(t, []byte(out), pullFilter), jq(t, golden(t, "gh-pr-view-7.json"), pullFilter); !reflect.DeepEqual(got, want) {
		t.Errorf("pr view 7 | jq = %v, gh's = %v", got, want)
	}
	if n := f.fake.Count("MirrorObject"); n != 0 {
		t.Errorf("a live key fetched %d times", n)
	}
}

func TestMiroirViewAnswersALocalProjetFromItsFolderInTheSameShapes(t *testing.T) {
	f := newMiroirFixture(t)
	dir := f.sessionDir(t)

	out, stderr, err := runMiroir(t, dir, "issue", "view", "12", "--json", "number,title,labels,blockedBy,milestone,comments")
	if err != nil || stderr != "" {
		t.Fatalf("issue view: %v\n%s", err, stderr)
	}
	if got, want := jq(t, []byte(out), issueFilter), jq(t, golden(t, "gh-issue-view-12.json"), issueFilter); !reflect.DeepEqual(got, want) {
		t.Errorf("issue view 12 | jq = %v, gh's = %v", got, want)
	}
	if due := jq(t, []byte(out), `.milestone | {number, title, dueOn}`); !reflect.DeepEqual(due, map[string]any{"number": 2.0, "title": "M2 Le panier", "dueOn": "2026-12-15T00:00:00Z"}) {
		t.Errorf("milestone %v", due)
	}
	if c := jq(t, []byte(out), `[.comments[] | {author: .author.login, body}]`); !reflect.DeepEqual(c, []any{map[string]any{"author": "octo", "body": "La limite atteinte, on attend."}}) {
		t.Errorf("comments %v", c)
	}

	out, stderr, err = runMiroir(t, dir, "pr", "view", "7", "--json", "headRefOid,statusCheckRollup,reviews,closingIssuesReferences")
	if err != nil || stderr != "" {
		t.Fatalf("pr view: %v\n%s", err, stderr)
	}
	head := gitIn(t, f.folder, "rev-parse", "feat/12-x")
	want := map[string]any{"headRefOid": head, "checks": []any{},
		"reviews": []any{map[string]any{"author": "relecteur", "state": "APPROVED", "body": "Bien.", "commit": head}}}
	if got := jq(t, []byte(out), pullFilter); !reflect.DeepEqual(got, want) {
		t.Errorf("pr view 7 | jq = %v, want %v", got, want)
	}
	if closing := jq(t, []byte(out), `[.closingIssuesReferences[].number]`); !reflect.DeepEqual(closing, []any{12.0}) {
		t.Errorf("closingIssuesReferences %v", closing)
	}
}

func TestMiroirJqAndJsonWithoutFields(t *testing.T) {
	newMiroirFixture(t)
	dir := githubDir(t)

	out, _, err := runMiroir(t, dir, "issue", "view", "12", "--json", "labels", "--jq", ".labels[].name")
	if err != nil || out != "priority:P1\nready-for-agent\nsize:S\n" {
		t.Errorf("--jq: %v, %q", err, out)
	}
	out, stderr, err := runMiroir(t, dir, "issue", "view", "12", "--json")
	if exitCode(err) != 1 {
		t.Errorf("--json without fields: exit %d (%v)", exitCode(err), err)
	}
	for _, field := range mirror.IssueFields {
		if !strings.Contains(out+stderr, "  "+field+"\n") {
			t.Errorf("--json lacks %s:\n%s%s", field, out, stderr)
		}
	}
	if _, _, err := runMiroir(t, dir, "issue", "view", "12", "--json", "nope"); exitCode(err) != 1 {
		t.Errorf("an unknown field: exit %d", exitCode(err))
	}
}

func TestMiroirListFiltersAsGhOnBothSources(t *testing.T) {
	f := newMiroirFixture(t)
	f.states(t, map[string]mirror.KeyState{ghKey: {State: mirror.FreshnessLive, SyncedAt: at(time.Minute)},
		localKey: {State: mirror.FreshnessLive, SyncedAt: at(time.Minute)}})
	for _, c := range []struct {
		name, dir string
		issues    []any
	}{{"github", githubDir(t), []any{15.0, 14.0, 13.0, 12.0}}, {"local", f.sessionDir(t), []any{14.0, 13.0, 12.0}}} {
		t.Run(c.name, func(t *testing.T) {
			out, stderr, err := runMiroir(t, c.dir, "issue", "list", "--label", "ready-for-agent", "--state", "open", "--json", "number")
			if err != nil {
				t.Fatalf("issue list: %v\n%s", err, stderr)
			}
			var got []map[string]any
			if err := json.Unmarshal([]byte(out), &got); err != nil {
				t.Fatalf("%v\n%s", err, out)
			}
			var numbers []any
			for _, o := range got {
				if len(o) != 1 {
					t.Errorf("fields %v", o)
				}
				numbers = append(numbers, o["number"])
			}
			if !reflect.DeepEqual(numbers, c.issues) {
				t.Errorf("issue list = %v, want %v", numbers, c.issues)
			}
			out, _, err = runMiroir(t, c.dir, "pr", "list", "--head", "feat/12-x", "--json", "number", "--jq", ".[].number")
			if err != nil || out != "7\n" {
				t.Errorf("pr list --head: %v, %q", err, out)
			}
			out, _, err = runMiroir(t, c.dir, "pr", "list", "--head", "feat/99-z", "--json", "number")
			if err != nil || strings.TrimSpace(out) != "[]" {
				t.Errorf("pr list --head of no PR: %v, %q", err, out)
			}
		})
	}
}
