package command

import "syscall"

// SetKill replaces kill(2) for the signals the Runner sends a group, until
// restore.
func SetKill(kill func(pid int, sig syscall.Signal) error) (restore func()) {
	signals.Lock()
	previous := signals.kill
	signals.kill = kill
	signals.Unlock()
	return func() {
		signals.Lock()
		signals.kill = previous
		signals.Unlock()
	}
}
