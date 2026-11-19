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
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/command"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// TestMain lets this test binary serve as the local HTTP server a Commande
// starts, when it is run with CREWDECK_TEST_SERVE set to a port: it listens
// after CREWDECK_TEST_SERVE_AFTER (a duration), answers each GET with
// CREWDECK_TEST_SERVE_STATUS (200 by default; a 3xx to /login, which
// answers 200) and its pid, and prints
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
	_ = http.Serve(listener, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		fmt.Println("served")
		if req.URL.Path == "/login" {
			fmt.Fprint(w, os.Getpid())
			return
		}
		if status >= 300 && status < 400 {
			w.Header().Set("Location", "/login") // which answers 200
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
	// Its address answers a 302 to a page that answers 200: the address given is the one that must answer 2xx.
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

func TestHealthAServiceWhoseShellExitsHasTheChildItLeftStopped(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	port := freePort(t)
	// The server, a child of the shell in its group, outlives it.
	text := strings.TrimPrefix(server(t, port, 0), "exec ") + " > /dev/null 2>&1 & echo $! > " + h.mark("child") + "; sleep 2"

	h.commands.Run(h.healthRun(t, runID, text, address(port), sha))
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonHealthy {
		t.Fatalf("verdict %+v, want healthy", v)
	}
	child := pidIn(t, h.mark("child"))
	shell := h.service(t).Pid
	if !dies(shell) && !dies(shell) {
		t.Fatal("the service's shell did not exit")
	}
	if !dies(child) {
		t.Fatal("the server its shell left still runs, untracked")
	}
	deadline := time.Now().Add(5 * time.Second)
	for exists(h.pidFile()) && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if exists(h.pidFile()) {
		t.Fatal("the pid file of a service gone is still there")
	}
}

// zombie says whether pid exited and is not reaped yet.
func zombie(pid int) bool {
	stat, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return false
	}
	fields := strings.Fields(string(stat[strings.LastIndexByte(string(stat), ')')+1:]))
	return len(fields) > 0 && fields[0] == "Z"
}

// becomesZombie waits for pid to exit, unreaped.
func becomesZombie(t *testing.T, pid int) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !zombie(pid) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !zombie(pid) {
		t.Fatalf("pid %d is not an unreaped zombie (alive %v)", pid, alive(pid))
	}
}

func TestHealthAServiceWhoseGroupCannotBeStoppedKeepsItsCommandeFromRunningUntilItIs(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	refuse, child, shell, port := h.stuckService(t, sha)
	h.commands.Run(h.healthRun(t, secondRun, "touch "+h.mark("second"), address(port), sha))
	if v := h.sent.verdict(t, secondRun); v.Reason != contracts.RunnerCommandVerdictReasonSpawnFailed {
		t.Fatalf("verdict %+v, want spawn-failed while the service's group lives", v)
	}
	if exists(h.mark("second")) || !alive(child) || !exists(h.pidFile()) {
		t.Fatal("the Commande ran beside its service, or the service was dropped")
	}

	// Once it can be stopped, the next run stops it first, then runs.
	refuse.Store(false)
	const thirdRun = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c03"
	h.commands.Run(h.run(t, thirdRun, "touch "+h.mark("third"), "project", sha))
	if v := h.sent.verdict(t, thirdRun); !v.Passed {
		t.Fatalf("verdict %+v, want passed", v)
	}
	if !dies(child) || !exists(h.mark("third")) || exists(h.pidFile()) {
		t.Fatal("the service was not stopped before its Commande ran again")
	}
	if zombie(shell) {
		t.Fatal("the service's shell was never reaped")
	}
}

func TestHealthAServicesGroupIsSignalledOnlyWhileItsProcessIsUnreaped(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	var shell atomic.Int64
	reused := make(chan int, 10)
	t.Cleanup(command.SetKill(func(pid int, sig syscall.Signal) error {
		// Its pid gone, a group of that id could be another's: none signalled then.
		if leader := int(shell.Load()); pid == -leader && sig != 0 {
			if _, err := os.Stat("/proc/" + strconv.Itoa(leader)); err != nil {
				reused <- leader
			}
		}
		return syscall.Kill(pid, sig)
	}))
	port := freePort(t)
	text := strings.TrimPrefix(server(t, port, 0), "exec ") + " > /dev/null 2>&1 & echo $! > " + h.mark("child") + "; sleep 2"
	h.commands.Run(h.healthRun(t, runID, text, address(port), sha))
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonHealthy {
		t.Fatalf("verdict %+v, want healthy", v)
	}
	child := pidIn(t, h.mark("child"))
	t.Cleanup(func() { _ = syscall.Kill(child, syscall.SIGKILL) })
	shell.Store(int64(h.service(t).Pid))
	if !dies(child) {
		t.Fatal("the server its shell left still runs")
	}
	deadline := time.Now().Add(5 * time.Second)
	for exists(h.pidFile()) && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	select {
	case pid := <-reused:
		t.Fatalf("the group %d was signalled once its process was reaped", pid)
	default:
	}
}

// stuckService starts a service whose shell exits after 2 s and leaves its
// server in its group, then makes every signal to a group fail: its shell
// is left an unreaped zombie, its server alive. refuse lets them through
// again once false.
func (h *harness) stuckService(t *testing.T, sha string) (refuse *atomic.Bool, child, shell int, port string) {
	t.Helper()
	refuse = new(atomic.Bool)
	t.Cleanup(command.SetKill(func(pid int, sig syscall.Signal) error {
		if refuse.Load() && pid < 0 {
			return syscall.EPERM
		}
		return syscall.Kill(pid, sig)
	}))
	port = freePort(t)
	text := strings.TrimPrefix(server(t, port, 0), "exec ") + " > /dev/null 2>&1 & echo $! > " + h.mark("child") + "; sleep 2"
	h.commands.Run(h.healthRun(t, runID, text, address(port), sha))
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonHealthy {
		t.Fatalf("verdict %+v, want healthy", v)
	}
	child = pidIn(t, h.mark("child"))
	t.Cleanup(func() { _ = syscall.Kill(child, syscall.SIGKILL) })
	shell = h.service(t).Pid
	refuse.Store(true)

	// Its shell exits, the server it left cannot be stopped: the service is not over.
	becomesZombie(t, shell)
	time.Sleep(200 * time.Millisecond)
	if !alive(child) || !exists(h.pidFile()) {
		t.Fatalf("child alive %v, pid file %v: want both", alive(child), exists(h.pidFile()))
	}
	return refuse, child, shell, port
}

func TestServiceStopServicesStopsTheGroupAServiceLeftBehindItsUnreapedShell(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	refuse, child, _, _ := h.stuckService(t, sha)

	// As uninstall does: the zombie is still the service's, its server is stopped.
	refuse.Store(false)
	stopped, err := command.StopServices(h.home)
	if err != nil || stopped != 1 {
		t.Fatalf("StopServices = %d, %v; want 1 service stopped", stopped, err)
	}
	if !dies(child) || exists(h.pidFile()) {
		t.Fatalf("child alive %v, pid file %v: want neither", alive(child), exists(h.pidFile()))
	}
}

func TestServiceStopServicesFailsWhileTheGroupBehindAnUnreapedShellCannotBeStopped(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	_, child, _, _ := h.stuckService(t, sha)

	if _, err := command.StopServices(h.home); err == nil {
		t.Fatal("StopServices said nothing of a service it could not stop")
	}
	if !alive(child) || !exists(h.pidFile()) {
		t.Fatalf("child alive %v, pid file %v: want both kept", alive(child), exists(h.pidFile()))
	}
}

func TestHealthARunWhoseExitCannotBeWatchedIsStillKilledAfterTheWindow(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	t.Cleanup(command.FailWatch(syscall.EMFILE))
	h.start(t)
	text := "echo $$ > " + h.mark("pid") + "; exec sleep 300"

	h.commands.Run(h.healthRun(t, runID, text, address(freePort(t)), sha))
	pid := pidIn(t, h.mark("pid"))
	t.Cleanup(func() { _ = syscall.Kill(pid, syscall.SIGKILL) })
	h.clock.fire(t, command.HealthWindow)
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonHealthTimeout {
		t.Fatalf("verdict %+v, want health-timeout", v)
	}
	if !dies(pid) {
		t.Fatal("a run whose exit was not watched was not killed")
	}
}

func TestHealthARunWhoseExitCannotBeWatchedStillGivesItsExitCode(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	t.Cleanup(command.FailWatch(syscall.EMFILE))
	h.start(t)

	h.commands.Run(h.healthRun(t, runID, "exit 1", address(freePort(t)), sha))
	v := h.sent.verdict(t, runID)
	if v.Reason != contracts.RunnerCommandVerdictReasonExited || code(v) != 1 {
		t.Fatalf("verdict %+v, want exited with 1", v)
	}
}

func TestHealthAnUnwatchedRunThatExitsZeroHasWhatItLeftKilledAfterTheWindow(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	t.Cleanup(command.FailWatch(syscall.EMFILE))
	h.start(t)
	text := "echo $$ > " + h.mark("shell") + "; sleep 300 > /dev/null 2>&1 & echo $! > " + h.mark("child") + "; exit 0"

	h.commands.Run(h.healthRun(t, runID, text, address(freePort(t)), sha))
	shell, child := pidIn(t, h.mark("shell")), pidIn(t, h.mark("child"))
	t.Cleanup(func() { _ = syscall.Kill(child, syscall.SIGKILL) })
	if !dies(shell) {
		t.Fatal("the shell did not exit")
	}
	time.Sleep(500 * time.Millisecond) // its exit noticed: a zombie, every 100 ms
	h.clock.fire(t, command.HealthWindow)
	if v := h.sent.verdict(t, runID); v.Reason != contracts.RunnerCommandVerdictReasonHealthTimeout {
		t.Fatalf("verdict %+v, want health-timeout", v)
	}
	if !dies(child) {
		t.Fatal("what an unwatched run left in its group outlived its window")
	}
}

func TestHealthAnAddressThatAnswersAfterAnUnnoticedExitOneFailsExited(t *testing.T) {
	h := newHarness(t)
	sha := h.remote.ticket(t)
	t.Cleanup(command.FailWatch(syscall.EMFILE))
	t.Cleanup(command.SlowPoll(4 * time.Second))
	h.start(t)
	port := freePort(t)
	// A server of its own session answers after 500 ms; the run exits 1 at once.
	text := "setsid sh -c \"" + strings.ReplaceAll(server(t, port, 500*time.Millisecond), "'", "") + " > /dev/null 2>&1 & echo \\$! > " + h.mark("daemon") + "\"; exit 1"

	h.commands.Run(h.healthRun(t, runID, text, address(port), sha))
	daemon := pidIn(t, h.mark("daemon"))
	t.Cleanup(func() { _ = syscall.Kill(daemon, syscall.SIGKILL) })
	v := h.sent.verdict(t, runID)
	if v.Passed || v.Reason != contracts.RunnerCommandVerdictReasonExited || code(v) != 1 {
		t.Fatalf("verdict %+v, want not passed, exited, 1", v)
	}
	if exists(h.pidFile()) {
		t.Fatal("a run that exited 1 has a pid file")
	}
}

// mainThreadExits is a server whose main thread exits (pthread_exit) while
// another thread binds the port given, half a second later, and serves it.
// It exits on its own after a minute, so a failing test leaves nothing.
const mainThreadExits = `import ctypes, http.server, os, sys, threading, time
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
    def log_message(self, *a): pass
def serve():
    time.sleep(0.5)
    http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
threading.Thread(target=serve).start()
threading.Timer(60, os._exit, (0,)).start()
ctypes.CDLL(None).pthread_exit(None)
`

func TestHealthAServiceWhoseMainThreadExitsWhileAnotherServesIsKeptThenStopped(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 is needed for a process whose main thread exits")
	}
	h := newHarness(t)
	sha := h.remote.ticket(t)
	h.start(t)
	port := freePort(t)
	script := filepath.Join(t.TempDir(), "main_exits.py")
	if err := os.WriteFile(script, []byte(mainThreadExits), 0o600); err != nil {
		t.Fatal(err)
	}

	h.commands.Run(h.healthRun(t, runID, "exec '"+python+"' '"+script+"' "+port, address(port), sha))
	if v := h.sent.verdict(t, runID); !v.Passed || v.Reason != contracts.RunnerCommandVerdictReasonHealthy || v.ExitCode != nil {
		t.Fatalf("verdict %+v, want passed, healthy, no exit code", v)
	}
	rec := h.service(t)
	t.Cleanup(func() { _ = syscall.Kill(-rec.Pgid, syscall.SIGKILL) })
	if !zombie(rec.Pid) {
		t.Fatal("the service's main thread is not a zombie")
	}
	if status, _ := get(t, address(port)); status != http.StatusOK {
		t.Fatalf("GET %d, want 200 from its other thread", status)
	}

	// Its Commande run again stops it first: its threads, not its main one alone.
	h.commands.Run(h.run(t, secondRun, "exit 0", "project", sha))
	if v := h.sent.verdict(t, secondRun); !v.Passed {
		t.Fatalf("verdict %+v, want passed", v)
	}
	client := &http.Client{Timeout: time.Second}
	if res, err := client.Get(address(port)); err == nil {
		res.Body.Close()
		t.Fatal("the service still answers once its Commande ran again")
	}
	if exists(h.pidFile()) {
		t.Fatal("the stopped service's pid file is still there")
	}
}
