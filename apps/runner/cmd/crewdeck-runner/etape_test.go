package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mirror"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// etapeRunner is a fake Runner's runner.sock: it records each `etape` op's
// request, and answers what its handlers say.
type etapeRunner struct {
	sock *localsock.Server
	mu   sync.Mutex
	got  []map[string]any
}

func newEtapeRunner(t *testing.T) *etapeRunner {
	t.Helper()
	home := t.TempDir()
	t.Setenv(state.HomeEnv, home)
	t.Setenv(session.SessionEnv, ghSession)
	r := &etapeRunner{sock: &localsock.Server{}}
	socket := filepath.Join(home, localsock.SocketName)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = r.sock.Serve(ctx, socket)
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})
	for i := 0; i < 200; i++ {
		if _, err := os.Stat(socket); err == nil {
			return r
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("runner.sock is not served")
	return nil
}

// handle answers op with reply, the request recorded.
func (r *etapeRunner) handle(op string, reply func(request map[string]any) (any, error)) {
	r.sock.Handle(op, func(_ context.Context, raw json.RawMessage) (any, error) {
		var request map[string]any
		_ = json.Unmarshal(raw, &request)
		r.mu.Lock()
		r.got = append(r.got, request)
		r.mu.Unlock()
		return reply(request)
	})
}

func (r *etapeRunner) requests() []map[string]any {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]map[string]any(nil), r.got...)
}

// opRefusal is the Runner's refusal of an op, by its code.
type opRefusal string

func (r opRefusal) Error() string { return string(r) }
func (r opRefusal) Code() string  { return string(r) }

// stepContext is the context of a Local Projet's code Étape.
func stepContext(stepRunID string) session.StepContext {
	projectID, branch, base := "P2", "feat/12-x", "main"
	return session.StepContext{StepRunID: stepRunID, StepKind: contracts.RunnerSessionStartStepStepKindCode, Skill: "code", ProjectID: &projectID,
		Origin: &contracts.Origin{Local: &contracts.OriginLocal{}}, Branch: &branch, Base: &base, Inputs: []contracts.RunnerSessionStartStepInputsElem{}}
}

// runEtape runs `crewdeck-runner etape args…`, stdin given.
func runEtape(t *testing.T, stdin string, args ...string) (string, string, error) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	root := newRoot(&machine{})
	root.SetOut(&stdout)
	root.SetErr(&stderr)
	root.SetIn(strings.NewReader(stdin))
	root.SetArgs(append([]string{"etape"}, args...))
	err := root.Execute()
	return stdout.String(), stderr.String(), err
}

func TestEtapeStartPrintsTheEtapesContextTheRunnerGives(t *testing.T) {
	r := newEtapeRunner(t)
	r.handle(session.OpStepStart, func(map[string]any) (any, error) {
		return stepContext("sr-1"), nil
	})

	out, stderr, err := runEtape(t, "", "start")

	if err != nil {
		t.Fatalf("%v, %s", err, stderr)
	}
	var printed map[string]any
	if err := json.Unmarshal([]byte(out), &printed); err != nil || printed["stepRunId"] != "sr-1" || printed["branch"] != "feat/12-x" {
		t.Fatalf("printed %q", out)
	}
	if got := r.requests(); len(got) != 1 || got[0]["sessionId"] != ghSession {
		t.Fatalf("requests %v, want the Session of the environment", got)
	}
}

func TestEtapeReportSendsTheFileOrTheStandardInputToTheRunnerWhichSealsIt(t *testing.T) {
	r := newEtapeRunner(t)
	// As the Runner for a Session whose Étape it does not read itself: a
	// report without figures is a bad request.
	r.handle(session.OpStepReport, func(request map[string]any) (any, error) {
		if request["figures"] == nil {
			return nil, opRefusal("bad-request")
		}
		return nil, nil
	})
	file := filepath.Join(t.TempDir(), "report.json")
	if err := os.WriteFile(file, []byte(`{"figures":{"tickets":3},"content":"Trois Tickets."}`), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, stderr, err := runEtape(t, "", "report", "--file", file); err != nil {
		t.Fatalf("--file: %v, %s", err, stderr)
	}
	if _, stderr, err := runEtape(t, `{"figures":{"read":1}}`, "report", "--file", "-"); err != nil {
		t.Fatalf("--file -: %v, %s", err, stderr)
	}

	got := r.requests()
	if len(got) != 2 || got[0]["content"] != "Trois Tickets." || got[0]["figures"].(map[string]any)["tickets"] != float64(3) || got[1]["content"] != nil || got[1]["sessionId"] != ghSession {
		t.Fatalf("requests %v", got)
	}

	// Not a report: the Runner refuses it, exit 1 with why.
	if _, stderr, err := runEtape(t, `["figures"]`, "report", "--file", "-"); err == nil || !strings.Contains(stderr, "objet JSON") {
		t.Fatalf("%v, %q", err, stderr)
	}
	if got := r.requests(); len(got) != 3 || got[2]["figures"] != nil || got[2]["content"] != nil {
		t.Fatalf("requests %v, want the last without figures nor content", got)
	}
}

// contractRefused is the Runner's refusal of a report its Contrat failed.
type contractRefused session.ContractFailedDetails

func (contractRefused) Error() string  { return "contract-failed" }
func (contractRefused) Code() string   { return "contract-failed" }
func (r contractRefused) Details() any { return session.ContractFailedDetails(r) }

// The report of an Étape the Runner reads itself (idea-analysis) is its
// file: sent without figures, the Runner checks its Contrat, and `etape`
// says each rule it failed.
func TestEtapeReportOfAnIdeaAnalysisSaysTheRulesItsContratFailed(t *testing.T) {
	r := newEtapeRunner(t)
	var refuse atomic.Bool
	refuse.Store(true)
	r.handle(session.OpStepReport, func(map[string]any) (any, error) {
		if refuse.Load() {
			return nil, contractRefused{FailedRules: []session.FailedRule{
				{ID: "idea-analysis.report.schema", Label: "Le rapport a un titre et un résumé d’au plus 400 caractères"},
				{ID: "idea-analysis.report.duplicates", Label: "Les doublons sont des Idées ouvertes"},
			}}
		}
		return nil, nil
	})
	file := filepath.Join(t.TempDir(), "report.json")
	if err := os.WriteFile(file, []byte(`{"title":"Exporter","summary":"…","impact":3}`), 0o600); err != nil {
		t.Fatal(err)
	}

	_, stderr, err := runEtape(t, "", "report", "--file", file)

	want := "Le rapport ne passe pas son Contrat :\n" +
		"- Le rapport a un titre et un résumé d’au plus 400 caractères (idea-analysis.report.schema)\n" +
		"- Les doublons sont des Idées ouvertes (idea-analysis.report.duplicates)\n" +
		"Rien n'est envoyé : corrige le rapport, puis envoie-le à nouveau.\n"
	if exitCode(err) != 1 || stderr != want {
		t.Fatalf("%v, stderr %q, want %q", err, stderr, want)
	}
	if got := r.requests(); len(got) != 1 || got[0]["figures"] != nil || got[0]["sessionId"] != ghSession {
		t.Fatalf("requests %v, want the Session's, without figures", got)
	}

	refuse.Store(false)
	if out, stderr, err := runEtape(t, "", "report", "--file", file); err != nil || !strings.Contains(out, "Le rapport est envoyé.") {
		t.Fatalf("%v, %q, %q", err, out, stderr)
	}
}

func TestEtapeAskWaitsForTheAnswerAcrossPollsAndPrintsIt(t *testing.T) {
	r := newEtapeRunner(t)
	r.handle(session.OpStepAsk, func(map[string]any) (any, error) { return session.StepAskReply{RequestID: "etape-1"}, nil })
	var polls atomic.Int32
	r.handle(session.OpStepAnswer, func(map[string]any) (any, error) {
		if polls.Add(1) < 3 {
			return session.StepAnswerReply{}, nil
		}
		return session.StepAnswerReply{Answered: true, Answer: &session.StepAnswer{Options: []string{"Caddie"}}}, nil
	})

	out, stderr, err := runEtape(t, "", "ask", "--question", `{"title":"Quel nom ?","options":[{"label":"Panier"},{"label":"Caddie"}]}`)

	if err != nil {
		t.Fatalf("%v, %s", err, stderr)
	}
	var answer map[string]any
	if json.Unmarshal([]byte(out), &answer) != nil || answer["options"].([]any)[0] != "Caddie" {
		t.Fatalf("printed %q", out)
	}
	if !strings.Contains(stderr, "--wait etape-1") {
		t.Fatalf("stderr %q, want the requestId to wait again with", stderr)
	}
	got := r.requests()
	question := got[0]["question"].(map[string]any)
	if len(got) != 4 || question["title"] != "Quel nom ?" || got[1]["requestId"] != "etape-1" {
		t.Fatalf("requests %v, want the ask then three polls", got)
	}

	// --wait polls again, asking nothing.
	if out, _, err := runEtape(t, "", "ask", "--wait", "etape-1"); err != nil || !strings.Contains(out, "Caddie") || len(r.requests()) != 5 {
		t.Fatalf("--wait: %q, %v", out, err)
	}
}

func TestEtapeSaysInFrenchWhyTheRunnerRefusedOrIsNotThere(t *testing.T) {
	r := newEtapeRunner(t)
	r.handle(session.OpStepStart, func(map[string]any) (any, error) { return nil, opRefusal("not-running") })

	if _, stderr, err := runEtape(t, "", "start"); err == nil || !strings.Contains(stderr, "Cette Session ne tourne pas.") {
		t.Fatalf("not-running: %v, %q", err, stderr)
	}

	t.Setenv(session.SessionEnv, "")
	if _, stderr, err := runEtape(t, "", "start"); err == nil || !strings.Contains(stderr, session.SessionEnv) {
		t.Fatalf("outside a Session: %v, %q", err, stderr)
	}

	t.Setenv(session.SessionEnv, ghSession)
	t.Setenv(state.HomeEnv, t.TempDir())
	if _, stderr, err := runEtape(t, "", "start"); err == nil || !strings.Contains(stderr, "Le Runner ne tourne pas") {
		t.Fatalf("no Runner: %v, %q", err, stderr)
	}
}

// The Session's crewdeck-runner shim names the Session to `etape`.
func TestTheCrewdeckRunnerShimNamesItsSessionToEtape(t *testing.T) {
	h := newGhHarness(t)
	var got []string
	var mu sync.Mutex
	h.sock.Handle(session.OpStepStart, func(_ context.Context, raw json.RawMessage) (any, error) {
		var request session.StepRequest
		_ = json.Unmarshal(raw, &request)
		mu.Lock()
		got = append(got, request.SessionID)
		mu.Unlock()
		return stepContext("sr-1"), nil
	})

	out, stderr, code := h.shim(t, t.TempDir(), os.Getenv("PATH"), "crewdeck-runner", "etape", "start")

	if code != 0 || !strings.Contains(out, `"stepRunId": "sr-1"`) {
		t.Fatalf("etape start: %d %q %q", code, out, stderr)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 1 || got[0] != ghSession {
		t.Fatalf("asked for %v, want the shim's Session", got)
	}
}

// A Session of the test Skill reads its Ticket as the Skill says, through
// the Session's mirror shim: the Miroir's copy, the running Runner asked of
// its freshness, and gh never run.
func TestTheTestSkillReadsItsTicketThroughTheMiroirNeverGh(t *testing.T) {
	h := newGhHarness(t)
	skill, err := os.ReadFile(filepath.Join("..", "..", "internal", "skills", "testdata", "crewdeck-test", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	line := regexp.MustCompile(`(?m)^\s*mirror (issue view <n> .*)$`).FindSubmatch(skill)
	if line == nil {
		t.Fatal("the test Skill reads no Ticket through mirror")
	}
	args := strings.Fields(strings.ReplaceAll(string(line[1]), "<n>", "12"))
	var mu sync.Mutex
	reads := 0
	h.sock.Handle(mirror.OpState, func(context.Context, json.RawMessage) (any, error) {
		mu.Lock()
		reads++
		mu.Unlock()
		return mirror.StateReply{Connected: true, Keys: map[string]mirror.KeyState{localKey: {State: mirror.FreshnessLive, SyncedAt: at(time.Minute)}}}, nil
	})
	gh, record := fakeGh(t, "", 0)

	out, stderr, code := h.shim(t, h.sessionDir(t), gh, "mirror", args...)

	if code != 0 {
		t.Fatalf("mirror %v: %d %q", args, code, stderr)
	}
	if title := jq(t, []byte(out), ".title"); title != "Le panier" {
		t.Fatalf("title %v; printed %s", title, out)
	}
	if body, labels := jq(t, []byte(out), ".body"), jq(t, []byte(out), ".labels | length"); body != "Le corps du douze.\n" || labels != 3 {
		t.Fatalf("body %v, labels %v", body, labels)
	}
	mu.Lock()
	defer mu.Unlock()
	if reads == 0 {
		t.Fatal("the running Runner was not asked of the copy's freshness")
	}
	if got := calls(t, record); got != "" {
		t.Fatalf("gh ran: %q", got)
	}
}

// fakeRefresh records what the Miroir's follower is asked.
type fakeRefresh struct {
	fetched []string
	synced  []string
}

func (f *fakeRefresh) Fetch(_ context.Context, repository string, number int) error {
	f.fetched = append(f.fetched, repository+"#"+strconv.Itoa(number))
	return nil
}

func (f *fakeRefresh) Sync(_ context.Context, repository string, _ bool) ([]string, error) {
	f.synced = append(f.synced, repository)
	return nil, nil
}

func TestTheChangeOfASessionsBranchIsFetchedThenReadFromTheMiroir(t *testing.T) {
	f := newMiroirFixture(t)
	refresh := &fakeRefresh{}
	changes := mirrorChanges{store: f.store, follow: refresh}

	pr, err := changes.of(context.Background(), "P2", "feat/12-x")

	if err != nil || pr == nil {
		t.Fatalf("%+v, %v", pr, err)
	}
	if pr.Head != "feat/12-x" || pr.Base != "main" || pr.Body != "Closes #12" || pr.HeadSHA == "" {
		t.Fatalf("pr %+v", pr)
	}
	if len(refresh.fetched) != 1 || refresh.fetched[0] != localKey+"#7" || len(refresh.synced) != 0 {
		t.Fatalf("fetched %v synced %v, want change 7 fetched", refresh.fetched, refresh.synced)
	}

	// A branch without a change: the open ones synced, then none.
	if pr, err := changes.of(context.Background(), "P2", "feat/13-y"); err != nil || pr != nil || len(refresh.synced) != 1 || refresh.synced[0] != localKey {
		t.Fatalf("%+v, %v; synced %v", pr, err, refresh.synced)
	}
	// A Projet the Miroir does not have: no PR, nothing asked.
	if pr, err := changes.of(context.Background(), "P9", "feat/12-x"); err != nil || pr != nil || len(refresh.fetched) != 1 || len(refresh.synced) != 1 {
		t.Fatalf("%+v, %v", pr, err)
	}
}
