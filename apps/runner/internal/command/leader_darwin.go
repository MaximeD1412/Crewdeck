package command

import (
	"errors"
	"os/exec"
	"strconv"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

// awaitExit waits for the process pid, a child, to exit, without reaping
// it (a kqueue's NOTE_EXIT): its exit code, nil when a signal ended it.
// An error says it was not watched.
func awaitExit(pid int) (*int, error) {
	kq, err := syscall.Kqueue()
	if err != nil {
		return nil, err
	}
	defer syscall.Close(kq)
	var change syscall.Kevent_t
	syscall.SetKevent(&change, pid, syscall.EVFILT_PROC, syscall.EV_ADD|syscall.EV_ONESHOT)
	change.Fflags = syscall.NOTE_EXIT | syscall.NOTE_EXITSTATUS
	events := make([]syscall.Kevent_t, 1)
	for {
		n, err := syscall.Kevent(kq, []syscall.Kevent_t{change}, events, nil)
		if err == syscall.EINTR {
			continue
		}
		if err != nil {
			return nil, err
		}
		if n != 1 || events[0].Flags&syscall.EV_ERROR != 0 || events[0].Fflags&syscall.NOTE_EXIT == 0 {
			return nil, errNotWatched
		}
		break
	}
	status := syscall.WaitStatus(events[0].Data)
	if status.Exited() {
		c := status.ExitStatus()
		return &c, nil
	}
	return nil, nil
}

var errNotWatched = errors.New("command: the kqueue did not watch the process")

// sZOMB is a zombie's p_stat (sys/proc.h).
const sZOMB = 5

// exitedUnreaped says whether pid is a zombie (sysctl kern.proc.pid: no
// file, no process of its own, when the kqueue could not be had).
func exitedUnreaped(pid int) bool {
	info, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	return err == nil && info.Proc.P_stat == sZOMB
}

// groupLives says whether the group pgid holds a process that is not a
// zombie (`ps -A -o pgid=,stat=`). When ps fails, it says yes.
func groupLives(pgid int) bool {
	out, err := exec.Command("ps", "-A", "-o", "pgid=,stat=").Output()
	if err != nil {
		return true
	}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || strings.HasPrefix(fields[1], "Z") {
			continue
		}
		if group, err := strconv.Atoi(fields[0]); err == nil && group == pgid {
			return true
		}
	}
	return false
}
