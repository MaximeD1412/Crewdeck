package session_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/enginetest"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
)

// officialSkills stand for the embedded Skills: the test Skill, and one a
// Session of it must not see.
func officialSkills(t *testing.T) fs.FS {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "skills", "testdata", "crewdeck-test", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	return fstest.MapFS{
		"crewdeck-test/SKILL.md": {Data: data},
		"code/SKILL.md":          {Data: []byte("---\nname: code\n---\n")},
	}
}

// filesUnder are the files under dir, relative to it.
func filesUnder(t *testing.T, dir string) []string {
	t.Helper()
	var found []string
	err := filepath.WalkDir(dir, func(name string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(dir, name)
		found = append(found, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return found
}

func envOf(env []string, name string) (string, bool) {
	for _, kv := range env {
		if value, ok := strings.CutPrefix(kv, name+"="); ok {
			return value, true
		}
	}
	return "", false
}

func TestAnEtapesSessionOfClaudeCodeGetsItsSkillAloneAsAPlugin(t *testing.T) {
	s := newSetup(t, message("fait"), result("eng-1"))
	s.config = func(c *session.Config) { c.Skills, c.RunnerVersion = officialSkills(t), "1.4.0" }
	m := s.manager(t)

	m.Start(start(firstID, "feat/12-panier"))
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)

	opts := s.engine.Runs()[0].Options()
	plugin := filepath.Join(s.home, "sessions", firstID, "plugin")
	if opts.SkillsDir != plugin {
		t.Fatalf("SkillsDir %q, want the Session's plugin %q", opts.SkillsDir, plugin)
	}
	if got := strings.Join(filesUnder(t, plugin), " "); got != ".claude-plugin/plugin.json skills/crewdeck-test/SKILL.md" {
		t.Fatalf("the plugin holds %s, want the test Skill alone", got)
	}
	if id, ok := envOf(opts.Env, session.SessionEnv); !ok || id != firstID {
		t.Fatalf("the Moteur's %s is %q", session.SessionEnv, id)
	}
}

func TestAnEtapesSessionOfCodexGetsItsSkillAloneInItsHome(t *testing.T) {
	s := newSetup(t, message("fait"), result("eng-1"))
	s.engine.EngineID = contracts.EngineIdCodex
	s.config = func(c *session.Config) { c.Skills = officialSkills(t) }
	m := s.manager(t)
	message := start(firstID, "feat/12-panier")
	message.Engine = contracts.RunnerSessionStartEngineCodex

	m.Start(message)
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)

	opts := s.engine.Runs()[0].Options()
	home := filepath.Join(s.home, "sessions", firstID, "codex-home")
	if got, _ := envOf(opts.Env, "CODEX_HOME"); got != home || opts.SkillsDir != "" {
		t.Fatalf("CODEX_HOME %q, SkillsDir %q; want %q and none", got, opts.SkillsDir, home)
	}
	if got := strings.Join(filesUnder(t, home), " "); got != "config.toml skills/crewdeck-test/SKILL.md" {
		t.Fatalf("the home holds %s, want the test Skill alone", got)
	}
}

func TestAnEtapesSessionWhoseSkillTheRunnerDoesNotEmbedEndsSetupFailed(t *testing.T) {
	s := newSetup(t, message("fait"))
	s.config = func(c *session.Config) { c.Skills = officialSkills(t) }
	m := s.manager(t)
	message := start(firstID, "feat/12-panier")
	message.Step.Skill = "product-design"

	m.Start(message)
	ended := s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)

	if ended.Error == nil || *ended.Error != contracts.RunnerSessionStateErrorSetupFailed {
		t.Fatalf("ended %+v, want setup-failed", ended)
	}
	if runs := s.engine.Runs(); len(runs) != 0 {
		t.Fatalf("%d Moteurs started", len(runs))
	}
	if exists(s.worktree("feat/12-panier")) {
		t.Fatal("the worktree is left")
	}
}

// stepSetup is a running Session of an Étape, its Moteur waiting on its
// question `hold`, with runner.sock serving its ops.
type stepSetup struct {
	*relayed
	m      *session.Manager
	socket string
	key    []byte
	// sealed are the contents the vault sealed, by their additional data;
	// version is the vault's, 1 unless moved.
	mu      sync.Mutex
	sealed  map[string]string
	version int
}

func newStepSetup(t *testing.T, config func(*session.Config)) *stepSetup {
	t.Helper()
	return newStepSetupOf(t, config, start(firstID, "feat/12-panier"))
}

// newStepSetupOf is newStepSetup for the Session message starts.
func newStepSetupOf(t *testing.T, config func(*session.Config), begin contracts.RunnerSessionStart) *stepSetup {
	t.Helper()
	st := &stepSetup{relayed: newRelayed(t, message("au travail"), question("hold")), sealed: map[string]string{}, version: 1}
	st.config = func(c *session.Config) {
		c.Seal = func(plaintext, aad []byte) (keys.SealedItem, int, error) {
			st.mu.Lock()
			defer st.mu.Unlock()
			st.sealed[string(aad)] = string(plaintext)
			return keys.SealedItem{Key: bytes.Repeat([]byte{byte(st.version)}, 60), Ciphertext: bytes.Repeat([]byte{2}, 32)}, st.version, nil
		}
		if config != nil {
			config(c)
		}
	}
	st.m = st.manager(t)
	st.socket = serveSocket(t, st.m, st.home)
	st.m.Start(begin)
	st.key = st.openKeys(t, st.frame(t).(contracts.RunnerSessionKeys), st.holders[0])
	st.waiting(t, "hold", contracts.RunnerSessionWaitingKindQuestion, 2)
	return st
}

func (st *stepSetup) call(t *testing.T, op string, request, reply any) error {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return localsock.Call(ctx, st.socket, op, request, reply)
}

func (st *stepSetup) step(t *testing.T) any {
	t.Helper()
	select {
	case m := <-st.reports.steps:
		return m
	case <-time.After(10 * time.Second):
		t.Fatal("no step message sent")
		return nil
	}
}

func failed(err error) string {
	var f *localsock.Failed
	if errors.As(err, &f) {
		return f.Code
	}
	if err != nil {
		return err.Error()
	}
	return ""
}

func TestEtapeStartSendsStepStartedAndGivesTheEtapesContext(t *testing.T) {
	st := newStepSetup(t, nil)

	var got session.StepContext
	if err := st.call(t, session.OpStepStart, session.StepRequest{SessionID: firstID}, &got); err != nil {
		t.Fatal(err)
	}

	if started, ok := st.step(t).(contracts.RunnerStepStarted); !ok || started.StepRunId != stepRunID {
		t.Fatalf("sent %+v, want the step.started of the StepRun", started)
	}
	if got.StepRunID != stepRunID || got.StepKind != contracts.RunnerSessionStartStepStepKindCode || got.Skill != "crewdeck-test" || got.ContractID != nil ||
		deref(got.ProjectID) != projectID || deref(got.Branch) != "feat/12-panier" || deref(got.Base) != "develop" || got.Origin == nil || got.Origin.Github == nil || got.Inputs == nil {
		t.Fatalf("context %+v", got)
	}
	if code := failed(st.call(t, session.OpStepStart, session.StepRequest{SessionID: secondID}, nil)); code != "not-found" {
		t.Fatalf("an unknown Session: %q, want not-found", code)
	}
}

func TestEtapeOfASessionWithoutAnEtapeIsRefused(t *testing.T) {
	r := newRelayed(t, question("hold"))
	m := r.manager(t)
	socket := serveSocket(t, m, r.home)
	message := start(firstID, "feat/12-panier")
	message.Step = nil
	m.Start(message)
	r.reports.await(t, firstID, contracts.RunnerSessionStateStateWaiting)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if code := failed(localsock.Call(ctx, socket, session.OpStepStart, session.StepRequest{SessionID: firstID}, nil)); code != "no-step" {
		t.Fatalf("%q, want no-step", code)
	}
}

func TestEtapeReportSendsTheFiguresAndTheContentSealedUnderItsStepRun(t *testing.T) {
	st := newStepSetup(t, nil)

	err := st.call(t, session.OpStepReport, map[string]any{"sessionId": firstID, "figures": map[string]any{"read": 1, "ticket": 12}, "content": "Le Ticket est lu."}, nil)
	if err != nil {
		t.Fatal(err)
	}

	report, ok := st.step(t).(contracts.RunnerStepReport)
	if !ok || report.StepRunId != stepRunID || len(report.Figures) != 2 || report.Figures["read"] != float64(1) {
		t.Fatalf("sent %+v", report)
	}
	b64 := base64.RawURLEncoding
	if report.Sealed == nil || report.Sealed.Key != b64.EncodeToString(bytes.Repeat([]byte{1}, 60)) || report.Sealed.Ciphertext != b64.EncodeToString(bytes.Repeat([]byte{2}, 32)) {
		t.Fatalf("sealed %+v, want the vault's item in base64url", report.Sealed)
	}
	if report.VaultKeyVersion == nil || *report.VaultKeyVersion != 1 {
		t.Fatalf("vaultKeyVersion %v, want the vault's 1", report.VaultKeyVersion)
	}
	st.mu.Lock()
	sealed := st.sealed["step.report:"+stepRunID]
	st.mu.Unlock()
	if sealed != "Le Ticket est lu." {
		t.Fatalf("sealed %q under step.report:<stepRunId>", st.sealed)
	}

	// Figures beyond STEP_REPORT_FIGURES_MAX, or none, are refused, and nothing sent.
	long := map[string]any{"sessionId": firstID, "figures": map[string]any{"text": strings.Repeat("é", session.StepReportFiguresMax)}}
	if code := failed(st.call(t, session.OpStepReport, long, nil)); code != "too-long" {
		t.Fatalf("figures too long: %q", code)
	}
	if code := failed(st.call(t, session.OpStepReport, map[string]any{"sessionId": firstID, "figures": []int{1}}, nil)); code != "bad-request" {
		t.Fatalf("figures not an object: %q", code)
	}
	select {
	case m := <-st.reports.steps:
		t.Fatalf("sent %+v", m)
	case <-time.After(100 * time.Millisecond):
	}
}

// E2E-4: a rotation done between a report's seal and its reception leaves
// it kept nowhere; once the vault held moves, the last report of a running
// Étape goes again, sealed under the new version. A move to no new version
// sends nothing.
func TestTheLastReportGoesAgainSealedUnderTheVaultsNewVersion(t *testing.T) {
	st := newStepSetup(t, nil)
	if err := st.call(t, session.OpStepReport, map[string]any{"sessionId": firstID, "figures": map[string]any{"read": 1}, "content": "Le Ticket est lu."}, nil); err != nil {
		t.Fatal(err)
	}
	if first := st.step(t).(contracts.RunnerStepReport); *first.VaultKeyVersion != 1 {
		t.Fatalf("first report under %d", *first.VaultKeyVersion)
	}

	st.m.VaultMoved()
	select {
	case m := <-st.reports.steps:
		t.Fatalf("the vault held still 1, sent %+v", m)
	case <-time.After(100 * time.Millisecond):
	}

	st.mu.Lock()
	st.version = 2
	delete(st.sealed, "step.report:"+stepRunID)
	st.mu.Unlock()
	st.m.VaultMoved()
	again, ok := st.step(t).(contracts.RunnerStepReport)
	if !ok || again.StepRunId != stepRunID || again.Figures["read"] != float64(1) || again.VaultKeyVersion == nil || *again.VaultKeyVersion != 2 {
		t.Fatalf("sent again %+v", again)
	}
	if again.Sealed == nil || again.Sealed.Key != base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{2}, 60)) {
		t.Fatalf("sealed again %+v, want under the version 2", again.Sealed)
	}
	st.mu.Lock()
	sealed := st.sealed["step.report:"+stepRunID]
	st.mu.Unlock()
	if sealed != "Le Ticket est lu." {
		t.Fatalf("sealed again %q", sealed)
	}
	st.m.VaultMoved()
	select {
	case m := <-st.reports.steps:
		t.Fatalf("already under 2, sent %+v", m)
	case <-time.After(100 * time.Millisecond):
	}
}

func TestEtapeAskWaitsAsAQuestionAndItsAnswerGoesToTheSkillNotTheMoteur(t *testing.T) {
	st := newStepSetup(t, func(c *session.Config) { c.AskPoll = 100 * time.Millisecond })
	question := map[string]any{"title": "Quel nom ?", "options": []map[string]any{{"label": "Panier"}, {"label": "Caddie"}}, "multiple": false}

	var asked session.StepAskReply
	if err := st.call(t, session.OpStepAsk, map[string]any{"sessionId": firstID, "question": question}, &asked); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(asked.RequestID, "etape-") {
		t.Fatalf("requestId %q", asked.RequestID)
	}
	st.waiting(t, asked.RequestID, contracts.RunnerSessionWaitingKindQuestion, 3)
	for _, kind := range []string{"message", "question"} {
		if event := st.liveEvent(t, st.key); event["kind"] != kind {
			t.Fatalf("event %v, want %s", event, kind)
		}
	}
	if event := st.liveEvent(t, st.key); event["kind"] != "question" || event["requestId"] != asked.RequestID || event["title"] != "Quel nom ?" || event["seq"] != float64(3) {
		t.Fatalf("event %v, want the Étape's question as seq 3", event)
	}

	// Before the answer, a wait ends unanswered; the Skill waits again.
	var reply session.StepAnswerReply
	if err := st.call(t, session.OpStepAnswer, session.StepAnswerRequest{SessionID: firstID, RequestID: asked.RequestID}, &reply); err != nil || reply.Answered {
		t.Fatalf("reply %+v, %v; want unanswered", reply, err)
	}

	st.m.Input(sealInput(t, st.key, firstID, inputID, map[string]any{"kind": "answer", "requestId": asked.RequestID, "optionIndexes": []int{1}}))
	st.answered(t, asked.RequestID)
	if event := st.liveEvent(t, st.key); event["kind"] != "answer" || event["requestId"] != asked.RequestID || event["seq"] != float64(4) {
		t.Fatalf("event %v, want the answer logged as seq 4", event)
	}
	if err := st.call(t, session.OpStepAnswer, session.StepAnswerRequest{SessionID: firstID, RequestID: asked.RequestID}, &reply); err != nil || !reply.Answered || reply.Answer == nil || !slices.Equal(reply.Answer.Options, []string{"Caddie"}) {
		t.Fatalf("reply %+v, %v; want the option Caddie", reply, err)
	}
	if answers := st.engine.Runs()[0].Answers(); len(answers) != 0 {
		t.Fatalf("the Moteur got %+v", answers)
	}
	// The Moteur's own question still waits.
	if got := st.reports.states(firstID); got[len(got)-1] != contracts.RunnerSessionStateStateWaiting {
		t.Fatalf("states %v, want waiting last", got)
	}

	// The Session stopped: a question still waiting ends.
	if err := st.call(t, session.OpStepAsk, map[string]any{"sessionId": firstID, "question": map[string]any{"title": "Et ensuite ?", "options": []any{}}}, &asked); err != nil {
		t.Fatal(err)
	}
	st.m.Stop(firstID)
	if code := failed(st.call(t, session.OpStepAnswer, session.StepAnswerRequest{SessionID: firstID, RequestID: asked.RequestID}, &reply)); code != "ended" {
		t.Fatalf("%q, want ended", code)
	}

	if code := failed(st.call(t, session.OpStepAsk, map[string]any{"sessionId": firstID, "question": map[string]any{"title": " "}}, nil)); code != "bad-request" {
		t.Fatalf("a question without a title: %q", code)
	}
}

// change is the fake Miroir's change of code: it records what was read.
type change struct {
	mu   sync.Mutex
	read []string
	pr   *contrat.PullRequest
}

func (c *change) of(_ context.Context, projectID, branch string) (*contrat.PullRequest, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.read = append(c.read, projectID+" "+branch)
	return c.pr, nil
}

func TestAnEtapesSessionEndedOkSendsItsContratsVerdictBeforeItsEnd(t *testing.T) {
	s := newSetup(t, message("fait"), result("eng-1"))
	s.hooks.Prepare = func(_ context.Context, w session.Worktree) error {
		// The README the Moteur would write, which only the worktree has.
		return os.WriteFile(filepath.Join(w.Dir, "README.md"), []byte("# Shop\n"), 0o644)
	}
	pr := &change{pr: &contrat.PullRequest{Base: "develop", Head: "feat/12-panier", Body: "Closes #12", Labels: []string{"conception"}, HeadSHA: "0123abc"}}
	s.config = func(c *session.Config) { c.ChangeOf = pr.of }
	m := s.manager(t)
	message := start(firstID, "feat/12-panier")
	message.Step.ContractId = "example"

	m.Start(message)
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)

	var verdict contracts.RunnerStepVerdict
	select {
	case sent := <-s.reports.steps:
		verdict, _ = sent.(contracts.RunnerStepVerdict)
	case <-time.After(time.Second):
		t.Fatal("no step.verdict")
	}
	v := verdict.Verdict
	if verdict.StepRunId != stepRunID || v.ContractId != "example" || v.Version != 1 || v.Status != contracts.ContratVerdictStatusIncomplete || v.HeadSha == nil || *v.HeadSha != "0123abc" {
		t.Fatalf("verdict %+v", verdict)
	}
	if slices.Contains(v.FailedRuleIds, "example.readme") || slices.Contains(v.FailedRuleIds, "example.pr") || !slices.Contains(v.FailedRuleIds, "example.notes") {
		t.Fatalf("failed %v: the worktree's README and the PR pass, the notes fail", v.FailedRuleIds)
	}
	if pr.read[0] != projectID+" feat/12-panier" || len(pr.read) != 1 {
		t.Fatalf("change read %v, want the Session's branch once", pr.read)
	}
	s.reports.mu.Lock()
	order := slices.Clone(s.reports.order)
	s.reports.mu.Unlock()
	if i := slices.Index(order, "step.verdict"); i < 0 || i+1 >= len(order) || order[i+1] != "session.state ended" {
		t.Fatalf("sent %v, want step.verdict right before the end", order)
	}
}

func TestAnUnknownContratSendsNoVerdictAndLogsItsCodeOnly(t *testing.T) {
	s := newSetup(t, message("fait"), result("eng-1"))
	var logged bytes.Buffer
	s.config = func(c *session.Config) { c.Logger = slog.New(slog.NewTextHandler(&logged, nil)) }
	m := s.manager(t)
	message := start(firstID, "feat/12-panier")
	message.Step.ContractId = "unknown-contract"

	m.Start(message)
	ended := s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)

	if ended.Outcome == nil || *ended.Outcome != contracts.RunnerSessionStateOutcomeOk {
		t.Fatalf("ended %+v, want ok", ended)
	}
	select {
	case sent := <-s.reports.steps:
		t.Fatalf("sent %+v", sent)
	default:
	}
	if !strings.Contains(logged.String(), "error=unknown-contrat") {
		t.Fatalf("logged %q", logged.String())
	}
}

// Claude Code stays alive after its turn, waiting for its next message on
// stdin: an Étape's Session on the real adapter, its fake binary kept open
// after its result, still ends ok, its Contrat checked and its verdict sent.
func TestAnEtapesSessionOnClaudeCodeWaitingAfterItsTurnEndsOkWithItsVerdict(t *testing.T) {
	stream := filepath.Join(t.TempDir(), "stream.jsonl")
	lines := []string{
		`{"type":"system","subtype":"init","session_id":"etape-0000-4000-8000-000000000001"}`,
		`{"type":"assistant","message":{"content":[{"type":"text","text":"fait"}]}}`,
		`{"type":"result","subtype":"success","is_error":false,"session_id":"etape-0000-4000-8000-000000000001"}`,
		`{"fake":"await-eof"}`,
	}
	if err := os.WriteFile(stream, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	s := newSetup(t)
	// A short home: Claude's control socket is under the 108 bytes of a unix address.
	home, err := os.MkdirTemp("", "cd-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(home) })
	s.home = filepath.Join(home, ".crewdeck")
	s.adapter = &claude.Engine{BinaryPath: enginetest.FakeBinary(t), Env: []string{"FAKE_ENGINE_STREAM=" + stream}}
	pr := &change{pr: &contrat.PullRequest{Base: "develop", Head: "feat/12-panier", Body: "Closes #12", HeadSHA: "0123abc"}}
	s.config = func(c *session.Config) { c.ChangeOf = pr.of }
	m := s.manager(t)
	message := start(firstID, "feat/12-panier")
	message.Step.ContractId = "example"

	m.Start(message)
	ended := s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)

	if ended.Outcome == nil || *ended.Outcome != contracts.RunnerSessionStateOutcomeOk {
		t.Fatalf("ended %+v, want ok", ended)
	}
	select {
	case sent := <-s.reports.steps:
		if verdict, ok := sent.(contracts.RunnerStepVerdict); !ok || verdict.StepRunId != stepRunID {
			t.Fatalf("sent %+v, want the StepRun's verdict", sent)
		}
	case <-time.After(time.Second):
		t.Fatal("no step.verdict")
	}
}

// A Session of the Pilote's own waits for their next message after a turn;
// an Étape's whose turn ended in error ends in error, with no verdict.
func TestOnlyAnEtapesTurnEndsItsSessionAndOneInErrorEndsItInError(t *testing.T) {
	failed := contracts.EngineEvent{Result: &contracts.EngineEventResult{Status: contracts.EngineEventResultStatusError}}
	s := newSetup(t, message("fait"), failed)
	s.engine.StayOpen = true
	m := s.manager(t)
	pilots := start(secondID, "feat/13-favoris")
	pilots.Step = nil

	m.Start(pilots)
	s.reports.await(t, secondID, contracts.RunnerSessionStateStateWaiting)
	m.Start(start(firstID, "feat/12-panier"))
	ended := s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)

	if ended.Outcome == nil || *ended.Outcome != contracts.RunnerSessionStateOutcomeError || ended.Error == nil || *ended.Error != contracts.RunnerSessionStateErrorEngineFailed {
		t.Fatalf("ended %+v, want error engine-failed", ended)
	}
	runs := s.engine.Runs()
	if len(runs) != 2 || runs[0].Ended() || !runs[1].Ended() {
		t.Fatalf("ended runs: the Pilote's %v, the Étape's %v", runs[0].Ended(), runs[1].Ended())
	}
	if states := s.reports.states(secondID); slices.Contains(states, contracts.RunnerSessionStateStateEnded) {
		t.Fatalf("the Pilote's Session went %v", states)
	}
	select {
	case sent := <-s.reports.steps:
		t.Fatalf("sent %+v, want no verdict", sent)
	default:
	}
}

// deref is *s, "" for null.
func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
