package command

import (
	"errors"
	"os/exec"
	"sync"
	"syscall"
	"time"
)

// leader is a run's process, the leader of its own group. Its exit is
// noticed without reaping it: while its zombie stands, the OS gives its pid
// to no other process, so its group's id is still its group's, and a signal
// to it reaches only what the run left there. It is reaped once nothing will
// be signalled any more.
type leader struct {
	cmd  *exec.Cmd
	pid  int
	left chan struct{} // it exited, its zombie unreaped
	code *int          // its exit code, nil when a signal ended it; set before left closes

	mu     sync.Mutex
	reaped bool
}

// lead watches cmd's process, started.
func lead(cmd *exec.Cmd) *leader {
	l := &leader{cmd: cmd, pid: cmd.Process.Pid, left: make(chan struct{})}
	go func() {
		code, err := watchExit(l.pid)
		if err != nil {
			// Not watched (a kqueue refused, say): it is looked at until it
			// is a zombie, whose exit status the OS gives without reaping it.
			var known bool
			if code, known = l.pollExit(); !known {
				// Its status unread: reaped at once, its group signalled no more.
				l.mu.Lock()
				l.reaped = true
				l.mu.Unlock()
				_ = cmd.Wait()
				code = exitCodeOf(cmd)
			}
		}
		l.code = code
		close(l.left)
	}()
	return l
}

// pollExit waits, every pollEvery, until it is a zombie: its exit code, nil
// when a signal ended it; known says the OS gave it.
func (l *leader) pollExit() (code *int, known bool) {
	for {
		dead, status, known := zombie(l.pid)
		if dead {
			if !known {
				return nil, false
			}
			if status.Exited() {
				c := status.ExitStatus()
				return &c, true
			}
			return nil, true
		}
		time.Sleep(pollInterval())
	}
}

// pollEvery is how often an unwatched process is looked at.
const pollEvery = 100 * time.Millisecond

// hasLeft says whether it exited, noticed or not yet: a zombie has.
func (l *leader) hasLeft() bool {
	select {
	case <-l.left:
		return true
	default:
		dead, _, _ := zombie(l.pid)
		return dead
	}
}

// reap waits for it to exit, then reaps it and waits for its output to be
// copied.
func (l *leader) reap() {
	<-l.left
	l.mu.Lock()
	reaped := l.reaped
	l.reaped = true
	l.mu.Unlock()
	if !reaped {
		_ = l.cmd.Wait()
	}
}

// signal sends sig to its group; once it is reaped, nothing: its group's id
// may then be another's.
func (l *leader) signal(sig syscall.Signal) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.reaped {
		return nil
	}
	if err := sendSignal(-l.pid, sig); err != nil && !errors.Is(err, syscall.ESRCH) {
		return err
	}
	return nil
}

// stopGroup stops what lives in its group, itself included: SIGTERM, SIGKILL
// after KillGrace, and its group then holds no process but a zombie. Its
// zombie is not reaped.
func (l *leader) stopGroup(after func(time.Duration) <-chan time.Time) error {
	if !groupLives(l.pid) {
		return nil
	}
	if err := l.signal(syscall.SIGTERM); err != nil {
		return err
	}
	if l.emptied(after(KillGrace)) {
		return nil
	}
	if err := l.signal(syscall.SIGKILL); err != nil {
		return err
	}
	if l.emptied(time.After(killWait)) {
		return nil
	}
	return errNotStopped
}

// emptied waits until its group holds no live process, or until; it says
// which.
func (l *leader) emptied(until <-chan time.Time) bool {
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		if !groupLives(l.pid) {
			return true
		}
		select {
		case <-until:
			return !groupLives(l.pid)
		case <-ticker.C:
		}
	}
}

// hooks are kill(2) and the watch of an exit, a test's to replace.
var hooks = struct {
	sync.Mutex
	kill  func(pid int, sig syscall.Signal) error
	watch func(pid int) (*int, error)
	poll  time.Duration
}{kill: syscall.Kill, watch: awaitExit, poll: pollEvery}

func pollInterval() time.Duration {
	hooks.Lock()
	defer hooks.Unlock()
	return hooks.poll
}

func sendSignal(pid int, sig syscall.Signal) error {
	hooks.Lock()
	kill := hooks.kill
	hooks.Unlock()
	return kill(pid, sig)
}

func watchExit(pid int) (*int, error) {
	hooks.Lock()
	watch := hooks.watch
	hooks.Unlock()
	return watch(pid)
}
