package command

import (
	"context"
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
func (r *Runner) execute(message contracts.RunnerCommandRun) {
	began := time.Now()
	reason, exitCode := r.attempt(message)
	duration := time.Since(began)
	r.cfg.Logger.Info("command.verdict", "runId", message.RunId, "reason", string(reason), "durationMs", duration.Milliseconds())
	r.send(message.RunId, "verdict", protocol.NewCommandVerdict(message.RunId, reason, exitCode, duration))
}

// attempt runs the Commande, and gives why it ended.
func (r *Runner) attempt(message contracts.RunnerCommandRun) (contracts.RunnerCommandVerdictReason, *int) {
	command, err := openSealed(r.cfg.Vault, message)
	if err != nil {
		return contracts.RunnerCommandVerdictReasonSealedInvalid, nil
	}
	l, done, ok := r.claim(message)
	if !ok {
		return contracts.RunnerCommandVerdictReasonBusy, nil
	}
	defer done()

	place, err := r.place(l.ctx, message, command.Where)
	if err != nil {
		if l.ctx.Err() != nil {
			return contracts.RunnerCommandVerdictReasonStopped, nil
		}
		r.cfg.Logger.Warn("command.place", "runId", message.RunId, "where", string(command.Where), "error", "unavailable")
		return contracts.RunnerCommandVerdictReasonPlaceUnavailable, nil
	}
	defer place.Release()
	if l.ctx.Err() != nil {
		return contracts.RunnerCommandVerdictReasonStopped, nil
	}

	out, err := r.openOutput(message.RunId)
	if err != nil {
		r.cfg.Logger.Warn("command.log", "runId", message.RunId, "error", "not opened")
		return contracts.RunnerCommandVerdictReasonSpawnFailed, nil
	}
	defer out.close()
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	cmd := exec.Command(shell, "-lc", command.Run)
	cmd.Dir = place.Dir
	cmd.Env = append(os.Environ(), environment(message)...)
	cmd.Stdout = out.stream(contracts.CommandOutputChunkStreamStdout)
	cmd.Stderr = out.stream(contracts.CommandOutputChunkStreamStderr)
	// Stdin nil is /dev/null. Its own group, so that a kill reaches its children.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.WaitDelay = waitDelay
	if err := cmd.Start(); err != nil {
		r.cfg.Logger.Warn("command.spawn", "runId", message.RunId, "error", "not started")
		return contracts.RunnerCommandVerdictReasonSpawnFailed, nil
	}
	r.send(message.RunId, "started", protocol.NewCommandStarted(message.RunId))
	exited := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(exited)
	}()

	reason := contracts.RunnerCommandVerdictReasonExited
	select {
	case <-exited:
	case <-r.cfg.After(Timeout):
		reason = contracts.RunnerCommandVerdictReasonTimeout
	case <-l.ctx.Done():
		reason = contracts.RunnerCommandVerdictReasonStopped
	}
	if reason != contracts.RunnerCommandVerdictReasonExited {
		group := -cmd.Process.Pid
		_ = syscall.Kill(group, syscall.SIGTERM)
		select {
		case <-exited:
		case <-r.cfg.After(KillGrace):
		}
		// What ignored the SIGTERM, the shell or a child it left.
		_ = syscall.Kill(group, syscall.SIGKILL)
		<-exited
		out.flush()
		return reason, nil
	}
	out.flush()
	var exitCode *int
	if state := cmd.ProcessState; state != nil && state.Exited() {
		code := state.ExitCode()
		exitCode = &code
	}
	return reason, exitCode
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
func (r *Runner) place(ctx context.Context, message contracts.RunnerCommandRun, where contracts.ProcessSealedCommandsValueWhere) (*session.Place, error) {
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
	return r.cfg.Places.TicketWorktree(ctx, message.ProjectId, owner, name, branch, sha)
}
