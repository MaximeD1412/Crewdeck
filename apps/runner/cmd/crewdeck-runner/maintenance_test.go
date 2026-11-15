package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/accounts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mcp"
	"github.com/maximed1412/crewdeck/apps/runner/internal/service"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
	"github.com/zalando/go-keyring"
)

var linux = service.Config{OS: "linux", Systemd: true}
var darwin = service.Config{OS: "darwin", UID: 501}

func TestStartStopAndRestartCallSystemctl(t *testing.T) {
	cases := map[string]string{"start": "Runner démarré.", "stop": "Runner arrêté.", "restart": "Runner redémarré."}
	for action, said := range cases {
		t.Run(action, func(t *testing.T) {
			tl := fakeTools(t, "systemctl", "launchctl")
			f := newMachineFixture(t, linux)
			f.installService(t)

			out, err := f.execute(t, "", action)
			if err != nil {
				t.Fatalf("%s: %v", action, err)
			}
			if !strings.Contains(out, said) {
				t.Fatalf("%s printed %q, want %q", action, out, said)
			}
			want := []string{"systemctl --user " + action + " crewdeck-runner.service"}
			if got := tl.calls(t); !reflect.DeepEqual(got, want) {
				t.Fatalf("calls %q, want %q", got, want)
			}
		})
	}
}

func TestStartStopAndRestartCallLaunchctl(t *testing.T) {
	loaded := "gui/501/com.crewdeck.runner = {\n\tstate = running\n}\n"
	cases := []struct {
		action string
		print  string
		code   int
		want   []string
	}{
		{"start", "", 113, []string{"launchctl print gui/501/com.crewdeck.runner", "launchctl bootstrap gui/501 PLIST"}},
		{"start", loaded, 0, []string{"launchctl print gui/501/com.crewdeck.runner", "launchctl kickstart gui/501/com.crewdeck.runner"}},
		{"restart", loaded, 0, []string{"launchctl print gui/501/com.crewdeck.runner", "launchctl kickstart -k gui/501/com.crewdeck.runner"}},
		{"stop", loaded, 0, []string{"launchctl print gui/501/com.crewdeck.runner", "launchctl bootout gui/501/com.crewdeck.runner"}},
	}
	for _, c := range cases {
		t.Run(c.action, func(t *testing.T) {
			tl := fakeTools(t, "systemctl", "launchctl")
			tl.answerTo(t, "launchctl", "print", c.print, c.code)
			f := newMachineFixture(t, darwin)
			f.installService(t)

			if _, err := f.execute(t, "", c.action); err != nil {
				t.Fatalf("%s: %v", c.action, err)
			}
			want := make([]string, len(c.want))
			for i, call := range c.want {
				want[i] = strings.ReplaceAll(call, "PLIST", service.PlistPath(f.home))
			}
			if got := tl.calls(t); !reflect.DeepEqual(got, want) {
				t.Fatalf("calls %q, want %q", got, want)
			}
		})
	}
}

func TestStartWithoutAServiceSaysToRunTheRunnerInTheForeground(t *testing.T) {
	tl := fakeTools(t, "systemctl", "launchctl")
	f := newMachineFixture(t, service.Config{OS: "linux", WSL: true})

	_, err := f.execute(t, "", "start")
	if err == nil || !strings.Contains(err.Error(), "crewdeck-runner run") {
		t.Fatalf("start = %v, want the foreground command", err)
	}
	if calls := tl.calls(t); calls != nil {
		t.Fatalf("calls %q, want none", calls)
	}
}

func TestLogsComeFromJournalctlUnderSystemd(t *testing.T) {
	tl := fakeTools(t, "journalctl")
	tl.answer(t, "journalctl", "{\"level\":\"INFO\",\"msg\":\"connected\"}\n", 0)
	f := newMachineFixture(t, linux)
	f.installService(t)

	out, err := f.execute(t, "", "logs", "-n", "50")
	if err != nil {
		t.Fatalf("logs: %v", err)
	}
	if !strings.Contains(out, `"msg":"connected"`) {
		t.Fatalf("logs printed %q", out)
	}
	want := []string{"journalctl --user -u crewdeck-runner.service --no-pager -o cat -n 50"}
	if got := tl.calls(t); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls %q, want %q", got, want)
	}
	if _, err := f.execute(t, "", "logs", "-f"); err != nil {
		t.Fatalf("logs -f: %v", err)
	}
	if got := tl.calls(t); got[1] != "journalctl --user -u crewdeck-runner.service --no-pager -o cat -n 200 -f" {
		t.Fatalf("logs -f called %q", got[1])
	}
}

func TestLogsAreTheLogFileUnderLaunchd(t *testing.T) {
	f := newMachineFixture(t, darwin)
	f.installService(t)
	var lines strings.Builder
	for i := 1; i <= 300; i++ {
		lines.WriteString("line " + itoa(i) + "\n")
	}
	if err := os.MkdirAll(f.state, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(service.LogPath(f.home), []byte(lines.String()), 0o600); err != nil {
		t.Fatal(err)
	}

	out, err := f.execute(t, "", "logs")
	if err != nil {
		t.Fatalf("logs: %v", err)
	}
	got := strings.Split(strings.TrimSpace(out), "\n")
	if len(got) != 200 || got[0] != "line 101" || got[199] != "line 300" {
		t.Fatalf("logs printed %d lines, %q … %q; want the last 200", len(got), got[0], got[len(got)-1])
	}
}

// uninstallable is a linked machine with its service, a clone, a key of
// each Moteur and the secrets of a Serveur MCP in the (fake) keychain.
func uninstallable(t *testing.T) (*machineFixture, *tools) {
	t.Helper()
	keyring.MockInit()
	tl := fakeTools(t, "systemctl")
	f := newMachineFixture(t, linux)
	f.installService(t)
	f.link(t, "https://crewdeck.example")
	clone := filepath.Join(f.state, "clones", "project", "README.md")
	if err := os.MkdirAll(filepath.Dir(clone), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(clone, []byte("clone"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, id := range accounts.Engines {
		if err := (accounts.Store{Dir: f.state}).Set(id, "sk-"+string(id)); err != nil {
			t.Fatal(err)
		}
	}
	stitch := mcp.Server{Name: "stitch", Transport: mcp.TransportStdio, Command: "stitch-mcp", Env: map[string]string{"API_KEY": "s3cr3t"}}
	if err := (mcp.Store{Dir: f.state}).Add(stitch); err != nil {
		t.Fatal(err)
	}
	return f, tl
}

// mcpSecret is the stitch server's API_KEY as the keychain holds it.
const mcpSecret = "mcp:stitch:env:API_KEY"

func TestUninstallAsksFirstAndKeepsEverythingWithoutAYes(t *testing.T) {
	f, tl := uninstallable(t)

	out, err := f.execute(t, "n\n", "uninstall")
	if err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	if !strings.Contains(out, "Supprimer le Runner, ses clones et ~/.crewdeck ? (o/N)") || !strings.Contains(out, "Rien n’a été supprimé.") {
		t.Fatalf("uninstall printed %q", out)
	}
	for _, path := range []string{f.state, f.binary, service.File(f.service)} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("%s: %v, want it kept", path, err)
		}
	}
	if _, err := (accounts.Store{Dir: f.state}).Get(contracts.EngineIdClaudeCode); err != nil {
		t.Fatalf("key: %v, want it kept", err)
	}
	if secret, err := keyring.Get(accounts.Service, mcpSecret); err != nil || secret != "s3cr3t" {
		t.Fatalf("secret of the Serveur MCP stitch: %q, %v, want it kept", secret, err)
	}
	if calls := tl.calls(t); calls != nil {
		t.Fatalf("calls %q, want none", calls)
	}
}

func TestUninstallRemovesTheServiceTheFolderTheKeysAndTheBinary(t *testing.T) {
	for _, in := range []string{"o\n", "oui\n"} {
		f, tl := uninstallable(t)

		out, err := f.execute(t, in, "uninstall")
		if err != nil {
			t.Fatalf("uninstall: %v", err)
		}
		if !strings.Contains(out, "Le Runner reste listé sur ton compte jusqu’à ce qu’une nouvelle liaison le remplace.") {
			t.Fatalf("uninstall printed %q", out)
		}
		want := []string{"systemctl --user disable --now crewdeck-runner.service", "systemctl --user daemon-reload"}
		if got := tl.calls(t); !reflect.DeepEqual(got, want) {
			t.Fatalf("calls %q, want %q", got, want)
		}
		for _, path := range []string{f.state, f.binary, service.File(f.service)} {
			if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("%s: %v, want it removed", path, err)
			}
		}
		for _, id := range accounts.Engines {
			if _, err := keyring.Get(accounts.Service, string(id)); !errors.Is(err, keyring.ErrNotFound) {
				t.Fatalf("key of %s: %v, want it deleted", id, err)
			}
		}
		if _, err := keyring.Get(accounts.Service, mcpSecret); !errors.Is(err, keyring.ErrNotFound) {
			t.Fatalf("secret of the Serveur MCP stitch: %v, want it deleted", err)
		}
	}
}

func TestUninstallYesDoesNotAsk(t *testing.T) {
	f, _ := uninstallable(t)

	out, err := f.execute(t, "", "uninstall", "--yes")
	if err != nil {
		t.Fatalf("uninstall --yes: %v", err)
	}
	if strings.Contains(out, "(o/N)") {
		t.Fatalf("uninstall --yes asked: %q", out)
	}
	if _, err := os.Stat(f.state); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("%s: %v, want it removed", f.state, err)
	}
}

func TestUninstallRefusesAFolderThatIsTheHomeBeforeRemovingAnything(t *testing.T) {
	f, tl := uninstallable(t)
	t.Setenv("HOME", f.home)
	t.Setenv(state.HomeEnv, f.home)
	// The keys of this Runner, kept in the folder it would remove.
	for _, id := range accounts.Engines {
		if err := (accounts.Store{Dir: f.home}).Set(id, "sk-"+string(id)); err != nil {
			t.Fatal(err)
		}
	}

	_, err := f.execute(t, "", "uninstall", "--yes")
	if err == nil || !strings.Contains(err.Error(), "rien n’a été supprimé") {
		t.Fatalf("uninstall = %v, want a refusal", err)
	}
	assertUntouched(t, f, tl, f.home)
}

func TestUninstallStopsWhenTheKeychainRefusesAKey(t *testing.T) {
	f, tl := uninstallable(t)
	keyring.MockInitWithError(errors.New("the keychain is locked"))

	out, err := f.execute(t, "", "uninstall", "--yes")
	if err == nil || !strings.Contains(err.Error(), "Les secrets des Serveurs MCP n’ont pas pu être retirés du trousseau") || !strings.Contains(err.Error(), "relance « crewdeck-runner uninstall »") {
		t.Fatalf("uninstall = %v, want the keychain's refusal", err)
	}
	if strings.Contains(out, "Runner supprimé") {
		t.Fatalf("uninstall announced its success: %q", out)
	}
	for _, path := range []string{f.state, f.binary, service.File(f.service)} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("%s: %v, want it kept", path, err)
		}
	}
	if calls := tl.calls(t); calls != nil {
		t.Fatalf("calls %q, want none", calls)
	}
}

// assertUntouched: the service, the folder, the binary and the keys of the
// Runner whose keys are in dir are all still there.
func assertUntouched(t *testing.T, f *machineFixture, tl *tools, dir string) {
	t.Helper()
	for _, path := range []string{f.state, f.binary, service.File(f.service)} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("%s: %v, want it kept", path, err)
		}
	}
	for _, id := range accounts.Engines {
		if _, err := (accounts.Store{Dir: dir}).Get(id); err != nil {
			t.Fatalf("key of %s: %v, want it kept", id, err)
		}
	}
	if calls := tl.calls(t); calls != nil {
		t.Fatalf("calls %q, want none", calls)
	}
}

// buildServer serves the version latest and its build for this platform,
// with the checksum sum (the build's own when empty).
func buildServer(t *testing.T, latest, build, sum string) *httptest.Server {
	t.Helper()
	if sum == "" {
		digest := sha256.Sum256([]byte(build))
		sum = hex.EncodeToString(digest[:])
	}
	platform := runtime.GOOS + "-" + runtime.GOARCH
	mux := http.NewServeMux()
	mux.HandleFunc("GET /runner/latest", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"version":"` + latest + `"}`))
	})
	mux.HandleFunc("GET /runner/"+latest+"/"+platform, func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(build))
	})
	mux.HandleFunc("GET /runner/"+latest+"/"+platform+".sha256", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(sum + "  crewdeck-runner\n"))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestUpdateReplacesTheBinaryAndRestartsAnActiveService(t *testing.T) {
	setVersion(t, "abc1234")
	tl := fakeTools(t, "systemctl")
	f := newMachineFixture(t, linux)
	f.installService(t)
	f.link(t, buildServer(t, "def5678", "new build", "").URL)

	out, err := f.execute(t, "", "update")
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if !strings.Contains(out, "Runner mis à jour : abc1234 → def5678.") || !strings.Contains(out, "Runner redémarré.") {
		t.Fatalf("update printed %q", out)
	}
	if data, _ := os.ReadFile(f.binary); string(data) != "new build" {
		t.Fatalf("binary holds %q, want the new build", data)
	}
	want := []string{"systemctl --user is-active --quiet crewdeck-runner.service", "systemctl --user restart crewdeck-runner.service"}
	if got := tl.calls(t); !reflect.DeepEqual(got, want) {
		t.Fatalf("calls %q, want %q", got, want)
	}
}

func TestUpdateWithABadChecksumKeepsTheOldBinary(t *testing.T) {
	setVersion(t, "abc1234")
	f := newMachineFixture(t, service.Config{OS: "linux", WSL: true})
	f.link(t, buildServer(t, "def5678", "new build", strings.Repeat("0", 64)).URL)

	_, err := f.execute(t, "", "update")
	if err == nil || !strings.Contains(err.Error(), "l’ancien est gardé") {
		t.Fatalf("update = %v, want the checksum refusal", err)
	}
	if data, _ := os.ReadFile(f.binary); string(data) != "build" {
		t.Fatalf("binary holds %q, want the old build", data)
	}
}

func TestUpdateOfARunnerUpToDateDoesNothing(t *testing.T) {
	setVersion(t, "abc1234")
	f := newMachineFixture(t, service.Config{OS: "linux", WSL: true})
	f.link(t, buildServer(t, "abc1234", "same build", "").URL)

	out, err := f.execute(t, "", "update")
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if !strings.Contains(out, "Le Runner est à jour (abc1234).") {
		t.Fatalf("update printed %q", out)
	}
	if data, _ := os.ReadFile(f.binary); string(data) != "build" {
		t.Fatalf("binary holds %q, want it untouched", data)
	}
}
