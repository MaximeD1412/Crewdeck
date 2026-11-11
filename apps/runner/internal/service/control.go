package service

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ErrNotInstalled: this machine has no service of the Runner (WSL without
// systemd, a link with --no-service): `crewdeck-runner run` runs it.
var ErrNotInstalled = errors.New("service: the Runner's service is not installed")

// State is the service's state, as `crewdeck-runner status` says it.
type State string

const (
	StateActive       State = "active"
	StateInactive     State = "inactive"
	StateNotInstalled State = "not-installed"
)

// Action is what `start`, `stop` and `restart` ask of the service.
type Action string

const (
	ActionStart   Action = "start"
	ActionStop    Action = "stop"
	ActionRestart Action = "restart"
)

// File is the service's file on this machine (the unit, the plist), empty
// where it cannot have one.
func File(cfg Config) string {
	switch {
	case cfg.OS == "linux" && cfg.Systemd:
		return UnitPath(cfg.Home)
	case cfg.OS == "darwin":
		return PlistPath(cfg.Home)
	}
	return ""
}

func installed(cfg Config) bool {
	file := File(cfg)
	if file == "" {
		return false
	}
	_, err := os.Stat(file)
	return err == nil
}

func withExec(cfg Config) Config {
	if cfg.Exec == nil {
		cfg.Exec = run
	}
	return cfg
}

func (cfg Config) target() string {
	return fmt.Sprintf("gui/%d/%s", cfg.UID, Label)
}

func (cfg Config) domain() string {
	return fmt.Sprintf("gui/%d", cfg.UID)
}

const unit = Name + ".service"

// StateOf says whether the service runs, is stopped, or is not installed.
func StateOf(ctx context.Context, cfg Config) (State, error) {
	cfg = withExec(cfg)
	if !installed(cfg) {
		return StateNotInstalled, nil
	}
	if cfg.OS == "darwin" {
		out, err := cfg.Exec(ctx, "launchctl", "print", cfg.target())
		if err == nil && strings.Contains(string(out), "state = running") {
			return StateActive, nil
		}
		return StateInactive, nil
	}
	if _, err := cfg.Exec(ctx, "systemctl", "--user", "is-active", "--quiet", unit); err != nil {
		return StateInactive, nil
	}
	return StateActive, nil
}

// Control starts, stops or restarts the service: systemctl --user on Linux;
// on macOS, launchctl bootstrap for an agent not loaded, else kickstart
// (with -k to restart), bootout to stop. ErrNotInstalled without a service.
func Control(ctx context.Context, cfg Config, action Action) error {
	cfg = withExec(cfg)
	if !installed(cfg) {
		return ErrNotInstalled
	}
	if cfg.OS != "darwin" {
		return runAll(ctx, cfg.Exec, [][]string{{"systemctl", "--user", string(action), unit}})
	}
	_, notLoaded := cfg.Exec(ctx, "launchctl", "print", cfg.target())
	var step []string
	switch {
	case action == ActionStop && notLoaded != nil:
		return nil
	case action == ActionStop:
		step = []string{"launchctl", "bootout", cfg.target()}
	case notLoaded != nil:
		// RunAtLoad starts it.
		step = []string{"launchctl", "bootstrap", cfg.domain(), PlistPath(cfg.Home)}
	case action == ActionRestart:
		step = []string{"launchctl", "kickstart", "-k", cfg.target()}
	default:
		step = []string{"launchctl", "kickstart", cfg.target()}
	}
	return runAll(ctx, cfg.Exec, [][]string{step})
}

// Uninstall stops the service and removes its file; nothing without one.
func Uninstall(ctx context.Context, cfg Config) error {
	cfg = withExec(cfg)
	if !installed(cfg) {
		return nil
	}
	file := File(cfg)
	if cfg.OS == "darwin" {
		// Not loaded is fine: the agent goes anyway.
		_, _ = cfg.Exec(ctx, "launchctl", "bootout", cfg.target())
		return remove(file)
	}
	if err := runAll(ctx, cfg.Exec, [][]string{{"systemctl", "--user", "disable", "--now", unit}}); err != nil {
		return err
	}
	if err := remove(file); err != nil {
		return err
	}
	return runAll(ctx, cfg.Exec, [][]string{{"systemctl", "--user", "daemon-reload"}})
}

func remove(file string) error {
	if err := os.Remove(file); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("service: remove %s: %w", file, err)
	}
	return nil
}

// LogOptions are those of `crewdeck-runner logs`.
type LogOptions struct {
	// Lines is how many of the last lines to print.
	Lines int
	// Follow keeps printing what is written after them.
	Follow bool
	// Poll is how often a followed file is read again; 500 ms by default.
	Poll time.Duration
}

// LogSource is where the service's log is: a command whose output it is
// (journalctl), or a file (launchd's StandardErrorPath).
type LogSource struct {
	Command []string
	File    string
}

// LogsOf says where the service's log is; ErrNotInstalled without a service.
func LogsOf(cfg Config, opts LogOptions) (LogSource, error) {
	if !installed(cfg) {
		return LogSource{}, ErrNotInstalled
	}
	if cfg.OS == "darwin" {
		return LogSource{File: LogPath(cfg.Home)}, nil
	}
	command := []string{"journalctl", "--user", "-u", unit, "--no-pager", "-o", "cat", "-n", strconv.Itoa(opts.Lines)}
	if opts.Follow {
		command = append(command, "-f")
	}
	return LogSource{Command: command}, nil
}

// LogPath is the launchd agent's log file.
func LogPath(home string) string {
	return filepath.Join(home, ".crewdeck", "runner.log")
}

// Tail prints the last opts.Lines lines of file then, with opts.Follow,
// what is appended to it until ctx ends.
func Tail(ctx context.Context, file string, out io.Writer, opts LogOptions) error {
	f, err := os.Open(file)
	if err != nil {
		return fmt.Errorf("service: open the log: %w", err)
	}
	defer f.Close()
	last := make([]string, 0, max(opts.Lines, 0))
	reader := bufio.NewReader(f)
	var partial string
	for {
		line, err := reader.ReadString('\n')
		if err == io.EOF {
			partial = line
			break
		}
		if err != nil {
			return fmt.Errorf("service: read the log: %w", err)
		}
		last = keep(last, line, opts.Lines)
	}
	// Followed, a line not ended yet is printed once it is.
	if !opts.Follow && partial != "" {
		last = keep(last, partial+"\n", opts.Lines)
	}
	for _, line := range last {
		if _, err := io.WriteString(out, line); err != nil {
			return err
		}
	}
	if !opts.Follow {
		return nil
	}
	poll := opts.Poll
	if poll == 0 {
		poll = 500 * time.Millisecond
	}
	ticker := time.NewTicker(poll)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		}
		for {
			line, err := reader.ReadString('\n')
			partial += line
			if err != nil {
				break
			}
			if _, err := io.WriteString(out, partial); err != nil {
				return err
			}
			partial = ""
		}
	}
}

// keep adds line to the last n lines.
func keep(last []string, line string, n int) []string {
	if n <= 0 {
		return last
	}
	if len(last) == n {
		last = append(last[:0], last[1:]...)
	}
	return append(last, line)
}
