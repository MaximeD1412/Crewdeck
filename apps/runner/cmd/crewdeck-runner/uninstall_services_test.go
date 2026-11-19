package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/command"
)

func TestUninstallStopsARunningServiceBeforeRemovingTheRunnersFolder(t *testing.T) {
	f, _ := uninstallable(t)
	marks := t.TempDir()
	mark, ready := filepath.Join(marks, "stopped-while-the-folder-was-there"), filepath.Join(marks, "ready")
	// A service that says, once it gets its SIGTERM, whether ~/.crewdeck was still there.
	svc := exec.Command("sh", "-c", "trap 'test -d \""+f.state+"\" && touch \""+mark+"\"; exit 0' TERM; touch \""+ready+"\"; while :; do sleep 0.05; done")
	svc.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := svc.Start(); err != nil {
		t.Fatal(err)
	}
	exited := make(chan struct{})
	go func() { _ = svc.Wait(); close(exited) }()
	t.Cleanup(func() { _ = syscall.Kill(-svc.Process.Pid, syscall.SIGKILL) })
	pid := svc.Process.Pid
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(10 * time.Millisecond) {
		if _, err := os.Stat(ready); err == nil {
			break
		}
	}
	started, err := command.StartTime(pid)
	if err != nil {
		t.Fatal(err)
	}
	record, _ := json.Marshal(map[string]any{"pid": pid, "pgid": pid, "startedAt": started, "runId": "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01"})
	pidFile := filepath.Join(f.state, "services", "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a92", "cmd-dev.pid")
	if err := os.MkdirAll(filepath.Dir(pidFile), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(pidFile, record, 0o600); err != nil {
		t.Fatal(err)
	}

	out, err := f.execute(t, "", "uninstall", "--yes")
	if err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	select {
	case <-exited:
	case <-time.After(5 * time.Second):
		t.Fatal("the service still runs after the uninstall")
	}
	if _, err := os.Stat(mark); err != nil {
		t.Fatalf("the service was not stopped before ~/.crewdeck was removed: %v; out %q", err, out)
	}
	if !strings.Contains(out, "1 service arrêté.") {
		t.Fatalf("uninstall printed %q, want the service stopped", out)
	}
}

func TestUninstallSaysNothingOfServicesWhenNoneRan(t *testing.T) {
	f, _ := uninstallable(t)
	out, err := f.execute(t, "", "uninstall", "--yes")
	if err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	if strings.Contains(out, "arrêté") {
		t.Fatalf("uninstall printed %q, want no service", out)
	}
}
