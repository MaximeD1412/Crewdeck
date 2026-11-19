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

// zombie says whether pid exited, unreaped, and its wait status when the
// OS gives it (`/proc/<pid>/stat`: its state, field 3, its exit code,
// field 52).
func zombie(pid int) (dead bool, status syscall.WaitStatus, known bool) {
	stat, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return false, 0, false
	}
	fields := strings.Fields(string(stat[bytes.LastIndexByte(stat, ')')+1:]))
	if len(fields) == 0 || fields[0] != "Z" {
		return false, 0, false
	}
	if len(fields) < 50 {
		return true, 0, false
	}
	code, err := strconv.ParseUint(fields[49], 10, 32)
	return true, syscall.WaitStatus(code), err == nil
}

// groupLives says whether the group pgid holds a process that is not a
// zombie (`/proc/<pid>/stat`: its state, field 3, and its group, field 5).
// When /proc cannot be read, it says yes.
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
		if len(fields) < 3 || fields[0] == "Z" || fields[0] == "X" {
			continue
		}
		if group, err := strconv.Atoi(fields[2]); err == nil && group == pgid {
			return true
		}
	}
	return false
}
