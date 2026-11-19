package command

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// The services of the Runner (RUNNER-19, ADR 0013, risk OPS-11): the
// process group of a run whose health address answered while it ran,
// recorded in `services/<projectId>/<commandId>.pid` so that a reused pid is
// never taken for it (its start time as the OS reports it). A service is
// stopped (SIGTERM to its group, SIGKILL after KillGrace) before its
// Commande runs again, and by `crewdeck-runner uninstall`; one that exits by
// itself loses its file when the Runner notices: at its exit while the
// Runner lives, once what it left in its group is stopped (its process
// reaped only then, so that its group's id is never another's; a group that
// cannot be stopped keeps the service, and fails its Commande's next run),
// else the next run or the next start.
//
//	services/<projectId>/<commandId>.pid  { pid, pgid, startedAt, runId } (folder 700, file 600)
//	services/<projectId>/<commandId>.log  the service's output after its verdict (mode 600, replaced at each start)

// killWait is how long a group has to be gone after its SIGKILL.
const killWait = 5 * time.Second

var errNotStopped = errors.New("command: the service's group outlived its SIGKILL")

// serviceKey names a service: its Projet and Commande, ids the run's
// message gave and openSealed checked.
type serviceKey struct {
	projectID, commandID string
}

func servicesDir(home string) string {
	return filepath.Join(home, "services")
}

func (k serviceKey) pidPath(home string) string {
	return filepath.Join(servicesDir(home), k.projectID, k.commandID+".pid")
}

func (k serviceKey) logPath(home string) string {
	return filepath.Join(servicesDir(home), k.projectID, k.commandID+".log")
}

// serviceRecord is a service's pid file.
type serviceRecord struct {
	Pid       int    `json:"pid"`
	Pgid      int    `json:"pgid"`
	StartedAt string `json:"startedAt"`
	RunID     string `json:"runId"`
}

// running says whether the record's process runs still: its pid alive with
// the same start time, in the same group. Never a group of 0 or 1, whose
// signal would reach the Runner's own or every process.
func (rec serviceRecord) running() bool {
	if rec.Pid <= 1 || rec.Pgid <= 1 || rec.StartedAt == "" {
		return false
	}
	started, err := StartTime(rec.Pid)
	if err != nil || started != rec.StartedAt {
		return false
	}
	pgid, err := syscall.Getpgid(rec.Pid)
	return err == nil && pgid == rec.Pgid
}

func readRecord(path string) (serviceRecord, error) {
	var rec serviceRecord
	data, err := os.ReadFile(path)
	if err != nil {
		return rec, err
	}
	return rec, json.Unmarshal(data, &rec)
}

// StartTime is the start time of the process pid as the OS reports it: on
// Linux its boot's id and its start in clock ticks since that boot
// (`/proc/<pid>/stat`), on macOS `ps -o lstart=`. A process gone (or a
// zombie) has none.
func StartTime(pid int) (string, error) {
	if runtime.GOOS != "linux" {
		cmd := exec.Command("ps", "-o", "lstart=", "-p", strconv.Itoa(pid))
		cmd.Env = append(os.Environ(), "LC_ALL=C")
		out, err := cmd.Output()
		if started := strings.TrimSpace(string(out)); err == nil && started != "" {
			return started, nil
		}
		return "", os.ErrNotExist
	}
	stat, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return "", err
	}
	// After the command's name, in parentheses: its state (field 3), …, its start (field 22).
	fields := strings.Fields(string(stat[bytes.LastIndexByte(stat, ')')+1:]))
	if len(fields) < 20 || fields[0] == "Z" {
		return "", os.ErrNotExist
	}
	boot, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(boot)) + ":" + fields[19], nil
}

// recordService writes the service's pid file at once, and opens its log.
func (r *Runner) recordService(key serviceKey, pid int, runID string) (*os.File, error) {
	started, err := StartTime(pid)
	if err != nil {
		return nil, err
	}
	data, err := json.Marshal(serviceRecord{Pid: pid, Pgid: pid, StartedAt: started, RunID: runID})
	if err != nil {
		return nil, err
	}
	path := key.pidPath(r.cfg.Home)
	if err := privateDir(filepath.Dir(path)); err != nil {
		return nil, err
	}
	logFile, err := openServiceLog(key.logPath(r.cfg.Home))
	if err != nil {
		return nil, err
	}
	r.svcMu.Lock()
	defer r.svcMu.Unlock()
	if err := writeAtOnce(path, data); err != nil {
		logFile.Close()
		return nil, err
	}
	return logFile, nil
}

// privateDir makes services/ and dir, mode 700.
func privateDir(dir string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	for _, d := range []string{filepath.Dir(dir), dir} {
		if err := os.Chmod(d, 0o700); err != nil {
			return err
		}
	}
	return nil
}

// writeAtOnce writes data at path through a file of the same folder, mode
// 600, renamed over it: a reader finds the whole record or none.
func writeAtOnce(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".pid-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// service is a service this Runner started.
type service struct {
	runID   string
	proc    *leader
	after   func(time.Duration) <-chan time.Time
	release func() // its output closed, its place released, its file removed

	mu    sync.Mutex // one stop at a time
	ended chan struct{}
}

// stop ends the service: its group stopped (SIGTERM, SIGKILL after
// KillGrace), its process reaped, its place released and its file removed.
// When its group outlives the stop (a signal refused, a process that
// survives its SIGKILL), nothing else is done and stop fails: the service
// stays tracked, its place held, its file kept, and its process unreaped,
// so that its group's id stays its own for the next stop.
func (s *service) stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	select {
	case <-s.ended:
		return nil
	default:
	}
	if err := s.proc.stopGroup(s.after); err != nil {
		return err
	}
	s.proc.reap()
	s.release()
	close(s.ended)
	return nil
}

func (r *Runner) track(key serviceKey, s *service) {
	r.svcMu.Lock()
	r.services[key] = s
	r.svcMu.Unlock()
}

// untrack forgets the service of the run runID once it ended, and its pid
// file unless a later run of its Commande wrote its own.
func (r *Runner) untrack(key serviceKey, runID string) {
	r.svcMu.Lock()
	defer r.svcMu.Unlock()
	if s := r.services[key]; s != nil && s.runID == runID {
		delete(r.services, key)
	}
	path := key.pidPath(r.cfg.Home)
	if rec, err := readRecord(path); err == nil && rec.RunID == runID {
		_ = os.Remove(path)
	}
}

// stopService stops the Commande's service before it runs again: the one
// this Runner started, or the one its pid file names; a file whose process
// is gone is only removed. An error leaves the service as it was.
func (r *Runner) stopService(key serviceKey) error {
	r.svcMu.Lock()
	s := r.services[key]
	r.svcMu.Unlock()
	if s != nil {
		return s.stop()
	}
	path := key.pidPath(r.cfg.Home)
	rec, err := readRecord(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err == nil && rec.running() {
		if err := stopGroup(rec.Pgid, r.cfg.After); err != nil {
			return err
		}
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// pruneServices removes, at the Runner's start, the pid files whose
// process is gone or is another one; a live service stays recorded.
func (r *Runner) pruneServices() {
	for path, rec := range records(r.cfg.Home) {
		if !rec.running() {
			_ = os.Remove(path)
		}
	}
}

// records is every pid file under home's services, by path; one that does
// not decode has a zero record.
func records(home string) map[string]serviceRecord {
	paths, _ := filepath.Glob(filepath.Join(servicesDir(home), "*", "*.pid"))
	found := make(map[string]serviceRecord, len(paths))
	for _, path := range paths {
		rec, _ := readRecord(path)
		found[path] = rec
	}
	return found
}

// StopServices stops every service recorded under home (SIGTERM to its
// group, SIGKILL after KillGrace) and removes its file; it gives how many
// ran, and the first stop that failed.
func StopServices(home string) (int, error) {
	stopped := 0
	var first error
	for path, rec := range records(home) {
		if rec.running() {
			if err := stopGroup(rec.Pgid, time.After); err != nil {
				first = cmpErr(first, err)
				continue
			}
			stopped++
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			first = cmpErr(first, err)
		}
	}
	return stopped, first
}

func cmpErr(first, err error) error {
	if first != nil {
		return first
	}
	return err
}

// stopGroup sends the group of a service of an earlier Runner SIGTERM,
// then SIGKILL after KillGrace, and waits for it to be gone.
func stopGroup(pgid int, after func(time.Duration) <-chan time.Time) error {
	if err := sendSignal(-pgid, syscall.SIGTERM); err != nil {
		if errors.Is(err, syscall.ESRCH) {
			return nil
		}
		return err
	}
	if gone(pgid, after(KillGrace)) {
		return nil
	}
	if err := sendSignal(-pgid, syscall.SIGKILL); err != nil && !errors.Is(err, syscall.ESRCH) {
		return err
	}
	if gone(pgid, time.After(killWait)) {
		return nil
	}
	return errNotStopped
}

// gone waits until the group has no process left, or until; it says which.
func gone(pgid int, until <-chan time.Time) bool {
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		if errors.Is(syscall.Kill(-pgid, 0), syscall.ESRCH) {
			return true
		}
		select {
		case <-until:
			return errors.Is(syscall.Kill(-pgid, 0), syscall.ESRCH)
		case <-ticker.C:
		}
	}
}
