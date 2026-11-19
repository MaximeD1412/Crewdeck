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
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github/githubtest"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mirror"
	"github.com/maximed1412/crewdeck/apps/runner/internal/service"
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
func newMiroirFixture(t *testing.T) *miroirFixture { return newMiroirFixtureOf(t, false) }

// newMiroirFixtureOf, mixed: one Projet, P3, its Tickets Local (local/P3)
// and its code on GitHub (acme/atelier).
func newMiroirFixtureOf(t *testing.T, mixed bool) *miroirFixture {
	t.Helper()
	id := "P2"
	if mixed {
		id = "P3"
	}
	root := t.TempDir()
	f := &miroirFixture{home: filepath.Join(root, ".crewdeck"), folder: filepath.Join(root, "carnet")}
	t.Setenv(state.HomeEnv, f.home)
	if err := os.MkdirAll(f.home, 0o700); err != nil {
		t.Fatal(err)
	}
	f.fake = githubtest.New(t, "testdata/miroir/graphql")
	f.fake.Schema(githubtest.GitHubSchema)

	writeFiles(t, f.folder, localTickets)
	if mixed {
		writeFiles(t, f.folder, map[string]string{"tickets/3-la-vitrine-locale.md": "---\nnumber: 3\ntitle: La vitrine, le Ticket\n---\n\nLe Ticket local.\n"})
	}
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
		Projects: map[string]string{id: f.folder}}); err != nil {
		t.Fatal(err)
	}
	store, err := mirror.Open(filepath.Join(f.home, mirror.FileName))
	if err != nil {
		t.Fatal(err)
	}
	f.store = store
	t.Cleanup(func() { store.Close() })
	projects := []mirror.Project{
		{Repository: ghKey, ProjectID: "P1", Source: mirror.SourceGitHub, Groups: []string{mirror.GroupTicket, mirror.GroupCode},
			GitHubRepoID: 1, InstallationID: 1, DisplayName: "Atelier", IntegrationBranch: "develop"},
		{Repository: localKey, ProjectID: "P2", Source: mirror.SourceLocal, Groups: []string{mirror.GroupTicket, mirror.GroupCode},
			DisplayName: "Carnet", IntegrationBranch: "main", Folder: f.folder},
	}
	if mixed {
		projects = []mirror.Project{
			{Repository: ghKey, ProjectID: id, Source: mirror.SourceGitHub, Groups: []string{mirror.GroupCode},
				GitHubRepoID: 1, InstallationID: 1, DisplayName: "Vitrine", IntegrationBranch: "develop"},
			{Repository: mirror.LocalPrefix + id, ProjectID: id, Source: mirror.SourceLocal, Groups: []string{mirror.GroupTicket},
				DisplayName: "Vitrine", IntegrationBranch: "main", Folder: f.folder},
		}
	}
	if err := store.PutProjects(projects); err != nil {
		t.Fatal(err)
	}

	vault := miroirVault(t)
	locals, err := openLocal(home, func() *keys.Vault { return vault })
	if err != nil {
		t.Fatal(err)
	}
	f.locals = locals
	t.Cleanup(func() { locals.Close() })
	project, ok := locals.Project(id)
	if !ok {
		t.Fatal("no Local Projet " + id)
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
		VALUES (?, 7, 'Le panier, la PR', 'Closes #12', 'feat/12-x', ?, 'main', 'open', 'MERGEABLE', 'agent-bot', '2026-11-05T08:00:00Z', '2026-11-05T08:00:00Z')`, id, head); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO reviews (id, project_id, number, author, state, body, commit_oid, submitted_at)
		VALUES ('r1', ?, 7, 'relecteur', 'APPROVED', 'Bien.', ?, '2026-11-06T09:00:00Z')`, id, head); err != nil {
		t.Fatal(err)
	}

	client := &mirror.Client{BaseURL: f.fake.URL, Logger: miroirLogger}
	// The Runner's clones, a GitHub key's never made: no test reaches GitHub.
	clones := mirrorClones(f.home, "", locals)
	localOrigin := clones.Origin
	clones.Origin = func(p mirror.Project, tokens github.TokenSource) mirror.Origin {
		if p.Source != mirror.SourceLocal {
			return nil
		}
		return localOrigin(p, tokens)
	}
	follower, err := mirror.NewFollower(mirror.FollowerConfig{Store: store, GitHub: client, Logger: miroirLogger,
		Locals: locals, Folders: locals.folders, Clones: clones,
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
	if err == nil || exitCode(err) != 1 {
		t.Errorf("--json without fields: exit %d (%v)", exitCode(err), err)
	}
	for _, field := range mirror.IssueFields {
		if !strings.Contains(out+stderr, "  "+field+"\n") {
			t.Errorf("--json lacks %s:\n%s%s", field, out, stderr)
		}
	}
	if _, _, err := runMiroir(t, dir, "issue", "view", "12", "--json", "nope"); err == nil || exitCode(err) != 1 {
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

// readyLines are `ready`'s lines as (number, available).
func readyLines(t *testing.T, out string) [][2]any {
	t.Helper()
	var lines [][2]any
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if line == "" {
			continue
		}
		var r map[string]any
		if err := json.Unmarshal([]byte(line), &r); err != nil {
			t.Fatalf("%v: %q", err, line)
		}
		lines = append(lines, [2]any{r["number"], r["available"]})
	}
	return lines
}

func TestMiroirReadyOnBothSources(t *testing.T) {
	f := newMiroirFixture(t)
	f.states(t, map[string]mirror.KeyState{ghKey: {State: mirror.FreshnessLive, SyncedAt: at(time.Minute)},
		localKey: {State: mirror.FreshnessLive, SyncedAt: at(time.Minute)}})
	for _, c := range []struct {
		name, dir      string
		available, all [][2]any
	}{
		// 12 has PR 7 on feat/12-x, 13 is blocked by 12 still open; 15 (P0, M2
		// due) before 14 (no milestone).
		{"github", githubDir(t), [][2]any{{15.0, true}, {14.0, true}},
			[][2]any{{15.0, true}, {14.0, true}, {12.0, false}, {13.0, false}}},
		{"local", f.sessionDir(t), [][2]any{{14.0, true}}, [][2]any{{14.0, true}, {12.0, false}, {13.0, false}}},
	} {
		t.Run(c.name, func(t *testing.T) {
			out, stderr, err := runMiroir(t, c.dir, "ready")
			if err != nil || stderr != "" {
				t.Fatalf("ready: %v\n%s", err, stderr)
			}
			if got := readyLines(t, out); !reflect.DeepEqual(got, c.available) {
				t.Errorf("ready = %v, want %v", got, c.available)
			}
			out, _, _ = runMiroir(t, c.dir, "ready", "--all")
			if got := readyLines(t, out); !reflect.DeepEqual(got, c.all) {
				t.Errorf("ready --all = %v, want %v", got, c.all)
			}
			out, _, _ = runMiroir(t, c.dir, "ready", "--all", "--numbers", "13,14")
			if got := readyLines(t, out); !reflect.DeepEqual(got, [][2]any{{14.0, true}, {13.0, false}}) {
				t.Errorf("ready --all --numbers 13,14 = %v", got)
			}
		})
	}
	out, _, _ := runMiroir(t, githubDir(t), "ready", "--all", "--numbers", "13")
	if !strings.Contains(out, `"openBlockers":[12]`) || !strings.Contains(out, `"milestone":"M2 Le panier","due":"2026-12-15T00:00:00Z"`) {
		t.Errorf("ready 13: %s", out)
	}
}

func TestMiroirATicketFileEditedByHandIsTheAnswerOfASession(t *testing.T) {
	f := newMiroirFixture(t)
	dir := f.sessionDir(t)
	writeFiles(t, f.folder, map[string]string{"tickets/12-le-panier.md": strings.Replace(localTickets["tickets/12-le-panier.md"], "title: Le panier", "title: Le panier, revu à la main", 1)})

	out, stderr, err := runMiroir(t, dir, "issue", "view", "12", "--json", "title", "--jq", ".title")
	if err != nil || stderr != "" || out != "Le panier, revu à la main\n" {
		t.Fatalf("issue view: %v, %q, stderr %q", err, out, stderr)
	}
}

func TestMiroirAProjetWithItsTicketsLocalAndItsCodeOnGitHub(t *testing.T) {
	newMiroirFixtureOf(t, true)
	dir := githubDir(t)

	out, stderr, err := runMiroir(t, dir, "issue", "view", "3", "--json", "title,url", "--jq", ".title, .url")
	if err != nil || stderr != "" || !strings.HasPrefix(out, "La vitrine, le Ticket\nfile://") || !strings.HasSuffix(out, "tickets/3-la-vitrine-locale.md\n") {
		t.Errorf("issue view 3: %v, %q, stderr %q", err, out, stderr)
	}
	out, stderr, err = runMiroir(t, dir, "pr", "view", "3", "--json", "title,state", "--jq", ".title, .state")
	if err != nil || out != "La vitrine, la PR\nMERGED\n" {
		t.Errorf("pr view 3: %v, %q, stderr %q", err, out, stderr)
	}
}

func TestMiroirALateKeyFetchesTheObjectFirst(t *testing.T) {
	f := newMiroirFixture(t)
	dir := githubDir(t)

	out, stderr, err := runMiroir(t, dir, "issue", "view", "12", "--json", "title", "--jq", ".title")
	if err != nil || stderr != "" || out != "Le panier\n" {
		t.Fatalf("issue view of a late key: %v, %q, stderr %q", err, out, stderr)
	}
	if n := f.fake.Count("MirrorObject"); n == 0 {
		t.Error("a late key's view did not fetch the object")
	}

	f.states(t, map[string]mirror.KeyState{ghKey: {State: mirror.FreshnessLate, SyncedAt: at(2*time.Hour + time.Minute)}})
	f.fake.Fail("MirrorObject", githubtest.BadGateway(), 100)
	out, stderr, err = runMiroir(t, dir, "issue", "view", "12", "--json", "title", "--jq", ".title")
	if err != nil || out != "Le panier\n" {
		t.Fatalf("issue view when the fetch fails: %v, %q", err, out)
	}
	if stderr != "Miroir en retard pour Atelier : dernière synchro il y a 2 h\n" {
		t.Errorf("stderr %q", stderr)
	}
}

func TestMiroirAFillingKeyListsFromGitHubAndReadyExits3(t *testing.T) {
	f := newMiroirFixture(t)
	f.states(t, map[string]mirror.KeyState{ghKey: {State: mirror.FreshnessFilling}})
	dir := githubDir(t)

	out, _, err := runMiroir(t, dir, "issue", "list", "--state", "open", "--json", "number", "--jq", "[.[].number]")
	if err != nil || out != "[15,14,13,12]\n" {
		t.Errorf("issue list of a filling key: %v, %q", err, out)
	}
	if n := f.fake.Count("MirrorListIssues"); n == 0 {
		t.Error("the list did not come from GitHub")
	}
	_, stderr, err := runMiroir(t, dir, "ready")
	if exitCode(err) != 3 || stderr != "Miroir en remplissage pour Atelier\n" {
		t.Errorf("ready of a filling key: exit %d, stderr %q", exitCode(err), stderr)
	}
}

func TestMiroirWithoutARunnerAnswersFromTheCopy(t *testing.T) {
	f := newMiroirFixture(t)
	f.stop()
	dir := githubDir(t)

	out, stderr, err := runMiroir(t, dir, "issue", "view", "12", "--json", "title", "--jq", ".title")
	if err != nil || out != "Le panier\n" {
		t.Fatalf("issue view: %v, %q", err, out)
	}
	if !strings.HasPrefix(stderr, "Miroir en retard pour Atelier : dernière synchro il y a ") {
		t.Errorf("stderr %q", stderr)
	}
	_, _, err = runMiroir(t, dir, "sync")
	if exitCode(err) != 1 || err == nil || !strings.Contains(err.Error(), "Le Runner n'est pas démarré") {
		t.Errorf("sync without a Runner: exit %d, %v", exitCode(err), err)
	}
}

func TestMiroirSearchAndSQL(t *testing.T) {
	newMiroirFixture(t)
	outside := t.TempDir()

	out, _, err := runMiroir(t, outside, "search", "limite atteinte", "--kind", "comment")
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	repositories := jq(t, []byte(out), `[.rows[].repository] | unique`)
	if !reflect.DeepEqual(repositories, []any{ghKey, localKey}) {
		t.Errorf("search found %v:\n%s", repositories, out)
	}
	if fresh := jq(t, []byte(out), `.freshness | keys`); !reflect.DeepEqual(fresh, []any{ghKey, localKey}) {
		t.Errorf("freshness %v", fresh)
	}

	out, _, err = runMiroir(t, outside, "sql", "select count(*) as n from issues")
	if err != nil {
		t.Fatalf("sql: %v", err)
	}
	// 4 issues and 2 PRs of acme/atelier, 3 Tickets and 1 change of local/P2.
	if rows := jq(t, []byte(out), `.rows`); !reflect.DeepEqual(rows, []any{map[string]any{"n": 10.0}}) {
		t.Errorf("sql rows %v:\n%s", rows, out)
	}
	if _, _, err := runMiroir(t, outside, "sql", "delete from issues"); err == nil || exitCode(err) != 1 {
		t.Errorf("sql delete: exit %d", exitCode(err))
	}
	out, _, _ = runMiroir(t, outside, "sql", "select count(*) as n from issues")
	if !strings.Contains(out, `"n":10`) {
		t.Errorf("the copy changed: %s", out)
	}
}

func TestMiroirSearchKindDocFindsWhatALocalProjetJustCommitted(t *testing.T) {
	f := newMiroirFixture(t)
	outside := t.TempDir()
	search := func() any {
		t.Helper()
		out, _, err := runMiroir(t, outside, "search", "vitrine carnet", "--kind", "doc")
		if err != nil {
			t.Fatalf("search: %v", err)
		}
		return jq(t, []byte(out), `[.rows[] | {repository, path, title, kind}]`)
	}
	if rows := search(); !reflect.DeepEqual(rows, []any{}) {
		t.Fatalf("a document before its commit: %v", rows)
	}

	// Committed on main, the integration branch, the Runner watching nothing:
	// the search synchronizes the Local key before reading the copy.
	writeFiles(t, f.folder, map[string]string{"docs/guide.md": "# Le guide\n\nLa vitrine du carnet.\n", "notes.md": "vitrine carnet\n"})
	gitIn(t, f.folder, "add", ".")
	gitIn(t, f.folder, "commit", "-m", "docs : le guide")
	want := []any{map[string]any{"repository": localKey, "path": "docs/guide.md", "title": "Le guide", "kind": "doc"}}
	if rows := search(); !reflect.DeepEqual(rows, want) {
		t.Errorf("search found %v, want %v", rows, want)
	}
}

func readFiles(t *testing.T, paths ...string) map[string][]byte {
	t.Helper()
	out := map[string][]byte{}
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		out[p] = data
	}
	return out
}

func TestMiroirRebuildRefillsALocalProjetAndLeavesLocalDBUnchanged(t *testing.T) {
	f := newMiroirFixture(t)
	dir := f.sessionDir(t)
	db := filepath.Join(f.home, "local.db")
	// A Ticket edited by hand since the last scan: its new date and hash are not in local.db.
	twelve := filepath.Join(f.folder, "tickets", "12-le-panier.md")
	writeFiles(t, f.folder, map[string]string{"tickets/12-le-panier.md": strings.Replace(localTickets["tickets/12-le-panier.md"], "title: Le panier", "title: Le panier, revu", 1)})
	if err := os.Chtimes(twelve, time.Now(), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	before := readFiles(t, db, db+"-wal")

	out, _, err := runMiroir(t, dir, "rebuild")
	if err != nil || out != "Miroir reconstruit : remplissage en cours\n" {
		t.Fatalf("rebuild: %v, %q", err, out)
	}
	out, stderr, err := runMiroir(t, dir, "issue", "list", "--json", "number,title", "--jq", `[.[] | "\(.number) \(.title)"]`)
	if err != nil || out != `["14 Le README","13 Le paiement","12 Le panier, revu"]`+"\n" {
		t.Errorf("issue list after rebuild: %v, %q, stderr %q", err, out, stderr)
	}
	if after := readFiles(t, db, db+"-wal"); !reflect.DeepEqual(before, after) {
		t.Error("local.db changed")
	}
}

func TestStatusShowsTheMiroirInEachState(t *testing.T) {
	f := newMiroirFixture(t)
	m := &machine{
		service: func() (service.Config, error) { return service.Config{OS: "linux", WSL: true, Home: t.TempDir()}, nil },
		engines: func(context.Context) []contracts.EngineCapabilities { return nil },
	}
	for _, c := range []struct {
		keys map[string]mirror.KeyState
		line string
	}{
		{map[string]mirror.KeyState{ghKey: {State: mirror.FreshnessLive, SyncedAt: at(time.Minute)}, localKey: {State: mirror.FreshnessLive, SyncedAt: at(time.Minute)}}, "Miroir : à jour"},
		{map[string]mirror.KeyState{ghKey: {State: mirror.FreshnessFilling}, localKey: {State: mirror.FreshnessLive, SyncedAt: at(time.Minute)}}, "Miroir : en remplissage"},
		{map[string]mirror.KeyState{ghKey: {State: mirror.FreshnessLate, SyncedAt: at(3*time.Hour + time.Minute)}, localKey: {State: mirror.FreshnessLive, SyncedAt: at(time.Minute)}}, "Miroir : en retard depuis 3 h"},
	} {
		f.states(t, c.keys)
		var out bytes.Buffer
		root := newRoot(m)
		root.SetOut(&out)
		root.SetErr(&out)
		root.SetArgs([]string{"status"})
		if err := root.Execute(); err != nil {
			t.Fatalf("status: %v\n%s", err, out.String())
		}
		if !strings.Contains(out.String(), c.line+"\n") {
			t.Errorf("status lacks %q:\n%s", c.line, out.String())
		}
	}
}

func TestMiroirStatusAndSyncWithARunner(t *testing.T) {
	f := newMiroirFixture(t)
	outside := t.TempDir()

	out, _, err := runMiroir(t, outside, "status", "--json")
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	keys := jq(t, []byte(out), `[.keys[] | {repository, state, issues, pulls}]`)
	want := []any{
		map[string]any{"repository": ghKey, "state": "late", "issues": 4.0, "pulls": 2.0},
		map[string]any{"repository": localKey, "state": "live", "issues": 3.0, "pulls": 1.0},
	}
	if !reflect.DeepEqual(keys, want) {
		t.Errorf("status keys %v", keys)
	}
	if runner := jq(t, []byte(out), `.socket.runner`); runner != true {
		t.Errorf("socket %v", runner)
	}

	out, _, err = runMiroir(t, outside, "sync", "--repo", ghKey)
	if err != nil || out != "Miroir synchronisé : Atelier\n" {
		t.Errorf("sync --repo: %v, %q", err, out)
	}
	out, _, err = runMiroir(t, outside, "sync")
	if err != nil || out != "Miroir synchronisé : Atelier\nMiroir synchronisé : Carnet\n" {
		t.Errorf("sync: %v, %q", err, out)
	}
	if n := f.fake.Count("MirrorIssues"); n == 0 {
		t.Error("sync did not walk GitHub")
	}
}

// override answers a fixture of testdata/miroir/graphql again, with its
// variables, as change makes its data.
func (f *miroirFixture) override(t *testing.T, name string, change func(data map[string]any)) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(miroirTestdata, "graphql", name))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Operation string         `json:"operation"`
		Variables map[string]any `json:"variables"`
		Data      map[string]any `json:"data"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	change(fixture.Data)
	f.fake.Reply(fixture.Operation, fixture.Variables, fixture.Data)
}

// dig is the map at path in data.
func dig(data map[string]any, path ...string) map[string]any {
	for _, p := range path {
		data = data[p].(map[string]any)
	}
	return data
}

func TestMiroirAnObjectClosedOrMergedWhileAwayIsReadAgain(t *testing.T) {
	f := newMiroirFixture(t)
	dir := githubDir(t)
	// While the Runner was away, 12 was closed and PR 7 merged: neither is in
	// GitHub's open lists any more.
	f.override(t, "open-issues.json", func(d map[string]any) {
		issues := dig(d, "repository", "issues")
		issues["nodes"] = issues["nodes"].([]any)[1:]
	})
	f.override(t, "open-pulls.json", func(d map[string]any) { dig(d, "repository", "pullRequests")["nodes"] = []any{} })
	f.override(t, "object-12.json", func(d map[string]any) {
		o := dig(d, "repository", "issueOrPullRequest")
		o["issueState"], o["stateReason"], o["closedAt"], o["updatedAt"] = "CLOSED", "COMPLETED", "2026-11-12T09:00:00Z", "2026-11-12T09:00:00Z"
	})
	f.override(t, "object-7.json", func(d map[string]any) {
		o := dig(d, "repository", "issueOrPullRequest")
		o["pullState"], o["mergedAt"], o["closedAt"], o["updatedAt"] = "MERGED", "2026-11-12T08:00:00Z", "2026-11-12T08:00:00Z", "2026-11-12T08:00:00Z"
	})

	out, stderr, err := runMiroir(t, dir, "issue", "list", "--state", "open", "--json", "number", "--jq", "[.[].number]")
	if err != nil || stderr != "" || out != "[15,14,13]\n" {
		t.Errorf("issue list after a closing while away: %v, %q, stderr %q", err, out, stderr)
	}
	out, _, err = runMiroir(t, dir, "pr", "list", "--json", "number", "--jq", "[.[].number]")
	if err != nil || out != "[]\n" {
		t.Errorf("pr list after a merge while away: %v, %q", err, out)
	}
	out, _, err = runMiroir(t, dir, "pr", "view", "7", "--json", "state", "--jq", ".state")
	if err != nil || out != "MERGED\n" {
		t.Errorf("pr view 7: %v, %q", err, out)
	}
	out, _, _ = runMiroir(t, dir, "ready", "--all", "--numbers", "13")
	if got := readyLines(t, out); !reflect.DeepEqual(got, [][2]any{{13.0, true}}) {
		t.Errorf("ready 13 once its blocker closed = %v", got)
	}
}

func TestMiroirViewOfTheOtherKindIsNotFound(t *testing.T) {
	f := newMiroirFixture(t)
	f.states(t, map[string]mirror.KeyState{ghKey: {State: mirror.FreshnessLive, SyncedAt: at(time.Minute)}})
	dir := githubDir(t)

	for _, args := range [][]string{{"pr", "view", "12", "--json", "headRefOid"}, {"issue", "view", "7", "--json", "title"}} {
		out, _, err := runMiroir(t, dir, args...)
		if exitCode(err) != 1 || out != "" || err == nil || err.Error() != "#"+args[2]+" n'existe pas dans Atelier." {
			t.Errorf("%v: exit %d, %v, %q", args, exitCode(err), err, out)
		}
	}
}

func TestMiroirAFillingKeyListsItsPullsWithTheirChecks(t *testing.T) {
	f := newMiroirFixture(t)
	f.states(t, map[string]mirror.KeyState{ghKey: {State: mirror.FreshnessFilling}})
	f.fake.Reply("MirrorListPulls", map[string]any{"owner": "acme", "name": "atelier", "states": []any{"OPEN"}, "after": nil},
		map[string]any{"repository": map[string]any{"pullRequests": map[string]any{
			"pageInfo": map[string]any{"hasNextPage": false, "endCursor": nil},
			"nodes": []any{map[string]any{"number": 7, "state": "OPEN", "headRefName": "feat/12-x",
				"author": map[string]any{"login": "agent-bot"}, "labels": map[string]any{"nodes": []any{}}}},
		}}})

	out, stderr, err := runMiroir(t, githubDir(t), "pr", "list", "--json", "number,statusCheckRollup",
		"--jq", `[.[] | {number, checks: [.statusCheckRollup[] | {name, conclusion}]}]`)
	if err != nil {
		t.Fatalf("pr list of a filling key: %v\n%s", err, stderr)
	}
	want := []any{map[string]any{"number": 7.0, "checks": []any{map[string]any{"name": "ci", "conclusion": "SUCCESS"}}}}
	if got := jq(t, []byte(out), "."); !reflect.DeepEqual(got, want) {
		t.Errorf("pr list = %v, want %v", got, want)
	}
	if n := f.fake.Count("MirrorListPulls"); n == 0 {
		t.Error("the list did not come from GitHub")
	}
}

func TestMiroirALocalCodeKeyWhoseFolderIsGoneAnswersFromTheCopyWithAWarning(t *testing.T) {
	f := newMiroirFixture(t)
	dir := f.sessionDir(t) // the Runner's clone stays, the Projet's folder goes
	// local/P2 holds only the code: its reads never scan the Tickets' files.
	if err := f.store.PutProjects([]mirror.Project{
		{Repository: ghKey, ProjectID: "P1", Source: mirror.SourceGitHub, Groups: []string{mirror.GroupTicket, mirror.GroupCode},
			GitHubRepoID: 1, InstallationID: 1, DisplayName: "Atelier", IntegrationBranch: "develop"},
		{Repository: localKey, ProjectID: "P2", Source: mirror.SourceLocal, Groups: []string{mirror.GroupCode},
			DisplayName: "Carnet", IntegrationBranch: "main", Folder: f.folder},
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(f.folder); err != nil {
		t.Fatal(err)
	}

	if _, _, err := runMiroir(t, dir, "sync", "--repo", localKey); err == nil || exitCode(err) != 1 {
		t.Errorf("sync of a folder gone: %v", err)
	}
	warning := "Miroir en retard pour Carnet : dernière synchro il y a moins d'une minute\n"
	out, stderr, err := runMiroir(t, dir, "pr", "view", "7", "--json", "title", "--jq", ".title")
	if err != nil || out != "Le panier, la PR\n" || stderr != warning {
		t.Errorf("pr view of a folder gone: %v, %q, stderr %q", err, out, stderr)
	}
	out, stderr, err = runMiroir(t, dir, "pr", "list", "--json", "number", "--jq", "[.[].number]")
	if err != nil || out != "[7]\n" || stderr != warning {
		t.Errorf("pr list of a folder gone: %v, %q, stderr %q", err, out, stderr)
	}
}

func TestMiroirAGitHubPRClosesALocalTicketByItsBody(t *testing.T) {
	f := newMiroirFixtureOf(t, true)
	dir := githubDir(t)
	// PR 7 on a branch out of BOUCLE-1's rule, its body closing Ticket 14 of
	// local/P3: GitHub has no issue 14, so no closing reference of its own.
	f.override(t, "object-7.json", func(d map[string]any) {
		o := dig(d, "repository", "issueOrPullRequest")
		o["headRefName"], o["body"], o["updatedAt"] = "feature/readme", "Le README.\n\nCloses #14", "2026-11-12T08:00:00Z"
		dig(o, "closingIssuesReferences")["nodes"] = []any{}
	})

	out, stderr, err := runMiroir(t, dir, "pr", "view", "7", "--json", "closingIssuesReferences", "--jq", "[.closingIssuesReferences[].number]")
	if err != nil || out != "[14]\n" {
		t.Errorf("pr view 7: %v, %q, stderr %q", err, out, stderr)
	}
	out, _, _ = runMiroir(t, dir, "ready", "--all")
	available := map[any]any{}
	for _, l := range readyLines(t, out) {
		available[l[0]] = l[1]
	}
	if available[14.0] != false || available[12.0] != true {
		t.Errorf("ready --all = %v, want 14 taken by PR 7 and 12 free", readyLines(t, out))
	}
}

// mergedWhileAway: while the Runner was away, PR 7 got the head B, its CI
// failed, and it was merged; mergedPull is `pr list --state merged`'s answer then.
func (f *miroirFixture) mergedWhileAway(t *testing.T) {
	t.Helper()
	f.override(t, "open-pulls.json", func(d map[string]any) { dig(d, "repository", "pullRequests")["nodes"] = []any{} })
	f.override(t, "object-7.json", func(d map[string]any) {
		o := dig(d, "repository", "issueOrPullRequest")
		o["pullState"], o["mergedAt"], o["closedAt"], o["updatedAt"] = "MERGED", "2026-11-12T08:00:00Z", "2026-11-12T08:00:00Z", "2026-11-12T08:00:00Z"
		o["headRefOid"], o["statusCheckRollup"] = headB, map[string]any{"state": "FAILURE"}
	})
	f.override(t, "checks-b.json", func(d map[string]any) {
		dig(d, "repository", "object")["statusCheckRollup"] = map[string]any{"contexts": map[string]any{
			"pageInfo": map[string]any{"hasNextPage": false, "endCursor": nil},
			"nodes": []any{map[string]any{"__typename": "CheckRun", "name": "ci", "status": "COMPLETED", "conclusion": "FAILURE",
				"detailsUrl": "https://github.com/acme/atelier/actions/runs/8", "startedAt": "2026-11-11T09:01:00Z", "completedAt": "2026-11-11T09:05:00Z"}},
		}}
	})
}

const headB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

var mergedPull = []any{map[string]any{"number": 7.0, "headRefOid": headB, "checks": []any{map[string]any{"name": "ci", "conclusion": "FAILURE"}}}}

func listMerged(t *testing.T, dir string) (any, string) {
	t.Helper()
	out, stderr, err := runMiroir(t, dir, "pr", "list", "--state", "merged", "--json", "number,headRefOid,statusCheckRollup",
		"--jq", `[.[] | select(.number == 7) | {number, headRefOid, checks: [.statusCheckRollup[] | {name, conclusion}]}]`)
	if err != nil {
		t.Fatalf("pr list --state merged: %v\n%s", err, stderr)
	}
	return jq(t, []byte(out), "."), stderr
}

func TestMiroirAPRWhoseHeadMovedThenMergedWhileAwayKeepsItsLastHeadsChecks(t *testing.T) {
	f := newMiroirFixture(t)
	f.mergedWhileAway(t)

	if got, stderr := listMerged(t, githubDir(t)); stderr != "" || !reflect.DeepEqual(got, mergedPull) {
		t.Errorf("pr list --state merged = %v, stderr %q, want %v", got, stderr, mergedPull)
	}
}

func TestMiroirChecksThatFailedToReadAfterAMergeAreReadAtTheNextList(t *testing.T) {
	f := newMiroirFixture(t)
	f.mergedWhileAway(t)
	f.fake.Fail("MirrorChecks", githubtest.BadGateway(), 1)
	dir := githubDir(t)

	got, stderr := listMerged(t, dir)
	if !strings.HasPrefix(stderr, "Miroir en retard pour Atelier") {
		t.Errorf("the first list, its checks unread: stderr %q", stderr)
	}
	if reflect.DeepEqual(got, mergedPull) {
		t.Errorf("the first list answered without its checks read: %v", got)
	}
	if got, stderr := listMerged(t, dir); stderr != "" || !reflect.DeepEqual(got, mergedPull) {
		t.Errorf("the next list = %v, stderr %q, want %v", got, stderr, mergedPull)
	}
}
