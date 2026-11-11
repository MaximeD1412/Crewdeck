package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/service"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// tools puts fake commands first on PATH: each records its call in
// calls.log and prints, then exits with, what its <name>.<first argument>
// .out and .code files of the folder hold, else its <name>.out and
// <name>.code (empty and 0 by default).
type tools struct {
	dir string
}

func fakeTools(t *testing.T, names ...string) *tools {
	t.Helper()
	tl := &tools{dir: t.TempDir()}
	for _, name := range names {
		base := filepath.Join(tl.dir, name)
		script := "#!/bin/sh\n" +
			"echo \"" + name + " $*\" >> '" + filepath.Join(tl.dir, "calls.log") + "'\n" +
			"for answer in '" + base + "'.\"$1\" '" + base + "'; do\n" +
			"  if [ -f \"$answer.code\" ]; then\n" +
			"    [ -f \"$answer.out\" ] && cat \"$answer.out\"\n" +
			"    exit $(cat \"$answer.code\")\n" +
			"  fi\n" +
			"done\n" +
			"exit 0\n"
		if err := os.WriteFile(filepath.Join(tl.dir, name), []byte(script), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", tl.dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return tl
}

// answer has the fake command print out and exit with code.
func (tl *tools) answer(t *testing.T, name, out string, code int) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(tl.dir, name+".out"), []byte(out), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tl.dir, name+".code"), []byte(itoa(code)), 0o644); err != nil {
		t.Fatal(err)
	}
}

// answerTo has the fake command called with sub as its first argument print out and exit with code.
func (tl *tools) answerTo(t *testing.T, name, sub, out string, code int) {
	t.Helper()
	tl.answer(t, name+"."+sub, out, code)
}

func (tl *tools) calls(t *testing.T) []string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(tl.dir, "calls.log"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimSpace(string(data)), "\n")
}

// machineFixture is a machine of a temporary home: its service config,
// its binary, its Moteurs.
type machineFixture struct {
	home    string
	state   string
	binary  string
	service service.Config
	engines []contracts.EngineCapabilities
}

func newMachineFixture(t *testing.T, cfg service.Config) *machineFixture {
	t.Helper()
	f := &machineFixture{home: t.TempDir()}
	f.state = filepath.Join(f.home, ".crewdeck")
	t.Setenv(state.HomeEnv, f.state)
	f.binary = filepath.Join(f.home, ".local", "bin", "crewdeck-runner")
	if err := os.MkdirAll(filepath.Dir(f.binary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f.binary, []byte("build"), 0o755); err != nil {
		t.Fatal(err)
	}
	cfg.Home = f.home
	f.service = cfg
	return f
}

func (f *machineFixture) installService(t *testing.T) {
	t.Helper()
	file := service.File(f.service)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("unit"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func (f *machineFixture) link(t *testing.T, server string) {
	t.Helper()
	if err := (state.Store{Dir: f.state}).Save(state.State{Server: server, RunnerID: "runner-id", Token: "rnr_token"}); err != nil {
		t.Fatal(err)
	}
}

func (f *machineFixture) machine() *machine {
	return &machine{
		service:    func() (service.Config, error) { return f.service, nil },
		executable: func() (string, error) { return f.binary, nil },
		engines: func(context.Context) []contracts.EngineCapabilities {
			return f.engines
		},
	}
}

// execute runs the root command of the fixture's machine with args, stdin in.
func (f *machineFixture) execute(t *testing.T, in string, args ...string) (string, error) {
	t.Helper()
	var out bytes.Buffer
	root := newRoot(f.machine())
	root.SetOut(&out)
	root.SetErr(&out)
	root.SetIn(strings.NewReader(in))
	root.SetArgs(args)
	err := root.Execute()
	return out.String(), err
}
