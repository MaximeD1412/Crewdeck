package command_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/command"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// TestMain lets this test binary serve as the local HTTP server a Commande
// starts, when it is run with CREWDECK_TEST_SERVE set to a port: it listens
// after CREWDECK_TEST_SERVE_AFTER (a duration), answers each GET with
// CREWDECK_TEST_SERVE_STATUS (200 by default) and its pid, and prints
// « served » on its stdout for each.
func TestMain(m *testing.M) {
	if port := os.Getenv("CREWDECK_TEST_SERVE"); port != "" {
		serve(port)
		return
	}
	os.Exit(m.Run())
}

func serve(port string) {
	if after, err := time.ParseDuration(os.Getenv("CREWDECK_TEST_SERVE_AFTER")); err == nil {
		time.Sleep(after)
	}
	status := http.StatusOK
	if s, err := strconv.Atoi(os.Getenv("CREWDECK_TEST_SERVE_STATUS")); err == nil {
		status = s
	}
	listener, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		fmt.Fprintln(os.Stderr, "listen:", err)
		os.Exit(1)
	}
	_ = http.Serve(listener, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Println("served")
		if status >= 300 && status < 400 {
			w.Header().Set("Location", "/")
		}
		w.WriteHeader(status)
		fmt.Fprint(w, os.Getpid())
	}))
}

// freePort is a TCP port of 127.0.0.1 nothing listens on.
func freePort(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return strconv.Itoa(listener.Addr().(*net.TCPAddr).Port)
}

// server is the text of a Commande that becomes the test's HTTP server on
// port, listening after delay (the shell exec'ing it: the server is the
// run's process).
func server(t *testing.T, port string, delay time.Duration, env ...string) string {
	t.Helper()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	vars := append([]string{"CREWDECK_TEST_SERVE=" + port, "CREWDECK_TEST_SERVE_AFTER=" + delay.String()}, env...)
	return "exec env " + strings.Join(vars, " ") + " '" + binary + "' -test.run='^$'"
}

func address(port string) string { return "http://127.0.0.1:" + port + "/health" }

// healthRun is the command.run of the Commande cmd-tests with a health address.
func (h *harness) healthRun(t *testing.T, id, text, healthURL, sha string) contracts.RunnerCommandRun {
	t.Helper()
	message := h.run(t, id, text, "project", sha)
	message.Sealed = h.seal(t, projectID, map[string]commande{"cmd-tests": {Run: text, Where: "project", HealthURL: healthURL}})
	return message
}

// record is a service's pid file, as the Runner writes it.
type record struct {
	Pid       int    `json:"pid"`
	Pgid      int    `json:"pgid"`
	StartedAt string `json:"startedAt"`
	RunID     string `json:"runId"`
}

func (h *harness) pidFile() string {
	return filepath.Join(h.home, "services", projectID, "cmd-tests.pid")
}

func (h *harness) service(t *testing.T) record {
	t.Helper()
	var rec record
	if err := json.Unmarshal([]byte(read(t, h.pidFile())), &rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

// get is the status and body of a GET of url.
func get(t *testing.T, url string) (int, string) {
	t.Helper()
	client := &http.Client{Timeout: 2 * time.Second}
	res, err := client.Get(url)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(body)
}

func mode(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	return info.Mode().Perm()
}

func TestHealthAServerThatAnswersAfterTwoSecondsPassesHealthyAndRunsOnAsAService(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	port := freePort(t)

	h.commands.Run(h.healthRun(t, runID, server(t, port, 2*time.Second), address(port), sha))
	v := h.sent.verdict(t, runID)
	if !v.Passed || v.Reason != contracts.RunnerCommandVerdictReasonHealthy || v.ExitCode != nil {
		t.Fatalf("verdict %+v, want passed, healthy, no exit code", v)
	}

	rec := h.service(t)
	if rec.RunID != runID || rec.Pid <= 0 || rec.Pgid != rec.Pid || rec.StartedAt == "" || !alive(rec.Pid) {
		t.Fatalf("pid file %+v, want the run's live group with its start time", rec)
	}
	if got, err := command.StartTime(rec.Pid); err != nil || got != rec.StartedAt {
		t.Fatalf("start time %q, %v, want the pid file's %q", got, err, rec.StartedAt)
	}
	if m := mode(t, h.pidFile()); m != 0o600 {
		t.Fatalf("pid file mode %v, want 600", m)
	}
	if m := mode(t, filepath.Dir(h.pidFile())); m != 0o700 {
		t.Fatalf("services folder mode %v, want 700", m)
	}

	// The server still answers, and what it prints goes on to the service's log.
	if status, body := get(t, address(port)); status != http.StatusOK || body != strconv.Itoa(rec.Pid) {
		t.Fatalf("GET after the verdict: %d %q, want 200 from pid %d", status, body, rec.Pid)
	}
	logFile := strings.TrimSuffix(h.pidFile(), ".pid") + ".log"
	deadline := time.Now().Add(5 * time.Second)
	for !strings.Contains(string(must(os.ReadFile(logFile))), "served") && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if !strings.Contains(read(t, logFile), "served") || mode(t, logFile) != 0o600 {
		t.Fatalf("service log %q (mode %v), want what the server printed, mode 600", read(t, logFile), mode(t, logFile))
	}
	var last command.Chunk
	for chunk, err := range command.Replay(h.home, runID, 1) {
		if err != nil {
			t.Fatal(err)
		}
		last = chunk
	}
	if want := fmt.Sprintf("Service démarré (pid %d).\n", rec.Pid); last.Text != want {
		t.Fatalf("the run's log ends with %q, want %q", last.Text, want)
	}
}

func must(data []byte, _ error) []byte { return data }

// asked says whether a run asked the clock for d.
func (c *clock) asks(d time.Duration) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, ok := c.waiting[d]
	return ok
}

func TestHealthARunWithAnAddressIsNotBoundByTheThirtyMinutes(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	port := freePort(t)
	h.commands.Run(h.healthRun(t, runID, server(t, port, 0), address(port), sha))
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonHealthy {
		t.Fatalf("verdict %+v, want healthy", v)
	}
	if h.clock.asks(command.Timeout) || !h.clock.asks(command.HealthWindow) {
		t.Fatal("a run with a health address waits for the 30 min, or not for its 120 s")
	}
}

func TestHealthRunningTheSameCommandeAgainStopsItsServiceFirst(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	port := freePort(t)
	text := server(t, port, 0)

	h.commands.Run(h.healthRun(t, runID, text, address(port), sha))
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonHealthy {
		t.Fatalf("first verdict %+v, want healthy", v)
	}
	first := h.service(t)

	// The second server listens on the same port: it passes only once the first is gone.
	h.commands.Run(h.healthRun(t, secondRun, text, address(port), sha))
	if v := h.sent.verdict(t, secondRun); !v.Passed || v.Reason != contracts.RunnerCommandVerdictReasonHealthy {
		t.Fatalf("second verdict %+v, want healthy", v)
	}
	if alive(first.Pid) {
		t.Fatal("the first server still runs")
	}
	second := h.service(t)
	if second.RunID != secondRun || second.Pid == first.Pid || !alive(second.Pid) {
		t.Fatalf("pid file %+v, want the second run's", second)
	}
	if _, body := get(t, address(port)); body != strconv.Itoa(second.Pid) {
		t.Fatalf("the port answers from pid %s, want the second server %d", body, second.Pid)
	}
}

func TestHealthAnAddressThatAnswersOnceTheCommandExitedZeroPassesWithNoService(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	port := freePort(t)
	// It daemonizes: a server of its own session, then exits 0.
	text := "setsid sh -c \"" + strings.ReplaceAll(server(t, port, time.Second), "'", "") + " > /dev/null 2>&1 & echo \\$! > " + h.mark("daemon") + "\"; exit 0"

	h.commands.Run(h.healthRun(t, runID, text, address(port), sha))
	v := h.sent.verdict(t, runID)
	daemon := pidIn(t, h.mark("daemon"))
	t.Cleanup(func() { _ = syscall.Kill(daemon, syscall.SIGKILL) })
	if !v.Passed || v.Reason != contracts.RunnerCommandVerdictReasonHealthy || code(v) != 0 {
		t.Fatalf("verdict %+v, want passed, healthy, 0", v)
	}
	if exists(h.pidFile()) {
		t.Fatal("a run that exited has a pid file")
	}
}

func TestHealthACommandThatExitsOneFailsExitedWithItsCode(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	h.commands.Run(h.healthRun(t, runID, "exit 1", address(freePort(t)), sha))
	if v := h.sent.verdict(t, runID); v.Passed || v.Reason != contracts.RunnerCommandVerdictReasonExited || code(v) != 1 {
		t.Fatalf("verdict %+v, want not passed, exited, 1", v)
	}
	if exists(h.pidFile()) {
		t.Fatal("a failed run has a pid file")
	}
}

func TestHealthAnAddressThatNeverAnswersFailsAfterTheWindowItsGroupKilled(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	h.commands.Run(h.healthRun(t, runID, "sleep 300 & echo $! > "+h.mark("child")+"; wait", address(freePort(t)), sha))
	h.sent.started(t, runID)
	child := pidIn(t, h.mark("child"))

	h.clock.fire(t, command.HealthWindow)
	v := h.sent.verdict(t, runID)
	if v.Passed || v.Reason != contracts.RunnerCommandVerdictReasonHealthTimeout || v.ExitCode != nil {
		t.Fatalf("verdict %+v, want health-timeout without an exit code", v)
	}
	if !dies(child) {
		t.Fatal("the run's child outlived its group's kill")
	}
	if exists(h.pidFile()) {
		t.Fatal("a run past its window has a pid file")
	}
}

func TestHealthARedirectIsNotHealthy(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	port := freePort(t)
	h.commands.Run(h.healthRun(t, runID, server(t, port, 0, "CREWDECK_TEST_SERVE_STATUS=302"), address(port), sha))
	h.sent.started(t, runID)
	// It answers, with a 302 only.
	deadline := time.Now().Add(10 * time.Second)
	for !strings.Contains(string(must(os.ReadFile(logPathOf(h, runID)))), "served") && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	h.clock.fire(t, command.HealthWindow)
	if v := h.sent.verdict(t, runID); v.Passed || v.Reason != contracts.RunnerCommandVerdictReasonHealthTimeout {
		t.Fatalf("verdict %+v, want health-timeout", v)
	}
}

func logPathOf(h *harness, id string) string {
	return filepath.Join(h.home, "commands", id+".log")
}

func TestHealthAServiceThatExitsByItselfLosesItsPidFile(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	port := freePort(t)
	h.commands.Run(h.healthRun(t, runID, server(t, port, 0), address(port), sha))
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonHealthy {
		t.Fatalf("verdict %+v, want healthy", v)
	}
	rec := h.service(t)
	if err := syscall.Kill(rec.Pid, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for exists(h.pidFile()) && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if exists(h.pidFile()) {
		t.Fatal("the pid file of a service gone is still there")
	}
}

// liveProcess is a process of its own group, the test's child, reaped as it ends.
func liveProcess(t *testing.T) int {
	t.Helper()
	cmd := exec.Command("sleep", "300")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	go func() { _ = cmd.Wait() }()
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	return cmd.Process.Pid
}

func (h *harness) writeRecord(t *testing.T, rec record) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(h.pidFile()), 0o700); err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(rec)
	if err := os.WriteFile(h.pidFile(), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestServiceAPidFileOfAnotherProcessIsRemovedAtStartAndThatProcessNotSignalled(t *testing.T) {
	h := newHarness(t)
	other := liveProcess(t)
	started, err := command.StartTime(other)
	if err != nil {
		t.Fatal(err)
	}
	// Its pid, another start time: a pid the OS gave again.
	h.writeRecord(t, record{Pid: other, Pgid: other, StartedAt: started + "0", RunID: runID})
	h.start(t)
	if exists(h.pidFile()) {
		t.Fatal("the pid file of another process is still there")
	}
	time.Sleep(100 * time.Millisecond)
	if !alive(other) {
		t.Fatal("the process that reused the pid was signalled")
	}
}

func TestServiceASurvivingServiceIsFoundAtStartAndStoppedBeforeItsCommandeRunsAgain(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	survivor := liveProcess(t)
	started, _ := command.StartTime(survivor)
	h.writeRecord(t, record{Pid: survivor, Pgid: survivor, StartedAt: started, RunID: runID})
	h.start(t)
	if !exists(h.pidFile()) || !alive(survivor) {
		t.Fatal("a live service was not kept at start")
	}

	h.commands.Run(h.run(t, secondRun, "exit 0", "project", sha))
	if v := h.sent.verdict(t, secondRun); !v.Passed {
		t.Fatalf("verdict %+v, want passed", v)
	}
	if !dies(survivor) {
		t.Fatal("the service still runs after its Commande ran again")
	}
	if exists(h.pidFile()) {
		t.Fatal("the stopped service's pid file is still there")
	}
}
