package command_test

import (
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/maximed1412/crewdeck/apps/runner/internal/command"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/fake"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/relay"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
)

const (
	projectID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a92"
	otherID   = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a93"
	runID     = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01"
	secondRun = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c02"
	tabID     = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6aa1"
	sessionID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b01"
	branch    = "feat/12-panier"
)

var b64 = base64.RawURLEncoding

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

// remote is a GitHub of one bare repository, acme/shop, cloned over
// file://, with a working copy to push from: `develop` holds a README and a
// .gitignore of `deps/`.
type remote struct {
	root, work string
}

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
	r.commit(t, ".gitignore", "deps/\n")
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

// ticket pushes a commit on the Ticket's branch, and gives its SHA.
func (r *remote) ticket(t *testing.T) string {
	t.Helper()
	git(t, r.work, "checkout", "-B", branch, "develop")
	sha := r.commit(t, "cart.txt", "panier\n")
	git(t, r.work, "push", "origin", branch)
	git(t, r.work, "checkout", "develop")
	return sha
}

// clock is the fake clock of the runs: each After waits until fired.
type clock struct {
	mu      sync.Mutex
	waiting map[time.Duration][]chan time.Time
	asked   chan time.Duration
}

func newClock() *clock {
	return &clock{waiting: map[time.Duration][]chan time.Time{}, asked: make(chan time.Duration, 100)}
}

func (c *clock) After(d time.Duration) <-chan time.Time {
	ch := make(chan time.Time, 1)
	c.mu.Lock()
	c.waiting[d] = append(c.waiting[d], ch)
	c.mu.Unlock()
	c.asked <- d
	return ch
}

// fire waits until a run asked for d, then makes it pass.
func (c *clock) fire(t *testing.T, d time.Duration) {
	t.Helper()
	deadline := time.After(10 * time.Second)
	for {
		c.mu.Lock()
		if chans := c.waiting[d]; len(chans) > 0 {
			c.waiting[d] = chans[1:]
			c.mu.Unlock()
			chans[0] <- time.Now()
			return
		}
		c.mu.Unlock()
		select {
		case <-c.asked:
		case <-deadline:
			t.Fatalf("no run waits for %v", d)
		}
	}
}

// sent records what the runner and the manager send the server.
type sent struct {
	mu       sync.Mutex
	messages []any
	changed  chan struct{}
}

func (s *sent) send(_ context.Context, message any) error {
	s.mu.Lock()
	s.messages = append(s.messages, message)
	s.mu.Unlock()
	select {
	case s.changed <- struct{}{}:
	default:
	}
	return nil
}

func (s *sent) all() []any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]any(nil), s.messages...)
}

// await is the first message sent that match accepts.
func (s *sent) await(t *testing.T, what string, match func(any) bool) any {
	t.Helper()
	deadline := time.After(20 * time.Second)
	for {
		for _, m := range s.all() {
			if match(m) {
				return m
			}
		}
		select {
		case <-s.changed:
		case <-time.After(20 * time.Millisecond):
		case <-deadline:
			t.Fatalf("no %s; sent %+v", what, s.all())
			return nil
		}
	}
}

func (s *sent) verdict(t *testing.T, id string) contracts.RunnerCommandVerdict {
	t.Helper()
	return s.await(t, "verdict of "+id, func(m any) bool {
		v, ok := m.(contracts.RunnerCommandVerdict)
		return ok && v.RunId == id
	}).(contracts.RunnerCommandVerdict)
}

func (s *sent) started(t *testing.T, id string) {
	t.Helper()
	s.await(t, "command.started of "+id, func(m any) bool {
		v, ok := m.(contracts.RunnerCommandStarted)
		return ok && v.RunId == id
	})
}

func (s *sent) startedAny(id string) bool {
	for _, m := range s.all() {
		if v, ok := m.(contracts.RunnerCommandStarted); ok && v.RunId == id {
			return true
		}
	}
	return false
}

// harness is a Runner's runner of Commandes and its manager of Sessions,
// against the remote, with a vault and the Appareil it wraps the relay for.
type harness struct {
	home   string
	remote *remote
	vault  *keys.Vault
	runner *ecdh.PrivateKey
	device *ecdh.PrivateKey
	clock  *clock
	sent   *sent
	engine *fake.Engine
	hooks  session.Hooks
	// probe, when set, is told each start of the fake Moteur, before it runs.
	probe func(engine.StartOptions)
	// worktreeCommands are what each Session and run gets as the Projet's.
	worktreeCommands *session.SealedCommands
	logs             *logBuffer
	relayed          bool
	// gate, when set, holds each opening of a sealed part until it closes.
	gate chan struct{}
	// marks is a folder outside the places, for what the runs write.
	marks string

	manager  *session.Manager
	commands *command.Runner
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	// A login shell of a known profile: the Pilote's own is not the test's.
	t.Setenv("HOME", t.TempDir())
	t.Setenv("SHELL", "/bin/sh")
	runner, _ := keys.GenerateKeyPair()
	device, _ := keys.GenerateKeyPair()
	vaultKey, _ := keys.GenerateAESKey()
	w, err := keys.SealWrap(device, keys.PublicKeyBytes(runner), vaultKey, []byte(keys.InfoVaultWrap), keys.VaultWrapAAD("runner-1", 1))
	if err != nil {
		t.Fatal(err)
	}
	vault, err := keys.Unlock(runner, keys.PublicKeyBytes(device), "runner-1", 1, w)
	if err != nil {
		t.Fatal(err)
	}
	return &harness{
		home:   filepath.Join(t.TempDir(), ".crewdeck"),
		remote: newRemote(t),
		vault:  vault,
		runner: runner,
		device: device,
		clock:  newClock(),
		sent:   &sent{changed: make(chan struct{}, 1)},
		engine: &fake.Engine{},
		marks:  t.TempDir(),
	}
}

func (h *harness) start(t *testing.T) *harness {
	t.Helper()
	var engines engine.Registry
	if h.probe != nil {
		engines.Register(probed{Engine: h.engine, probe: h.probe})
	} else {
		engines.Register(h.engine)
	}
	h.logs = &logBuffer{}
	logger := slog.New(slog.NewJSONHandler(h.logs, nil))
	m, err := session.New(session.Config{Home: h.home, Engines: &engines, GitHubURL: h.remote.url(), Hooks: h.hooks, Send: h.sent.send, Logger: logger})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	var vault command.Vault = h.vault
	if h.gate != nil {
		vault = gatedVault{inner: h.vault, gate: h.gate}
	}
	cfg := command.Config{Home: h.home, Vault: vault, Places: m, Send: h.sent.send, After: h.clock.After, Logger: logger}
	if h.relayed {
		cfg.Keys = &relay.Keys{Runner: h.runner, Holders: func() ([][]byte, error) { return [][]byte{keys.PublicKeyBytes(h.device)}, nil }}
	}
	r, err := command.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(r.Close)
	// The services a test left: stopped, after its runner.
	home := h.home
	t.Cleanup(func() { _, _ = command.StopServices(home) })
	h.manager, h.commands = m, r
	return h
}

// gatedVault opens a sealed part once its gate is closed: a vault slow to open.
type gatedVault struct {
	inner command.Vault
	gate  chan struct{}
}

func (v gatedVault) OpenItem(item keys.SealedItem, aad []byte) ([]byte, error) {
	<-v.gate
	return v.inner.OpenItem(item, aad)
}

// commande is one entry of a sealed part.
type commande struct {
	Run       string `json:"run"`
	Where     string `json:"where"`
	HealthURL string `json:"healthUrl,omitempty"`
}

// seal is the sealed part of a version of the Projet project, as the page seals it.
func (h *harness) seal(t *testing.T, project string, commands map[string]commande) contracts.RunnerCommandRunSealed {
	t.Helper()
	return h.sealPayload(t, project, map[string]any{"commands": commands})
}

// sealPayload seals payload as it is, the schema's or not.
func (h *harness) sealPayload(t *testing.T, project string, payload any) contracts.RunnerCommandRunSealed {
	t.Helper()
	plain, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	item, err := h.vault.SealItem(plain, []byte("process:"+project))
	if err != nil {
		t.Fatal(err)
	}
	return contracts.RunnerCommandRunSealed{Key: b64.EncodeToString(item.Key), Ciphertext: b64.EncodeToString(item.Ciphertext)}
}

// run is the command.run of the Commande cmd-tests, sealed with that one
// text and place, for the Ticket 12 at sha.
func (h *harness) run(t *testing.T, id, text, where, sha string) contracts.RunnerCommandRun {
	t.Helper()
	return contracts.RunnerCommandRun{
		Type:              "command.run",
		Id:                "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c10",
		At:                time.Now().UTC(),
		RunId:             id,
		ProjectId:         projectID,
		CommandId:         "cmd-tests",
		Sealed:            h.seal(t, projectID, map[string]commande{"cmd-tests": {Run: text, Where: where}}),
		Origin:            contracts.RunnerCommandRunOrigin{Kind: contracts.RunnerCommandRunOriginKindGithub, Owner: "acme", Name: "shop"},
		IntegrationBranch: "develop",
		Ref:               contracts.RunnerCommandRunRef{StepId: "tests", Ticket: float64(12), Branch: branch, Sha: sha},
		WorktreeCommands:  runWorktreeCommands(h.worktreeCommands),
	}
}

func runWorktreeCommands(sealed *session.SealedCommands) *contracts.RunnerCommandRunWorktreeCommands {
	if sealed == nil {
		return nil
	}
	return &contracts.RunnerCommandRunWorktreeCommands{Key: sealed.Key, Ciphertext: sealed.Ciphertext}
}

func sessionWorktreeCommands(sealed *session.SealedCommands) *contracts.RunnerSessionStartWorktreeCommands {
	if sealed == nil {
		return nil
	}
	return &contracts.RunnerSessionStartWorktreeCommands{Key: sealed.Key, Ciphertext: sealed.Ciphertext}
}

// mark is the path of a marker file, outside the places.
func (h *harness) mark(name string) string {
	return filepath.Join(h.marks, name)
}

func read(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", filepath.Base(path), err)
	}
	return strings.TrimSpace(string(data))
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func (h *harness) worktree() string {
	return filepath.Join(h.home, "worktrees", projectID, strings.ReplaceAll(branch, "/", "__"))
}

func code(v contracts.RunnerCommandVerdict) any { return v.ExitCode }

func TestACommandeOpenedForItsProjetRunsAndGivesItsExitCode(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)

	h.commands.Run(h.run(t, runID, "exit 0", "worktree", sha))
	ok := h.sent.verdict(t, runID)
	if !ok.Passed || ok.Reason != contracts.RunnerCommandVerdictReasonExited || code(ok) != 0 {
		t.Fatalf("verdict %+v, want passed, exited, 0", ok)
	}
	if !h.sent.startedAny(runID) {
		t.Fatal("no command.started before the verdict")
	}

	h.commands.Run(h.run(t, secondRun, "exit 3", "worktree", sha))
	failed := h.sent.verdict(t, secondRun)
	if failed.Passed || failed.Reason != contracts.RunnerCommandVerdictReasonExited || code(failed) != 3 {
		t.Fatalf("verdict %+v, want not passed, exited, 3", failed)
	}
}

func TestASealedPartThatDoesNotOpenForThisRunRunsNothing(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	text := "touch " + h.mark("ran")

	otherProjet := h.run(t, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c11", text, "worktree", sha)
	otherProjet.Sealed = h.seal(t, otherID, map[string]commande{"cmd-tests": {Run: text, Where: "worktree"}})

	tampered := h.run(t, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c12", text, "worktree", sha)
	raw, _ := b64.DecodeString(tampered.Sealed.Ciphertext)
	raw[len(raw)-1] ^= 1
	tampered.Sealed.Ciphertext = b64.EncodeToString(raw)

	notHeld := h.run(t, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c13", text, "worktree", sha)
	notHeld.CommandId = "cmd-deploy"

	outside := h.run(t, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c14", text, "worktree", sha)
	outside.Sealed = h.seal(t, projectID, map[string]commande{"cmd-tests": {Run: text, Where: "home"}})

	// The whole sealed part is checked, not only its Commande cmd-tests.
	tests := map[string]any{"run": text, "where": "worktree"}
	payloads := []any{
		map[string]any{"commands": map[string]any{"cmd-tests": tests, "cmd-lint": map[string]any{"run": "", "where": "project"}}},
		map[string]any{"commands": map[string]any{"cmd-tests": map[string]any{"run": text, "where": "worktree", "shell": "bash"}}},
		map[string]any{"commands": map[string]any{"cmd-tests": tests}, "env": map[string]any{}},
		map[string]any{"commands": map[string]any{"cmd-tests": map[string]any{"run": text, "where": "worktree", "healthUrl": "ftp://localhost/"}}},
		map[string]any{"commands": map[string]any{"cmd-tests": map[string]any{"run": text, "where": "worktree", "healthUrl": nil}}},
		map[string]any{"commands": map[string]any{"cmd-tests": tests, "Cmd_Lint": tests}},
		map[string]any{"commands": nil},
		// 10 001 UTF-16 code units, 10 000 characters: zod counts the former.
		map[string]any{"commands": map[string]any{"cmd-tests": map[string]any{"run": text + " #😀" + strings.Repeat("x", 10000-utf8.RuneCountInString(text)-3), "where": "worktree"}}},
	}
	invalid := []contracts.RunnerCommandRun{otherProjet, tampered, notHeld, outside}
	for i, payload := range payloads {
		message := h.run(t, fmt.Sprintf("019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c%d", 20+i), text, "worktree", sha)
		message.Sealed = h.sealPayload(t, projectID, payload)
		invalid = append(invalid, message)
	}
	for _, message := range invalid {
		h.commands.Run(message)
		v := h.sent.verdict(t, message.RunId)
		if v.Passed || v.Reason != contracts.RunnerCommandVerdictReasonSealedInvalid || v.ExitCode != nil {
			t.Fatalf("verdict %+v, want sealed-invalid", v)
		}
		if h.sent.startedAny(message.RunId) {
			t.Fatalf("%s started", message.RunId)
		}
	}
	if exists(h.mark("ran")) {
		t.Fatal("a Commande ran from a sealed part that did not open for it")
	}
	if exists(h.worktree()) {
		t.Fatal("a worktree was made for a run that never ran")
	}
}

func TestACommandeOfTenThousandCharactersRuns(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	text := "touch " + h.mark("ran") + " #"
	text += strings.Repeat("x", 10000-len(text))
	message := h.run(t, runID, text, "worktree", sha)
	message.Sealed = h.sealPayload(t, projectID, map[string]any{"commands": map[string]any{
		"cmd-tests": map[string]any{"run": text, "where": "worktree", "healthUrl": "http://127.0.0.1:" + freePort(t) + "/sante"},
	}})
	h.commands.Run(message)
	// Its address never answers: it ran, and failed after its window.
	for deadline := time.Now().Add(10 * time.Second); !exists(h.mark("ran")) && time.Now().Before(deadline); {
		time.Sleep(10 * time.Millisecond)
	}
	h.clock.fire(t, command.HealthWindow)
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonHealthTimeout || !exists(h.mark("ran")) {
		t.Fatalf("verdict %+v, want the Commande run, then health-timeout", v)
	}
}

func TestAWorktreeCommandeRunsAtTheTicketsShaInItsWorktreeThenRemovesIt(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	// The Ticket's branch moved on since the SHA under judgement.
	git(t, h.remote.work, "checkout", branch)
	h.remote.commit(t, "cart.txt", "later\n")
	git(t, h.remote.work, "push", "origin", branch)
	git(t, h.remote.work, "checkout", "develop")
	var prepared, cleaned []string
	h.hooks = session.Hooks{
		Prepare: func(_ context.Context, w session.Worktree) error { prepared = append(prepared, w.Dir); return nil },
		Clean:   func(_ context.Context, w session.Worktree) error { cleaned = append(cleaned, w.Dir); return nil },
	}
	h.start(t)

	h.commands.Run(h.run(t, runID, "git rev-parse HEAD > "+h.mark("head")+"; pwd -P > "+h.mark("pwd"), "worktree", sha))
	if v := h.sent.verdict(t, runID); !v.Passed {
		t.Fatalf("verdict %+v", v)
	}
	if got := read(t, h.mark("head")); got != sha {
		t.Fatalf("ran at %s, want the Ticket's %s", got, sha)
	}
	want, _ := filepath.EvalSymlinks(filepath.Dir(h.worktree()))
	if got := read(t, h.mark("pwd")); got != filepath.Join(want, filepath.Base(h.worktree())) {
		t.Fatalf("ran in %s, want the Ticket's worktree", got)
	}
	if exists(h.worktree()) {
		t.Fatal("the worktree is still there once the run ended")
	}
	if len(prepared) != 1 || len(cleaned) != 1 || prepared[0] != h.worktree() {
		t.Fatalf("hooks prepared %v, cleaned %v", prepared, cleaned)
	}
}

func TestAWorktreeALiveSessionHoldsIsUnavailableAndOneARunHoldsIsBusyForASession(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.engine.Events = []contracts.EngineEvent{{Question: &contracts.EngineEventQuestion{RequestId: "q1", Title: "Quelle couleur ?", Options: []contracts.EngineEventQuestionOptionsElem{{Label: "Bleu"}}}}}
	h.start(t)

	h.manager.Start(contracts.RunnerSessionStart{
		Type: "session.start", Id: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c20", At: time.Now().UTC(),
		SessionId: sessionID, ProjectId: projectID,
		Origin: contracts.RunnerSessionStartOrigin{Kind: contracts.RunnerSessionStartOriginKindGithub, Owner: "acme", Name: "shop"},
		Branch: branch, Base: "develop", Engine: contracts.RunnerSessionStartEngineClaudeCode, Model: "claude-opus-5-5", Role: "code",
		PermissionMode: contracts.RunnerSessionStartPermissionModeBypass, Title: "Le panier",
	})
	h.sent.await(t, "the Session waiting", func(m any) bool {
		s, ok := m.(contracts.RunnerSessionState)
		return ok && s.SessionId == sessionID && s.State == contracts.RunnerSessionStateStateWaiting
	})
	h.commands.Run(h.run(t, runID, "touch "+h.mark("ran"), "worktree", sha))
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonPlaceUnavailable || v.Passed {
		t.Fatalf("verdict %+v, want place-unavailable", v)
	}
	if exists(h.mark("ran")) {
		t.Fatal("the Commande ran in a live Session's worktree")
	}
	if !exists(h.worktree()) {
		t.Fatal("the run removed the live Session's worktree")
	}
	h.manager.Stop(sessionID)
	h.sent.await(t, "the Session stopped", func(m any) bool {
		s, ok := m.(contracts.RunnerSessionState)
		return ok && s.SessionId == sessionID && s.State == contracts.RunnerSessionStateStateStopped
	})

	// The stopped Session's worktree is at the Ticket's SHA: the run uses
	// it, and leaves it to the Session.
	h.commands.Run(h.run(t, secondRun, "touch "+h.mark("ran"), "worktree", sha))
	if v := h.sent.verdict(t, secondRun); !v.Passed {
		t.Fatalf("verdict %+v, want passed in the stopped Session's worktree", v)
	}
	if !exists(h.worktree()) {
		t.Fatal("the run removed the stopped Session's worktree")
	}
	develop := git(t, h.remote.work, "rev-parse", "develop")
	other := h.run(t, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c03", "true", "worktree", develop)
	h.commands.Run(other)
	if v := h.sent.verdict(t, other.RunId); v.Reason != contracts.RunnerCommandVerdictReasonPlaceUnavailable {
		t.Fatalf("verdict %+v, want place-unavailable at another SHA", v)
	}
}

// startSession starts the Session of the Ticket's branch, and waits for its question.
func (h *harness) startSession(t *testing.T) {
	t.Helper()
	h.manager.Start(contracts.RunnerSessionStart{
		Type: "session.start", Id: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c20", At: time.Now().UTC(),
		SessionId: sessionID, ProjectId: projectID,
		Origin: contracts.RunnerSessionStartOrigin{Kind: contracts.RunnerSessionStartOriginKindGithub, Owner: "acme", Name: "shop"},
		Branch: branch, Base: "develop", Engine: contracts.RunnerSessionStartEngineClaudeCode, Model: "claude-opus-5-5", Role: "code",
		PermissionMode: contracts.RunnerSessionStartPermissionModeBypass, Title: "Le panier",
		WorktreeCommands: sessionWorktreeCommands(h.worktreeCommands),
	})
	h.sent.await(t, "the Session waiting", func(m any) bool {
		s, ok := m.(contracts.RunnerSessionState)
		return ok && s.SessionId == sessionID && s.State == contracts.RunnerSessionStateStateWaiting
	})
}

func TestTheResumeOfAStoppedSessionWaitsForTheRunThatHoldsItsWorktree(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.engine.Events = []contracts.EngineEvent{{Question: &contracts.EngineEventQuestion{RequestId: "q1", Title: "Quelle couleur ?", Options: []contracts.EngineEventQuestionOptionsElem{{Label: "Bleu"}}}}}
	h.start(t)
	h.startSession(t)
	h.manager.Stop(sessionID)
	h.sent.await(t, "the Session stopped", func(m any) bool {
		s, ok := m.(contracts.RunnerSessionState)
		return ok && s.SessionId == sessionID && s.State == contracts.RunnerSessionStateStateStopped
	})
	h.commands.Run(h.run(t, runID, "sleep 300", "worktree", sha))
	h.sent.started(t, runID)

	// By its resume, and by a session.start of its id.
	h.manager.Resume(sessionID)
	h.manager.Start(contracts.RunnerSessionStart{Type: "session.start", Id: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c21", At: time.Now().UTC(), SessionId: sessionID})
	time.Sleep(300 * time.Millisecond)
	if runs := len(h.engine.Runs()); runs != 1 {
		t.Fatalf("%d Moteur runs while the Commande holds the worktree, want the first one only", runs)
	}

	h.commands.Stop(runID)
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonStopped {
		t.Fatalf("verdict %+v", v)
	}
	deadline := time.Now().Add(10 * time.Second)
	for len(h.engine.Runs()) < 2 {
		if time.Now().After(deadline) {
			t.Fatal("the Session was not resumed once the run released its worktree")
		}
		time.Sleep(20 * time.Millisecond)
	}
	time.Sleep(200 * time.Millisecond)
	if runs := len(h.engine.Runs()); runs != 2 {
		t.Fatalf("%d Moteur runs, want the Session resumed once", runs)
	}
	if !exists(h.worktree()) {
		t.Fatal("the run removed the Session's worktree")
	}
}

func TestAStopOfAResumeThatWaitsForARunCancelsIt(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.engine.Events = []contracts.EngineEvent{{Question: &contracts.EngineEventQuestion{RequestId: "q1", Title: "Quelle couleur ?", Options: []contracts.EngineEventQuestionOptionsElem{{Label: "Bleu"}}}}}
	h.start(t)
	h.startSession(t)
	h.manager.Stop(sessionID)
	h.sent.await(t, "the Session stopped", func(m any) bool {
		s, ok := m.(contracts.RunnerSessionState)
		return ok && s.SessionId == sessionID && s.State == contracts.RunnerSessionStateStateStopped
	})
	h.commands.Run(h.run(t, runID, "sleep 300", "worktree", sha))
	h.sent.started(t, runID)

	// The Pilote resumes it while the Commande holds its worktree, then stops it.
	h.manager.Resume(sessionID)
	h.manager.Stop(sessionID)
	h.commands.Stop(runID)
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonStopped {
		t.Fatalf("verdict %+v", v)
	}
	time.Sleep(500 * time.Millisecond)
	if runs := len(h.engine.Runs()); runs != 1 {
		t.Fatalf("%d Moteur runs, want none after the stop", runs)
	}
	// A later resume still resumes it.
	h.manager.Resume(sessionID)
	deadline := time.Now().Add(10 * time.Second)
	for len(h.engine.Runs()) < 2 {
		if time.Now().After(deadline) {
			t.Fatal("the Session was not resumed by a resume after the stop")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestARunOnABranchNamedIntegrationLeavesTheIntegrationCheckout(t *testing.T) {
	h := newHarness(t)
	develop := git(t, h.remote.work, "rev-parse", "develop")
	git(t, h.remote.work, "checkout", "-B", "integration", "develop")
	other := h.remote.commit(t, "cart.txt", "integration\n")
	git(t, h.remote.work, "push", "origin", "integration")
	git(t, h.remote.work, "checkout", "develop")
	h.start(t)

	h.commands.Run(h.run(t, runID, "mkdir -p deps; echo kept > deps/kept; pwd -P > "+h.mark("checkout"), "project", develop))
	if v := h.sent.verdict(t, runID); !v.Passed {
		t.Fatalf("verdict %+v", v)
	}
	onBranch := h.run(t, secondRun, "pwd -P > "+h.mark("worktree"), "worktree", other)
	onBranch.Ref.Branch = "integration"
	h.commands.Run(onBranch)
	if v := h.sent.verdict(t, secondRun); !v.Passed {
		t.Fatalf("verdict %+v", v)
	}
	if read(t, h.mark("checkout")) == read(t, h.mark("worktree")) {
		t.Fatal("the branch integration's worktree is the integration checkout")
	}
	again := h.run(t, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c03", "test -f deps/kept", "project", develop)
	h.commands.Run(again)
	if v := h.sent.verdict(t, again.RunId); !v.Passed {
		t.Fatalf("verdict %+v: the integration checkout lost its ignored file", v)
	}
}

func TestARunHoldsItsWorktreeAgainstANewSession(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	h.commands.Run(h.run(t, runID, "sleep 300", "worktree", sha))
	h.sent.started(t, runID)

	h.manager.Start(contracts.RunnerSessionStart{
		Type: "session.start", Id: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c20", At: time.Now().UTC(),
		SessionId: sessionID, ProjectId: projectID,
		Origin: contracts.RunnerSessionStartOrigin{Kind: contracts.RunnerSessionStartOriginKindGithub, Owner: "acme", Name: "shop"},
		Branch: branch, Base: "develop", Engine: contracts.RunnerSessionStartEngineClaudeCode, Model: "claude-opus-5-5", Role: "code",
		PermissionMode: contracts.RunnerSessionStartPermissionModeBypass, Title: "Le panier",
	})
	state := h.sent.await(t, "the Session ended", func(m any) bool {
		s, ok := m.(contracts.RunnerSessionState)
		return ok && s.SessionId == sessionID && s.State == contracts.RunnerSessionStateStateEnded
	}).(contracts.RunnerSessionState)
	if state.Error == nil || *state.Error != contracts.RunnerSessionStateErrorBranchBusy {
		t.Fatalf("state %+v, want branch-busy", state)
	}
	h.commands.Stop(runID)
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonStopped {
		t.Fatalf("verdict %+v", v)
	}
}

func TestAProjectCommandeRunsInTheIntegrationCheckoutMovedToTheShaKeepingIgnoredFiles(t *testing.T) {
	h := newHarness(t)
	first := git(t, h.remote.work, "rev-parse", "develop")
	h.start(t)

	h.commands.Run(h.run(t, runID, "git rev-parse HEAD > "+h.mark("first")+"; mkdir -p deps; echo kept > deps/kept; echo gone > untracked", "project", first))
	if v := h.sent.verdict(t, runID); !v.Passed {
		t.Fatalf("verdict %+v", v)
	}
	second := h.remote.commit(t, "README", "second\n")
	git(t, h.remote.work, "push", "origin", "develop")

	run := h.run(t, secondRun, "git rev-parse HEAD > "+h.mark("second")+"; pwd -P > "+h.mark("pwd")+"; test -f deps/kept && test ! -e untracked", "project", second)
	h.commands.Run(run)
	if v := h.sent.verdict(t, secondRun); !v.Passed {
		t.Fatalf("verdict %+v: the ignored file went, or the untracked one stayed", v)
	}
	if read(t, h.mark("first")) != first || read(t, h.mark("second")) != second {
		t.Fatalf("ran at %s then %s, want %s then %s", read(t, h.mark("first")), read(t, h.mark("second")), first, second)
	}
	if got := read(t, h.mark("pwd")); filepath.Base(got) != ".integration" || filepath.Base(filepath.Dir(got)) != projectID {
		t.Fatalf("ran in %s, want worktrees/<projectId>/.integration", got)
	}

	// Without a SHA (the « Livraison »): the head of the integration branch.
	third := h.remote.commit(t, "README", "third\n")
	git(t, h.remote.work, "push", "origin", "develop")
	head := h.run(t, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c03", "git rev-parse HEAD > "+h.mark("third"), "project", "")
	head.Ref = contracts.RunnerCommandRunRef{StepId: "deploy"}
	h.commands.Run(head)
	if v := h.sent.verdict(t, head.RunId); !v.Passed || read(t, h.mark("third")) != third {
		t.Fatalf("verdict %+v at %s, want the head %s", v, read(t, h.mark("third")), third)
	}
}

func TestTheRunGetsTheCrewdeckVariablesAndAPlainShellWhenShellIsUnset(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	t.Setenv("SHELL", "")
	t.Setenv("CREWDECK_SHA", "inherited")

	h.commands.Run(h.run(t, runID, "env | grep ^CREWDECK_ | sort > "+h.mark("env")+"; echo \"$0\" > "+h.mark("shell"), "worktree", sha))
	if v := h.sent.verdict(t, runID); !v.Passed {
		t.Fatalf("verdict %+v", v)
	}
	want := strings.Join([]string{"CREWDECK_BRANCH=" + branch, "CREWDECK_PROJECT=" + projectID, "CREWDECK_SHA=" + sha, "CREWDECK_STEP=tests", "CREWDECK_TICKET=12"}, "\n")
	if got := read(t, h.mark("env")); got != want {
		t.Fatalf("environment\n%s\nwant\n%s", got, want)
	}
	if got := read(t, h.mark("shell")); got != "/bin/sh" {
		t.Fatalf("ran by %q, want /bin/sh", got)
	}

	delivery := h.run(t, secondRun, "env | grep ^CREWDECK_ | sort > "+h.mark("delivery"), "project", "")
	delivery.Ref = contracts.RunnerCommandRunRef{StepId: "deploy"}
	h.commands.Run(delivery)
	if v := h.sent.verdict(t, secondRun); !v.Passed {
		t.Fatalf("verdict %+v", v)
	}
	want = strings.Join([]string{"CREWDECK_BRANCH=", "CREWDECK_PROJECT=" + projectID, "CREWDECK_SHA=", "CREWDECK_STEP=deploy", "CREWDECK_TICKET="}, "\n")
	if got := read(t, h.mark("delivery")); got != want {
		t.Fatalf("environment outside a Ticket\n%s\nwant\n%s", got, want)
	}
}
