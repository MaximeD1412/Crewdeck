package command

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
)

// waitDelay is how long a run's exit waits for the processes it left that
// still hold its output.
const waitDelay = 2 * time.Second

// execute runs the Commande and sends its verdict, whatever ends it: once
// its place and its claim are released, so that the run the verdict lets the
// server ask for next finds them free.
func (r *Runner) execute(message contracts.RunnerCommandRun, l *live) {
	began := time.Now()
	reason, exitCode := contracts.RunnerCommandVerdictReasonBusy, (*int)(nil)
	// l nil: a run of the same runId is under way.
	if l != nil {
		reason, exitCode = r.attempt(message, l)
		r.forget(message.RunId, l)
	}
	duration := time.Since(began)
	r.cfg.Logger.Info("command.verdict", "runId", message.RunId, "reason", string(reason), "durationMs", duration.Milliseconds())
	r.send(message.RunId, "verdict", protocol.NewCommandVerdict(message.RunId, reason, exitCode, duration))
}

// attempt runs the Commande, and gives why it ended.
func (r *Runner) attempt(message contracts.RunnerCommandRun, l *live) (contracts.RunnerCommandVerdictReason, *int) {
	command, err := openSealed(r.cfg.Vault, message)
	if err != nil {
		return contracts.RunnerCommandVerdictReasonSealedInvalid, nil
	}
	if l.ctx.Err() != nil {
		return contracts.RunnerCommandVerdictReasonStopped, nil
	}
	done, ok := r.claim(message)
	if !ok {
		return contracts.RunnerCommandVerdictReasonBusy, nil
	}
	defer done()

	// Its service, if it runs, first: a stop that fails runs nothing new.
	if err := r.stopService(serviceKey{projectID: message.ProjectId, commandID: message.CommandId}); err != nil {
		r.cfg.Logger.Warn("command.service", "runId", message.RunId, "error", "not stopped")
		return contracts.RunnerCommandVerdictReasonSpawnFailed, nil
	}

	// Its log first: what prepares its worktree goes in it, before its own output.
	out, err := r.openOutput(message.RunId)
	if err != nil {
		r.cfg.Logger.Warn("command.log", "runId", message.RunId, "error", "not opened")
		return contracts.RunnerCommandVerdictReasonSpawnFailed, nil
	}
	// A service kept holds its place and its output until it ends.
	kept := false
	defer func() {
		if !kept {
			out.close()
		}
	}()
	stdout := out.stream(contracts.CommandOutputChunkStreamStdout)
	stderr := out.stream(contracts.CommandOutputChunkStreamStderr)
	prep := session.Preparation{Commands: worktreeSealed(message.WorktreeCommands), Env: environment(message), Stdout: stdout, Stderr: stderr}

	place, err := r.place(l.ctx, message, command.Where, prep)
	out.flush()
	if err != nil {
		var setup *session.SetupError
		switch {
		case l.ctx.Err() != nil:
			return contracts.RunnerCommandVerdictReasonStopped, nil
		case errors.As(err, &setup):
			r.cfg.Logger.Warn("command.place", "runId", message.RunId, "where", string(command.Where), "error", "setup-failed")
			_, _ = stderr.Write([]byte(setup.Summary + "\n"))
			out.flush()
			return contracts.RunnerCommandVerdictReasonSetupFailed, nil
		}
		r.cfg.Logger.Warn("command.place", "runId", message.RunId, "where", string(command.Where), "error", "unavailable")
		return contracts.RunnerCommandVerdictReasonPlaceUnavailable, nil
	}
	// Released before its log closes: what cleans its worktree goes in it.
	defer func() {
		if !kept {
			place.Release()
			out.flush()
		}
	}()
	if l.ctx.Err() != nil {
		return contracts.RunnerCommandVerdictReasonStopped, nil
	}

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	cmd := exec.Command(shell, "-lc", command.Run)
	cmd.Dir = place.Dir
	cmd.Env = append(os.Environ(), environment(message)...)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	// Stdin nil is /dev/null. Its own group, so that a kill reaches its children.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.WaitDelay = waitDelay
	if err := cmd.Start(); err != nil {
		r.cfg.Logger.Warn("command.spawn", "runId", message.RunId, "error", "not started")
		return contracts.RunnerCommandVerdictReasonSpawnFailed, nil
	}
	r.send(message.RunId, "started", protocol.NewCommandStarted(message.RunId))
	proc := lead(cmd)

	if command.HealthURL != "" {
		var (
			reason   contracts.RunnerCommandVerdictReason
			exitCode *int
		)
		reason, exitCode, kept = r.awaitHealth(message, l, proc, out, place, command.HealthURL)
		return reason, exitCode
	}

	reason := contracts.RunnerCommandVerdictReasonExited
	select {
	case <-proc.left:
	case <-r.cfg.After(Timeout):
		reason = contracts.RunnerCommandVerdictReasonTimeout
	case <-l.ctx.Done():
		reason = contracts.RunnerCommandVerdictReasonStopped
	}
	if reason != contracts.RunnerCommandVerdictReasonExited {
		r.kill(proc)
		out.flush()
		return reason, nil
	}
	proc.reap()
	out.flush()
	return reason, proc.code
}

// kill sends the run's group SIGTERM, then SIGKILL after KillGrace, and
// reaps its process once it exited: its group signalled while its pid is
// still its own.
func (r *Runner) kill(proc *leader) {
	killGroup(proc, r.cfg.After)
}

// killGroup is the kill of a run's group on the clock after.
func killGroup(proc *leader, after func(time.Duration) <-chan time.Time) {
	_ = proc.signal(syscall.SIGTERM)
	select {
	case <-proc.left:
	case <-after(KillGrace):
	}
	// What ignored the SIGTERM, the shell or a child it left.
	_ = proc.signal(syscall.SIGKILL)
	proc.reap()
}

// exitCodeOf is the exit code of the run's process once it exited by
// itself, nil when a signal ended it.
func exitCodeOf(cmd *exec.Cmd) *int {
	if state := cmd.ProcessState; state != nil && state.Exited() {
		code := state.ExitCode()
		return &code
	}
	return nil
}

// environment is what the run gets beside the Runner's own environment:
// the CREWDECK_* variables, empty when the Ticket gives none.
func environment(message contracts.RunnerCommandRun) []string {
	ticket := ""
	if n, ok := message.Ref.Ticket.(float64); ok {
		ticket = strconv.Itoa(int(n))
	}
	return []string{
		"CREWDECK_PROJECT=" + message.ProjectId,
		"CREWDECK_STEP=" + message.Ref.StepId,
		"CREWDECK_TICKET=" + ticket,
		"CREWDECK_BRANCH=" + text(message.Ref.Branch),
		"CREWDECK_SHA=" + text(message.Ref.Sha),
	}
}

func text(value any) string {
	s, _ := value.(string)
	return s
}

// place is the folder the opened Commande runs in: the Ticket's worktree at
// its SHA, or the Projet's integration checkout. An origin the Runner has
// no clone for, or a Ticket without its branch and SHA, has none.
func (r *Runner) place(ctx context.Context, message contracts.RunnerCommandRun, where contracts.ProcessSealedCommandsValueWhere, prep session.Preparation) (*session.Place, error) {
	if r.cfg.Places == nil || message.Origin.Kind != contracts.RunnerCommandRunOriginKindGithub {
		return nil, session.ErrPlaceUnavailable
	}
	owner, name := message.Origin.Owner, message.Origin.Name
	sha := text(message.Ref.Sha)
	if where == contracts.ProcessSealedCommandsValueWhereProject {
		return r.cfg.Places.IntegrationCheckout(ctx, message.ProjectId, owner, name, message.IntegrationBranch, sha)
	}
	branch := text(message.Ref.Branch)
	if branch == "" || sha == "" {
		return nil, session.ErrPlaceUnavailable
	}
	return r.cfg.Places.TicketWorktree(ctx, message.ProjectId, owner, name, branch, sha, prep)
}

// worktreeSealed is the run's worktree Commandes as the message gave them,
// nil when the Pilote set neither.
func worktreeSealed(given *contracts.RunnerCommandRunWorktreeCommands) *session.SealedCommands {
	if given == nil {
		return nil
	}
	return &session.SealedCommands{Key: given.Key, Ciphertext: given.Ciphertext}
}
