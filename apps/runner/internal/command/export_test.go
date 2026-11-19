package command

import "syscall"

// SetKill replaces kill(2) for the signals the Runner sends a group, until
// restore.
func SetKill(kill func(pid int, sig syscall.Signal) error) (restore func()) {
	hooks.Lock()
	previous := hooks.kill
	hooks.kill = kill
	hooks.Unlock()
	return func() {
		hooks.Lock()
		hooks.kill = previous
		hooks.Unlock()
	}
}

// FailWatch makes every watch of a run's exit fail with err, until restore.
func FailWatch(err error) (restore func()) {
	hooks.Lock()
	previous := hooks.watch
	hooks.watch = func(int) (*int, error) { return nil, err }
	hooks.Unlock()
	return func() {
		hooks.Lock()
		hooks.watch = previous
		hooks.Unlock()
	}
}
