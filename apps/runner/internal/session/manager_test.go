package session_test

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/fake"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
)

const (
	projectID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a92"
	stepRunID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a93"
	firstID   = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b01"
	secondID  = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b02"
)

// git runs git in dir, the test failing on an error.
func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.test", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.test")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

// remote is a GitHub of local bare repositories: <root>/<owner>/<name>.git,
// cloned over file://, with a working copy to push from.
type remote struct {
	root, work string
}

// newRemote makes acme/shop with `develop`, holding a README and a
// `.process.json` whose command would create `ran`.
func newRemote(t *testing.T) *remote {
	t.Helper()
	r := &remote{root: filepath.Join(t.TempDir(), "github"), work: filepath.Join(t.TempDir(), "work")}
	bare := filepath.Join(r.root, "acme", "shop.git")
	if err := os.MkdirAll(bare, 0o755); err != nil {
		t.Fatal(err)
	}
	git(t, bare, "init", "--bare", "-b", "develop")
	git(t, filepath.Dir(r.work), "clone", bare, r.work)
	git(t, r.work, "checkout", "-b", "develop")
	r.commit(t, "README", "develop\n")
	r.commit(t, ".process.json", `{"setup":"touch ran","teardown":"touch ran"}`)
	git(t, r.work, "push", "origin", "develop")
	return r
}

func (r *remote) commit(t *testing.T, file, content string) string {
	t.Helper()
	if err := os.WriteFile(filepath.Join(r.work, file), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, r.work, "add", file)
	git(t, r.work, "commit", "-m", file)
	return git(t, r.work, "rev-parse", "HEAD")
}

func (r *remote) url() string { return "file://" + r.root }

// reports records the session.state messages the manager sends.
type reports struct {
	mu   sync.Mutex
	all  []contracts.RunnerSessionState
	next chan contracts.RunnerSessionState
}

func newReports() *reports { return &reports{next: make(chan contracts.RunnerSessionState, 100)} }

func (r *reports) send(_ context.Context, message any) error {
	state, ok := message.(contracts.RunnerSessionState)
	if !ok {
		return errors.New("not a session.state")
	}
	r.mu.Lock()
	r.all = append(r.all, state)
	r.mu.Unlock()
	r.next <- state
	return nil
}

// await waits for the report of `state` for the Session `id`, and returns it.
func (r *reports) await(t *testing.T, id string, state contracts.RunnerSessionStateState) contracts.RunnerSessionState {
	t.Helper()
	timeout := time.After(10 * time.Second)
	for {
		select {
		case report := <-r.next:
			if report.SessionId == id && report.State == state {
				return report
			}
		case <-timeout:
			t.Fatalf("no %s for %s; reports %+v", state, id, r.states(id))
			return contracts.RunnerSessionState{}
		}
	}
}

func (r *reports) states(id string) []contracts.RunnerSessionStateState {
	r.mu.Lock()
	defer r.mu.Unlock()
	var states []contracts.RunnerSessionStateState
	for _, report := range r.all {
		if report.SessionId == id {
			states = append(states, report.State)
		}
	}
	return states
}

type setup struct {
	home    string
	remote  *remote
	engine  *fake.Engine
	reports *reports
	hooks   session.Hooks
}

func newSetup(t *testing.T, events ...contracts.EngineEvent) *setup {
	t.Helper()
	return &setup{
		home:    filepath.Join(t.TempDir(), ".crewdeck"),
		remote:  newRemote(t),
		engine:  &fake.Engine{Events: events},
		reports: newReports(),
	}
}

func (s *setup) manager(t *testing.T) *session.Manager {
	t.Helper()
	var engines engine.Registry
	engines.Register(s.engine)
	m, err := session.New(session.Config{Home: s.home, Engines: &engines, GitHubURL: s.remote.url(), Hooks: s.hooks, Send: s.reports.send})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	return m
}

func start(id, branch string) contracts.RunnerSessionStart {
	return contracts.RunnerSessionStart{
		Type:           "session.start",
		Id:             "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01",
		At:             time.Now().UTC(),
		SessionId:      id,
		ProjectId:      projectID,
		Origin:         contracts.RunnerSessionStartOrigin{Kind: contracts.RunnerSessionStartOriginKindGithub, Owner: "acme", Name: "shop"},
		Branch:         branch,
		Base:           "develop",
		Engine:         contracts.RunnerSessionStartEngineClaudeCode,
		Model:          "claude-opus-5-5",
		Role:           "code",
		PermissionMode: contracts.RunnerSessionStartPermissionModeBypass,
		Step:           &contracts.RunnerSessionStartStep{StepRunId: stepRunID, StepKind: contracts.RunnerSessionStartStepStepKindCode},
		Title:          "Le panier garde les articles",
	}
}

func message(text string) contracts.EngineEvent {
	return contracts.EngineEvent{Message: &contracts.EngineEventMessage{From: "agent", Text: text, Final: true}}
}

func result(engineSessionID string) contracts.EngineEvent {
	return contracts.EngineEvent{Result: &contracts.EngineEventResult{Status: contracts.EngineEventResultStatusOk, EngineSessionId: &engineSessionID}}
}

func question(id string) contracts.EngineEvent {
	return contracts.EngineEvent{Question: &contracts.EngineEventQuestion{RequestId: id, Title: "Quelle couleur ?", Options: []contracts.EngineEventQuestionOptionsElem{{Label: "Bleu"}}}}
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func (s *setup) worktree(branch string) string {
	return filepath.Join(s.home, "worktrees", projectID, strings.ReplaceAll(branch, "/", "__"))
}

func TestASessionClonesOnceFetchesBeforeTheNextAndRemovesItsWorktreeOnceEnded(t *testing.T) {
	s := newSetup(t, message("fait"), result("eng-1"))
	develop := git(t, s.remote.work, "rev-parse", "HEAD")
	var heads []string
	s.hooks.Prepare = func(_ context.Context, w session.Worktree) error {
		heads = append(heads, git(t, w.Dir, "rev-parse", "HEAD"))
		return nil
	}
	m := s.manager(t)

	m.Start(start(firstID, "feat/12-panier"))
	ended := s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)
	if ended.Outcome == nil || *ended.Outcome != contracts.RunnerSessionStateOutcomeOk || ended.Error != nil {
		t.Fatalf("ended %+v, want ok", ended)
	}
	if states := s.reports.states(firstID); states[0] != contracts.RunnerSessionStateStateStarting || states[1] != contracts.RunnerSessionStateStateActive {
		t.Fatalf("states %v, want starting, active, …, ended", states)
	}
	if ended.EngineSessionId == nil || *ended.EngineSessionId != "eng-1" {
		t.Fatalf("ended %+v, want the Moteur's id eng-1", ended)
	}
	clone := filepath.Join(s.home, "repos", "github", "acme", "shop")
	runs := s.engine.Runs()
	if len(runs) != 1 {
		t.Fatalf("%d runs, want 1", len(runs))
	}
	opts := runs[0].Options()
	if opts.Dir != s.worktree("feat/12-panier") || opts.PermissionMode != engine.PermissionBypass || opts.Model != "claude-opus-5-5" || opts.Role != "code" {
		t.Fatalf("options %+v", opts)
	}
	if !strings.Contains(opts.InitialPrompt, "Run the Étape code for the StepRun "+stepRunID+".") {
		t.Fatalf("initial prompt %q", opts.InitialPrompt)
	}
	if opts.SessionDir != filepath.Join(s.home, "sessions", firstID) {
		t.Fatalf("session dir %q", opts.SessionDir)
	}
	if exists(s.worktree("feat/12-panier")) {
		t.Fatal("the worktree is still there once the Session ended")
	}
	if heads[0] != develop {
		t.Fatalf("the worktree started at %s, want develop's %s", heads[0], develop)
	}

	// The next Session, on a branch the remote has since: the clone is not
	// made again, it is fetched, and the worktree starts from the remote branch.
	marker := filepath.Join(clone, ".git", "crewdeck-test-marker")
	if err := os.WriteFile(marker, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	git(t, s.remote.work, "checkout", "-b", "feat/13-remise")
	remise := s.remote.commit(t, "REMISE", "10 %\n")
	git(t, s.remote.work, "push", "origin", "feat/13-remise")

	m.Start(start(secondID, "feat/13-remise"))
	s.reports.await(t, secondID, contracts.RunnerSessionStateStateEnded)
	if !exists(marker) {
		t.Fatal("the clone was made again")
	}
	if heads[1] != remise {
		t.Fatalf("the worktree started at %s, want the remote branch's %s", heads[1], remise)
	}
}

func TestASessionWithoutAStepStartsWithoutAPromptInItsPermissionMode(t *testing.T) {
	s := newSetup(t, result("eng-1"))
	m := s.manager(t)
	message := start(firstID, "feat/12-panier")
	message.Step = nil
	message.PermissionMode = contracts.RunnerSessionStartPermissionModeAuto

	m.Start(message)
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)
	opts := s.engine.Runs()[0].Options()
	if opts.InitialPrompt != "" || opts.PermissionMode != engine.PermissionAuto {
		t.Fatalf("options %+v, want no prompt, auto", opts)
	}
}

func TestAFailingPrepareEndsTheSessionWithSetupFailedAndTheMoteurNeverStarts(t *testing.T) {
	s := newSetup(t, result("eng-1"))
	var cleaned []bool
	s.hooks.Prepare = func(context.Context, session.Worktree) error { return errors.New("pnpm install failed") }
	s.hooks.Clean = func(_ context.Context, w session.Worktree) error {
		cleaned = append(cleaned, exists(w.Dir))
		return nil
	}
	m := s.manager(t)

	m.Start(start(firstID, "feat/12-panier"))
	ended := s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)
	if ended.Outcome == nil || *ended.Outcome != contracts.RunnerSessionStateOutcomeError || ended.Error == nil || *ended.Error != contracts.RunnerSessionStateErrorSetupFailed {
		t.Fatalf("ended %+v, want error setup-failed", ended)
	}
	if runs := s.engine.Runs(); len(runs) != 0 {
		t.Fatalf("the Moteur started %d times", len(runs))
	}
	if len(cleaned) != 1 || !cleaned[0] {
		t.Fatalf("Clean %v, want once, before the worktree's removal", cleaned)
	}
	if exists(s.worktree("feat/12-panier")) {
		t.Fatal("the worktree is still there")
	}
}

func TestCleanRunsBeforeTheWorktreeIsRemovedAndNilHooksRunNothing(t *testing.T) {
	s := newSetup(t, result("eng-1"))
	var cleaned []bool
	s.hooks.Clean = func(_ context.Context, w session.Worktree) error {
		cleaned = append(cleaned, exists(filepath.Join(w.Dir, "README")))
		return errors.New("cleaning failed")
	}
	m := s.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)
	if len(cleaned) != 1 || !cleaned[0] {
		t.Fatalf("Clean %v, want once, the worktree still there", cleaned)
	}
	if exists(s.worktree("feat/12-panier")) {
		t.Fatal("a failing Clean kept the worktree")
	}

	// Without hooks, the worktree's .process.json runs none of its commands.
	s.hooks = session.Hooks{}
	var ran []bool
	s.engine.Events = nil
	m = s.manager(t)
	m.Start(start(secondID, "feat/13-remise"))
	s.reports.await(t, secondID, contracts.RunnerSessionStateStateEnded)
	for _, dir := range []string{s.worktree("feat/13-remise"), filepath.Join(s.home, "repos", "github", "acme", "shop")} {
		ran = append(ran, exists(filepath.Join(dir, "ran")))
	}
	if ran[0] || ran[1] {
		t.Fatal("a command of .process.json ran")
	}
}

func TestASecondSessionOnALiveBranchEndsWithBranchBusy(t *testing.T) {
	s := newSetup(t, question("q1"))
	m := s.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateWaiting)

	m.Start(start(secondID, "feat/12-panier"))
	ended := s.reports.await(t, secondID, contracts.RunnerSessionStateStateEnded)
	if ended.Error == nil || *ended.Error != contracts.RunnerSessionStateErrorBranchBusy {
		t.Fatalf("ended %+v, want branch-busy", ended)
	}
	if !exists(s.worktree("feat/12-panier")) {
		t.Fatal("the live Session's worktree was removed")
	}
	if runs := s.engine.Runs(); len(runs) != 1 {
		t.Fatalf("%d runs, want the first one only", len(runs))
	}
}

func TestACloneThatFailsEndsTheSessionWithCloneFailed(t *testing.T) {
	s := newSetup(t, result("eng-1"))
	m := s.manager(t)
	message := start(firstID, "feat/12-panier")
	message.Origin.Name = "missing"
	m.Start(message)
	ended := s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)
	if ended.Error == nil || *ended.Error != contracts.RunnerSessionStateErrorCloneFailed {
		t.Fatalf("ended %+v, want clone-failed", ended)
	}
}

func TestAStartOfASessionTheRunnerKnowsDoesNotStartItTwice(t *testing.T) {
	s := newSetup(t, question("q1"))
	m := s.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateWaiting)

	m.Start(start(firstID, "feat/12-panier"))
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateWaiting)
	if runs := s.engine.Runs(); len(runs) != 1 {
		t.Fatalf("%d runs, want 1", len(runs))
	}
}

func TestStopThenResumeContinuesTheSameMoteurSessionAndTheLogsSeq(t *testing.T) {
	s := newSetup(t, result("eng-1"), question("q1"))
	m := s.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateWaiting)
	waitForSeq(t, s.home, firstID, 2) // the question too

	m.Stop(firstID)
	stopped := s.reports.await(t, firstID, contracts.RunnerSessionStateStateStopped)
	if stopped.EngineSessionId == nil || *stopped.EngineSessionId != "eng-1" {
		t.Fatalf("stopped %+v, want eng-1 kept", stopped)
	}
	if !exists(s.worktree("feat/12-panier")) {
		t.Fatal("a stopped Session lost its worktree")
	}
	if got := m.Hello(); len(got) != 1 || got[0].SessionId != firstID || got[0].Alive {
		t.Fatalf("hello %+v, want the stopped Session, not alive", got)
	}

	m.Resume(firstID)
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateActive)
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateWaiting)
	runs := s.engine.Runs()
	if len(runs) != 2 || runs[1].EngineSessionID() != "eng-1" || runs[1].Options().Dir != s.worktree("feat/12-panier") {
		t.Fatalf("runs %d, the second resuming %q", len(runs), runs[len(runs)-1].EngineSessionID())
	}
	waitForSeq(t, s.home, firstID, 5)
	var seqs []int
	for event, err := range session.Replay(s.home, firstID, 0) {
		if err != nil {
			t.Fatal(err)
		}
		seqs = append(seqs, seqOf(event))
	}
	// The first run: result, question, the interrupted result; the second: result, question.
	if want := []int{1, 2, 3, 4, 5}; !equal(seqs, want) {
		t.Fatalf("log seqs %v, want %v", seqs, want)
	}
	var after []int
	for event, err := range session.Replay(s.home, firstID, 3) {
		if err != nil {
			t.Fatal(err)
		}
		after = append(after, seqOf(event))
	}
	if !equal(after, []int{4, 5}) {
		t.Fatalf("replay after 3: %v", after)
	}
}

func TestAfterARestartTheHelloSaysItsSessionsDeadAndOnlyResumeRestartsThem(t *testing.T) {
	s := newSetup(t, result("eng-1"), question("q1"))
	m := s.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateWaiting)
	waitForSeq(t, s.home, firstID, 2) // the question too
	if got := m.Hello(); len(got) != 1 || !got[0].Alive {
		t.Fatalf("hello %+v, want the Session alive", got)
	}
	m.Close() // the Runner stops: its Moteurs die with it

	restarted := s.manager(t)
	if got := restarted.Hello(); len(got) != 1 || got[0].SessionId != firstID || got[0].Alive {
		t.Fatalf("hello after the restart %+v, want the Session, not alive", got)
	}
	if runs := s.engine.Runs(); len(runs) != 1 {
		t.Fatalf("%d runs after the restart, want none more", len(runs))
	}
	restarted.Resume(firstID)
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateActive)
	runs := s.engine.Runs()
	if len(runs) != 2 || runs[1].EngineSessionID() != "eng-1" {
		t.Fatalf("the resume did not continue eng-1: %d runs", len(runs))
	}
}

func TestAResumeOfASessionTheRunnerDoesNotKnowEndsIt(t *testing.T) {
	s := newSetup(t)
	m := s.manager(t)
	m.Resume(firstID)
	ended := s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)
	if ended.Error == nil || *ended.Error != contracts.RunnerSessionStateErrorEngineFailed {
		t.Fatalf("ended %+v, want engine-failed", ended)
	}
}

func TestTheSessionsFolderAndLogAreThePilotesOnly(t *testing.T) {
	s := newSetup(t, message("fait"), result("eng-1"))
	m := s.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)
	dir := filepath.Join(s.home, "sessions", firstID)
	for path, mode := range map[string]os.FileMode{dir: 0o700, filepath.Join(dir, "log.jsonl"): 0o600, filepath.Join(dir, "session.json"): 0o600} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != mode {
			t.Fatalf("%s mode %o, want %o", path, info.Mode().Perm(), mode)
		}
	}
}

func waitForSeq(t *testing.T, home, id string, seq int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		last := 0
		for event, err := range session.Replay(home, id, 0) {
			if err == nil {
				last = seqOf(event)
			}
		}
		if last >= seq {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("the log of %s never reached seq %d", id, seq)
}

func seqOf(event contracts.EngineEvent) int {
	switch {
	case event.Result != nil:
		return event.Result.Seq
	case event.Question != nil:
		return event.Question.Seq
	case event.Message != nil:
		return event.Message.Seq
	}
	return -1
}

func equal(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
