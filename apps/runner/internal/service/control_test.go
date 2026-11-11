package service

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func installedSystemd(t *testing.T, r *recorder) Config {
	t.Helper()
	cfg := Config{OS: "linux", Home: t.TempDir(), Systemd: true, Exec: r.exec}
	if err := write(UnitPath(cfg.Home), Unit("")); err != nil {
		t.Fatal(err)
	}
	return cfg
}

func installedLaunchd(t *testing.T, r *recorder) Config {
	t.Helper()
	cfg := Config{OS: "darwin", Home: t.TempDir(), UID: 501, Exec: r.exec}
	if err := write(PlistPath(cfg.Home), Plist(cfg.Home, "")); err != nil {
		t.Fatal(err)
	}
	return cfg
}

func failing(match string) func(string) ([]byte, error) {
	return func(call string) ([]byte, error) {
		if strings.Contains(call, match) {
			return nil, errors.New("exit status 3")
		}
		return nil, nil
	}
}

func TestTheStateOfASystemdServiceIsWhatSystemctlSays(t *testing.T) {
	active := &recorder{}
	if got, err := StateOf(context.Background(), installedSystemd(t, active)); err != nil || got != StateActive {
		t.Fatalf("state = %q, %v", got, err)
	}
	if strings.Join(active.calls, "\n") != "systemctl --user is-active --quiet crewdeck-runner.service" {
		t.Fatalf("calls %v", active.calls)
	}
	inactive := &recorder{answer: failing("is-active")}
	if got, _ := StateOf(context.Background(), installedSystemd(t, inactive)); got != StateInactive {
		t.Fatalf("state = %q", got)
	}
}

func TestAServiceWithoutItsFileOrWithoutSystemdIsNotInstalled(t *testing.T) {
	r := &recorder{}
	for _, cfg := range []Config{
		{OS: "linux", Home: t.TempDir(), Systemd: true, Exec: r.exec},
		{OS: "linux", Home: t.TempDir(), WSL: true, Exec: r.exec},
		{OS: "darwin", Home: t.TempDir(), UID: 501, Exec: r.exec},
	} {
		if got, err := StateOf(context.Background(), cfg); err != nil || got != StateNotInstalled {
			t.Errorf("%+v: state = %q, %v", cfg, got, err)
		}
	}
	if len(r.calls) != 0 {
		t.Fatalf("calls %v", r.calls)
	}
}

func TestTheStateOfALaunchdAgentIsWhetherItRuns(t *testing.T) {
	running := &recorder{answer: func(string) ([]byte, error) {
		return []byte("gui/501/com.crewdeck.runner = {\n\tstate = running\n}"), nil
	}}
	if got, _ := StateOf(context.Background(), installedLaunchd(t, running)); got != StateActive {
		t.Fatalf("state = %q", got)
	}
	if running.calls[0] != "launchctl print gui/501/com.crewdeck.runner" {
		t.Fatalf("calls %v", running.calls)
	}
	waiting := &recorder{answer: func(string) ([]byte, error) { return []byte("\tstate = not running\n"), nil }}
	if got, _ := StateOf(context.Background(), installedLaunchd(t, waiting)); got != StateInactive {
		t.Fatalf("state = %q", got)
	}
	unloaded := &recorder{answer: failing("print")}
	if got, _ := StateOf(context.Background(), installedLaunchd(t, unloaded)); got != StateInactive {
		t.Fatalf("state = %q", got)
	}
}

func TestSystemdStartsStopsAndRestartsTheUnit(t *testing.T) {
	for action, want := range map[Action]string{
		ActionStart:   "systemctl --user start crewdeck-runner.service",
		ActionStop:    "systemctl --user stop crewdeck-runner.service",
		ActionRestart: "systemctl --user restart crewdeck-runner.service",
	} {
		r := &recorder{}
		if err := Control(context.Background(), installedSystemd(t, r), action); err != nil {
			t.Fatalf("%s: %v", action, err)
		}
		if strings.Join(r.calls, "\n") != want {
			t.Errorf("%s: calls %v, want %q", action, r.calls, want)
		}
	}
}

func TestLaunchdBootstrapsAnAgentNotLoadedAndKickstartsALoadedOne(t *testing.T) {
	cases := []struct {
		action Action
		loaded bool
		want   []string
	}{
		{ActionStart, false, []string{"launchctl print gui/501/com.crewdeck.runner", "launchctl bootstrap gui/501 {plist}"}},
		{ActionStart, true, []string{"launchctl print gui/501/com.crewdeck.runner", "launchctl kickstart gui/501/com.crewdeck.runner"}},
		{ActionRestart, false, []string{"launchctl print gui/501/com.crewdeck.runner", "launchctl bootstrap gui/501 {plist}"}},
		{ActionRestart, true, []string{"launchctl print gui/501/com.crewdeck.runner", "launchctl kickstart -k gui/501/com.crewdeck.runner"}},
		{ActionStop, true, []string{"launchctl print gui/501/com.crewdeck.runner", "launchctl bootout gui/501/com.crewdeck.runner"}},
		{ActionStop, false, []string{"launchctl print gui/501/com.crewdeck.runner"}},
	}
	for _, c := range cases {
		r := &recorder{}
		if !c.loaded {
			r.answer = failing("print")
		}
		cfg := installedLaunchd(t, r)
		if err := Control(context.Background(), cfg, c.action); err != nil {
			t.Fatalf("%s loaded=%v: %v", c.action, c.loaded, err)
		}
		want := strings.ReplaceAll(strings.Join(c.want, "\n"), "{plist}", PlistPath(cfg.Home))
		if strings.Join(r.calls, "\n") != want {
			t.Errorf("%s loaded=%v: calls\n%s\nwant\n%s", c.action, c.loaded, strings.Join(r.calls, "\n"), want)
		}
	}
}

func TestControlWithoutAServiceSaysSoAndRunsNothing(t *testing.T) {
	r := &recorder{}
	for _, cfg := range []Config{
		{OS: "linux", Home: t.TempDir(), WSL: true, Exec: r.exec},
		{OS: "linux", Home: t.TempDir(), Systemd: true, Exec: r.exec},
		{OS: "darwin", Home: t.TempDir(), Exec: r.exec},
	} {
		if err := Control(context.Background(), cfg, ActionStart); !errors.Is(err, ErrNotInstalled) {
			t.Errorf("%+v: err = %v", cfg, err)
		}
	}
	if len(r.calls) != 0 {
		t.Fatalf("calls %v", r.calls)
	}
}

func TestControlSaysWhatFailed(t *testing.T) {
	r := &recorder{answer: func(call string) ([]byte, error) {
		return []byte("Unit crewdeck-runner.service is masked.\n"), errors.New("exit status 1")
	}}
	err := Control(context.Background(), installedSystemd(t, r), ActionStart)
	if err == nil || !strings.Contains(err.Error(), "is masked") {
		t.Fatalf("err = %v", err)
	}
}

func TestUninstallStopsAndRemovesTheSystemdUnit(t *testing.T) {
	r := &recorder{}
	cfg := installedSystemd(t, r)
	if err := Uninstall(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	want := []string{"systemctl --user disable --now crewdeck-runner.service", "systemctl --user daemon-reload"}
	if strings.Join(r.calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("calls %v", r.calls)
	}
	if _, err := os.Stat(UnitPath(cfg.Home)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the unit is still there: %v", err)
	}
}

func TestUninstallBootsOutAndRemovesTheLaunchdAgent(t *testing.T) {
	r := &recorder{answer: failing("bootout")}
	cfg := installedLaunchd(t, r)
	if err := Uninstall(context.Background(), cfg); err != nil {
		t.Fatal(err)
	}
	if strings.Join(r.calls, "\n") != "launchctl bootout gui/501/com.crewdeck.runner" {
		t.Fatalf("calls %v", r.calls)
	}
	if _, err := os.Stat(PlistPath(cfg.Home)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the plist is still there: %v", err)
	}
}

func TestUninstallWithoutAServiceDoesNothing(t *testing.T) {
	r := &recorder{}
	if err := Uninstall(context.Background(), Config{OS: "linux", Home: t.TempDir(), Systemd: true, Exec: r.exec}); err != nil || len(r.calls) != 0 {
		t.Fatalf("err %v, calls %v", err, r.calls)
	}
}

func TestSystemdLogsComeFromJournalctl(t *testing.T) {
	cfg := installedSystemd(t, &recorder{})
	src, err := LogsOf(cfg, LogOptions{Lines: 50, Follow: true})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(src.Command, " "); got != "journalctl --user -u crewdeck-runner.service --no-pager -o cat -n 50 -f" {
		t.Fatalf("command %q", got)
	}
	src, _ = LogsOf(cfg, LogOptions{Lines: 200})
	if strings.Contains(strings.Join(src.Command, " "), "-f") {
		t.Fatalf("command %v", src.Command)
	}
}

func TestLaunchdLogsAreTheAgentsLogFile(t *testing.T) {
	cfg := installedLaunchd(t, &recorder{})
	src, err := LogsOf(cfg, LogOptions{Lines: 200})
	if err != nil {
		t.Fatal(err)
	}
	if src.File != filepath.Join(cfg.Home, ".crewdeck", "runner.log") || src.Command != nil {
		t.Fatalf("source %+v", src)
	}
}

func TestNoLogsWithoutAService(t *testing.T) {
	if _, err := LogsOf(Config{OS: "linux", Home: t.TempDir(), WSL: true}, LogOptions{Lines: 200}); !errors.Is(err, ErrNotInstalled) {
		t.Fatalf("err = %v", err)
	}
}

func TestTailPrintsTheLastLinesOfAFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "runner.log")
	if err := os.WriteFile(file, []byte("1\n2\n3\n4"), 0o600); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := Tail(context.Background(), file, &out, LogOptions{Lines: 2}); err != nil {
		t.Fatal(err)
	}
	if out.String() != "3\n4\n" { // the last line, not ended, included
		t.Fatalf("tail printed %q", out.String())
	}
}

func TestTailFollowsWhatIsAppendedUntilItsContextEnds(t *testing.T) {
	file := filepath.Join(t.TempDir(), "runner.log")
	if err := os.WriteFile(file, []byte("1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	out := &syncBuffer{}
	done := make(chan error, 1)
	go func() { done <- Tail(ctx, file, out, LogOptions{Lines: 10, Follow: true, Poll: 10 * time.Millisecond}) }()

	f, err := os.OpenFile(file, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteString("2\n")
	f.Close()
	deadline := time.Now().Add(5 * time.Second)
	for out.String() != "1\n2\n" && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if out.String() != "1\n2\n" {
		t.Fatalf("tail printed %q", out.String())
	}
}

type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}
