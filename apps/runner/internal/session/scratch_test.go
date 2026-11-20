package session_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
)

// ideaID is the Idée a scratch Session analyses.
const ideaID = "7a1c2e4d-0000-4000-8000-000000000001"

// ideaFixture is a folder of the Contrat idea-analysis's fixtures.
func ideaFixture(name, file string) string {
	return filepath.Join("..", "contrat", "checks", "testdata", "idea-analysis", name, ".crewdeck", file)
}

// scratchStart starts a Session without code: no Projet, Origin, branch
// nor base, the Étape idea-analysis of the Idée ideaID.
func scratchStart(id string) contracts.RunnerSessionStart {
	message := start(id, "")
	message.ProjectId, message.Origin, message.Branch, message.Base, message.Title = nil, nil, nil, nil, nil
	message.Step = &contracts.RunnerSessionStartStep{
		StepRunId: stepRunID, StepKind: contracts.RunnerSessionStartStepStepKindIdeaAnalysis, Skill: "crewdeck-test",
		ContractId: "idea-analysis", Inputs: []contracts.RunnerSessionStartStepInputsElem{},
		Ideas: &contracts.RunnerSessionStartStepIdeas{
			Idea: contracts.RunnerSessionStartStepIdeasIdea{Id: ideaID, Number: 64, Text: contracts.RunnerSessionStartStepIdeasIdeaText{Key: "a2V5", Ciphertext: "dGV4dGU"}},
			Open: []contracts.RunnerSessionStartStepIdeasOpenElem{},
		},
	}
	return message
}

// fakeKind stands for the kind idea-analysis: it writes the context of the
// fixtures, and reads the report the test wrote.
type fakeKind struct {
	mu       sync.Mutex
	prepared []string
}

func (k *fakeKind) Prepare(_ context.Context, dir string, step *contracts.RunnerSessionStartStep) error {
	k.mu.Lock()
	k.prepared = append(k.prepared, dir)
	k.mu.Unlock()
	data, err := os.ReadFile(ideaFixture("pass", "context.json"))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(dir, ".crewdeck"), 0o700); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, ".crewdeck", "context.json"), data, 0o600)
}

func (k *fakeKind) Report(dir string, step *contracts.RunnerSessionStartStep) (session.StepReport, error) {
	data, err := os.ReadFile(filepath.Join(dir, ".crewdeck", "report.json"))
	if err != nil {
		return session.StepReport{}, err
	}
	var report map[string]any
	if err := json.Unmarshal(data, &report); err != nil {
		return session.StepReport{}, err
	}
	return session.StepReport{Figures: map[string]any{"impact": report["impact"]}, Content: []byte(report["summary"].(string)), AAD: step.Ideas.Idea.Id + ":analysis"}, nil
}

func (k *fakeKind) dirs() []string {
	k.mu.Lock()
	defer k.mu.Unlock()
	return slices.Clone(k.prepared)
}

// withKind registers kind for idea-analysis.
func withKind(kind session.StepKind) func(*session.Config) {
	return func(c *session.Config) {
		c.Steps = map[contracts.RunnerSessionStartStepStepKind]session.StepKind{contracts.RunnerSessionStartStepStepKindIdeaAnalysis: kind}
	}
}

func TestASessionWithoutCodeRunsInItsScratchFolderWithoutCloneNorToken(t *testing.T) {
	s := newSetup(t, message("fait"), result("eng-1"))
	kind := &fakeKind{}
	s.hooks.Prepare = func(context.Context, session.Worktree) error {
		t.Error("the Hooks prepared a scratch folder")
		return nil
	}
	s.config = func(c *session.Config) {
		withKind(kind)(c)
		c.GitHubTokens = func(context.Context, string) (github.Issued, error) {
			t.Error("a scratch Session asked a GitHub token")
			return github.Issued{}, errors.New("no token")
		}
		c.ChangeOf = func(context.Context, string, string) (*contrat.PullRequest, error) {
			t.Error("a scratch Session read a change of code")
			return nil, nil
		}
	}
	m := s.manager(t)

	m.Start(scratchStart(firstID))
	ended := s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)

	if ended.Outcome == nil || *ended.Outcome != contracts.RunnerSessionStateOutcomeOk || ended.Error != nil {
		t.Fatalf("ended %+v, want ok", ended)
	}
	dir := filepath.Join(s.home, "scratch", firstID)
	if runs := s.engine.Runs(); len(runs) != 1 || runs[0].Options().Dir != dir {
		t.Fatalf("runs %d, want one in %s", len(runs), dir)
	}
	if got := kind.dirs(); !slices.Equal(got, []string{dir}) {
		t.Fatalf("prepared %v, want the scratch folder once", got)
	}
	if exists(filepath.Join(s.home, "repos")) || exists(filepath.Join(s.home, "worktrees")) {
		t.Fatal("a scratch Session cloned or made a worktree")
	}
	if exists(dir) {
		t.Fatal("the scratch folder is left once the Session ended")
	}
	// Its Contrat checked on the scratch folder: no report there, incomplete.
	var sent any
	select {
	case sent = <-s.reports.steps:
	case <-time.After(10 * time.Second):
		t.Fatal("no verdict sent")
	}
	verdict, ok := sent.(contracts.RunnerStepVerdict)
	if !ok || verdict.Verdict.ContractId != "idea-analysis" || verdict.Verdict.Status != contracts.ContratVerdictStatusIncomplete {
		t.Fatalf("sent %+v, want the verdict of idea-analysis, incomplete", verdict)
	}
}

func TestAStartMixingNullAndCodeEndsSetupFailed(t *testing.T) {
	mixes := map[string]func(*contracts.RunnerSessionStart){
		"a branch":             func(m *contracts.RunnerSessionStart) { m.Branch = "feat/12-panier" },
		"a base":               func(m *contracts.RunnerSessionStart) { m.Base = "develop" },
		"an Origin":            func(m *contracts.RunnerSessionStart) { m.Origin = &contracts.Origin{Local: &contracts.OriginLocal{}} },
		"a projectId not uuid": func(m *contracts.RunnerSessionStart) { m.ProjectId = "P2" },
	}
	for name, mix := range mixes {
		t.Run(name, func(t *testing.T) {
			s := newSetup(t, message("fait"), result("eng-1"))
			m := s.manager(t)
			message := scratchStart(firstID)
			mix(&message)

			m.Start(message)
			ended := s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)

			if ended.Error == nil || *ended.Error != contracts.RunnerSessionStateErrorSetupFailed || len(s.engine.Runs()) != 0 {
				t.Fatalf("ended %+v, %d runs; want setup-failed, none", ended, len(s.engine.Runs()))
			}
		})
	}
}

// A scratch Session of a Projet (the Idée's) keeps its projectId.
func TestAScratchSessionMayNameItsProjet(t *testing.T) {
	s := newSetup(t, message("fait"), result("eng-1"))
	m := s.manager(t)
	message := scratchStart(firstID)
	message.ProjectId = projectID

	m.Start(message)
	ended := s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)

	if ended.Outcome == nil || *ended.Outcome != contracts.RunnerSessionStateOutcomeOk {
		t.Fatalf("ended %+v, want ok", ended)
	}
}

func TestAStoppedScratchSessionKeepsItsFolderAndResumesInIt(t *testing.T) {
	s := newSetup(t, result("eng-1"), question("q1"))
	kind := &fakeKind{}
	s.config = withKind(kind)
	m := s.manager(t)
	m.Start(scratchStart(firstID))
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateWaiting)
	dir := filepath.Join(s.home, "scratch", firstID)
	if err := os.WriteFile(filepath.Join(dir, ".crewdeck", "report.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}

	m.Stop(firstID)
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateStopped)
	if !exists(filepath.Join(dir, ".crewdeck", "report.json")) {
		t.Fatal("a stopped scratch Session lost its folder")
	}

	m.Resume(firstID)
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateActive)
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateWaiting)
	runs := s.engine.Runs()
	if len(runs) != 2 || runs[1].EngineSessionID() != "eng-1" || runs[1].Options().Dir != dir {
		t.Fatalf("runs %d, want the second resuming eng-1 in %s", len(runs), dir)
	}
	if !exists(filepath.Join(dir, ".crewdeck", "report.json")) || len(kind.dirs()) != 1 {
		t.Fatalf("the resumed folder lost its report, or was prepared again (%v)", kind.dirs())
	}
}

func TestEtapeStartOfAScratchSessionGivesNoProjetOriginBranchNorBase(t *testing.T) {
	st := newStepSetupOf(t, withKind(&fakeKind{}), scratchStart(firstID))

	var got map[string]json.RawMessage
	if err := st.call(t, session.OpStepStart, session.StepRequest{SessionID: firstID}, &got); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"projectId", "origin", "branch", "base"} {
		if string(got[field]) != "null" {
			t.Errorf("%s is %s, want null", field, got[field])
		}
	}
	if string(got["stepKind"]) != `"idea-analysis"` || string(got["contractId"]) != `"idea-analysis"` {
		t.Errorf("context %v", got)
	}
}

func TestAnIdeaReportFailingItsContratIsRefusedWithItsRulesAndNotSent(t *testing.T) {
	st := newStepSetupOf(t, withKind(&fakeKind{}), scratchStart(firstID))
	dir := filepath.Join(st.home, "scratch", firstID)
	write := func(fixture string) {
		t.Helper()
		data, err := os.ReadFile(ideaFixture(fixture, "report.json"))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, ".crewdeck", "report.json"), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	write("fail-summary")
	err := st.call(t, session.OpStepReport, map[string]string{"sessionId": firstID}, nil)
	var refused *localsock.Failed
	if !errors.As(err, &refused) || refused.Code != "contract-failed" {
		t.Fatalf("%v, want contract-failed", err)
	}
	var details session.ContractFailedDetails
	if err := json.Unmarshal(refused.Details, &details); err != nil {
		t.Fatal(err)
	}
	if want := []session.FailedRule{{ID: "idea-analysis.report.schema", Label: "Le rapport a un titre et un résumé d’au plus 400 caractères"}}; !slices.Equal(details.FailedRules, want) {
		t.Fatalf("failed rules %+v, want %+v", details.FailedRules, want)
	}
	select {
	case sent := <-st.reports.steps:
		t.Fatalf("sent %+v for a refused report", sent)
	case <-time.After(100 * time.Millisecond):
	}

	write("pass")
	if err := st.call(t, session.OpStepReport, map[string]string{"sessionId": firstID}, nil); err != nil {
		t.Fatal(err)
	}
	report, ok := st.step(t).(contracts.RunnerStepReport)
	if !ok || report.StepRunId != stepRunID || report.Figures["impact"] != float64(3) || report.Sealed == nil {
		t.Fatalf("sent %+v, want the kind's report", report)
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	if _, ok := st.sealed[ideaID+":analysis"]; !ok || len(st.sealed) != 1 {
		t.Fatalf("sealed under %v, want %s:analysis alone", keysOf(st.sealed), ideaID)
	}
}

func keysOf(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for key := range m {
		keys = append(keys, key)
	}
	return keys
}

// Each scratch Session has its folder: two of them run at once.
func TestTwoScratchSessionsRunAtOnceEachInItsFolder(t *testing.T) {
	s := newSetup(t, question("q1"))
	m := s.manager(t)

	m.Start(scratchStart(firstID))
	m.Start(scratchStart(secondID))
	// await drops the other Session's states: both read from the record.
	deadline := time.Now().Add(10 * time.Second)
	for !slices.Contains(s.reports.states(firstID), contracts.RunnerSessionStateStateWaiting) ||
		!slices.Contains(s.reports.states(secondID), contracts.RunnerSessionStateStateWaiting) {
		if time.Now().After(deadline) {
			t.Fatalf("states %v and %v, want both waiting", s.reports.states(firstID), s.reports.states(secondID))
		}
		time.Sleep(10 * time.Millisecond)
	}

	dirs := []string{}
	for _, run := range s.engine.Runs() {
		dirs = append(dirs, run.Options().Dir)
	}
	slices.Sort(dirs)
	if want := []string{filepath.Join(s.home, "scratch", firstID), filepath.Join(s.home, "scratch", secondID)}; !slices.Equal(dirs, want) {
		t.Fatalf("runs in %v, want %v", dirs, want)
	}
}
