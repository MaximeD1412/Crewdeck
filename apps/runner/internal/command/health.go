package command

import (
	"context"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
)

// The health address of a Commande (RUNNER-19, ADR 0013 « Verdict »): a
// Commande that starts a local server never exits, so a `GET` of its
// address says whether it runs. Asked at its start, then every second: the
// first 2xx while its process runs passes the run (`healthy`) and keeps the
// process as a service of the Runner; a 2xx after it exited 0 passes it with
// no service (a command that daemonizes); an exit with an error first fails
// it (`exited`); 120 s without a 2xx kill its group (`health-timeout`). The
// 30 min of Timeout do not apply.
const (
	// HealthWindow is how long a run has for its address to answer 2xx.
	HealthWindow = 120 * time.Second
	// healthEvery is how often the address is asked.
	healthEvery = time.Second
	// healthTimeout is how long one GET has.
	healthTimeout = 2 * time.Second
	// healthBodyMax is the most of an answer's body read.
	healthBodyMax = 1024
)

var healthClient = func() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DisableKeepAlives = true // a server about to be stopped keeps no connection of ours
	return &http.Client{
		Timeout:   healthTimeout,
		Transport: transport,
		// No redirect followed: the address given is the one that must
		// answer 2xx, its 3xx is its answer, and not a healthy one (a
		// redirect to a login page that answers 200 says nothing of it).
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}()

// healthy is closed at the first 2xx of url, asked now then every
// healthEvery until ctx ends.
func healthy(ctx context.Context, url string) <-chan struct{} {
	ok := make(chan struct{})
	go func() {
		ticker := time.NewTicker(healthEvery)
		defer ticker.Stop()
		for {
			if answers(ctx, url) {
				close(ok)
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return ok
}

// answers says whether a GET of url answers 2xx.
func answers(ctx context.Context, url string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	res, err := healthClient.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	_, _ = io.CopyN(io.Discard, res.Body, healthBodyMax)
	return res.StatusCode >= 200 && res.StatusCode <= 299
}

// awaitHealth judges a started run by its health address. kept says the
// process became a service: its place and its output are then the
// service's, released when it ends.
func (r *Runner) awaitHealth(message contracts.RunnerCommandRun, l *live, cmd *exec.Cmd, exited <-chan struct{}, out *output, place *session.Place, url string) (reason contracts.RunnerCommandVerdictReason, exitCode *int, kept bool) {
	ctx, cancel := context.WithCancel(l.ctx)
	defer cancel()
	ok := healthy(ctx, url)
	window := r.cfg.After(HealthWindow)
	waiting := exited
	for {
		select {
		case <-ok:
			select {
			case <-exited:
				return r.exitedHealthy(cmd, out)
			default:
			}
			reason, kept := r.keep(message, cmd, exited, out, place)
			return reason, nil, kept
		case <-waiting:
			// Exited 0: its address may answer still (it daemonized).
			waiting = nil
			if code := exitCodeOf(cmd); code == nil || *code != 0 {
				out.flush()
				return contracts.RunnerCommandVerdictReasonExited, code, false
			}
		case <-window:
			r.kill(cmd, exited)
			out.flush()
			return contracts.RunnerCommandVerdictReasonHealthTimeout, nil, false
		case <-l.ctx.Done():
			r.kill(cmd, exited)
			out.flush()
			return contracts.RunnerCommandVerdictReasonStopped, nil, false
		}
	}
}

// exitedHealthy is the verdict of an address that answered once its
// process had exited: healthy when it exited 0, no service kept.
func (r *Runner) exitedHealthy(cmd *exec.Cmd, out *output) (contracts.RunnerCommandVerdictReason, *int, bool) {
	out.flush()
	code := exitCodeOf(cmd)
	if code == nil || *code != 0 {
		return contracts.RunnerCommandVerdictReasonExited, code, false
	}
	return contracts.RunnerCommandVerdictReasonHealthy, code, false
}

// keep makes the run's live process a service: its pid file written, its
// output going on to its own log, its place held until it ends. A service
// that cannot be recorded is not kept: its group is killed.
func (r *Runner) keep(message contracts.RunnerCommandRun, cmd *exec.Cmd, exited <-chan struct{}, out *output, place *session.Place) (contracts.RunnerCommandVerdictReason, bool) {
	key := serviceKey{projectID: message.ProjectId, commandID: message.CommandId}
	pid := cmd.Process.Pid
	logFile, err := r.recordService(key, pid, message.RunId)
	if err != nil {
		r.cfg.Logger.Warn("command.service", "runId", message.RunId, "error", "not recorded")
		r.kill(cmd, exited)
		out.flush()
		return contracts.RunnerCommandVerdictReasonSpawnFailed, false
	}
	out.flush()
	out.handOver(logFile, "Service démarré (pid "+strconv.Itoa(pid)+").\n")
	done := r.track(key, message.RunId)
	go func() {
		<-exited
		// What its process left in its group goes with it: a child the
		// Runner would track no more, holding its port.
		if err := stopGroup(pid, r.cfg.After); err != nil {
			r.cfg.Logger.Warn("command.service", "runId", message.RunId, "error", "group not stopped")
		}
		out.flush()
		out.close()
		place.Release()
		r.untrack(key, message.RunId)
		close(done)
	}()
	r.cfg.Logger.Info("command.service", "runId", message.RunId, "pid", pid)
	return contracts.RunnerCommandVerdictReasonHealthy, true
}

// openServiceLog replaces the service's log by an empty one, mode 600.
func openServiceLog(path string) (*os.File, error) {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	return os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
}
