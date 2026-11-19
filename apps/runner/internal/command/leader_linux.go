package command

import (
	"bytes"
	"os"
	"strconv"
	"strings"
	"syscall"
	"unsafe"
)

const (
	pPID      = 1          // P_PID
	wEXITED   = 0x4        // WEXITED
	wNOWAIT   = 0x01000000 // WNOWAIT
	wNOHANG   = 0x1        // WNOHANG
	cldExited = 1          // CLD_EXITED
)

// siginfo is the head of siginfo_t for SIGCHLD on a 64-bit Linux.
type siginfo struct {
	signo, errno, code, _ int32
	pid                   int32
	uid                   uint32
	status                int32
	_                     [100]byte
}

// awaitExit waits for the process pid, a child, to exit, without reaping
// it (waitid with WNOWAIT): its exit code, nil when a signal ended it. An
// error says it was not watched.
func awaitExit(pid int) (*int, error) {
	var info siginfo
	for {
		_, _, errno := syscall.Syscall6(syscall.SYS_WAITID, pPID, uintptr(pid), uintptr(unsafe.Pointer(&info)), wEXITED|wNOWAIT, 0, 0)
		if errno == syscall.EINTR {
			continue
		}
		if errno != 0 {
			return nil, errno
		}
		break
	}
	if info.code == cldExited {
		c := int(info.status)
		return &c, nil
	}
	return nil, nil
}

// zombie says whether the process pid, a child, exited, unreaped, and its
// exit code (nil when a signal ended it) when the OS gives it. It asks
// waitid (WNOHANG, WNOWAIT): the process as a whole, never its main thread
// alone, which may be a zombie while another thread runs on. When waitid
// refuses, /proc says it, without its code.
func zombie(pid int) (dead bool, code *int, known bool) {
	for {
		var info siginfo
		_, _, errno := syscall.Syscall6(syscall.SYS_WAITID, pPID, uintptr(pid), uintptr(unsafe.Pointer(&info)), wEXITED|wNOWAIT|wNOHANG, 0, 0)
		if errno == syscall.EINTR {
			continue
		}
		if errno != 0 {
			return !alive(strconv.Itoa(pid)), nil, false
		}
		if info.pid == 0 {
			return false, nil, true
		}
		if info.code == cldExited {
			c := int(info.status)
			return true, &c, true
		}
		return true, nil, true
	}
}

// alive says whether the process pid runs: its main thread, or another of
// its threads when its main one is a zombie (`/proc/<pid>/task/*/stat`,
// field 3). When /proc cannot be read, it says yes.
func alive(pid string) bool {
	state, ok := stateOf("/proc/" + pid + "/stat")
	if !ok {
		_, err := os.Stat("/proc/" + pid)
		return err == nil || !os.IsNotExist(err)
	}
	if state != "Z" && state != "X" {
		return true
	}
	tasks, err := os.ReadDir("/proc/" + pid + "/task")
	if err != nil {
		return !os.IsNotExist(err)
	}
	for _, task := range tasks {
		if state, ok := stateOf("/proc/" + pid + "/task/" + task.Name() + "/stat"); ok && state != "Z" && state != "X" {
			return true
		}
	}
	return false
}

// stateOf is the state of a stat file, field 3.
func stateOf(path string) (string, bool) {
	stat, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	fields := strings.Fields(string(stat[bytes.LastIndexByte(stat, ')')+1:]))
	if len(fields) == 0 {
		return "", false
	}
	return fields[0], true
}

// groupLives says whether the group pgid holds a process that runs, a
// zombie whose other threads run included (`/proc/<pid>/stat`: its group,
// field 5). When /proc cannot be read, it says yes.
func groupLives(pgid int) bool {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return true
	}
	for _, entry := range entries {
		if _, err := strconv.Atoi(entry.Name()); err != nil {
			continue
		}
		stat, err := os.ReadFile("/proc/" + entry.Name() + "/stat")
		if err != nil {
			continue
		}
		fields := strings.Fields(string(stat[bytes.LastIndexByte(stat, ')')+1:]))
		if len(fields) < 3 {
			continue
		}
		if group, err := strconv.Atoi(fields[2]); err == nil && group == pgid && alive(entry.Name()) {
			return true
		}
	}
	return false
}
