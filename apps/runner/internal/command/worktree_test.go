package command_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/command"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/fake"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
)

// probed is the fake Moteur, its probe told each start before it runs.
type probed struct {
	*fake.Engine
	probe func(engine.StartOptions)
}

func (p probed) Start(ctx context.Context, opts engine.StartOptions) (engine.Run, error) {
	p.probe(opts)
	return p.Engine.Start(ctx, opts)
}

// logBuffer is the Runner's log, one JSON line per record.
type logBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *logBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *logBuffer) records(msg string) []map[string]any {
	b.mu.Lock()
	defer b.mu.Unlock()
	var found []map[string]any
	for line := range strings.SplitSeq(b.buf.String(), "\n") {
		var record map[string]any
		if json.Unmarshal([]byte(line), &record) == nil && record["msg"] == msg {
			found = append(found, record)
		}
	}
	return found
}

// worktreeHooks makes the harness run the Projet's worktree Commandes
// prepare and clean (nil: not set), sealed for the Projet project as the
// page seals them.
func (h *harness) worktreeHooks(t *testing.T, project string, prepare, clean any) {
	t.Helper()
	h.hooks = command.WorktreeHooks(h.vault)
	plain, err := json.Marshal(map[string]any{"prepare": prepare, "clean": clean})
	if err != nil {
		t.Fatal(err)
	}
	item, err := h.vault.SealItem(plain, []byte("settings:"+project))
	if err != nil {
		t.Fatal(err)
	}
	h.worktreeCommands = &session.SealedCommands{Key: b64.EncodeToString(item.Key), Ciphertext: b64.EncodeToString(item.Ciphertext)}
}

// startEndingSession starts the Session of the Ticket's branch, its Moteur
// ending at once, and gives its last state.
func (h *harness) startEndingSession(t *testing.T) contracts.RunnerSessionState {
	t.Helper()
	h.manager.Start(contracts.RunnerSessionStart{
		Type: "session.start", Id: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c20", At: time.Now().UTC(),
		SessionId: sessionID, ProjectId: projectID,
		Origin: contracts.RunnerSessionStartOrigin{Kind: contracts.RunnerSessionStartOriginKindGithub, Owner: "acme", Name: "shop"},
		Branch: branch, Base: "develop", Engine: contracts.RunnerSessionStartEngineClaudeCode, Model: "claude-opus-5-5", Role: "code",
		PermissionMode: contracts.RunnerSessionStartPermissionModeBypass, Title: "Le panier",
		WorktreeCommands: sessionWorktreeCommands(h.worktreeCommands),
	})
	return h.sent.await(t, "the Session ended", func(m any) bool {
		s, ok := m.(contracts.RunnerSessionState)
		return ok && s.SessionId == sessionID && s.State == contracts.RunnerSessionStateStateEnded
	}).(contracts.RunnerSessionState)
}

func (h *harness) prepareLog() string {
	return filepath.Join(h.home, "sessions", sessionID, session.PrepareLogFile)
}

func failure(s contracts.RunnerSessionState) contracts.RunnerSessionStateError {
	if s.Error == nil {
		return ""
	}
	return *s.Error
}

func TestAPreparedSessionFindsWhatPrepareMadeBeforeTheMoteurStarts(t *testing.T) {
	h := newHarness(t)
	h.remote.ticket(t)
	h.worktreeHooks(t, projectID, `echo "préparé pour $CREWDECK_PROJECT"; echo "sur $CREWDECK_BRANCH" >&2; touch .prepared`, nil)
	var prepared []bool
	h.probe = func(opts engine.StartOptions) {
		prepared = append(prepared, exists(filepath.Join(opts.Dir, ".prepared")))
	}
	h.start(t)

	if s := h.startEndingSession(t); failure(s) != "" {
		t.Fatalf("Session ended %+v", s)
	}
	if len(prepared) != 1 || !prepared[0] {
		t.Fatalf("the Moteur started with the marker %v, want it there before its one start", prepared)
	}
	log := read(t, h.prepareLog())
	if !strings.Contains(log, "préparé pour "+projectID) || !strings.Contains(log, "sur "+branch) {
		t.Fatalf("prepare.log holds %q", log)
	}
	if info, err := os.Stat(h.prepareLog()); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("prepare.log %v, %v, want mode 600", info, err)
	}
}

func TestAPrepareExitingTwoEndsTheSessionSetupFailedWithItsCodeAndTail(t *testing.T) {
	h := newHarness(t)
	h.remote.ticket(t)
	h.worktreeHooks(t, projectID, `i=0; while [ $i -lt 60 ]; do echo "ligne $i"; i=$((i+1)); done; echo "pnpm: introuvable"; exit 2`, nil)
	h.start(t)

	s := h.startEndingSession(t)
	if failure(s) != contracts.RunnerSessionStateErrorSetupFailed || s.Outcome == nil || *s.Outcome != contracts.RunnerSessionStateOutcomeError {
		t.Fatalf("Session ended %+v, want error setup-failed", s)
	}
	if runs := len(h.engine.Runs()); runs != 0 {
		t.Fatalf("the Moteur ran %d times, want never", runs)
	}
	if exists(h.worktree()) {
		t.Fatal("the worktree is still there")
	}
	var failures []contracts.EngineEventError
	for event, err := range session.Replay(h.home, sessionID, 0) {
		if err != nil {
			t.Fatal(err)
		}
		if event.Error != nil {
			failures = append(failures, *event.Error)
		}
	}
	if len(failures) != 1 || failures[0].Code != "setup-failed" {
		t.Fatalf("the log holds the errors %+v, want one setup-failed", failures)
	}
	lines := strings.Split(failures[0].Message, "\n")
	if lines[0] != "Préparer le worktree a échoué (code 2)" || len(lines) != 51 || lines[1] != "ligne 11" || lines[50] != "pnpm: introuvable" {
		t.Fatalf("the error's message is %q, want the code then the 50 last lines", failures[0].Message)
	}
}

func TestCleanRunsInTheWorktreeBeforeItIsRemovedAndItsFailureIsOnlyLogged(t *testing.T) {
	h := newHarness(t)
	h.remote.ticket(t)
	h.worktreeHooks(t, projectID, "touch .prepared", "test -f .prepared && echo nettoyé > "+h.mark("cleaned")+"; echo nettoyage; exit 1")
	h.start(t)

	if s := h.startEndingSession(t); failure(s) != "" {
		t.Fatalf("Session ended %+v, want no error for a failed cleaning", s)
	}
	if got := read(t, h.mark("cleaned")); got != "nettoyé" {
		t.Fatalf("clean wrote %q, want it run in the prepared worktree", got)
	}
	if exists(h.worktree()) {
		t.Fatal("the worktree is still there once its cleaning failed")
	}
	if log := read(t, h.prepareLog()); !strings.Contains(log, "nettoyage") {
		t.Fatalf("prepare.log holds %q, want the cleaning's output", log)
	}
	records := h.logs.records("session.clean")
	if len(records) != 1 || records[0]["exitCode"] != float64(1) || records[0]["sessionId"] != sessionID {
		t.Fatalf("the Runner logged %v, want the cleaning's exit code", records)
	}
	if strings.Contains(h.logs.buf.String(), "nettoyage") {
		t.Fatal("the Runner's log holds the cleaning's output")
	}
}

func TestAStoppedSessionResumedIsNotPreparedAgain(t *testing.T) {
	h := newHarness(t)
	h.remote.ticket(t)
	h.engine.Events = []contracts.EngineEvent{{Question: &contracts.EngineEventQuestion{RequestId: "q1", Title: "Quelle couleur ?", Options: []contracts.EngineEventQuestionOptionsElem{{Label: "Bleu"}}}}}
	h.worktreeHooks(t, projectID, "echo une >> "+h.mark("prepared"), nil)
	h.start(t)
	h.startSession(t)
	h.manager.Stop(sessionID)
	h.sent.await(t, "the Session stopped", func(m any) bool {
		s, ok := m.(contracts.RunnerSessionState)
		return ok && s.SessionId == sessionID && s.State == contracts.RunnerSessionStateStateStopped
	})

	h.manager.Resume(sessionID)
	deadline := time.Now().Add(10 * time.Second)
	for len(h.engine.Runs()) < 2 {
		if time.Now().After(deadline) {
			t.Fatal("the Session was not resumed")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if got := read(t, h.mark("prepared")); got != "une" {
		t.Fatalf("prepare ran %q, want once", got)
	}
}

func TestAWorktreeRunOnAnAbsentWorktreePreparesItFirst(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.worktreeHooks(t, projectID, `echo "préparé à l'étape $CREWDECK_STEP"; touch .prepared`, nil)
	h.start(t)

	h.commands.Run(h.run(t, runID, "test -f .prepared && touch "+h.mark("ran"), "worktree", sha))
	if v := h.sent.verdict(t, runID); !v.Passed {
		t.Fatalf("verdict %+v", v)
	}
	if !exists(h.mark("ran")) {
		t.Fatal("the Commande ran in a worktree not prepared")
	}
	if log := read(t, filepath.Join(h.home, "commands", runID+".log")); !strings.Contains(log, "préparé à l'étape tests") {
		t.Fatalf("the run's log holds %q, want the preparation's output", log)
	}
}

func TestAFailedPrepareGivesTheRunSetupFailedAndRunsNothing(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.worktreeHooks(t, projectID, "exit 3", "touch "+h.mark("cleaned"))
	h.start(t)

	h.commands.Run(h.run(t, runID, "touch "+h.mark("ran"), "worktree", sha))
	if v := h.sent.verdict(t, runID); v.Passed || v.Reason != contracts.RunnerCommandVerdictReasonSetupFailed {
		t.Fatalf("verdict %+v, want setup-failed", v)
	}
	if exists(h.mark("ran")) {
		t.Fatal("the Commande ran though its worktree's preparation failed")
	}
	if exists(h.worktree()) {
		t.Fatal("the worktree is still there")
	}
	if !exists(h.mark("cleaned")) {
		t.Fatal("the worktree was removed without its cleaning")
	}
	if log := read(t, filepath.Join(h.home, "commands", runID+".log")); !strings.Contains(log, "Préparer le worktree a échoué (code 3)") {
		t.Fatalf("the run's log holds %q, want why", log)
	}
}

func TestWorktreeCommandsSealedForAnotherProjetDoNotOpenAndRunNothing(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.worktreeHooks(t, otherID, "touch "+h.mark("prepared"), "touch "+h.mark("cleaned"))
	h.start(t)

	h.commands.Run(h.run(t, runID, "touch "+h.mark("ran"), "worktree", sha))
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonSetupFailed {
		t.Fatalf("verdict %+v, want setup-failed", v)
	}
	if s := h.startEndingSession(t); failure(s) != contracts.RunnerSessionStateErrorSetupFailed {
		t.Fatalf("Session ended %+v, want setup-failed", s)
	}
	for _, name := range []string{"prepared", "cleaned", "ran"} {
		if exists(h.mark(name)) {
			t.Fatalf("%s: a worktree Commande of another Projet ran", name)
		}
	}
	if runs := len(h.engine.Runs()); runs != 0 || exists(h.worktree()) {
		t.Fatalf("the Moteur ran %d times, the worktree there %v", runs, exists(h.worktree()))
	}
}

func TestWorktreeCommandsThatAreNotTheSchemasDoNotOpen(t *testing.T) {
	h := newHarness(t)
	for i, payload := range []map[string]any{
		{"prepare": "touch " + h.mark("ran")},
		{"prepare": "touch " + h.mark("ran"), "clean": nil, "drop": "rm -rf ."},
		{"prepare": "", "clean": nil},
		{"prepare": strings.Repeat("a", 4001), "clean": nil},
		{"prepare": 1, "clean": nil},
	} {
		plain, _ := json.Marshal(payload)
		item, err := h.vault.SealItem(plain, []byte("settings:"+projectID))
		if err != nil {
			t.Fatal(err)
		}
		hooks := command.WorktreeHooks(h.vault)
		err = hooks.Prepare(context.Background(), session.Worktree{
			ProjectID: projectID, Dir: h.marks,
			Preparation: session.Preparation{Commands: &session.SealedCommands{Key: b64.EncodeToString(item.Key), Ciphertext: b64.EncodeToString(item.Ciphertext)}},
		})
		var setup *session.SetupError
		if !errors.As(err, &setup) {
			t.Fatalf("payload %d: %v, want a SetupError", i, err)
		}
	}
	if exists(h.mark("ran")) {
		t.Fatal("a part not of the schema ran")
	}
}

func TestNoWorktreeCommandsMakeAndRemoveTheWorktreeAsBefore(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.hooks = command.WorktreeHooks(h.vault)
	h.start(t)

	h.commands.Run(h.run(t, runID, "touch "+h.mark("ran"), "worktree", sha))
	if v := h.sent.verdict(t, runID); !v.Passed || !exists(h.mark("ran")) {
		t.Fatalf("verdict %+v", v)
	}
	if exists(h.worktree()) {
		t.Fatal("the worktree is still there once the run ended")
	}
	if s := h.startEndingSession(t); failure(s) != "" {
		t.Fatalf("Session ended %+v", s)
	}
	if exists(h.prepareLog()) {
		t.Fatal("a Session with no worktree Commandes has a prepare.log")
	}
}

func TestAPrepareThatOutlastsItsBoundFailsAndIsKilled(t *testing.T) {
	restore := command.SetPrepareBound(300 * time.Millisecond)
	defer restore()
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.worktreeHooks(t, projectID, "echo installe; sleep 30; touch "+h.mark("late"), nil)
	h.start(t)

	began := time.Now()
	h.commands.Run(h.run(t, runID, "touch "+h.mark("ran"), "worktree", sha))
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonSetupFailed {
		t.Fatalf("verdict %+v, want setup-failed", v)
	}
	if took := time.Since(began); took > 10*time.Second {
		t.Fatalf("the run took %s", took)
	}
	if log := read(t, filepath.Join(h.home, "commands", runID+".log")); !strings.Contains(log, "Préparer le worktree a échoué (délai de ") {
		t.Fatalf("the run's log holds %q", log)
	}
	if exists(h.mark("ran")) || exists(h.worktree()) {
		t.Fatal("the Commande ran, or the worktree stayed")
	}
}

// rotatingVault is the vault the Runner holds, swapped by a rotation for
// the next vault key: the server rewraps its own copies under it, never
// the Runner's.
type rotatingVault struct{ current atomic.Pointer[keys.Vault] }

func holding(v *keys.Vault) *rotatingVault {
	r := &rotatingVault{}
	r.current.Store(v)
	return r
}

func (r *rotatingVault) ItemKey(item keys.SealedItem, aad []byte) ([]byte, error) {
	return r.current.Load().ItemKey(item, aad)
}

func (r *rotatingVault) rotate(t *testing.T) {
	runner, _ := keys.GenerateKeyPair()
	device, _ := keys.GenerateKeyPair()
	next, _ := keys.GenerateAESKey()
	version := r.current.Load().Version + 1
	w, err := keys.SealWrap(device, keys.PublicKeyBytes(runner), next, []byte(keys.InfoVaultWrap), keys.VaultWrapAAD("runner-1", version))
	if err != nil {
		t.Fatal(err)
	}
	vault, err := keys.Unlock(runner, keys.PublicKeyBytes(device), "runner-1", version, w)
	if err != nil {
		t.Fatal(err)
	}
	r.current.Store(vault)
}

func TestTheWorktreeCommandsStillCleanTheWorktreeOnceTheVaultRotatedAfterItsPreparation(t *testing.T) {
	h := newHarness(t)
	h.remote.ticket(t)
	h.worktreeHooks(t, projectID, "touch .prepared", "test -f .prepared && echo nettoyé > "+h.mark("cleaned"))
	vault := holding(h.vault)
	h.hooks = command.WorktreeHooks(vault)
	// The vault rotates once the worktree is prepared, before it is cleaned.
	h.probe = func(engine.StartOptions) { vault.rotate(t) }
	h.start(t)

	if s := h.startEndingSession(t); failure(s) != "" {
		t.Fatalf("Session ended %+v", s)
	}
	if got := read(t, h.mark("cleaned")); got != "nettoyé" {
		t.Fatalf("clean wrote %q, want it run after the rotation", got)
	}
	if records := h.logs.records("session.clean"); len(records) != 0 {
		t.Fatalf("the Runner logged %v, want a cleaning that ran", records)
	}
}

func TestAStoppedSessionResumedAfterARestartAndARotationIsStillCleaned(t *testing.T) {
	h := newHarness(t)
	h.remote.ticket(t)
	h.engine.Events = []contracts.EngineEvent{{Question: &contracts.EngineEventQuestion{RequestId: "q1", Title: "Quelle couleur ?", Options: []contracts.EngineEventQuestionOptionsElem{{Label: "Bleu"}}}}}
	h.worktreeHooks(t, projectID, "echo une >> "+h.mark("prepared"), "echo nettoyé > "+h.mark("cleaned"))
	vault := holding(h.vault)
	h.hooks = command.WorktreeHooks(vault)
	h.start(t)
	h.startSession(t)
	h.manager.Stop(sessionID)
	h.sent.await(t, "the Session stopped", func(m any) bool {
		s, ok := m.(contracts.RunnerSessionState)
		return ok && s.SessionId == sessionID && s.State == contracts.RunnerSessionStateStateStopped
	})

	// The Runner stops, the vault rotates, the Runner starts again.
	h.commands.Close()
	h.manager.Close()
	vault.rotate(t)
	h.engine.Events = []contracts.EngineEvent{{Result: &contracts.EngineEventResult{Status: contracts.EngineEventResultStatusOk}}}
	h.start(t)
	h.manager.Resume(sessionID)
	h.sent.await(t, "the Session ended", func(m any) bool {
		s, ok := m.(contracts.RunnerSessionState)
		return ok && s.SessionId == sessionID && s.State == contracts.RunnerSessionStateStateEnded
	})
	if got := read(t, h.mark("prepared")); got != "une" {
		t.Fatalf("prepare ran %q, want once", got)
	}
	if got := read(t, h.mark("cleaned")); got != "nettoyé" {
		t.Fatalf("clean wrote %q, want it run after the restart and the rotation", got)
	}
}

func TestAWorktreeRunIsStillCleanedOnceTheVaultRotatedDuringIt(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.worktreeHooks(t, projectID, nil, "echo nettoyé > "+h.mark("cleaned"))
	vault := holding(h.vault)
	h.hooks = command.WorktreeHooks(vault)
	h.start(t)

	// The run's own command waits until the vault rotated.
	rotated := filepath.Join(h.marks, "rotated")
	h.commands.Run(h.run(t, runID, "while ! test -f "+rotated+"; do sleep 0.05; done", "worktree", sha))
	deadline := time.Now().Add(10 * time.Second)
	for !exists(h.worktree()) {
		if time.Now().After(deadline) {
			t.Fatal("the run's worktree was never made")
		}
		time.Sleep(20 * time.Millisecond)
	}
	vault.rotate(t)
	if err := os.WriteFile(rotated, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if v := h.sent.verdict(t, runID); !v.Passed {
		t.Fatalf("verdict %+v", v)
	}
	if got := read(t, h.mark("cleaned")); got != "nettoyé" {
		t.Fatalf("clean wrote %q, want it run after the rotation", got)
	}
}

func TestTheCleaningOfAServicesWorktreeGoesToTheRunsLogRelayed(t *testing.T) {
	h := newHarness(t)
	h.relayed = true
	sha := h.remote.ticket(t)
	h.worktreeHooks(t, projectID, nil, "echo nettoyage du service")
	h.start(t)
	port := freePort(t)
	text := server(t, port, 0)
	message := h.run(t, runID, text, "worktree", sha)
	message.Sealed = h.seal(t, projectID, map[string]commande{"cmd-tests": {Run: text, Where: "worktree", HealthURL: address(port)}})
	h.commands.Run(message)
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonHealthy {
		t.Fatalf("verdict %+v, want healthy", v)
	}

	// The service ends: its worktree is cleaned, then removed.
	if err := syscall.Kill(h.service(t).Pid, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for exists(h.worktree()) {
		if time.Now().After(deadline) {
			t.Fatal("the service's worktree was never removed")
		}
		time.Sleep(20 * time.Millisecond)
	}
	log := filepath.Join(h.home, "commands", runID+".log")
	h.sent.await(t, "the cleaning's output relayed", func(any) bool {
		return strings.Contains(read(t, log), "nettoyage du service")
	})
	live := h.relayedTo(t, nil, 1)
	relayed := false
	for _, c := range live.chunks {
		relayed = relayed || c.Text == "nettoyage du service\n"
	}
	if !relayed {
		t.Fatalf("relayed %+v, want the cleaning's output", live.chunks)
	}
}
