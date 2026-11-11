package service

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// recorder answers each command as told and records them.
type recorder struct {
	calls  []string
	answer func(call string) ([]byte, error)
}

func (r *recorder) exec(_ context.Context, name string, args ...string) ([]byte, error) {
	call := strings.Join(append([]string{name}, args...), " ")
	r.calls = append(r.calls, call)
	if r.answer != nil {
		return r.answer(call)
	}
	return nil, nil
}

func TestSystemdWritesTheUserUnitThenEnablesAndStartsIt(t *testing.T) {
	home := t.TempDir()
	r := &recorder{answer: func(call string) ([]byte, error) {
		if strings.Contains(call, "is-active") {
			return nil, errors.New("inactive")
		}
		return nil, nil
	}}

	out, err := Install(context.Background(), Config{OS: "linux", Home: home, Systemd: true, Path: "/usr/bin:/home/p/.local/bin", Exec: r.exec})
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	unit := filepath.Join(home, ".config", "systemd", "user", "crewdeck-runner.service")
	if !out.Started || out.File != unit {
		t.Fatalf("outcome %+v", out)
	}
	data, err := os.ReadFile(unit)
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range []string{"ExecStart=%h/.local/bin/crewdeck-runner run", "Restart=on-failure", "WantedBy=default.target", `Environment="PATH=/usr/bin:/home/p/.local/bin"`} {
		if !strings.Contains(string(data), line+"\n") {
			t.Errorf("the unit lacks %q:\n%s", line, data)
		}
	}
	want := []string{
		"systemctl --user is-active --quiet crewdeck-runner.service",
		"systemctl --user daemon-reload",
		"systemctl --user enable --now crewdeck-runner.service",
	}
	if strings.Join(r.calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("calls:\n%s\nwant:\n%s", strings.Join(r.calls, "\n"), strings.Join(want, "\n"))
	}
}

func TestSystemdRestartsAServiceAlreadyRunningSoItReadsTheNewLink(t *testing.T) {
	r := &recorder{}
	if _, err := Install(context.Background(), Config{OS: "linux", Home: t.TempDir(), Systemd: true, Exec: r.exec}); err != nil {
		t.Fatal(err)
	}
	if last := r.calls[len(r.calls)-1]; last != "systemctl --user restart crewdeck-runner.service" {
		t.Fatalf("last call %q", last)
	}
}

func TestSystemdSaysWhatFailed(t *testing.T) {
	r := &recorder{answer: func(call string) ([]byte, error) {
		if strings.Contains(call, "enable") {
			return []byte("Failed to connect to bus\n"), errors.New("exit status 1")
		}
		return nil, nil
	}}
	_, err := Install(context.Background(), Config{OS: "linux", Home: t.TempDir(), Systemd: true, Exec: r.exec})
	if err == nil || !strings.Contains(err.Error(), "enable --now") || !strings.Contains(err.Error(), "Failed to connect to bus") {
		t.Fatalf("err = %v", err)
	}
}

func TestTheUnitEscapesThePath(t *testing.T) {
	if got := Unit(`/a b/%x/"q"`); !strings.Contains(got, `Environment="PATH=/a b/%%x/\"q\""`) {
		t.Fatalf("unit:\n%s", got)
	}
	if strings.Contains(Unit(""), "Environment") {
		t.Fatal("an empty PATH is written")
	}
}

func TestLaunchdWritesTheAgentAndBootstrapsItInTheGuiDomain(t *testing.T) {
	home := t.TempDir()
	r := &recorder{answer: func(call string) ([]byte, error) {
		if strings.Contains(call, "bootout") {
			return []byte("Boot-out failed: 3: No such process"), errors.New("exit status 3")
		}
		return nil, nil
	}}

	out, err := Install(context.Background(), Config{OS: "darwin", Home: home, UID: 501, Path: "/opt/homebrew/bin:/usr/bin", Exec: r.exec})
	if err != nil {
		t.Fatalf("install: %v", err)
	}
	plist := filepath.Join(home, "Library", "LaunchAgents", "com.crewdeck.runner.plist")
	if !out.Started || out.File != plist {
		t.Fatalf("outcome %+v", out)
	}
	data, err := os.ReadFile(plist)
	if err != nil {
		t.Fatal(err)
	}
	for _, part := range []string{"<string>com.crewdeck.runner</string>", "<string>" + filepath.Join(home, ".local", "bin", "crewdeck-runner") + "</string>\n\t\t<string>run</string>", "<key>RunAtLoad</key>\n\t<true/>", "<string>/opt/homebrew/bin:/usr/bin</string>"} {
		if !strings.Contains(string(data), part) {
			t.Errorf("the plist lacks %q:\n%s", part, data)
		}
	}
	want := []string{"launchctl bootout gui/501/com.crewdeck.runner", "launchctl bootstrap gui/501 " + plist}
	if strings.Join(r.calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("calls:\n%s", strings.Join(r.calls, "\n"))
	}
}

func TestThePlistEscapesItsValues(t *testing.T) {
	if got := Plist("/Users/a&b", "/x<y"); !strings.Contains(got, "/Users/a&amp;b/.local/bin/crewdeck-runner") || !strings.Contains(got, "/x&lt;y") {
		t.Fatalf("plist:\n%s", got)
	}
}

func TestWSLWithoutSystemdSaysHowToEnableItAndRunsNothing(t *testing.T) {
	r := &recorder{}
	out, err := Install(context.Background(), Config{OS: "linux", Home: t.TempDir(), WSL: true, Exec: r.exec})
	if err != nil {
		t.Fatal(err)
	}
	if out.Started || len(r.calls) != 0 {
		t.Fatalf("outcome %+v, calls %v", out, r.calls)
	}
	for _, part := range []string{"/etc/wsl.conf", "[boot]", "systemd=true", "wsl --shutdown", "crewdeck-runner run"} {
		if !strings.Contains(out.Help, part) {
			t.Errorf("the help lacks %q", part)
		}
	}
}

func TestLinuxWithoutSystemdRunsInTheForeground(t *testing.T) {
	out, err := Install(context.Background(), Config{OS: "linux", Home: t.TempDir(), Exec: (&recorder{}).exec})
	if err != nil || out.Started || !strings.Contains(out.Help, "crewdeck-runner run") {
		t.Fatalf("outcome %+v, err %v", out, err)
	}
}
