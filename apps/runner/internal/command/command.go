// Package command runs the Commandes the server asks for (RUNNER-18, ADR
// 0013, ADR 0011 « What the server reads of a Process »): the Runner opens
// the version's sealed part with its vault, for the Projet the message
// names, and runs only the text it opened, where the opened part says (risk
// SEC-11). The message gives ids and the Ticket under judgement, nothing
// that runs.
//
// A run is `$SHELL -lc '<run>'` as the Pilote, in its own process group, one
// per Projet and Commande, killed after 30 min or on `command.stop`. Its
// output is logged in `~/.crewdeck/commands/<runId>.log` for 30 days and
// relayed sealed for the Appareils as a Session's, chunk by chunk as it is
// read; its verdict carries figures only. It runs in the Ticket's worktree,
// or in the Projet's integration checkout
// `~/.crewdeck/worktrees/<projectId>/.integration`, a name no branch's
// worktree takes.
//
// The Runner's folder (~/.crewdeck):
//
//	commands/<runId>.log  the run's output, one JSON line per chunk (mode 600)
//	commands/<runId>.key  the run's relay key (mode 600)
package command

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/relay"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
)

const (
	// Timeout is how long a run lasts before its group is killed (`timeout`).
	Timeout = 30 * time.Minute
	// KillGrace is how long a group has between SIGTERM and SIGKILL.
	KillGrace = 10 * time.Second
	// LogAge is how long a run's output stays on the Runner.
	LogAge = 30 * 24 * time.Hour
	// sweepEvery is how often the logs past LogAge are removed.
	sweepEvery = 24 * time.Hour
)

// Vault opens the sealed part of a version (keys.Vault).
type Vault interface {
	OpenItem(item keys.SealedItem, aad []byte) ([]byte, error)
}

// Places gives the folders the runs run in (session.Manager): the Ticket's
// worktree, the Projet's integration checkout, each held until released.
type Places interface {
	TicketWorktree(ctx context.Context, projectID, owner, name, branch, sha string) (*session.Place, error)
	IntegrationCheckout(ctx context.Context, projectID, owner, name, integrationBranch, sha string) (*session.Place, error)
}

// Config is what the runs run with.
type Config struct {
	// Home is the Runner's folder, ~/.crewdeck.
	Home   string
	Vault  Vault
	Places Places
	// Keys seal the relay of the output; nil, nothing is relayed.
	Keys *relay.Keys
	// Send sends a message to the server (protocol.ErrNotConnected while
	// offline: the message is lost).
	Send   func(ctx context.Context, message any) error
	Logger *slog.Logger
	// After is the clock of the timeout and the kill grace; nil, time.After.
	After func(time.Duration) <-chan time.Time
}

// Runner runs the Commandes: one goroutine per run.
type Runner struct {
	cfg    Config
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
	once   sync.Once

	mu     sync.Mutex
	closed bool
	// busy are the Commandes running, by Projet and Commande.
	busy map[string]bool
	runs map[string]*live
}

// live is a run under way.
type live struct {
	// ctx ends with a stop, or the runner's Close.
	ctx    context.Context
	once   sync.Once
	stop   chan struct{}
	cancel context.CancelFunc
}

func (l *live) halt() {
	l.once.Do(func() {
		close(l.stop)
		l.cancel()
	})
}

var uuid = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// New is the runner of the Commandes kept under cfg.Home; it removes the
// logs past LogAge now, then every 24 h until Close.
func New(cfg Config) (*Runner, error) {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.After == nil {
		cfg.After = time.After
	}
	if cfg.Send == nil {
		cfg.Send = func(context.Context, any) error { return protocol.ErrNotConnected }
	}
	dir := commandsDir(cfg.Home)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	r := &Runner{cfg: cfg, ctx: ctx, cancel: cancel, busy: map[string]bool{}, runs: map[string]*live{}}
	r.Sweep()
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		ticker := time.NewTicker(sweepEvery)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				r.Sweep()
			}
		}
	}()
	return r, nil
}

// Register makes the client hand the server's command.run, command.stop and
// command.replay to the runner.
func (r *Runner) Register(client *protocol.Client) {
	protocol.On(client, protocol.TypeCommandRun, func(_ context.Context, message contracts.RunnerCommandRun) error {
		r.Run(message)
		return nil
	})
	protocol.On(client, protocol.TypeCommandStop, func(_ context.Context, message contracts.RunnerCommandStop) error {
		r.Stop(message.RunId)
		return nil
	})
	protocol.On(client, protocol.TypeCommandReplay, func(_ context.Context, message contracts.RunnerCommandReplay) error {
		r.ReplayTo(message)
		return nil
	})
}

// Close stops the runs under way, their groups killed, and waits for them.
func (r *Runner) Close() {
	r.once.Do(func() {
		r.mu.Lock()
		r.closed = true
		r.mu.Unlock()
		r.cancel()
		r.wg.Wait()
	})
}

// Run runs the Commande in the background; its verdict ends it, even when
// it never started. The run is known before Run returns: a command.stop
// that follows it, even while its sealed part is being opened, stops it.
func (r *Runner) Run(message contracts.RunnerCommandRun) {
	if !uuid.MatchString(message.RunId) {
		return // nothing to name it by
	}
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return
	}
	var l *live
	if r.runs[message.RunId] == nil {
		ctx, cancel := context.WithCancel(r.ctx)
		l = &live{ctx: ctx, stop: make(chan struct{}), cancel: cancel}
		r.runs[message.RunId] = l
	}
	r.wg.Add(1)
	r.mu.Unlock()
	go func() {
		defer r.wg.Done()
		r.execute(message, l)
	}()
}

// forget ends the run l: Stop no longer finds it.
func (r *Runner) forget(runID string, l *live) {
	r.mu.Lock()
	if r.runs[runID] == l {
		delete(r.runs, runID)
	}
	r.mu.Unlock()
	l.cancel()
}

// Stop stops the run: its group gets SIGTERM, then SIGKILL after KillGrace.
func (r *Runner) Stop(runID string) {
	r.mu.Lock()
	l := r.runs[runID]
	r.mu.Unlock()
	if l != nil {
		l.halt()
	}
}

// claim makes the run the one of its Commande, false when that Commande is
// already under way.
func (r *Runner) claim(message contracts.RunnerCommandRun) (func(), bool) {
	busyKey := message.ProjectId + "/" + message.CommandId
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.busy[busyKey] {
		return nil, false
	}
	r.busy[busyKey] = true
	return func() {
		r.mu.Lock()
		delete(r.busy, busyKey)
		r.mu.Unlock()
	}, true
}

func (r *Runner) send(runID, step string, message any) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.ctx), 10*time.Second)
	defer cancel()
	if err := r.cfg.Send(ctx, message); err != nil && !errors.Is(err, protocol.ErrNotConnected) {
		r.cfg.Logger.Warn("command."+step, "runId", runID, "error", "not sent")
	}
}

func commandsDir(home string) string {
	return filepath.Join(home, "commands")
}
