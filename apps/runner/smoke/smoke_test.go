// The compiled Runner's smoke test (RUNNER-14), run as the nightly runs it
// on darwin: smoke.sh against the fake server, with a binary built with
// `-tags smoke`. The linux job runs the same script against the real server.
package smoke_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// root is the repository's root, where smoke.sh runs from.
var root, _ = filepath.Abs(filepath.Join("..", "..", ".."))

// runnerDir is the Go module.
var runnerDir = filepath.Join(root, "apps", "runner")

// contratFile is the example Contrat embedded in the binary.
var contratFile = filepath.Join(runnerDir, "internal", "contrat", "contrats", "example.v1.json")

func needs(t *testing.T, tools ...string) {
	t.Helper()
	for _, tool := range tools {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("%s is not on PATH", tool)
		}
	}
}

// build compiles pkg of the Runner's module to out, with the build's extra arguments.
func build(t *testing.T, out, pkg string, args ...string) error {
	t.Helper()
	cmd := exec.Command("go", append(append([]string{"build"}, args...), "-o", out, pkg)...)
	cmd.Dir = runnerDir
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("go build %s: %w\n%s", pkg, err, output)
	}
	return nil
}

// smokeBinary is the Runner built with `-tags smoke`, its Contrats replaced
// as the overlay says when one is given.
func smokeBinary(t *testing.T, overlay string) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "crewdeck-runner")
	args := []string{"-tags", "smoke"}
	if overlay != "" {
		args = append(args, "-overlay", overlay)
	}
	if err := build(t, out, "./cmd/crewdeck-runner", args...); err != nil {
		t.Fatal(err)
	}
	return out
}

// fakeServer starts apps/runner/smoke/fakeserver and gives its URL.
func fakeServer(t *testing.T) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "fakeserver")
	if err := build(t, out, "./smoke/fakeserver"); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(out, "-addr", "127.0.0.1:0", "-fixtures", filepath.Join(root, "packages", "contracts", "fixtures", "runner"))
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var logs bytes.Buffer
	cmd.Stderr = &logs
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Signal(os.Interrupt)
		_ = cmd.Wait()
		if t.Failed() {
			t.Logf("fakeserver:\n%s", logs.String())
		}
	})
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil {
		t.Fatalf("fakeserver gave no URL: %v", err)
	}
	return strings.TrimSpace(line)
}

// smoke runs smoke.sh with the binary against the server.
func smoke(t *testing.T, server, runner string) (string, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", "apps/runner/smoke/smoke.sh")
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "SERVER_URL="+server, "RUNNER="+runner)
	output, err := cmd.CombinedOutput()
	return string(output), err
}

func TestTheSmokeTestPassesAgainstTheFakeServer(t *testing.T) {
	needs(t, "sh", "git", "curl", "jq")
	output, err := smoke(t, fakeServer(t), smokeBinary(t, ""))
	if err != nil {
		t.Fatalf("smoke.sh: %v\n%s", err, output)
	}
	for _, step := range []string{"linked", "session ended ok", "contrat example passed"} {
		if !strings.Contains(output, "smoke: "+step) {
			t.Errorf("smoke.sh never said %q:\n%s", step, output)
		}
	}
}

// overlay is a `go build -overlay` file putting replacement (empty: none)
// in the place of the embedded example Contrat.
func overlay(t *testing.T, replacement string) string {
	t.Helper()
	return overlayOf(t, map[string]string{contratFile: replacement})
}

// overlayOf is a `go build -overlay` file putting each replacement (empty:
// none) in the place of its file.
func overlayOf(t *testing.T, replace map[string]string) string {
	t.Helper()
	data, err := json.Marshal(map[string]map[string]string{"Replace": replace})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "overlay.json")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestARemovedEmbeddedContratFailsTheSmokeBuild(t *testing.T) {
	// Every embedded Contrat removed: one left would still match the go:embed.
	embedded, err := filepath.Glob(filepath.Join(filepath.Dir(contratFile), "*.json"))
	if err != nil || len(embedded) == 0 {
		t.Fatalf("the embedded Contrats = %v, %v", embedded, err)
	}
	removed := map[string]string{}
	for _, file := range embedded {
		removed[file] = ""
	}
	err = build(t, filepath.Join(t.TempDir(), "crewdeck-runner"), "./cmd/crewdeck-runner", "-tags", "smoke", "-overlay", overlayOf(t, removed))
	if err == nil || !strings.Contains(err.Error(), "no matching files") {
		t.Fatalf("the build without the embedded Contrat = %v, want a failed go:embed", err)
	}
}

func TestABrokenEmbeddedContratFailsTheSmokeTest(t *testing.T) {
	needs(t, "sh", "git", "curl", "jq")
	data, err := os.ReadFile(contratFile)
	if err != nil {
		t.Fatal(err)
	}
	// The README rule now asks for a file the example's fixture does not have.
	broken := bytes.Replace(data, []byte(`"path": "README.md"`), []byte(`"path": "LISEZMOI.md"`), 1)
	if bytes.Equal(broken, data) {
		t.Fatal("the example Contrat has no README rule to break")
	}
	path := filepath.Join(t.TempDir(), "example.v1.json")
	if err := os.WriteFile(path, broken, 0o600); err != nil {
		t.Fatal(err)
	}
	output, err := smoke(t, fakeServer(t), smokeBinary(t, overlay(t, path)))
	if err == nil {
		t.Fatalf("smoke.sh passed with a broken Contrat:\n%s", output)
	}
	if !strings.Contains(output, "contrat check") || !strings.Contains(output, "example.readme") {
		t.Fatalf("smoke.sh failed elsewhere than at the Contrat check:\n%s", output)
	}
}

func TestTheReleaseBinaryRejectsTheSmokeFlags(t *testing.T) {
	needs(t, "sh", "sha256sum")
	out := t.TempDir()
	host := runtime.GOOS + "/" + runtime.GOARCH
	cmd := exec.Command("sh", "install/dist.sh", out)
	cmd.Dir = runnerDir
	cmd.Env = append(os.Environ(), "CREWDECK_VERSION=smoke", "DIST_TARGETS="+host)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("runner:dist: %v\n%s", err, output)
	}
	binary := filepath.Join(out, "smoke", runtime.GOOS+"-"+runtime.GOARCH)
	for _, flag := range []string{"--engine-fake", "--github-url"} {
		output, err := exec.Command(binary, "run", flag, "x").CombinedOutput()
		if err == nil || !strings.Contains(string(output), "unknown flag: "+flag) {
			t.Errorf("the release binary with %s = %v\n%s", flag, err, output)
		}
	}
}
