package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// buildRunner builds this command at version into out.
func buildRunner(t *testing.T, version, out string) {
	t.Helper()
	goTool, err := exec.LookPath("go")
	if err != nil {
		goTool = filepath.Join(runtime.GOROOT(), "bin", "go")
	}
	build := exec.Command(goTool, "build", "-ldflags", "-X main.version="+version, "-o", out, ".")
	build.Env = append(os.Environ(), "CGO_ENABLED=0")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("go build %s: %v\n%s", version, err, output)
	}
}

// updatingServer speaks the protocol to Runners: it rejects with
// update-required any hello but latest's, and serves latest's build with
// the checksum sum (the build's own when empty). hellos receives the
// version of each hello.
func updatingServer(t *testing.T, latest string, build []byte, sum string) (*httptest.Server, chan string) {
	t.Helper()
	if sum == "" {
		digest := sha256.Sum256(build)
		sum = hex.EncodeToString(digest[:])
	}
	hellos := make(chan string, 8)
	platform := runtime.GOOS + "-" + runtime.GOARCH
	at := time.Date(2026, 11, 11, 9, 0, 0, 0, time.UTC)
	const id = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a00"
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		_, data, err := conn.Read(r.Context())
		if err != nil {
			return
		}
		var hello contracts.RunnerHello
		if err := json.Unmarshal(data, &hello); err != nil {
			t.Errorf("hello %s: %v", data, err)
			return
		}
		hellos <- hello.RunnerVersion
		if hello.RunnerVersion != latest {
			rejected, _ := json.Marshal(contracts.RunnerHelloRejected{Type: "hello.rejected", Id: id, At: at, Reason: "update-required", LatestVersion: &latest})
			_ = conn.Write(r.Context(), websocket.MessageText, rejected)
			conn.Close(websocket.StatusCode(contracts.CloseUpdateRequired), "update-required")
			return
		}
		accepted, _ := json.Marshal(contracts.RunnerHelloAccepted{Type: "hello.accepted", Id: id, At: at, RunnerId: id, ProtocolVersion: contracts.ProtocolVersion})
		_ = conn.Write(r.Context(), websocket.MessageText, accepted)
		for {
			if _, _, err := conn.Read(r.Context()); err != nil {
				return
			}
		}
	})
	mux.HandleFunc("GET /runner/latest", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"version":"` + latest + `"}`))
	})
	mux.HandleFunc("GET /runner/"+latest+"/"+platform, func(w http.ResponseWriter, _ *http.Request) {
		w.Write(build)
	})
	mux.HandleFunc("GET /runner/"+latest+"/"+platform+".sha256", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(sum + "  crewdeck-runner-" + platform + "\n"))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, hellos
}

type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// startRunner runs the build at binary, linked to server, in the
// foreground (as no service runs it); stopped at the test's end.
func startRunner(t *testing.T, binary, server string) *lockedBuffer {
	t.Helper()
	home := t.TempDir()
	dir := filepath.Join(home, ".crewdeck")
	if err := (state.Store{Dir: dir}).Save(state.State{Server: server, RunnerID: "runner-id", Token: "rnr_token"}); err != nil {
		t.Fatal(err)
	}
	var env []string
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, "INVOCATION_ID=") && !strings.HasPrefix(kv, "XPC_SERVICE_NAME=") && !strings.HasPrefix(kv, state.HomeEnv+"=") {
			env = append(env, kv)
		}
	}
	logs := &lockedBuffer{}
	runner := exec.Command(binary, "run")
	runner.Env = append(env, state.HomeEnv+"="+dir, "HOME="+home)
	runner.Stdout = logs
	runner.Stderr = logs
	if err := runner.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = runner.Process.Kill()
		_ = runner.Wait()
		if t.Failed() {
			t.Logf("the Runner's log:\n%s", logs.String())
		}
	})
	return logs
}

func nextHello(t *testing.T, hellos chan string) string {
	t.Helper()
	select {
	case v := <-hellos:
		return v
	case <-time.After(30 * time.Second):
		t.Fatal("no hello")
		return ""
	}
}

func TestARunnerRejectedForAnUpdateReplacesItselfThenReconnectsWithTheNewVersion(t *testing.T) {
	if testing.Short() {
		t.Skip("builds the Runner twice")
	}
	if runtime.GOOS == "windows" {
		t.Skip("the Runner runs on Linux and macOS")
	}
	builds := t.TempDir()
	buildRunner(t, "v1", filepath.Join(builds, "v1"))
	buildRunner(t, "v2", filepath.Join(builds, "v2"))
	v1, err := os.ReadFile(filepath.Join(builds, "v1"))
	if err != nil {
		t.Fatal(err)
	}
	v2, err := os.ReadFile(filepath.Join(builds, "v2"))
	if err != nil {
		t.Fatal(err)
	}
	install := func(t *testing.T) string {
		binary := filepath.Join(t.TempDir(), "crewdeck-runner")
		if err := os.WriteFile(binary, v1, 0o755); err != nil {
			t.Fatal(err)
		}
		return binary
	}

	t.Run("a verified build", func(t *testing.T) {
		srv, hellos := updatingServer(t, "v2", v2, "")
		binary := install(t)
		startRunner(t, binary, srv.URL)

		if v := nextHello(t, hellos); v != "v1" {
			t.Fatalf("first hello of %q, want v1", v)
		}
		if v := nextHello(t, hellos); v != "v2" {
			t.Fatalf("hello after the update of %q, want v2", v)
		}
		if data, _ := os.ReadFile(binary); !bytes.Equal(data, v2) {
			t.Fatal("the binary is not the build v2")
		}
	})

	t.Run("a bad checksum", func(t *testing.T) {
		srv, hellos := updatingServer(t, "v2", v2, strings.Repeat("0", 64))
		binary := install(t)
		logs := startRunner(t, binary, srv.URL)

		if v := nextHello(t, hellos); v != "v1" {
			t.Fatalf("first hello of %q, want v1", v)
		}
		deadline := time.Now().Add(30 * time.Second)
		for !strings.Contains(logs.String(), `"msg":"update.checksum-mismatch"`) {
			if time.Now().After(deadline) {
				t.Fatal("no update.checksum-mismatch in the log")
			}
			time.Sleep(50 * time.Millisecond)
		}
		if data, _ := os.ReadFile(binary); !bytes.Equal(data, v1) {
			t.Fatal("the binary is not the build v1 any more")
		}
		select {
		case v := <-hellos:
			t.Fatalf("a hello of %q before the next attempt, ten minutes later", v)
		case <-time.After(time.Second):
		}
	})
}
