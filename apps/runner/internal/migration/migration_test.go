package migration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/migration"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	ghsource "github.com/maximed1412/crewdeck/apps/runner/internal/source/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

const projectID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02"

// env is a Local Projet's folder, a fake repository on GitHub and what the
// handler sent to the server.
type env struct {
	t       *testing.T
	dir     string
	home    string
	db      *local.DB
	project *local.Project
	// folder is the Projet's folder in the Runner's state (dir; "" for
	// none), pending the one picked for a migration to Local ("" for none).
	folder   string
	pending  string
	promoted []string
	// others are the folders other Projets hold.
	others []string
	// remote is the repository's git URL (a bare repository over file://).
	remote   string
	opened   map[string]*local.Project
	vault    *keys.Vault
	gh       *fakeGitHub
	url      string
	token    string // the migration's token, as the server issues it
	mu       sync.Mutex
	sent     []any
	finished []string
	logs     bytes.Buffer
}

func newEnv(t *testing.T, files map[string]string) *env {
	t.Helper()
	e := &env{t: t, dir: t.TempDir(), home: t.TempDir(), vault: testVault(t)}
	gitIn(t, e.dir, "init", "--quiet")
	for name, content := range files {
		e.write(name, content)
	}
	gitIn(t, e.dir, "add", "-A")
	gitIn(t, e.dir, "commit", "--quiet", "--allow-empty", "-m", "Les Tickets")
	db, err := local.OpenDB(filepath.Join(t.TempDir(), "local.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e.db, e.folder, e.opened = db, e.dir, map[string]*local.Project{}
	e.project = local.Open(db, func() *keys.Vault { return e.vault }, projectID, e.dir)
	gh, server := newFakeGitHub(t)
	e.gh, e.url, e.token = gh, server.URL, gh.token
	return e
}

// attachOther makes folder another Projet's, as the folders handler does:
// refused when this Projet holds it, as its folder or its pending one.
func (e *env) attachOther(folder string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if folder == e.pending || folder == e.folder {
		return false
	}
	e.others = append(e.others, folder)
	return true
}

func (e *env) handler() *migration.Handler {
	return migration.New(migration.Config{
		Home: e.home,
		Send: func(_ context.Context, m any) error {
			e.mu.Lock()
			defer e.mu.Unlock()
			e.sent = append(e.sent, m)
			return nil
		},
		Folder: func(id string) (string, bool) {
			e.mu.Lock()
			defer e.mu.Unlock()
			return e.folder, id == projectID && e.folder != ""
		},
		Pending: func(id string) (string, bool) {
			e.mu.Lock()
			defer e.mu.Unlock()
			return e.pending, id == projectID && e.pending != ""
		},
		Promote: func(_ context.Context, id, folder string) error {
			e.mu.Lock()
			defer e.mu.Unlock()
			e.folder, e.pending = folder, ""
			e.promoted = append(e.promoted, id)
			return nil
		},
		Hold: func(_ context.Context, id, _, folder string) (bool, error) {
			e.mu.Lock()
			defer e.mu.Unlock()
			if id != projectID || slices.Contains(e.others, folder) {
				return false, nil
			}
			e.pending = folder
			return true, nil
		},
		Open: e.open,
		Remote: func(_, owner, name string) migration.Remote {
			return migration.Remote{URL: e.remote, Env: func(context.Context) ([]string, error) {
				return migration.AuthEnv(e.remote, e.token), nil
			}}
		},
		GitHub: func(_, owner, name string) source.Copier {
			return &ghsource.Tickets{BaseURL: e.url, Owner: owner, Name: name, Wait: func(int) time.Duration { return 0 },
				Token: func(context.Context) (string, error) { return e.token, nil }}
		},
		Vault:    func() *keys.Vault { return e.vault },
		Finished: func(_ context.Context, id, to string) { e.finished = append(e.finished, id+" "+to) },
		Logger:   slog.New(slog.NewTextHandler(&e.logs, &slog.HandlerOptions{Level: slog.LevelDebug})),
	})
}

// open is the Local Projet in folder: the env's own in dir.
func (e *env) open(id, folder string) *local.Project {
	e.mu.Lock()
	defer e.mu.Unlock()
	if folder == e.dir {
		return e.project
	}
	if p, ok := e.opened[folder]; ok {
		return p
	}
	p := local.Open(e.db, func() *keys.Vault { return e.vault }, id, folder)
	e.opened[folder] = p
	return p
}

func (e *env) write(name, content string) {
	e.t.Helper()
	path := filepath.Join(e.dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		e.t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) read(name string) string {
	e.t.Helper()
	data, err := os.ReadFile(filepath.Join(e.dir, filepath.FromSlash(name)))
	if err != nil {
		e.t.Fatal(err)
	}
	return string(data)
}

func sentOf[T any](e *env) []T {
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []T
	for _, m := range e.sent {
		if v, ok := m.(T); ok {
			out = append(out, v)
		}
	}
	return out
}

func copyMessage(from, to contracts.RunnerMigrationCopyFrom) contracts.RunnerMigrationCopy {
	return contracts.RunnerMigrationCopy{
		Type: "migration.copy", MigrationId: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a99", ProjectId: projectID,
		Group: contracts.RunnerMigrationCopyGroupTicket, From: from, To: contracts.RunnerMigrationCopyTo(to),
		Repository: &contracts.RunnerMigrationCopyRepository{Owner: "o", Name: "r"},
	}
}

func finishMessage(s contracts.RunnerMigrationSwitch) contracts.RunnerMigrationFinish {
	m := contracts.RunnerMigrationFinish{Type: "migration.finish", MigrationId: s.MigrationId}
	for _, f := range s.Fingerprints {
		m.Fingerprints = append(m.Fingerprints, contracts.RunnerMigrationFinishFingerprintsElem{Key: f.Key, State: f.State, ContentHash: f.ContentHash})
	}
	return m
}

// thirtyTickets are a Local Projet's 30 Tickets: 1 and 2 closed completed,
// 3 not planned, 4 the child of 5, 6 blocked by 4 and 5, 7 and 8 ready,
// 1 to 10 in M1 (due), 11 to 15 in M2.
func thirtyTickets() map[string]string {
	files := map[string]string{"tickets/milestones.yml": "- title: M1\n  due_on: 2026-12-01\n- title: M2\n"}
	for n := 1; n <= 30; n++ {
		front := fmt.Sprintf("number: %d\ntitle: Ticket %d\nlabels: [size:S]\n", n, n)
		switch n {
		case 1, 2:
			front += "state: closed\nstate_reason: completed\n"
		case 3:
			front += "state: closed\nstate_reason: not_planned\n"
		case 4:
			front += "parent: 5\n"
		case 6:
			front += "blocked_by: [4, 5]\n"
		case 7, 8:
			front += "ready: true\n"
		}
		if n <= 10 {
			front += "milestone: M1\n"
		} else if n <= 15 {
			front += "milestone: M2\n"
		}
		files[fmt.Sprintf("tickets/%d-ticket-%d.md", n, n)] = "---\n" + front + "---\n\nLe corps du Ticket " + fmt.Sprint(n) + ".\n"
	}
	return files
}

// commentEach writes one comment on each of the 30 Tickets.
func (e *env) commentEach() {
	e.t.Helper()
	for n := 1; n <= 30; n++ {
		if _, err := e.project.Comment(context.Background(), n, "Pilote", fmt.Sprintf("Remarque %d", n), ""); err != nil {
			e.t.Fatal(err)
		}
	}
}

var hex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)

func TestACopyMakesEachLocalTicketAnIssueWithItsStateLabelsMilestoneCommentAndLinks(t *testing.T) {
	e := newEnv(t, thirtyTickets())
	e.commentEach()
	e.handler().Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))

	if failed := sentOf[contracts.RunnerMigrationFailed](e); len(failed) > 0 {
		t.Fatalf("failed %+v\n%s", failed, e.logs.String())
	}
	issues := e.gh.Issues()
	if len(issues) != 30 || e.gh.count("POST /issues") != 30 {
		t.Fatalf("%d issues, %d created", len(issues), e.gh.count("POST /issues"))
	}
	byMarker := map[string]fakeIssue{}
	for _, is := range issues {
		marker := regexp.MustCompile(`<!-- crewdeck:from (local#\d+) -->$`).FindStringSubmatch(is.Body)
		if marker == nil {
			t.Fatalf("issue #%d without its marker: %q", is.Number, is.Body)
		}
		byMarker[marker[1]] = is
	}
	at := func(n int) fakeIssue { return byMarker[fmt.Sprintf("local#%d", n)] }
	if is := at(12); is.Title != "Ticket 12" || !strings.HasPrefix(is.Body, "Le corps du Ticket 12.") {
		t.Errorf("issue of 12: %q %q", is.Title, is.Body)
	}
	for _, n := range []int{1, 2} {
		if is := at(n); is.State != "closed" || is.StateReason == nil || *is.StateReason != "completed" {
			t.Errorf("issue of %d: %s %v", n, is.State, is.StateReason)
		}
	}
	if is := at(3); is.State != "closed" || *is.StateReason != "not_planned" {
		t.Errorf("issue of 3: %s %v", is.State, *is.StateReason)
	}
	if is := at(9); is.State != "open" || strings.Join(is.Labels, ",") != "size:S" {
		t.Errorf("issue of 9: %s %v", is.State, is.Labels)
	}
	if is := at(7); strings.Join(is.Labels, ",") != "size:S,ready-for-agent" {
		t.Errorf("issue of 7's labels: %v", is.Labels)
	}
	if len(e.gh.milestones) != 2 || e.gh.milestones[0].Title != "M1" || e.gh.milestones[0].DueOn == nil || *e.gh.milestones[0].DueOn != "2026-12-01T00:00:00Z" {
		t.Errorf("milestones %+v", e.gh.milestones)
	}
	if at(10).Milestone != 1 || at(11).Milestone != 2 || at(16).Milestone != 0 {
		t.Errorf("milestones of 10, 11, 16: %d %d %d", at(10).Milestone, at(11).Milestone, at(16).Milestone)
	}
	for n := 1; n <= 30; n++ {
		comments := at(n).Comments
		if len(comments) != 1 || !strings.HasPrefix(comments[0].Body, "**Pilote**, le ") || !strings.Contains(comments[0].Body, fmt.Sprintf("Remarque %d", n)) || !regexp.MustCompile(fmt.Sprintf(`<!-- crewdeck:from local#%d/comment/[0-9a-f-]+ -->$`, n)).MatchString(comments[0].Body) {
			t.Fatalf("comments of %d: %+v", n, comments)
		}
	}
	if at(4).Parent != at(5).Number {
		t.Errorf("4's parent #%d, want #%d", at(4).Parent, at(5).Number)
	}
	if blocked := at(6).BlockedBy; len(blocked) != 2 || blocked[0] != at(4).Number || blocked[1] != at(5).Number {
		t.Errorf("6 blocked by %v", blocked)
	}

	switched := sentOf[contracts.RunnerMigrationSwitch](e)
	if len(switched) != 1 {
		t.Fatalf("switches %d", len(switched))
	}
	s := switched[0]
	if len(s.Renumbering) != 30 || len(s.Fingerprints) != 32 || len(s.Milestones) != 2 {
		t.Fatalf("switch %d renumbered, %d fingerprints, %d milestones", len(s.Renumbering), len(s.Fingerprints), len(s.Milestones))
	}
	for _, r := range s.Renumbering {
		if at(r.From).Number != r.To {
			t.Errorf("renumbering %d → %d, its issue #%d", r.From, r.To, at(r.From).Number)
		}
	}
	for _, f := range s.Fingerprints {
		if !regexp.MustCompile(`^local#(milestone/)?\d+$`).MatchString(f.Key) || !hex64.MatchString(f.ContentHash) || (f.State != "open" && f.State != "closed") {
			t.Errorf("fingerprint %+v", f)
		}
	}
	progress := sentOf[contracts.RunnerMigrationProgress](e)
	if len(progress) == 0 || progress[len(progress)-1].State != contracts.RunnerMigrationProgressStateVerifying || progress[0].State != contracts.RunnerMigrationProgressStateCopying || progress[0].Total != 30 {
		t.Errorf("progress %+v", progress)
	}
	info, err := os.Stat(filepath.Join(e.home, "migrations", s.MigrationId+".json"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("progress file %v %v", info, err)
	}
	if strings.Contains(e.logs.String(), e.gh.token) {
		t.Errorf("the token is in the logs")
	}
	// The Local Tickets stay, untouched, until the finish.
	if got := e.read("tickets/12-ticket-12.md"); !strings.Contains(got, "title: Ticket 12") || strings.Contains(got, "from:") {
		t.Errorf("12's file %q", got)
	}
}

func testVault(t *testing.T) *keys.Vault {
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

func gitIn(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "user.name=Pilote", "-c", "user.email=pilote@example.test", "-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false"}, args...)...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func TestACopyInterruptedAfterTwelveIssuesResumesWithTheOthersAndNoDuplicate(t *testing.T) {
	e := newEnv(t, thirtyTickets())
	e.commentEach()
	ctx, stop := context.WithCancel(context.Background())
	created := 0
	e.gh.before = func(call, _ string) {
		if call == "POST /issues" {
			created++
			if created == 13 {
				stop() // the Runner stops as the 13th is asked
			}
		}
	}
	m := copyMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub)
	e.handler().Copy(ctx, m)
	if got := len(e.gh.Issues()); got > 13 || got < 12 {
		t.Fatalf("%d issues before the restart", got)
	}
	if len(sentOf[contracts.RunnerMigrationFailed](e)) > 0 || len(sentOf[contracts.RunnerMigrationSwitch](e)) > 0 {
		t.Fatalf("an interrupted copy sent %+v", e.sent)
	}
	before := len(e.gh.Issues())

	// After the restart, the server sends the copy again.
	e.gh.before = nil
	e.handler().Copy(context.Background(), m)
	issues := e.gh.Issues()
	if len(issues) != 30 || e.gh.count("POST /issues")-created != 30-before {
		t.Fatalf("%d issues, %d created after the restart for %d missing", len(issues), e.gh.count("POST /issues")-created, 30-before)
	}
	seen := map[string]bool{}
	for _, is := range issues {
		marker := regexp.MustCompile(`local#\d+ -->$`).FindString(is.Body)
		if seen[marker] || len(is.Comments) != 1 {
			t.Fatalf("issue #%d: marker %q twice or %d comments", is.Number, marker, len(is.Comments))
		}
		seen[marker] = true
	}
	if s := sentOf[contracts.RunnerMigrationSwitch](e); len(s) != 1 || len(s[0].Renumbering) != 30 {
		t.Fatalf("switch %+v", s)
	}
}

func TestATicketEditedWhileVerifyingIsCopiedAgainAndTheSwitchWaitsForAPassWithoutChange(t *testing.T) {
	e := newEnv(t, thirtyTickets())
	lists := 0
	e.gh.before = func(call, query string) {
		if call != "GET /issues" || !strings.Contains(query, "page=1") {
			return
		}
		lists++
		// Edited as the copy, then the first verifying pass, read GitHub.
		if lists <= 2 {
			e.write("tickets/12-ticket-12.md", fmt.Sprintf("---\nnumber: 12\ntitle: Ticket 12, version %d\nlabels: [size:S]\nmilestone: M2\n---\n\nLe corps.\n", lists))
		}
	}
	e.handler().Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))

	s := sentOf[contracts.RunnerMigrationSwitch](e)
	if len(s) != 1 {
		t.Fatalf("switches %d, failed %+v", len(s), sentOf[contracts.RunnerMigrationFailed](e))
	}
	var twelve fakeIssue
	for _, is := range e.gh.Issues() {
		if strings.Contains(is.Body, "local#12 -->") {
			twelve = is
		}
	}
	if twelve.Title != "Ticket 12, version 2" || e.gh.count(fmt.Sprintf("PATCH /issues/%d", twelve.Number)) != 2 {
		t.Errorf("12's issue %q, edited %d times", twelve.Title, e.gh.count(fmt.Sprintf("PATCH /issues/%d", twelve.Number)))
	}
	// The copy, two passes that recopied, one without change.
	if lists != 4 {
		t.Errorf("%d passes, want 4", lists)
	}
	verifying := 0
	for _, p := range sentOf[contracts.RunnerMigrationProgress](e) {
		if p.State == contracts.RunnerMigrationProgressStateVerifying {
			verifying++
		}
	}
	if verifying != 3 {
		t.Errorf("%d verifying passes said", verifying)
	}
}

func TestTenPassesWithoutAStableOneFailTheMigrationUnstable(t *testing.T) {
	e := newEnv(t, thirtyTickets())
	lists := 0
	e.gh.before = func(call, query string) {
		if call == "GET /issues" && strings.Contains(query, "page=1") {
			lists++
			e.write("tickets/12-ticket-12.md", fmt.Sprintf("---\nnumber: 12\ntitle: Ticket 12, version %d\n---\n", lists))
		}
	}
	e.handler().Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))

	failed := sentOf[contracts.RunnerMigrationFailed](e)
	if len(failed) != 1 || failed[0].Code != migration.CodeUnstable || failed[0].Stage != contracts.RunnerMigrationFailedStageCopy {
		t.Fatalf("failed %+v", failed)
	}
	if len(sentOf[contracts.RunnerMigrationSwitch](e)) > 0 || lists != 1+migration.Passes {
		t.Errorf("switched, or %d passes", lists)
	}
}

func TestATicketFileThatDoesNotParseFailsTheMigrationLocalUnreadable(t *testing.T) {
	files := thirtyTickets()
	files["tickets/31-broken.md"] = "---\nnumber: [oops\n---\n"
	e := newEnv(t, files)
	e.handler().Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))

	failed := sentOf[contracts.RunnerMigrationFailed](e)
	if len(failed) != 1 || failed[0].Code != migration.CodeLocalUnreadable || failed[0].Stage != contracts.RunnerMigrationFailedStageCopy {
		t.Fatalf("failed %+v", failed)
	}
	if e.gh.count("POST /issues") != 0 || len(sentOf[contracts.RunnerMigrationSwitch](e)) > 0 {
		t.Errorf("copied %d issues, or switched", e.gh.count("POST /issues"))
	}
	if _, err := os.Stat(filepath.Join(e.dir, "tickets", "12-ticket-12.md")); err != nil {
		t.Errorf("the Local Tickets moved: %v", err)
	}
}

func TestGitHubRefusingFailsTheMigrationGithubRefused(t *testing.T) {
	e := newEnv(t, thirtyTickets())
	e.token = "ghs_expired"
	e.handler().Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))
	if failed := sentOf[contracts.RunnerMigrationFailed](e); len(failed) != 1 || failed[0].Code != migration.CodeGitHubRefused {
		t.Fatalf("failed %+v", failed)
	}
}

func TestTheFinishArchivesTicketsAndCarriesAFileEditedSinceTheLastPass(t *testing.T) {
	e := newEnv(t, thirtyTickets())
	h := e.handler()
	h.Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))
	switched := sentOf[contracts.RunnerMigrationSwitch](e)
	if len(switched) != 1 {
		t.Fatalf("switches %d", len(switched))
	}
	// Edited between the last pass and the freeze; an archive of today exists already.
	e.write("tickets/12-ticket-12.md", "---\nnumber: 12\ntitle: Ticket 12, en retard\nlabels: [size:S]\nmilestone: M2\nstate: closed\n---\n\nLe corps.\n")
	if _, err := e.project.Comment(context.Background(), 12, "Pilote", "Un dernier mot", ""); err != nil {
		t.Fatal(err)
	}
	today := local.ArchivePrefix + time.Now().UTC().Format(time.DateOnly)
	e.write(today+"/README.md", "Une archive d'avant.\n")
	patchedBefore := e.gh.count(`PATCH /issues/\d+`)

	h.Finish(context.Background(), finishMessage(switched[0]))

	if failed := sentOf[contracts.RunnerMigrationFailed](e); len(failed) > 0 {
		t.Fatalf("failed %+v\n%s", failed, e.logs.String())
	}
	if _, err := os.Stat(filepath.Join(e.dir, "tickets")); !os.IsNotExist(err) {
		t.Errorf("tickets/ is still there: %v", err)
	}
	if got := e.read(today + "-2/12-ticket-12.md"); !strings.Contains(got, "en retard") {
		t.Errorf("the archive's 12: %q", got)
	}
	var twelve fakeIssue
	for _, is := range e.gh.Issues() {
		if strings.Contains(is.Body, "local#12 -->") {
			twelve = is
		}
	}
	if twelve.Title != "Ticket 12, en retard" || twelve.State != "closed" || len(twelve.Comments) != 1 || !strings.Contains(twelve.Comments[0].Body, "Un dernier mot") {
		t.Errorf("12's issue %q %s %+v", twelve.Title, twelve.State, twelve.Comments)
	}
	// Only the late Ticket is written again.
	if got := e.gh.count(`PATCH /issues/\d+`) - patchedBefore; got != 1 {
		t.Errorf("%d issues edited by the finish", got)
	}
	if len(sentOf[contracts.RunnerMigrationFinished](e)) != 1 || strings.Join(e.finished, ";") != projectID+" github" {
		t.Errorf("finished %+v, %v", sentOf[contracts.RunnerMigrationFinished](e), e.finished)
	}
	// Sent again (the finished message lost): finished again, nothing redone.
	calls := len(e.gh.calls)
	e.handler().Finish(context.Background(), finishMessage(switched[0]))
	if len(sentOf[contracts.RunnerMigrationFinished](e)) != 2 || len(e.gh.calls) != calls {
		t.Errorf("a finish sent again: %d finished, %d calls", len(sentOf[contracts.RunnerMigrationFinished](e)), len(e.gh.calls)-calls)
	}
}

func TestGitHubToLocalWritesAFilePerIssueThenArchivesAndLocksTheIssues(t *testing.T) {
	e := newEnv(t, map[string]string{"README.md": "Le Projet.\n"})
	due := "2026-12-01T00:00:00Z"
	e.gh.milestones = []fakeMilestone{{Number: 1, Title: "MVP", DueOn: &due}}
	notPlanned := "not_planned"
	e.gh.add(fakeIssue{Title: "Connexion GitHub", Body: "Le corps.", Labels: []string{"ready-for-agent", "size:S"}, Milestone: 1,
		Comments: []fakeComment{{ID: 1, Author: "octo", Body: "Bien vu", At: "2026-11-10T08:00:00Z"}, {ID: 2, Author: "pilote", Body: "Merci", At: "2026-11-10T09:00:00Z"}}})
	e.gh.add(fakeIssue{Title: "Une PR", PR: true})
	e.gh.add(fakeIssue{Title: "Fermée", State: "closed"})
	e.gh.add(fakeIssue{Title: "Abandonnée", State: "closed", StateReason: &notPlanned, Parent: 1})
	e.gh.add(fakeIssue{Title: "Bloquée", BlockedBy: []int{1, 3}})
	h := e.handler()
	h.Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromGithub, contracts.RunnerMigrationCopyFromLocal))

	switched := sentOf[contracts.RunnerMigrationSwitch](e)
	if len(switched) != 1 {
		t.Fatalf("switches %d, failed %+v\n%s", len(switched), sentOf[contracts.RunnerMigrationFailed](e), e.logs.String())
	}
	renumbered := map[int]int{}
	for _, r := range switched[0].Renumbering {
		renumbered[r.From] = r.To
	}
	if len(renumbered) != 4 || renumbered[2] != 0 || switched[0].Fingerprints[0].Key != "github#1" {
		t.Fatalf("renumbering %v, fingerprints %+v", renumbered, switched[0].Fingerprints)
	}
	if len(switched[0].Milestones) != 1 || switched[0].Milestones[0].From != 1 || switched[0].Milestones[0].To != 1 {
		t.Errorf("milestones %+v", switched[0].Milestones)
	}
	files, _ := filepath.Glob(filepath.Join(e.dir, "tickets", "*.md"))
	if len(files) != 4 {
		t.Fatalf("files %v", files)
	}
	first := e.read(fmt.Sprintf("tickets/%d-connexion-github.md", renumbered[1]))
	for _, want := range []string{"title: Connexion GitHub", "from: github#1", "ready: true", "size:S", "milestone: MVP", "Le corps."} {
		if !strings.Contains(first, want) {
			t.Errorf("1's file lacks %q: %q", want, first)
		}
	}
	if strings.Contains(first, "ready-for-agent") {
		t.Errorf("1's file keeps the ready label: %q", first)
	}
	abandoned := e.read(fmt.Sprintf("tickets/%d-abandonnee.md", renumbered[4]))
	if !strings.Contains(abandoned, "state_reason: not_planned") || !strings.Contains(abandoned, fmt.Sprintf("parent: %d", renumbered[1])) {
		t.Errorf("4's file %q", abandoned)
	}
	if closed := e.read(fmt.Sprintf("tickets/%d-fermee.md", renumbered[3])); !strings.Contains(closed, "state: closed") {
		t.Errorf("3's file %q", closed)
	}
	blocked := e.read(fmt.Sprintf("tickets/%d-bloquee.md", renumbered[5]))
	if f, err := local.Parse([]byte(blocked)); err != nil || fmt.Sprint(f.BlockedBy) != fmt.Sprint([]int{renumbered[1], renumbered[3]}) {
		t.Errorf("5's file %q", blocked)
	}
	if !strings.Contains(e.read("tickets/milestones.yml"), "title: MVP") || !strings.Contains(e.read("tickets/milestones.yml"), "due_on: \"2026-12-01\"") && !strings.Contains(e.read("tickets/milestones.yml"), "due_on: 2026-12-01") {
		t.Errorf("milestones.yml %q", e.read("tickets/milestones.yml"))
	}
	comments, err := e.project.Comments(context.Background(), renumbered[1])
	if err != nil || len(comments) != 2 || comments[0].Author != "octo" || comments[0].Body != "Bien vu" || comments[1].CreatedAt.Format(time.RFC3339) != "2026-11-10T09:00:00Z" {
		t.Errorf("comments %+v %v", comments, err)
	}
	// Never committed.
	if status := gitIn(t, e.dir, "status", "--porcelain"); !strings.Contains(status, "?? tickets/") || gitIn(t, e.dir, "rev-list", "--count", "HEAD") != "1" {
		t.Errorf("status %q", status)
	}
	if e.gh.count(`(POST|PATCH|PUT|DELETE) .*`) != 0 {
		t.Errorf("the copy wrote on GitHub")
	}

	h.Finish(context.Background(), finishMessage(switched[0]))
	if failed := sentOf[contracts.RunnerMigrationFailed](e); len(failed) > 0 {
		t.Fatalf("failed %+v\n%s", failed, e.logs.String())
	}
	for _, is := range e.gh.issues {
		archived := strings.Contains(strings.Join(is.Labels, ","), ghsource.ArchiveLabel)
		if is.PR == (archived || is.Locked) {
			t.Errorf("#%d (PR %v): archived %v, locked %v", is.Number, is.PR, archived, is.Locked)
		}
	}
	if e.gh.issue(1).State != "open" || e.gh.issue(3).State != "closed" {
		t.Errorf("states changed: %s %s", e.gh.issue(1).State, e.gh.issue(3).State)
	}
	if strings.Join(e.finished, ";") != projectID+" local" || len(sentOf[contracts.RunnerMigrationFinished](e)) != 1 {
		t.Errorf("finished %v", e.finished)
	}
}

func TestASubIssueOrABlockerOfAnotherRepositoryIsNoTicketOfTheProjet(t *testing.T) {
	e := newEnv(t, map[string]string{"README.md": "Le Projet.\n"})
	e.gh.add(fakeIssue{Title: "Parent"})
	e.gh.add(fakeIssue{Title: "Bloquée"})
	e.gh.add(fakeIssue{Title: "Homonyme", Number: 7})
	// b/x#7, as numbered as o/r#7: o/r#1's sub-issue and o/r#2's blocker.
	other := e.gh.add(fakeIssue{Title: "Ailleurs", Number: 7, Repo: "b/x", Parent: 1})
	e.gh.issue(2).BlockedByOther = []int64{other.ID}
	e.handler().Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromGithub, contracts.RunnerMigrationCopyFromLocal))

	switched := sentOf[contracts.RunnerMigrationSwitch](e)
	if len(switched) != 1 || len(switched[0].Renumbering) != 3 {
		t.Fatalf("switches %+v, failed %+v\n%s", switched, sentOf[contracts.RunnerMigrationFailed](e), e.logs.String())
	}
	renumbered := map[int]int{}
	for _, r := range switched[0].Renumbering {
		renumbered[r.From] = r.To
	}
	for from, name := range map[int]string{7: "homonyme", 2: "bloquee"} {
		f, err := local.Parse([]byte(e.read(fmt.Sprintf("tickets/%d-%s.md", renumbered[from], name))))
		if err != nil || f.Parent != nil || len(f.BlockedBy) != 0 {
			t.Errorf("%d's file: parent %v, blocked by %v (%v)", from, f.Parent, f.BlockedBy, err)
		}
	}
}

func TestAnIssueOrACommentCreatedWhoseAnswerIsLostIsFoundByItsMarkerNotCreatedAgain(t *testing.T) {
	e := newEnv(t, thirtyTickets())
	e.commentEach()
	cut := map[string]int{}
	e.gh.cut = func(call string) bool {
		kind := regexp.MustCompile(`\d+`).ReplaceAllString(call, "n")
		cut[kind]++
		// GitHub creates the 1st and the 5th issue, and the 1st comment, then the answer is lost.
		return kind == "POST /issues" && (cut[kind] == 1 || cut[kind] == 5) || kind == "POST /issues/n/comments" && cut[kind] == 1
	}
	e.handler().Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))

	if s := sentOf[contracts.RunnerMigrationSwitch](e); len(s) != 1 {
		t.Fatalf("switches %+v, failed %+v\n%s", s, sentOf[contracts.RunnerMigrationFailed](e), e.logs.String())
	}
	issues := e.gh.Issues()
	if len(issues) != 30 {
		t.Fatalf("%d issues for 30 Tickets", len(issues))
	}
	for _, is := range issues {
		if len(is.Comments) != 1 {
			t.Errorf("issue #%d has %d comments", is.Number, len(is.Comments))
		}
	}
}

func TestAMilestoneFoundByItsTitleGetsItsDueDateAndOneChangedAfterTheLastPassIsCarriedByTheFinish(t *testing.T) {
	e := newEnv(t, thirtyTickets())
	other, none := "2026-11-01T00:00:00Z", (*string)(nil)
	e.gh.milestones = []fakeMilestone{{Number: 1, Title: "M1", DueOn: &other}, {Number: 2, Title: "M2", DueOn: &other}}
	h := e.handler()
	h.Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))

	switched := sentOf[contracts.RunnerMigrationSwitch](e)
	if len(switched) != 1 {
		t.Fatalf("switches %d, failed %+v\n%s", len(switched), sentOf[contracts.RunnerMigrationFailed](e), e.logs.String())
	}
	if len(e.gh.milestones) != 2 || *e.gh.milestones[0].DueOn != "2026-12-01T00:00:00Z" || e.gh.milestones[1].DueOn != none {
		t.Fatalf("milestones %+v", e.gh.milestones)
	}

	// M2 gets a due date between the last pass and the freeze.
	e.write("tickets/milestones.yml", "- title: M1\n  due_on: 2026-12-01\n- title: M2\n  due_on: 2027-01-15\n")
	h.Finish(context.Background(), finishMessage(switched[0]))
	if failed := sentOf[contracts.RunnerMigrationFailed](e); len(failed) > 0 || len(sentOf[contracts.RunnerMigrationFinished](e)) != 1 {
		t.Fatalf("failed %+v\n%s", failed, e.logs.String())
	}
	if m := e.gh.milestones[1]; m.DueOn == nil || *m.DueOn != "2027-01-15T00:00:00Z" {
		t.Errorf("M2 after the finish: %+v", m)
	}
}

func TestAMilestoneDueDateChangedOnGitHubAfterTheLastPassIsWrittenInMilestonesYml(t *testing.T) {
	e := newEnv(t, map[string]string{"README.md": "Le Projet.\n"})
	due := "2026-12-01T00:00:00Z"
	e.gh.milestones = []fakeMilestone{{Number: 1, Title: "MVP", DueOn: &due}, {Number: 2, Title: "V2"}}
	e.gh.add(fakeIssue{Title: "Connexion GitHub", Milestone: 1})
	h := e.handler()
	h.Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromGithub, contracts.RunnerMigrationCopyFromLocal))
	switched := sentOf[contracts.RunnerMigrationSwitch](e)
	if len(switched) != 1 {
		t.Fatalf("switches %d, failed %+v\n%s", len(switched), sentOf[contracts.RunnerMigrationFailed](e), e.logs.String())
	}

	later := "2027-02-01T00:00:00Z"
	e.gh.milestones[0].DueOn, e.gh.milestones[1].DueOn = nil, &later
	h.Finish(context.Background(), finishMessage(switched[0]))
	if failed := sentOf[contracts.RunnerMigrationFailed](e); len(failed) > 0 || len(sentOf[contracts.RunnerMigrationFinished](e)) != 1 {
		t.Fatalf("failed %+v\n%s", failed, e.logs.String())
	}
	milestones, err := e.project.Milestones(context.Background())
	if err != nil || len(milestones) != 2 || milestones[0].Title != "MVP" || milestones[0].DueOn != nil || milestones[1].DueOn == nil || milestones[1].DueOn.Format(time.DateOnly) != "2027-02-01" {
		t.Errorf("milestones %+v %v\n%s", milestones, err, e.read("tickets/milestones.yml"))
	}
}

func TestAFinishCutBetweenTheRenameAndItsRecordFindsTheArchiveAndCarriesItsLateChanges(t *testing.T) {
	e := newEnv(t, thirtyTickets())
	e.handler().Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))
	switched := sentOf[contracts.RunnerMigrationSwitch](e)
	if len(switched) != 1 {
		t.Fatalf("switches %d", len(switched))
	}
	e.write("tickets/12-ticket-12.md", "---\nnumber: 12\ntitle: Ticket 12, en retard\nlabels: [size:S]\nmilestone: M2\n---\n\nLe corps.\n")

	// The Runner stopped once tickets/ renamed under the name its progress
	// kept, before the progress said frozen.
	path := filepath.Join(e.home, "migrations", switched[0].MigrationId+".json")
	var p map[string]any
	data, err := os.ReadFile(path)
	if err != nil || json.Unmarshal(data, &p) != nil {
		t.Fatalf("progress %q %v", data, err)
	}
	archive := local.ArchivePrefix + time.Now().UTC().Format(time.DateOnly)
	p["archive"] = archive
	if data, err = json.Marshal(p); err != nil || os.WriteFile(path, data, 0o600) != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(e.dir, "tickets"), filepath.Join(e.dir, archive)); err != nil {
		t.Fatal(err)
	}

	e.handler().Finish(context.Background(), finishMessage(switched[0]))
	if failed := sentOf[contracts.RunnerMigrationFailed](e); len(failed) > 0 || len(sentOf[contracts.RunnerMigrationFinished](e)) != 1 {
		t.Fatalf("failed %+v\n%s", failed, e.logs.String())
	}
	late := false
	for _, is := range e.gh.Issues() {
		late = late || strings.Contains(is.Body, "local#12 -->") && is.Title == "Ticket 12, en retard"
	}
	if !late {
		t.Errorf("12's late change not carried")
	}
}

func TestTheFinishLeavesAMilestoneTheOldSourceDidNotChangeAsTheNewOneHasIt(t *testing.T) {
	e := newEnv(t, thirtyTickets())
	h := e.handler()
	h.Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))
	switched := sentOf[contracts.RunnerMigrationSwitch](e)
	if len(switched) != 1 {
		t.Fatalf("switches %d, failed %+v\n%s", len(switched), sentOf[contracts.RunnerMigrationFailed](e), e.logs.String())
	}

	// Once switched, the Pilote moves M1 on GitHub; a Ticket changes late in Local, M1 there as it was.
	moved := "2026-12-10T00:00:00Z"
	e.gh.milestones[0].DueOn = &moved
	e.write("tickets/12-ticket-12.md", "---\nnumber: 12\ntitle: Ticket 12, en retard\nlabels: [size:S]\nmilestone: M2\n---\n\nLe corps.\n")
	h.Finish(context.Background(), finishMessage(switched[0]))
	if failed := sentOf[contracts.RunnerMigrationFailed](e); len(failed) > 0 || len(sentOf[contracts.RunnerMigrationFinished](e)) != 1 {
		t.Fatalf("failed %+v\n%s", failed, e.logs.String())
	}
	if m := e.gh.milestones[0]; m.DueOn == nil || *m.DueOn != moved {
		t.Errorf("M1 after the finish: %+v", m)
	}
	if e.gh.count(`PATCH /milestones/\d+`) != 0 {
		t.Errorf("the finish wrote %d milestones", e.gh.count(`PATCH /milestones/\d+`))
	}
	late := false
	for _, is := range e.gh.Issues() {
		late = late || strings.Contains(is.Body, "local#12 -->") && is.Title == "Ticket 12, en retard"
	}
	if !late {
		t.Errorf("12's late change not carried")
	}
}

func TestTheFinishFindsAMilestoneRenamedSinceTheSwitchByItsNumber(t *testing.T) {
	e := newEnv(t, thirtyTickets())
	h := e.handler()
	h.Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))
	switched := sentOf[contracts.RunnerMigrationSwitch](e)
	if len(switched) != 1 {
		t.Fatalf("switches %d, failed %+v\n%s", len(switched), sentOf[contracts.RunnerMigrationFailed](e), e.logs.String())
	}

	// Once switched, the Pilote renames M1 on GitHub; in Local, Ticket 5 changes late, still in M1, and M2 is renamed.
	e.gh.milestones[0].Title = "Livraison"
	e.write("tickets/5-ticket-5.md", "---\nnumber: 5\ntitle: Ticket 5, en retard\nlabels: [size:S]\nmilestone: M1\n---\n\nLe corps.\n")
	e.write("tickets/milestones.yml", "- title: M1\n  due_on: 2026-12-01\n- title: M2 bis\n")
	for n := 11; n <= 15; n++ {
		e.write(fmt.Sprintf("tickets/%d-ticket-%d.md", n, n), fmt.Sprintf("---\nnumber: %d\ntitle: Ticket %d\nlabels: [size:S]\nmilestone: M2 bis\n---\n\nLe corps du Ticket %d.\n", n, n, n))
	}
	h.Finish(context.Background(), finishMessage(switched[0]))
	if failed := sentOf[contracts.RunnerMigrationFailed](e); len(failed) > 0 || len(sentOf[contracts.RunnerMigrationFinished](e)) != 1 {
		t.Fatalf("failed %+v\n%s", failed, e.logs.String())
	}
	if len(e.gh.milestones) != 2 || e.gh.milestones[0].Title != "Livraison" || e.gh.milestones[1].Title != "M2 bis" {
		t.Errorf("milestones %+v", e.gh.milestones)
	}
	for _, is := range e.gh.Issues() {
		switch {
		case strings.Contains(is.Body, "local#5 -->"):
			if is.Title != "Ticket 5, en retard" || is.Milestone != 1 {
				t.Errorf("5's issue %q in milestone %d", is.Title, is.Milestone)
			}
		case strings.Contains(is.Body, "local#11 -->"):
			if is.Milestone != 2 {
				t.Errorf("11's issue in milestone %d", is.Milestone)
			}
		}
	}
}

func TestAMilestoneRenamedOnGitHubAfterTheSwitchIsRenamedInMilestonesYmlNotAdded(t *testing.T) {
	e := newEnv(t, map[string]string{"README.md": "Le Projet.\n"})
	due := "2026-12-01T00:00:00Z"
	e.gh.milestones = []fakeMilestone{{Number: 1, Title: "MVP", DueOn: &due}, {Number: 2, Title: "V2"}}
	e.gh.add(fakeIssue{Title: "Connexion GitHub", Milestone: 1})
	h := e.handler()
	h.Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromGithub, contracts.RunnerMigrationCopyFromLocal))
	switched := sentOf[contracts.RunnerMigrationSwitch](e)
	if len(switched) != 1 {
		t.Fatalf("switches %d, failed %+v\n%s", len(switched), sentOf[contracts.RunnerMigrationFailed](e), e.logs.String())
	}

	e.gh.milestones[0].Title = "Lancement"
	h.Finish(context.Background(), finishMessage(switched[0]))
	if failed := sentOf[contracts.RunnerMigrationFailed](e); len(failed) > 0 || len(sentOf[contracts.RunnerMigrationFinished](e)) != 1 {
		t.Fatalf("failed %+v\n%s", failed, e.logs.String())
	}
	milestones, err := e.project.Milestones(context.Background())
	if err != nil || len(milestones) != 2 || milestones[0].Title != "Lancement" || milestones[0].DueOn == nil || milestones[0].DueOn.Format(time.DateOnly) != "2026-12-01" || milestones[1].Title != "V2" {
		t.Errorf("milestones %+v %v\n%s", milestones, err, e.read("tickets/milestones.yml"))
	}
	if ticket := e.read("tickets/1-connexion-github.md"); !strings.Contains(ticket, "milestone: Lancement") {
		t.Errorf("ticket 1\n%s", ticket)
	}
}

func TestALateTicketStaysInItsMilestoneWhenThePiloteSwapsTheMilestonesOfMilestonesYml(t *testing.T) {
	e := newEnv(t, map[string]string{"README.md": "Le Projet.\n"})
	e.gh.milestones = []fakeMilestone{{Number: 1, Title: "M1"}, {Number: 2, Title: "M2"}}
	issue := e.gh.add(fakeIssue{Title: "Connexion GitHub", Milestone: 1})
	e.gh.add(fakeIssue{Title: "Export", Milestone: 2})
	h := e.handler()
	h.Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromGithub, contracts.RunnerMigrationCopyFromLocal))
	switched := sentOf[contracts.RunnerMigrationSwitch](e)
	if len(switched) != 1 {
		t.Fatalf("switches %d, failed %+v\n%s", len(switched), sentOf[contracts.RunnerMigrationFailed](e), e.logs.String())
	}

	// Once switched, the Pilote swaps the milestones in milestones.yml (their
	// ranks, Local's numbers, with them); on GitHub, the issue of M1 changes late.
	e.write("tickets/milestones.yml", "- title: M2\n- title: M1\n")
	issue.Title = "Connexion GitHub, en retard"
	h.Finish(context.Background(), finishMessage(switched[0]))
	if failed := sentOf[contracts.RunnerMigrationFailed](e); len(failed) > 0 || len(sentOf[contracts.RunnerMigrationFinished](e)) != 1 {
		t.Fatalf("failed %+v\n%s", failed, e.logs.String())
	}
	if ticket := e.read("tickets/1-connexion-github.md"); !strings.Contains(ticket, "Connexion GitHub, en retard") || !strings.Contains(ticket, "milestone: M1") {
		t.Errorf("ticket 1\n%s", ticket)
	}
	if yml := e.read("tickets/milestones.yml"); yml != "- title: M2\n- title: M1\n" {
		t.Errorf("milestones.yml %q", yml)
	}
}

func TestMilestonesSwappedInTheOldMilestonesYmlAfterTheSwitchAreNotRenamedOnGitHub(t *testing.T) {
	e := newEnv(t, thirtyTickets())
	h := e.handler()
	h.Copy(context.Background(), copyMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))
	switched := sentOf[contracts.RunnerMigrationSwitch](e)
	if len(switched) != 1 {
		t.Fatalf("switches %d, failed %+v\n%s", len(switched), sentOf[contracts.RunnerMigrationFailed](e), e.logs.String())
	}

	// Once switched, the Pilote swaps M1 and M2 in Local, and Ticket 5 changes late, still in M1.
	e.write("tickets/milestones.yml", "- title: M2\n- title: M1\n  due_on: 2026-12-01\n")
	e.write("tickets/5-ticket-5.md", "---\nnumber: 5\ntitle: Ticket 5, en retard\nlabels: [size:S]\nmilestone: M1\n---\n\nLe corps.\n")
	h.Finish(context.Background(), finishMessage(switched[0]))
	if failed := sentOf[contracts.RunnerMigrationFailed](e); len(failed) > 0 || len(sentOf[contracts.RunnerMigrationFinished](e)) != 1 {
		t.Fatalf("failed %+v\n%s", failed, e.logs.String())
	}
	if len(e.gh.milestones) != 2 || e.gh.milestones[0].Title != "M1" || e.gh.milestones[0].DueOn == nil || e.gh.milestones[1].Title != "M2" || e.gh.milestones[1].DueOn != nil {
		t.Errorf("milestones %+v", e.gh.milestones)
	}
	for _, is := range e.gh.Issues() {
		if strings.Contains(is.Body, "local#5 -->") && (is.Title != "Ticket 5, en retard" || is.Milestone != 1) {
			t.Errorf("5's issue %q in milestone %d", is.Title, is.Milestone)
		}
	}
}
