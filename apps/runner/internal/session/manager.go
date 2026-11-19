// Package session runs the Sessions the server asks for (RUNNER-9, ADR
// 0004): each in its own worktree of the Runner's clone of the Projet's
// code, never in the Pilote's checkout (risk AGT-1), with one Moteur, its
// events kept in a local log. The Runner keeps no Process state: it reports
// each Session's state with `session.state`, and after a restart says in
// its hello the Sessions it knows, none alive, which only a `session.resume`
// starts again.
//
// The Runner's folder (~/.crewdeck):
//
//	repos/github/<owner>/<name>              the clones, one per repository
//	worktrees/<projectId>/<branch, / as __>  one worktree per live Session or Commande's run
//	worktrees/<projectId>/integration        the integration checkout of the Commandes `project`
//	sessions/<id>/                           session.json, log.jsonl, key (the relay's), the Moteur's socket
package session

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sync"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
)

// Config is what the manager runs the Sessions with.
type Config struct {
	// Home is the Runner's folder, ~/.crewdeck.
	Home string
	// Engines are the Moteurs' adapters.
	Engines *engine.Registry
	// GitHubURL is where the GitHub repositories are cloned from; empty,
	// DefaultGitHubURL.
	GitHubURL string
	// Tokens authenticates the clones of the Commandes' runs; nil clones
	// without one.
	Tokens github.TokenSource
	// GitHubTokens gives a Session a new GitHub token, the server's
	// (github.ServerTokens, RUNNER-10): each Session of a GitHub Projet has
	// its own, fetched as it starts, renewed while it lives, given to git
	// through the askpass and to gh through its shim, a Session whose token
	// is refused ending `clone-failed`; nil (the smoke build's local
	// repositories alone), its git runs with Tokens.
	GitHubTokens func(ctx context.Context, sessionID string) (github.Issued, error)
	// RunnerPath is the program of the askpass and of the Session's shims;
	// empty, this one.
	RunnerPath string
	// Now and After are time's unless a test moves the tokens' clock.
	Now   func() time.Time
	After func(time.Duration) <-chan time.Time
	// LocalOrigin gives a Local Projet's Origin (source/local, SOURCE-2);
	// nil, a Session of a Local Projet ends `clone-failed`.
	LocalOrigin func(projectID string) Origin
	Hooks       Hooks
	// Send sends a message to the server (protocol.ErrNotConnected while
	// offline: the report is lost, the hello says the Sessions again).
	Send   func(ctx context.Context, message any) error
	Logger *slog.Logger
	// Keys seal the relay of the Sessions (SESSION-1); nil, nothing is
	// relayed and no input taken.
	Keys *RelayKeys
	// StopGrace is how long a stopped Moteur has to end its turn before it
	// is killed; zero, 10 s.
	StopGrace time.Duration
}

// Manager runs the Sessions: one goroutine per running Session.
type Manager struct {
	cfg    Config
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
	once   sync.Once

	mu       sync.Mutex
	closed   bool
	sessions map[string]*live
	// held are the folders a Commande's run holds (place.go).
	held map[string]bool
	// waiting are the stopped Sessions whose resume waits for a run to
	// release their worktree, by folder.
	waiting map[string][]*live
	// afterUnhold, for the tests, runs as unhold releases m.mu, before the
	// resumes it took start.
	afterUnhold func()

	relayMu sync.Mutex
	relay   relayState
}

// live is a Session the manager knows: running when alive.
type live struct {
	mu       sync.Mutex
	rec      record
	alive    bool
	stopping bool
	// resume is a resume asked while stopping: run once the Moteur stopped.
	resume bool
	cancel context.CancelFunc
	run    engine.Run
	// pending are the requests of the run that wait for the Pilote.
	pending map[string]request
	// token is the GitHub token of the run, while it runs.
	token *github.SessionToken
}

// request is a `question` or a `permission-request` that waits: what an
// answer to it is checked against.
type request struct {
	kind     contracts.RunnerSessionWaitingKind
	options  []string
	multiple bool
}

var uuid = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// New is the manager of the Sessions kept under cfg.Home: none of them
// alive, their Moteurs having died with the Runner that ran them.
func New(cfg Config) (*Manager, error) {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.GitHubURL == "" {
		cfg.GitHubURL = DefaultGitHubURL
	}
	if cfg.StopGrace == 0 {
		cfg.StopGrace = 10 * time.Second
	}
	if cfg.Engines == nil {
		cfg.Engines = &engine.Registry{}
	}
	records, err := loadRecords(cfg.Home)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	m := &Manager{cfg: cfg, ctx: ctx, cancel: cancel, sessions: map[string]*live{}, relay: relayState{keys: map[string][]byte{}, inputs: map[string]*seenInputs{}}}
	for _, r := range records {
		m.sessions[r.SessionID] = &live{rec: *r}
	}
	return m, nil
}

// Register makes the client hand the server's session.start, stop, resume,
// and the relay's session.replay and session.input, to the manager.
func (m *Manager) Register(client *protocol.Client) {
	protocol.On(client, protocol.TypeSessionStart, func(_ context.Context, message contracts.RunnerSessionStart) error {
		m.Start(message)
		return nil
	})
	protocol.On(client, protocol.TypeSessionStop, func(_ context.Context, message contracts.RunnerSessionStop) error {
		m.Stop(message.SessionId)
		return nil
	})
	protocol.On(client, protocol.TypeSessionResume, func(_ context.Context, message contracts.RunnerSessionResume) error {
		m.Resume(message.SessionId)
		return nil
	})
	protocol.On(client, protocol.TypeSessionReplay, func(_ context.Context, message contracts.RunnerSessionReplay) error {
		m.ReplayTo(message)
		return nil
	})
	protocol.On(client, protocol.TypeSessionInput, func(_ context.Context, message contracts.RunnerSessionInput) error {
		m.Input(message)
		return nil
	})
}

// Hello is what the hello says of the Sessions: those not ended, alive
// while their Moteur runs.
func (m *Manager) Hello() []contracts.RunnerHelloSessionsElem {
	m.mu.Lock()
	defer m.mu.Unlock()
	hello := []contracts.RunnerHelloSessionsElem{}
	for id, s := range m.sessions {
		s.mu.Lock()
		if s.rec.State != contracts.RunnerSessionStateStateEnded {
			hello = append(hello, contracts.RunnerHelloSessionsElem{SessionId: id, Alive: s.alive})
		}
		s.mu.Unlock()
	}
	return hello
}

// Close kills the running Sessions' Moteurs and waits for them; their
// records stay as they were, for the next Runner to report them.
func (m *Manager) Close() {
	m.once.Do(func() {
		m.mu.Lock()
		m.closed = true
		m.mu.Unlock()
		m.cancel()
		m.wg.Wait()
	})
}

// Start starts the Session; one the Runner already knows is not started
// twice: alive or ended, its state is reported again; stopped or
// interrupted, it is resumed.
func (m *Manager) Start(message contracts.RunnerSessionStart) {
	var commands *SealedCommands
	if sealed := message.WorktreeCommands; sealed != nil {
		commands = m.cfg.Hooks.keep(message.ProjectId, &SealedCommands{Key: sealed.Key, Ciphertext: sealed.Ciphertext})
	}
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		return
	}
	if s, known := m.sessions[message.SessionId]; known {
		m.mu.Unlock()
		m.revive(s)
		return
	}
	s := &live{rec: record{
		SessionID:      message.SessionId,
		ProjectID:      message.ProjectId,
		Origin:         message.Origin,
		Branch:         message.Branch,
		Base:           message.Base,
		Worktree:       worktreeDir(m.cfg.Home, message.ProjectId, message.Branch),
		Engine:         message.Engine,
		Model:          message.Model,
		Role:           message.Role,
		PermissionMode: message.PermissionMode,
		Step:           message.Step,
		State:          contracts.RunnerSessionStateStateStarting,
	}}
	s.rec.WorktreeCommands = commands
	if !uuid.MatchString(message.SessionId) {
		m.mu.Unlock()
		return // nothing to name it by, nor a folder to keep it in
	}
	m.sessions[message.SessionId] = s
	failure := contracts.RunnerSessionStateError("")
	switch {
	case !uuid.MatchString(message.ProjectId) || !validBranch(message.Branch) || !validBranch(message.Base):
		failure = contracts.RunnerSessionStateErrorSetupFailed
	case m.busy(s):
		failure = contracts.RunnerSessionStateErrorBranchBusy
	}
	var run func()
	if failure == "" {
		s.mu.Lock()
		run = m.arm(s, true)
		s.mu.Unlock()
	}
	m.mu.Unlock()
	if failure != "" {
		s.mu.Lock()
		s.rec.Worktree = "" // another Session's, or none
		s.mu.Unlock()
		m.end(s, contracts.RunnerSessionStateOutcomeError, failure)
		return
	}
	run()
}

// busy: another Session not ended holds the worktree (a stopped one keeps
// it for its resume), or a Commande's run does. Called with m.mu held.
func (m *Manager) busy(s *live) bool {
	if m.held[s.rec.Worktree] {
		return true
	}
	for id, other := range m.sessions {
		if id == s.rec.SessionID {
			continue
		}
		other.mu.Lock()
		holds := other.rec.State != contracts.RunnerSessionStateStateEnded && other.rec.Worktree == s.rec.Worktree
		other.mu.Unlock()
		if holds {
			return true
		}
	}
	return false
}

// Resume starts the stopped or interrupted Session again on its Moteur
// session; one the Runner does not know ends in `engine-failed`.
func (m *Manager) Resume(id string) {
	m.mu.Lock()
	s, known := m.sessions[id]
	closed := m.closed
	m.mu.Unlock()
	if closed {
		return
	}
	if !known {
		if uuid.MatchString(id) {
			m.send(protocol.NewSessionState(id, contracts.RunnerSessionStateStateEnded, contracts.RunnerSessionStateOutcomeError, contracts.RunnerSessionStateErrorEngineFailed, ""))
		}
		return
	}
	m.revive(s)
}

// revive reports an alive or ended Session again, and resumes the others;
// one still stopping is resumed once its Moteur stopped (the server took the
// stop at once, then the Pilote's resume); one whose worktree a Commande's
// run holds, once the run released it (unhold). Deciding the resume and
// arming it happen under m.mu, as the run's hold does: never both at once.
func (m *Manager) revive(s *live) {
	m.mu.Lock()
	then := m.reviveLocked(s)
	m.mu.Unlock()
	then()
}

// reviveLocked decides revive's step and arms the resume, with m.mu held;
// what it gives is called once m.mu is released.
func (m *Manager) reviveLocked(s *live) func() {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case s.alive && s.stopping:
		s.resume = true
		return func() {}
	case s.alive || s.rec.State == contracts.RunnerSessionStateStateEnded:
		return func() { m.report(s) }
	case m.closed:
		return func() {}
	}
	if dir := s.rec.Worktree; dir != "" && m.held[dir] {
		if !slices.Contains(m.waiting[dir], s) {
			if m.waiting == nil {
				m.waiting = map[string][]*live{}
			}
			m.waiting[dir] = append(m.waiting[dir], s)
		}
		return func() {}
	}
	return m.arm(s, false)
}

// Stop stops the Session's Moteur: interrupted, then killed once its turn
// ended or after StopGrace; a resume of it still waiting for a run is
// cancelled. The Session keeps its worktree and its Moteur's id.
func (m *Manager) Stop(id string) {
	m.mu.Lock()
	s, known := m.sessions[id]
	if known {
		// The stop came after a resume still waiting for a run to release
		// the worktree: that resume is cancelled.
		for dir, waiting := range m.waiting {
			if i := slices.Index(waiting, s); i >= 0 {
				m.waiting[dir] = slices.Delete(waiting, i, i+1)
			}
		}
	}
	m.mu.Unlock()
	if !known {
		return
	}
	s.mu.Lock()
	if !s.alive {
		changed := s.rec.State != contracts.RunnerSessionStateStateEnded && s.rec.State != contracts.RunnerSessionStateStateStopped
		if changed {
			s.rec.State = contracts.RunnerSessionStateStateStopped
		}
		s.mu.Unlock()
		if changed {
			m.save(s)
		}
		m.report(s)
		return
	}
	s.stopping, s.resume = true, false
	run, cancel := s.run, s.cancel
	s.mu.Unlock()
	if run == nil {
		cancel() // still preparing its worktree
		return
	}
	time.AfterFunc(m.cfg.StopGrace, cancel)
	go func() {
		ctx, done := context.WithTimeout(m.ctx, m.cfg.StopGrace)
		defer done()
		if err := run.Interrupt(ctx); err != nil {
			cancel()
		}
	}()
}

// arm makes the Session alive with the context of its next run, and gives
// what starts that run, to be called once s.mu is released. It is called
// with s.mu held, in the same hold as what decided the run: a Stop that comes
// after cancels this run, never the one before it.
func (m *Manager) arm(s *live, fresh bool) func() {
	ctx, cancel := context.WithCancel(m.ctx)
	s.alive, s.cancel, s.stopping, s.resume, s.run = true, cancel, false, false, nil
	m.wg.Add(1)
	return func() {
		go func() {
			defer m.wg.Done()
			defer cancel()
			m.runSession(ctx, s, fresh)
		}()
	}
}

// runSession makes the worktree when it has none (always for a new
// Session), then runs the Moteur, starting it, or resuming its session.
func (m *Manager) runSession(ctx context.Context, s *live, fresh bool) {
	m.setState(s, contracts.RunnerSessionStateStateStarting)
	s.mu.Lock()
	rec := s.rec
	s.mu.Unlock()
	output := prepareLog{path: filepath.Join(sessionDir(m.cfg.Home, rec.SessionID), PrepareLogFile)}
	w := Worktree{SessionID: rec.SessionID, ProjectID: rec.ProjectID, Dir: rec.Worktree, Branch: rec.Branch, Preparation: Preparation{
		Commands: rec.WorktreeCommands,
		Stdout:   output,
		Stderr:   output,
	}}
	origin, err := m.originOf(rec.ProjectID, rec.Origin)
	if err != nil {
		m.fail(s, w, false, contracts.RunnerSessionStateErrorCloneFailed, "clone", err)
		return
	}
	w.Clone = origin.Dir()
	var gitEnv []string
	if gh, ok := origin.(*GitHubOrigin); ok {
		// Never the machine's credentials: the Session's token, or none.
		gitEnv = github.NoMachineCredentials()
		if m.cfg.GitHubTokens != nil {
			// A token refused, its Projet's access lost included, ends the
			// Session before its clone and its Moteur.
			_, end, err := m.sessionToken(ctx, s, rec.SessionID)
			if err != nil {
				m.fail(s, w, false, contracts.RunnerSessionStateErrorCloneFailed, "github-token", err)
				return
			}
			defer end()
			gitEnv = github.GitEnv(m.runnerPath(), m.cfg.Home, rec.SessionID)
			gh.Tokens, gh.Env = nil, gitEnv
		}
	}

	if _, err := os.Stat(w.Dir); fresh || err != nil {
		_, auth, err := origin.Clone(ctx)
		if err != nil {
			m.fail(s, w, false, contracts.RunnerSessionStateErrorCloneFailed, "clone", err)
			return
		}
		unlock := LockClone(w.Clone)
		err = addWorktree(ctx, w.Clone, auth, w.Dir, rec.Branch, rec.Base)
		unlock()
		if err != nil {
			m.fail(s, w, true, contracts.RunnerSessionStateErrorSetupFailed, "worktree", err)
			return
		}
		if err := m.cfg.Hooks.prepare(ctx, withEnv(ctx, w)); err != nil {
			m.failPrepare(s, w, err)
			return
		}
	}

	adapter, ok := m.cfg.Engines.Get(contracts.EngineId(rec.Engine))
	if !ok {
		m.fail(s, w, true, contracts.RunnerSessionStateErrorEngineFailed, "engine", errors.New("no adapter"))
		return
	}
	dir := sessionDir(m.cfg.Home, rec.SessionID)
	log, err := openLog(dir)
	if err != nil {
		m.fail(s, w, true, contracts.RunnerSessionStateErrorEngineFailed, "log", err)
		return
	}
	defer log.close()
	// The key goes to the tabs before any event of the run.
	key := m.liveKeys(rec.SessionID)
	if end, ended, err := log.endCut(time.Now()); err != nil {
		m.cfg.Logger.Warn("session.log", "sessionId", rec.SessionID, "error", err)
	} else if ended {
		m.relayLive(key, rec.SessionID, end)
	}
	opts := engine.StartOptions{Dir: w.Dir, Model: rec.Model, Role: rec.Role, PermissionMode: engine.PermissionMode(rec.PermissionMode), SessionDir: dir, SessionID: rec.SessionID}
	if opts.Env, err = m.moteurEnv(rec.SessionID, gitEnv); err != nil {
		m.fail(s, w, true, contracts.RunnerSessionStateErrorEngineFailed, "shims", err)
		return
	}
	var run engine.Run
	if rec.EngineSessionID != "" {
		run, err = adapter.Resume(ctx, engine.ResumeOptions{StartOptions: opts, EngineSessionID: rec.EngineSessionID})
	} else if opts.InitialPrompt, err = initialPrompt(rec.Step); err == nil {
		run, err = adapter.Start(ctx, opts)
	}
	if err != nil {
		m.fail(s, w, true, contracts.RunnerSessionStateErrorEngineFailed, "engine", err)
		return
	}
	s.mu.Lock()
	s.run = run
	s.pending = map[string]request{}
	s.mu.Unlock()
	m.setState(s, contracts.RunnerSessionStateStateActive)

	offset := log.lastSeq
	for event := range run.Events() {
		if stamped, err := log.append(event, offset); err != nil {
			m.cfg.Logger.Warn("session.log", "sessionId", rec.SessionID, "error", err)
		} else {
			m.relayLive(key, rec.SessionID, stamped)
			m.track(s, stamped)
		}
		state := contracts.RunnerSessionStateStateActive
		switch {
		case event.Question != nil, event.PermissionRequest != nil:
			state = contracts.RunnerSessionStateStateWaiting
		case event.Result != nil:
			// The turn ended: the agent waits for its next message.
			state = contracts.RunnerSessionStateStateWaiting
			s.mu.Lock()
			if id := event.Result.EngineSessionId; id != nil && *id != "" {
				s.rec.EngineSessionID = *id
			}
			stopping := s.stopping
			s.mu.Unlock()
			if stopping {
				s.cancel()
			}
		}
		// A request answered while another still waits: the Session waits on.
		s.mu.Lock()
		if len(s.pending) > 0 {
			state = contracts.RunnerSessionStateStateWaiting
		}
		s.mu.Unlock()
		m.setState(s, state)
	}
	waitErr := run.Wait()
	s.mu.Lock()
	s.run = nil
	s.pending = nil
	stopping := s.stopping
	s.mu.Unlock()
	switch {
	case stopping:
		m.halt(s)
	case m.ctx.Err() != nil:
		m.drop(s) // the Runner stops: the Session is told after its restart
	case waitErr != nil:
		m.cfg.Logger.Warn("session.engine", "sessionId", rec.SessionID, "error", "the Moteur ended in error")
		m.finish(s, w, true, contracts.RunnerSessionStateOutcomeError, contracts.RunnerSessionStateErrorEngineFailed)
	default:
		m.finish(s, w, true, contracts.RunnerSessionStateOutcomeOk, "")
	}
}

// fail ends a Session that could not start, unless it was stopped meanwhile
// or the Runner stops. Only the step that failed is logged, never git's
// output nor a hook's.
func (m *Manager) fail(s *live, w Worktree, made bool, failure contracts.RunnerSessionStateError, step string, err error) {
	s.mu.Lock()
	stopping := s.stopping
	s.mu.Unlock()
	switch {
	case stopping:
		m.halt(s)
	case m.ctx.Err() != nil:
		m.drop(s)
	default:
		m.cfg.Logger.Warn("session.start", "sessionId", w.SessionID, "step", step, "error", errorKind(err))
		m.finish(s, w, made, contracts.RunnerSessionStateOutcomeError, failure)
	}
}

// failPrepare ends a Session whose worktree's preparation failed: its
// worktree cleaned and removed first, whatever comes next, then its log gets
// the `error` event that says why, relayed live, and it ends in
// `setup-failed`. A Session stopped meanwhile, even while that event waits
// on its relay, or a Runner that stops, has no worktree left: its resume
// makes it again, and prepares it.
func (m *Manager) failPrepare(s *live, w Worktree, err error) {
	m.remove(w)
	s.mu.Lock()
	stopping := s.stopping
	s.mu.Unlock()
	if !stopping && m.ctx.Err() == nil {
		m.logSetupError(w.SessionID, setupFailed(err))
	}
	m.fail(s, w, false, contracts.RunnerSessionStateErrorSetupFailed, "prepare", err)
}

// logSetupError appends to the Session's log one `error` event
// `setup-failed` with the preparation's message, and relays it live.
func (m *Manager) logSetupError(sessionID string, setup *SetupError) {
	log, err := openLog(sessionDir(m.cfg.Home, sessionID))
	if err != nil {
		m.cfg.Logger.Warn("session.log", "sessionId", sessionID, "error", errorKind(err))
		return
	}
	defer log.close()
	key := m.liveKeys(sessionID)
	event := contracts.EngineEvent{Error: &contracts.EngineEventError{Kind: contracts.EngineEventKindError, Seq: 1, At: time.Now().UTC(), Code: string(contracts.RunnerSessionStateErrorSetupFailed), Message: setup.Message()}}
	stamped, err := log.append(event, log.lastSeq)
	if err != nil {
		m.cfg.Logger.Warn("session.log", "sessionId", sessionID, "error", errorKind(err))
		return
	}
	m.relayLive(key, sessionID, stamped)
}

// remove cleans the worktree (the Hooks' Clean), then removes it: with
// contexts of their own, the Session's or the run's may be gone. The
// cleaning's failure is logged, and the worktree removed anyway.
func (m *Manager) remove(w Worktree) {
	ctx, cancel := context.WithTimeout(context.Background(), cleanBound)
	defer cancel()
	if err := m.cfg.Hooks.clean(ctx, withEnv(ctx, w)); err != nil {
		step := "session.clean"
		if w.SessionID == "" {
			step = "command.clean"
		}
		var clean *CleanError
		if errors.As(err, &clean) {
			attrs := []any{"sessionId", w.SessionID, "projectId", w.ProjectID, "error", clean.Reason}
			if clean.ExitCode != nil {
				attrs = append(attrs, "exitCode", *clean.ExitCode)
			}
			m.cfg.Logger.Warn(step, attrs...)
		} else {
			m.cfg.Logger.Warn(step, "sessionId", w.SessionID, "projectId", w.ProjectID, "error", errorKind(err))
		}
	}
	unlock := LockClone(w.Clone)
	removeWorktree(ctx, w.Clone, w.Dir)
	unlock()
}

// cleanBound is how long a worktree's cleaning and removal last at most:
// « Nettoyer le worktree »'s own 10 min, and git's removal after it.
const cleanBound = 11 * time.Minute

// withEnv is w with the CREWDECK_* variables of a Commande (command.run),
// those of a Session when w has none: its Projet, its branch, the
// worktree's HEAD; no Étape nor Ticket, which a Session's message does not
// name.
func withEnv(ctx context.Context, w Worktree) Worktree {
	if w.Env != nil {
		return w
	}
	head, _ := gitOutput(ctx, w.Dir, "rev-parse", "HEAD")
	w.Env = []string{
		"CREWDECK_PROJECT=" + w.ProjectID,
		"CREWDECK_STEP=",
		"CREWDECK_TICKET=",
		"CREWDECK_BRANCH=" + w.Branch,
		"CREWDECK_SHA=" + head,
	}
	return w
}

// finish ends the Session for good: Clean, then the worktree removed.
func (m *Manager) finish(s *live, w Worktree, made bool, outcome contracts.RunnerSessionStateOutcome, failure contracts.RunnerSessionStateError) {
	if made {
		m.remove(w)
	}
	m.end(s, outcome, failure)
}

func (m *Manager) end(s *live, outcome contracts.RunnerSessionStateOutcome, failure contracts.RunnerSessionStateError) {
	s.mu.Lock()
	s.alive = false
	s.rec.State, s.rec.Outcome, s.rec.Error = contracts.RunnerSessionStateStateEnded, outcome, failure
	s.mu.Unlock()
	m.save(s)
	m.report(s)
}

// halt is a stop done: the Session keeps its worktree and its Moteur's id;
// a resume asked meanwhile starts it again at once.
func (m *Manager) halt(s *live) {
	m.mu.Lock()
	closed := m.closed
	m.mu.Unlock()
	s.mu.Lock()
	if s.resume && !closed {
		run := m.arm(s, false)
		s.mu.Unlock()
		run()
		return
	}
	s.alive, s.stopping, s.resume = false, false, false
	s.rec.State = contracts.RunnerSessionStateStateStopped
	s.mu.Unlock()
	m.save(s)
	m.report(s)
}

// drop: the Runner stops, the Session's Moteur with it; its record stays.
func (m *Manager) drop(s *live) {
	s.mu.Lock()
	s.alive = false
	s.mu.Unlock()
	m.save(s)
}

// track keeps the requests of the run that wait, and tells the server when
// one waits (with the seq of its logged event) and when it was answered.
func (m *Manager) track(s *live, event contracts.EngineEvent) {
	s.mu.Lock()
	id := s.rec.SessionID
	var message any
	switch {
	case event.Question != nil:
		q := event.Question
		options := make([]string, len(q.Options))
		for i, o := range q.Options {
			options[i] = o.Label
		}
		s.pending[q.RequestId] = request{kind: contracts.RunnerSessionWaitingKindQuestion, options: options, multiple: q.Multiple}
		message = protocol.NewSessionWaiting(id, q.RequestId, contracts.RunnerSessionWaitingKindQuestion, q.Seq)
	case event.PermissionRequest != nil:
		p := event.PermissionRequest
		s.pending[p.RequestId] = request{kind: contracts.RunnerSessionWaitingKindPermission}
		message = protocol.NewSessionWaiting(id, p.RequestId, contracts.RunnerSessionWaitingKindPermission, p.Seq)
	case event.Answer != nil:
		delete(s.pending, event.Answer.RequestId)
		message = protocol.NewSessionAnswered(id, event.Answer.RequestId)
	}
	s.mu.Unlock()
	if message != nil {
		m.sendMessage(id, message)
	}
}

// setState records and reports a new state; the same state again is not
// reported.
func (m *Manager) setState(s *live, state contracts.RunnerSessionStateState) {
	s.mu.Lock()
	changed := s.rec.State != state
	s.rec.State = state
	s.mu.Unlock()
	if !changed && state != contracts.RunnerSessionStateStateStarting {
		return
	}
	m.save(s)
	m.report(s)
}

func (m *Manager) save(s *live) {
	s.mu.Lock()
	rec := s.rec
	s.mu.Unlock()
	if err := rec.save(m.cfg.Home); err != nil {
		m.cfg.Logger.Warn("session.save", "sessionId", rec.SessionID, "error", errorKind(err))
	}
}

func (m *Manager) report(s *live) {
	s.mu.Lock()
	rec := s.rec
	s.mu.Unlock()
	m.send(protocol.NewSessionState(rec.SessionID, rec.State, rec.Outcome, rec.Error, rec.EngineSessionID))
}

func (m *Manager) send(message contracts.RunnerSessionState) {
	m.sendMessage(message.SessionId, message)
}

func (m *Manager) sendMessage(sessionID string, message any) {
	if m.cfg.Send == nil {
		return
	}
	ctx, cancel := context.WithTimeout(m.ctx, 10*time.Second)
	defer cancel()
	if err := m.cfg.Send(ctx, message); err != nil && !errors.Is(err, protocol.ErrNotConnected) && m.ctx.Err() == nil {
		m.cfg.Logger.Warn("session.state", "sessionId", sessionID, "error", err)
	}
}

// errorKind names an error without its text, which may hold a path or a
// command's output.
func errorKind(err error) string {
	var gitErr *gitError
	var pathErr *os.PathError
	switch {
	case errors.As(err, &gitErr):
		return "git " + gitErr.command
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return "canceled"
	case errors.As(err, &pathErr):
		return pathErr.Op + " " + filepath.Base(pathErr.Path)
	}
	return "failed"
}
