// Package engine is the one interface the Runner drives every Moteur through
// (ADR 0004): an adapter per Moteur (claude/, codex/) turns its provider's
// stream into the normalised events of packages/contracts/src/runner/events.ts,
// the provider's own event kept beside each one in `raw`. Tests never run a
// real Moteur: enginetest replays the recorded streams through the fake
// binary of fake/cmd/fake-engine, and fake/ is an in-process Engine for the
// Sessions and the fake Runner.
package engine

import (
	"context"
	"errors"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// Engine is a Moteur's adapter.
type Engine interface {
	ID() contracts.EngineId
	// Capabilities says what the Moteur can do on this machine: installed,
	// its version and whether the adapter knows it, the Compte IA, the models.
	Capabilities(ctx context.Context) (contracts.EngineCapabilities, error)
	// Start starts a new Session of the Moteur, its first message
	// InitialPrompt.
	Start(ctx context.Context, opts StartOptions) (Run, error)
	// Resume starts the Moteur again on the Session it knows as
	// opts.EngineSessionID (the `engineSessionId` of a `result`).
	Resume(ctx context.Context, opts ResumeOptions) (Run, error)
}

// Run is a Moteur running a Session.
type Run interface {
	// Events gives the normalised events in order, their seq 1, 2, …; it is
	// closed when the run ends.
	Events() <-chan contracts.EngineEvent
	// Send sends a message of the Pilote (or of the Runner) to the agent.
	Send(ctx context.Context, text string) error
	// Answer answers the `question` or the `permission-request` of requestID.
	Answer(ctx context.Context, requestID string, answer Answer) error
	// Interrupt stops the turn in progress: it ends with a `result` whose
	// status is `interrupted`.
	Interrupt(ctx context.Context) error
	// Wait waits for the run to end, and says why when it is not a normal end.
	Wait() error
}

// PermissionMode is how the Moteur asks before acting: `auto` sends its
// requests to the Pilote (as `permission-request`), `bypass` asks nothing
// (the Rôles that work in a worktree, ADR 0004).
type PermissionMode string

const (
	PermissionAuto   PermissionMode = "auto"
	PermissionBypass PermissionMode = "bypass"
)

// StartOptions are what a Session starts with.
type StartOptions struct {
	// Dir is the folder the Moteur works in (the Session's worktree).
	Dir string
	// Model is the provider's id of the model (`claude-opus-5-5`).
	Model string
	// Role is the Rôle of the agent, as the server names it.
	Role           string
	PermissionMode PermissionMode
	// Env is added to the Moteur's environment (`KEY=value`).
	Env []string
	// SkillsDir holds the official Skills the Session mounts.
	SkillsDir     string
	InitialPrompt string
	// BinaryPath is the Moteur's executable; empty, the adapter's own (found
	// on PATH). The tests set the fake binary here.
	BinaryPath string
}

// ResumeOptions are a StartOptions on a Session the Moteur already knows.
type ResumeOptions struct {
	StartOptions
	EngineSessionID string
}

// Answer is the Pilote's answer to a request: Allow for a
// `permission-request`, the labels of the options chosen (Options) or a
// text of their own (Text) for a `question`.
type Answer struct {
	Allow   *bool
	Options []string
	Text    string
}

// ErrRunEnded is what Send, Answer and Interrupt return once the run ended.
var ErrRunEnded = errors.New("engine: the run has ended")

// ErrNoSuchRequest is what Answer returns for a request that is not pending.
var ErrNoSuchRequest = errors.New("engine: no such pending request")
