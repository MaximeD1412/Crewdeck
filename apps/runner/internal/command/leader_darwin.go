package command

import (
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

// awaitExit waits for the process pid, a child, to exit, without reaping
// it (a kqueue's NOTE_EXIT): its exit code, nil when a signal ended it.
// held says it is still unreaped; when the kqueue cannot watch it, it is
// not, and the caller reaps it.
func awaitExit(pid int) (code *int, held bool) {
	kq, err := syscall.Kqueue()
	if err != nil {
		return nil, false
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
		if err != nil || n != 1 || events[0].Flags&syscall.EV_ERROR != 0 || events[0].Fflags&syscall.NOTE_EXIT == 0 {
			return nil, false
		}
		break
	}
	status := syscall.WaitStatus(events[0].Data)
	if status.Exited() {
		c := status.ExitStatus()
		return &c, true
	}
	return nil, true
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
