package mirror

import (
	"context"
	"errors"
	"os"
	osexec "os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/logging"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

// The documentation index (MIROIR-5): a GitHub Projet's documents from a
// bare repository over file://, as the Runner's clone (RUNNER-9) fetches
// it, and a Local Projet's from a git folder, its clone's origin (SOURCE-2).

// docsFiles are a Projet's files: three documents, and two files that are not.
var docsFiles = map[string]string{
	"docs/adr/0001-x.md":    "---\nstatus: accepted\n---\n\n# Le Miroir\n\nLe Miroir copie GitHub sur la machine du Pilote.\n",
	"AGENTS.md":             "# Instructions\n\nLire le PRD avant tout ticket.\n",
	"backlog/issues/A-1.md": "---\ntitle: A-1\n---\n\n## Contexte\n\n```sh\n# pas un titre\n```\n\nLe panier.\n",
	"src/readme.md":         "# Le code\n\nLe Miroir du code.\n",
	"design/screens.json":   `{"title": "Le Miroir des écrans"}`,
}

func gitTest(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := osexec.Command("git", append([]string{"-c", "user.name=Pilote", "-c", "user.email=pilote@example.test",
		"-c", "init.defaultBranch=develop", "-c", "commit.gpgsign=false"}, args...)...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

// docsRepo is a Projet's repository: a working copy, pushed to a bare
// repository (GitHub's) when bare is set, else itself the Local folder.
type docsRepo struct {
	work string
	bare string // "" for a Local folder
	url  string // the GitHub URL of a bare one, file://…
}

// newDocsRemote is acme/atelier's repository on a GitHub served over file://.
func newDocsRemote(t *testing.T, files map[string]string) *docsRepo {
	t.Helper()
	root := t.TempDir()
	r := &docsRepo{work: filepath.Join(root, "work"), bare: filepath.Join(root, "github", "acme", "atelier.git"), url: "file://" + filepath.Join(root, "github")}
	gitTest(t, root, "init", "--quiet", "--bare", r.bare)
	gitTest(t, root, "init", "--quiet", r.work)
	r.commit(t, "develop", files)
	return r
}

// newDocsFolder is a Local Projet's folder, a git repository on main.
func newDocsFolder(t *testing.T, files map[string]string) *docsRepo {
	t.Helper()
	r := &docsRepo{work: filepath.Join(t.TempDir(), "carnet")}
	gitTest(t, filepath.Dir(r.work), "init", "--quiet", "--initial-branch", "main", r.work)
	r.commit(t, "main", files)
	return r
}

// commit writes the files on branch (an empty content deletes the file),
// commits them and pushes the branch; it gives the commit.
func (r *docsRepo) commit(t *testing.T, branch string, files map[string]string) string {
	t.Helper()
	current, _ := osexec.Command("git", "-C", r.work, "symbolic-ref", "--short", "HEAD").Output()
	if strings.TrimSpace(string(current)) != branch && osexec.Command("git", "-C", r.work, "checkout", "--quiet", branch).Run() != nil {
		gitTest(t, r.work, "checkout", "--quiet", "-b", branch)
	}
	r.write(t, files)
	gitTest(t, r.work, "add", "--all")
	gitTest(t, r.work, "commit", "--quiet", "--allow-empty", "-m", "docs")
	if r.bare != "" {
		gitTest(t, r.work, "push", "--quiet", r.bare, branch)
	}
	return gitTest(t, r.work, "rev-parse", "HEAD")
}

func (r *docsRepo) write(t *testing.T, files map[string]string) {
	t.Helper()
	for name, content := range files {
		path := filepath.Join(r.work, name)
		if content == "" {
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// docsClones are the Runner's clones under home: RUNNER-9's from url for a
// GitHub key, SOURCE-2's of the key's folder for a Local one.
func docsClones(home, url string) Clones {
	return Clones{
		Origin: func(p Project, tokens github.TokenSource) Origin {
			if p.Source == SourceLocal {
				folder := p.Folder
				return session.LockedOrigin(&local.Origin{Home: home, ProjectID: p.ProjectID,
					Folder: func(string) (string, bool) { return folder, folder != "" }})
			}
			owner, name, _ := strings.Cut(p.Repository, "/")
			return &session.GitHubOrigin{Home: home, URL: url, Owner: owner, Name: name, Tokens: tokens}
		},
		Lock: session.LockClone,
	}
}

// gitCalls counts the Miroir's git commands by subcommand.
type gitCalls struct {
	mu    sync.Mutex
	calls map[string]int
}

func (c *gitCalls) wrap(m *Mirror) {
	c.calls = map[string]int{}
	m.git = func(ctx context.Context, dir string, env []string, args ...string) ([]byte, error) {
		c.mu.Lock()
		c.calls[args[0]]++
		c.mu.Unlock()
		return runGit(ctx, dir, env, args...)
	}
}

func (c *gitCalls) take() map[string]int {
	c.mu.Lock()
	defer c.mu.Unlock()
	calls := c.calls
	c.calls = map[string]int{}
	return calls
}

// docsMirror is a Mirror of a copy holding acme/atelier, its clones under a home of its own.
func docsMirror(t *testing.T, remote *docsRepo, projects ...Project) (*Mirror, string) {
	t.Helper()
	store, path := openStore(t)
	if len(projects) == 0 {
		projects = []Project{followedAtelier}
	}
	if err := store.PutProjects(projects); err != nil {
		t.Fatal(err)
	}
	url := ""
	if remote != nil {
		url = remote.url
	}
	home := filepath.Join(t.TempDir(), ".crewdeck")
	return &Mirror{Store: store, Logger: testLogger, Now: func() time.Time { return now }, Clones: docsClones(home, url)}, path
}

func docRows(t *testing.T, path, key string) [][]any {
	t.Helper()
	return query(t, path, "SELECT path, title FROM docs WHERE repository = ? ORDER BY path", key)
}

func docContent(t *testing.T, path, key, doc string) string {
	t.Helper()
	rows := query(t, path, "SELECT content FROM search WHERE kind = 'doc' AND repository = ? AND path = ?", key, doc)
	if len(rows) != 1 {
		t.Fatalf("%d search rows for %s", len(rows), doc)
	}
	return rows[0][0].(string)
}

func TestDocsIndexesTheValidatedDocumentsOnly(t *testing.T) {
	remote := newDocsRemote(t, docsFiles)
	// A branch other than the integration one is not read.
	remote.commit(t, "feat/1-x", map[string]string{"docs/brouillon.md": "# Brouillon\n"})
	m, path := docsMirror(t, remote)

	if err := m.IndexDocs(context.Background(), "acme/atelier"); err != nil {
		t.Fatalf("IndexDocs: %v", err)
	}
	want := [][]any{
		{"AGENTS.md", "Instructions"},
		{"backlog/issues/A-1.md", "backlog/issues/A-1.md"}, // no `# ` heading: its path
		{"docs/adr/0001-x.md", "Le Miroir"},
	}
	if got := docRows(t, path, "acme/atelier"); !reflect.DeepEqual(got, want) {
		t.Errorf("docs %v, want %v", got, want)
	}
	if n := count(t, path, "SELECT count(*) FROM search WHERE kind = 'doc' AND repository = 'acme/atelier' AND number IS NULL"); n != 3 {
		t.Errorf("%d search rows of kind doc, want 3", n)
	}
	if got := docContent(t, path, "acme/atelier", "AGENTS.md"); got != docsFiles["AGENTS.md"] {
		t.Errorf("content %q", got)
	}
	head := gitTest(t, remote.bare, "rev-parse", "develop")
	if got := query(t, path, "SELECT docs_head FROM projects WHERE repository = 'acme/atelier'")[0][0]; got != head {
		t.Errorf("docs_head %v, want %s", got, head)
	}
}

func TestDocsSearchKindDocFindsTheDocumentWithItsPathAndTitle(t *testing.T) {
	remote := newDocsRemote(t, docsFiles)
	m, _ := docsMirror(t, remote)
	if err := m.IndexDocs(context.Background(), "acme/atelier"); err != nil {
		t.Fatal(err)
	}
	rows, err := m.Store.Search("Miroir", "doc", nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Kind != "doc" || rows[0].Repository != "acme/atelier" || rows[0].Number != nil ||
		rows[0].Path == nil || *rows[0].Path != "docs/adr/0001-x.md" || rows[0].Title != "Le Miroir" {
		t.Fatalf("search --kind doc: %+v", rows)
	}
	// Without a kind, the documents come with the other rows.
	all, err := m.Store.Search("PRD", "", nil, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].Kind != "doc" || *all[0].Path != "AGENTS.md" {
		t.Errorf("search without --kind: %+v", all)
	}
}

func TestDocsAnUnchangedFileIsNotReadAgain(t *testing.T) {
	remote := newDocsRemote(t, docsFiles)
	m, path := docsMirror(t, remote)
	var calls gitCalls
	calls.wrap(m)
	ctx := context.Background()
	if err := m.IndexDocs(ctx, "acme/atelier"); err != nil {
		t.Fatal(err)
	}
	if got := calls.take()["show"]; got != 3 {
		t.Errorf("the first index read %d files, want 3", got)
	}

	// One document changed, one added, one deleted, the others as they were.
	remote.commit(t, "develop", map[string]string{
		"AGENTS.md":             "# Instructions\n\nLire le glossaire aussi.\n",
		"CONTEXT.md":            "# Glossaire\n\nLe Pilote.\n",
		"backlog/issues/A-1.md": "",
		"src/main.go":           "package main\n",
	})
	if err := m.IndexDocs(ctx, "acme/atelier"); err != nil {
		t.Fatal(err)
	}
	if got := calls.take()["show"]; got != 2 {
		t.Errorf("the reindex read %d files, want 2 (AGENTS.md, CONTEXT.md)", got)
	}
	want := [][]any{{"AGENTS.md", "Instructions"}, {"CONTEXT.md", "Glossaire"}, {"docs/adr/0001-x.md", "Le Miroir"}}
	if got := docRows(t, path, "acme/atelier"); !reflect.DeepEqual(got, want) {
		t.Errorf("docs %v, want %v", got, want)
	}
	if got := docContent(t, path, "acme/atelier", "AGENTS.md"); !strings.Contains(got, "glossaire") {
		t.Errorf("AGENTS.md not reindexed: %q", got)
	}
	if n := count(t, path, "SELECT count(*) FROM search WHERE kind = 'doc' AND repository = 'acme/atelier'"); n != 3 {
		t.Errorf("%d search rows, want 3", n)
	}

	// The head did not move: nothing is listed nor read.
	if err := m.IndexDocs(ctx, "acme/atelier"); err != nil {
		t.Fatal(err)
	}
	if got := calls.take(); got["show"] != 0 || got["ls-tree"] != 0 {
		t.Errorf("an index at the same head ran %v", got)
	}
}

func TestDocsAFailedFetchKeepsThePreviousIndex(t *testing.T) {
	remote := newDocsRemote(t, docsFiles)
	m, path := docsMirror(t, remote)
	ctx := context.Background()
	if err := m.IndexDocs(ctx, "acme/atelier"); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(remote.bare); err != nil {
		t.Fatal(err)
	}
	err := m.IndexDocs(ctx, "acme/atelier")
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("IndexDocs with GitHub gone: %v, want ErrUnavailable", err)
	}
	if n := count(t, path, "SELECT count(*) FROM docs"); n != 3 {
		t.Errorf("%d docs kept, want 3", n)
	}
}

func TestDocsTheLogNamesNoDocumentNorItsContent(t *testing.T) {
	remote := newDocsRemote(t, docsFiles)
	m, _ := docsMirror(t, remote)
	var log syncBuffer
	m.Logger = logging.New(&log)
	ctx := context.Background()
	if err := m.IndexDocs(ctx, "acme/atelier"); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(remote.bare, remote.bare+".parti"); err != nil {
		t.Fatal(err)
	}
	err := m.IndexDocs(ctx, "acme/atelier")
	if err == nil {
		t.Fatal("IndexDocs with GitHub gone succeeded")
	}
	m.Logger.Warn("mirror docs failed", "repository", "acme/atelier", "error", err.Error())
	if !strings.Contains(log.String(), "mirror docs") {
		t.Fatalf("no docs log:\n%s", log.String())
	}
	for _, secret := range []string{"docs/adr", "AGENTS.md", "A-1", "Le Miroir", "Instructions", "PRD", "panier", remote.work, remote.bare} {
		if strings.Contains(log.String(), secret) {
			t.Errorf("the log holds %q:\n%s", secret, log.String())
		}
	}
}

func TestDocsOfAKeyWithoutTheCodeGroupAreNone(t *testing.T) {
	remote := newDocsRemote(t, docsFiles)
	m, path := docsMirror(t, remote)
	ctx := context.Background()
	if err := m.IndexDocs(ctx, "acme/atelier"); err != nil {
		t.Fatal(err)
	}
	// The code group moved to a Local key: this one's documents go.
	ticketsOnly := followedAtelier
	ticketsOnly.Groups = []string{GroupTicket}
	if err := m.Store.PutProjects([]Project{ticketsOnly}); err != nil {
		t.Fatal(err)
	}
	if err := m.IndexDocs(ctx, "acme/atelier"); err != nil {
		t.Fatal(err)
	}
	if n := count(t, path, "SELECT count(*) FROM docs") + count(t, path, "SELECT count(*) FROM search WHERE kind = 'doc'"); n != 0 {
		t.Errorf("%d rows left", n)
	}
	if !errors.Is(m.IndexDocs(ctx, "acme/inconnu"), ErrNotAProject) {
		t.Error("a key not of the copy is indexed")
	}
}

// emptySource is a Local Source with no Ticket nor change: only its documents.
type emptySource struct{}

func (emptySource) Tickets(context.Context) ([]source.Ticket, error) { return nil, nil }
func (emptySource) Ticket(context.Context, int) (source.Ticket, error) {
	return source.Ticket{}, source.ErrNotFound
}
func (emptySource) Comments(context.Context, int) ([]source.Comment, error) { return nil, nil }
func (emptySource) Milestones(context.Context) ([]source.Milestone, error)  { return nil, nil }
func (emptySource) Changes(context.Context) ([]source.Change, error)        { return nil, nil }
func (emptySource) Change(context.Context, int) (source.Change, error) {
	return source.Change{}, source.ErrNotFound
}
func (emptySource) Reviews(context.Context, int) ([]source.Review, error)  { return nil, nil }
func (emptySource) Checks(context.Context, string) ([]source.Check, error) { return nil, nil }
func (emptySource) History(context.Context, int) (source.History, error) {
	return source.History{}, nil
}

type emptySources struct{}

func (emptySources) Source(string) (source.Reader, bool) { return emptySource{}, true }

const carnetID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a09"

func localCarnet(folder string) Project {
	return Project{Repository: LocalPrefix + carnetID, ProjectID: carnetID, Source: SourceLocal, Groups: []string{GroupTicket, GroupCode},
		DisplayName: "Carnet", IntegrationBranch: "main", Folder: folder}
}

func TestDocsOfALocalProjetAreItsCommittedFilesUntilTheNextSync(t *testing.T) {
	folder := newDocsFolder(t, map[string]string{"docs/prd.md": "# Le PRD\n\nLa première version.\n", "notes.md": "# Notes\n"})
	carnet := localCarnet(folder.work)
	store, path := followedStore(t, 0, carnet)
	clock := newClock()
	f, err := NewFollower(FollowerConfig{Store: store, GitHub: &Client{Logger: testLogger}, Logger: testLogger, Clock: clock,
		Locals: emptySources{}, Clones: docsClones(filepath.Join(t.TempDir(), ".crewdeck"), "")})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := f.Sync(ctx, carnet.Repository, false); err != nil {
		t.Fatalf("sync: %v", err)
	}
	if got := docRows(t, path, carnet.Repository); !reflect.DeepEqual(got, [][]any{{"docs/prd.md", "Le PRD"}}) {
		t.Fatalf("docs %v", got)
	}

	// An edit not committed, even staged, is not a validated document.
	folder.write(t, map[string]string{"docs/prd.md": "# Le PRD\n\nLa seconde version.\n"})
	gitTest(t, folder.work, "add", "docs/prd.md")
	if _, err := f.Sync(ctx, carnet.Repository, false); err != nil {
		t.Fatal(err)
	}
	if got := docContent(t, path, carnet.Repository, "docs/prd.md"); !strings.Contains(got, "première") {
		t.Fatalf("an uncommitted edit was indexed: %q", got)
	}
	// Committed on another branch: still not.
	gitTest(t, folder.work, "checkout", "--quiet", "-b", "feat/2-prd")
	gitTest(t, folder.work, "commit", "--quiet", "-m", "prd")
	if _, err := f.Sync(ctx, carnet.Repository, false); err != nil {
		t.Fatal(err)
	}
	if got := docContent(t, path, carnet.Repository, "docs/prd.md"); !strings.Contains(got, "première") {
		t.Fatalf("a commit of another branch was indexed: %q", got)
	}
	// Merged into the integration branch: the next sync indexes it.
	gitTest(t, folder.work, "checkout", "--quiet", "main")
	gitTest(t, folder.work, "merge", "--quiet", "--ff-only", "feat/2-prd")
	if _, err := f.Sync(ctx, carnet.Repository, false); err != nil {
		t.Fatal(err)
	}
	if got := docContent(t, path, carnet.Repository, "docs/prd.md"); !strings.Contains(got, "seconde") {
		t.Fatalf("the committed edit was not indexed: %q", got)
	}

	// The folder gone: the sync fails, the index is kept.
	if err := os.RemoveAll(folder.work); err != nil {
		t.Fatal(err)
	}
	if _, err := f.Sync(ctx, carnet.Repository, false); err == nil {
		t.Error("a sync of a folder gone succeeded")
	}
	if n := count(t, path, "SELECT count(*) FROM docs"); n != 1 {
		t.Errorf("%d docs kept, want 1", n)
	}
}

// pushed is a push envelope on ref.
func pushed(seq int, project Project, ref, sha string) any {
	return stamp("github.changed", map[string]any{"change": map[string]any{
		"seq": seq, "projectId": project.ProjectID, "repository": project.Repository, "kind": "push",
		"action": nil, "number": nil, "ref": ref, "sha": sha, "at": now.Format(time.RFC3339),
	}})
}

// followDocs runs a follower of store whose clones are under a home of its own.
func followDocs(t *testing.T, store *Store, server *runnerServer, remote *docsRepo, locals LocalSources) *Follower {
	t.Helper()
	fake := newFake(t, "testdata/graphql")
	url := ""
	if remote != nil {
		url = remote.url
	}
	home := filepath.Join(t.TempDir(), ".crewdeck")
	f, _ := followWith(t, store, fake, server, nil, func(cfg *FollowerConfig) {
		cfg.Clones = docsClones(home, url)
		cfg.Locals = locals
	})
	return f
}

func awaitDoc(t *testing.T, path, key, doc, text string) {
	t.Helper()
	eventually(t, doc+" indexed with "+text, func() bool {
		rows := query(t, path, "SELECT content FROM search WHERE kind = 'doc' AND repository = ? AND path = ?", key, doc)
		return len(rows) == 1 && strings.Contains(rows[0][0].(string), text)
	})
}

func TestDocsAPushOnTheIntegrationBranchReindexesAndOneOnAnotherBranchDoesNot(t *testing.T) {
	remote := newDocsRemote(t, docsFiles)
	clock := newClock()
	server := newRunnerServer(t, clock)
	store, path := followedStore(t, 0, followedAtelier)
	server.sendLive(0)
	f := followDocs(t, store, server, remote, nil)
	server.awaitHello()
	awaitDoc(t, path, "acme/atelier", "AGENTS.md", "PRD")

	// develop moved, and a push names another branch: nothing is reindexed.
	head := remote.commit(t, "develop", map[string]string{"AGENTS.md": "# Instructions\n\nLire le glossaire.\n"})
	other := remote.commit(t, "feat/1-x", map[string]string{"docs/brouillon.md": "# Brouillon\n"})
	server.send(pushed(1, followedAtelier, "refs/heads/feat/1-x", other))
	awaitCursor(t, store, 1)
	time.Sleep(50 * time.Millisecond)
	if got := docContent(t, path, "acme/atelier", "AGENTS.md"); !strings.Contains(got, "PRD") {
		t.Fatalf("a push on another branch reindexed: %q", got)
	}

	server.send(pushed(2, followedAtelier, "refs/heads/develop", head))
	awaitDoc(t, path, "acme/atelier", "AGENTS.md", "glossaire")
	awaitCursor(t, store, 2)
	if n := count(t, path, "SELECT count(*) FROM docs WHERE path = 'docs/brouillon.md'"); n != 0 {
		t.Error("another branch's document is indexed")
	}
	if state, _ := f.State("acme/atelier"); state.State != FreshnessLive {
		t.Errorf("freshness %s", state.State)
	}
}

func TestDocsAFailedIndexMakesTheGitHubKeyLateUntilOneSucceeds(t *testing.T) {
	remote := newDocsRemote(t, docsFiles)
	clock := newClock()
	server := newRunnerServer(t, clock)
	store, path := followedStore(t, 0, followedAtelier)
	server.sendLive(0)
	f := followDocs(t, store, server, remote, nil)
	server.awaitHello()
	awaitDoc(t, path, "acme/atelier", "AGENTS.md", "PRD")
	eventually(t, "live", func() bool { s, _ := f.State("acme/atelier"); return s.State == FreshnessLive })

	moved := filepath.Join(filepath.Dir(remote.bare), "ailleurs.git")
	if err := os.Rename(remote.bare, moved); err != nil {
		t.Fatal(err)
	}
	server.send(pushed(1, followedAtelier, "refs/heads/develop", "0000000000000000000000000000000000000000"))
	eventually(t, "late", func() bool { s, _ := f.State("acme/atelier"); return s.State == FreshnessLate })
	if n := count(t, path, "SELECT count(*) FROM docs"); n != 3 {
		t.Errorf("%d docs kept, want 3", n)
	}

	if err := os.Rename(moved, remote.bare); err != nil {
		t.Fatal(err)
	}
	remote.commit(t, "develop", map[string]string{"CONTEXT.md": "# Glossaire\n"})
	advanceUntil(t, clock, time.Second, "the index retried", func() bool {
		return count(t, path, "SELECT count(*) FROM docs WHERE path = 'CONTEXT.md'") == 1
	})
	eventually(t, "live again", func() bool { s, _ := f.State("acme/atelier"); return s.State == FreshnessLive })
}

func TestDocsTheReconciliationReindexesWhenTheBranchMovedWithoutAnEnvelope(t *testing.T) {
	t.Run("GitHub", func(t *testing.T) {
		remote := newDocsRemote(t, docsFiles)
		clock := newClock()
		server := newRunnerServer(t, clock)
		store, path := followedStore(t, 0, followedAtelier)
		followDocs(t, store, server, remote, nil)
		server.awaitHello()
		awaitDoc(t, path, "acme/atelier", "AGENTS.md", "PRD")

		remote.commit(t, "develop", map[string]string{"AGENTS.md": "# Instructions\n\nLire le glossaire.\n"})
		clock.Advance(ReconcileEvery)
		awaitDoc(t, path, "acme/atelier", "AGENTS.md", "glossaire")
	})
	t.Run("Local", func(t *testing.T) {
		folder := newDocsFolder(t, map[string]string{"AGENTS.md": "# Instructions\n\nLire le PRD.\n"})
		carnet := localCarnet(folder.work)
		clock := newClock()
		server := newRunnerServer(t, clock)
		store, path := followedStore(t, 0, carnet)
		followDocs(t, store, server, nil, emptySources{})
		awaitDoc(t, path, carnet.Repository, "AGENTS.md", "PRD")

		folder.commit(t, "main", map[string]string{"AGENTS.md": "# Instructions\n\nLire le glossaire.\n"})
		clock.Advance(ReconcileEvery)
		awaitDoc(t, path, carnet.Repository, "AGENTS.md", "glossaire")
	})
}

func TestDocsAProjetWhoseIntegrationBranchChangesIsReindexed(t *testing.T) {
	remote := newDocsRemote(t, docsFiles)
	remote.commit(t, "main", map[string]string{"AGENTS.md": "# Instructions\n\nLa branche main.\n"})
	clock := newClock()
	server := newRunnerServer(t, clock)
	store, path := followedStore(t, 0, followedAtelier)
	followDocs(t, store, server, remote, nil)
	server.awaitHello()
	awaitDoc(t, path, "acme/atelier", "AGENTS.md", "PRD")

	onMain := followedAtelier
	onMain.IntegrationBranch = "main"
	server.send(mirrorProjects(onMain))
	awaitDoc(t, path, "acme/atelier", "AGENTS.md", "branche main")
}

func TestDocsTheLocalWatcherAsksTheIndexOnARefsMove(t *testing.T) {
	folder := newDocsFolder(t, map[string]string{"AGENTS.md": "# Instructions\n\nLire le PRD.\n"})
	carnet := localCarnet(folder.work)
	clock := newClock()
	server := newRunnerServer(t, clock)
	store, path := followedStore(t, 0, carnet)
	f := followDocs(t, store, server, nil, emptySources{})
	awaitDoc(t, path, carnet.Repository, "AGENTS.md", "PRD")

	folder.commit(t, "main", map[string]string{"AGENTS.md": "# Instructions\n\nLire le glossaire.\n"})
	f.RefsMoved(carnet.ProjectID)
	awaitDoc(t, path, carnet.Repository, "AGENTS.md", "glossaire")
}
