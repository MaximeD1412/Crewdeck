package session

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
)

// Worktree is a worktree the Runner made, for a Session or a Commande's run:
// its folder, its branch, the clone it belongs to, and what the Hooks prepare
// and clean it with.
type Worktree struct {
	// SessionID is the Session's; empty for a Commande's run.
	SessionID string
	ProjectID string
	Dir       string
	Branch    string
	Clone     string
	Preparation
	// scratch is a scratch Session's folder: no clone, no Hooks.
	scratch bool
}

// SealedCommands is the Projet's worktree Commandes « Préparer le worktree »
// and « Nettoyer le worktree », base64url, additional data
// `settings:<projectId>` (RUNNER-20): as the message gave them, Key their
// item key sealed under the vault key; or as the Runner keeps them once the
// Hooks' Keep opened that item key, ItemKey it and Key empty. A rotation of
// the vault rewraps an item's key, never its ciphertext: the copy kept (a
// Session's session.json, a run's worktree) still opens after one, even
// after a restart.
type SealedCommands struct {
	Key        string `json:"key,omitempty"`
	Ciphertext string `json:"ciphertext"`
	ItemKey    string `json:"itemKey,omitempty"`
}

// Preparation is what the Hooks run around a worktree with.
type Preparation struct {
	// Commands are the Projet's sealed worktree Commandes; nil when the
	// Pilote set neither: nothing runs.
	Commands *SealedCommands
	// Env are the CREWDECK_* variables of what the worktree is made for.
	Env []string
	// Stdout and Stderr get the Commandes' output: a Session's
	// `prepare.log`, a run's own log.
	Stdout, Stderr io.Writer
}

// SetupError is a preparation that failed: Summary says how, Tail is the
// end of its output. A Session's log gets them as one `error` event
// (`setup-failed`); a run, `setup-failed`.
type SetupError struct {
	Summary string
	Tail    string
}

func (e *SetupError) Error() string { return "session: the worktree's preparation failed" }

// Message is the Summary, then the Tail on the lines after it.
func (e *SetupError) Message() string {
	if e.Tail == "" {
		return e.Summary
	}
	return e.Summary + "\n" + e.Tail
}

// setupFailed is err as a SetupError: a hook's other error gets a summary of
// its own.
func setupFailed(err error) *SetupError {
	var setup *SetupError
	if errors.As(err, &setup) {
		return setup
	}
	return &SetupError{Summary: "Préparer le worktree a échoué"}
}

// Hooks run around each worktree the Runner makes (RUNNER-20 fills them
// with the Projet's Commandes « Préparer le worktree » and « Nettoyer le
// worktree », command.WorktreeHooks); a nil hook runs nothing. Prepare runs
// once the worktree is made, before the Moteur starts or the run's own
// command: its error ends the Session in `setup-failed` (a SetupError says
// why in its log), or the run. Clean runs before the worktree is removed:
// its error is logged, and the worktree removed anyway. A worktree kept (a
// stopped Session's) is not prepared again. Nothing of the worktree itself
// runs (no `.process.json`, ADR 0011).
//
// Keep turns the Commandes a message gave into the copy the Runner keeps for
// the worktree's whole life, when Start takes the Session and before a run's
// worktree is made; what it cannot open it gives back as it is.
type Hooks struct {
	Keep    func(projectID string, commands SealedCommands) SealedCommands
	Prepare func(ctx context.Context, w Worktree) error
	Clean   func(ctx context.Context, w Worktree) error
}

func (h Hooks) keep(projectID string, commands *SealedCommands) *SealedCommands {
	if h.Keep == nil || commands == nil {
		return commands
	}
	kept := h.Keep(projectID, *commands)
	return &kept
}

func (h Hooks) prepare(ctx context.Context, w Worktree) error {
	if h.Prepare == nil {
		return nil
	}
	return h.Prepare(ctx, w)
}

func (h Hooks) clean(ctx context.Context, w Worktree) error {
	if h.Clean == nil {
		return nil
	}
	return h.Clean(ctx, w)
}

// prepareLog is `<home>/sessions/<id>/prepare.log`, mode 600: the output of
// the Session's worktree Commandes, appended, opened at each write so that
// a Session whose Commandes say nothing has none.
type prepareLog struct{ path string }

func (p prepareLog) Write(b []byte) (int, error) {
	if err := os.MkdirAll(filepath.Dir(p.path), 0o700); err != nil {
		return 0, err
	}
	file, err := os.OpenFile(p.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	return file.Write(b)
}

// PrepareLogFile is the name of a Session's prepare.log in its folder.
const PrepareLogFile = "prepare.log"

// CleanError is a cleaning that failed: its exit code when it exited by
// itself, Reason how it ended otherwise (`timeout`, `signal`,
// `sealed-invalid`). The Runner's log gets them, never its output.
type CleanError struct {
	ExitCode *int
	Reason   string
}

func (e *CleanError) Error() string { return "session: the worktree's cleaning failed" }
