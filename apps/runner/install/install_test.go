// Package install holds install.sh, the script the server renders at
// /runner/install.sh (ADR 0004); its tests run it against a local server.
package install

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

const code = "7kq4-M2PXA7QK9VZ3T8W4R6N1B5C0DE"

// fakeRunner stands for crewdeck-runner: it writes the arguments it got.
const fakeRunner = "#!/bin/sh\nprintf '%s\\n' \"$*\" > \"$HOME/linked\"\n"

type dist struct {
	mu       sync.Mutex
	requests []string
	bodies   []string
	checksum string
}

func (d *dist) serve(t *testing.T) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		d.mu.Lock()
		d.requests = append(d.requests, r.Method+" "+r.URL.Path)
		d.bodies = append(d.bodies, string(body))
		d.mu.Unlock()
		switch {
		case strings.HasPrefix(r.URL.Path, "/runner/v1/") && strings.HasSuffix(r.URL.Path, ".sha256"):
			_, _ = io.WriteString(w, d.checksum+"  "+filepath.Base(strings.TrimSuffix(r.URL.Path, ".sha256"))+"\n")
		case strings.HasPrefix(r.URL.Path, "/runner/v1/"):
			_, _ = io.WriteString(w, fakeRunner)
		case r.URL.Path == "/api/runner/link-failures":
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func sum(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// run renders install.sh as the server does and runs it with sh, in a home
// of its own, uname answering system and machine.
func run(t *testing.T, server, system, machine string, args ...string) (home, output string, err error) {
	t.Helper()
	script, err := os.ReadFile("install.sh")
	if err != nil {
		t.Fatal(err)
	}
	rendered := strings.ReplaceAll(strings.ReplaceAll(string(script), "__CREWDECK_SERVER__", server), "__CREWDECK_VERSION__", "v1")
	dir := t.TempDir()
	home = filepath.Join(dir, "home")
	bin := filepath.Join(dir, "bin")
	for _, d := range []string{home, bin} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	uname := "#!/bin/sh\ncase \"$1\" in -s) echo " + system + " ;; -m) echo " + machine + " ;; esac\n"
	if err := os.WriteFile(filepath.Join(bin, "uname"), []byte(uname), 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "install.sh")
	if err := os.WriteFile(path, []byte(rendered), 0o644); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("sh", append([]string{path}, args...)...)
	cmd.Env = append(os.Environ(), "HOME="+home, "PATH="+bin+":"+os.Getenv("PATH"))
	out, err := cmd.CombinedOutput()
	return home, string(out), err
}

func TestItInstallsTheCheckedBinaryInLocalBinThenLinksIt(t *testing.T) {
	d := &dist{checksum: sum(fakeRunner)}
	srv := d.serve(t)

	home, out, err := run(t, srv.URL, "Linux", "x86_64", "--link", code)
	if err != nil {
		t.Fatalf("install: %v\n%s", err, out)
	}
	installed := filepath.Join(home, ".local", "bin", "crewdeck-runner")
	info, err := os.Stat(installed)
	if err != nil || info.Mode().Perm() != 0o755 {
		t.Fatalf("installed binary: %v %v", info, err)
	}
	linked, err := os.ReadFile(filepath.Join(home, "linked"))
	if err != nil {
		t.Fatalf("the Runner was not run: %v\n%s", err, out)
	}
	if got := strings.TrimSpace(string(linked)); got != "link "+code+" --server "+srv.URL {
		t.Fatalf("ran with %q", got)
	}
	if strings.Join(d.requests, ",") != "GET /runner/v1/linux-amd64,GET /runner/v1/linux-amd64.sha256" {
		t.Fatalf("requests %v", d.requests)
	}
}

func TestTheServerFlagTakesThePlaceOfTheRenderedOne(t *testing.T) {
	d := &dist{checksum: sum(fakeRunner)}
	srv := d.serve(t)

	home, out, err := run(t, "https://crewdeck.invalid", "Darwin", "arm64", "--link", code, "--server", srv.URL+"/")
	if err != nil {
		t.Fatalf("install: %v\n%s", err, out)
	}
	linked, _ := os.ReadFile(filepath.Join(home, "linked"))
	if got := strings.TrimSpace(string(linked)); got != "link "+code+" --server "+srv.URL {
		t.Fatalf("ran with %q", got)
	}
}

func TestItRefusesAWrongChecksumAndInstallsNothing(t *testing.T) {
	d := &dist{checksum: sum("another binary")}
	srv := d.serve(t)

	home, out, err := run(t, srv.URL, "Linux", "aarch64", "--link", code)
	if err == nil {
		t.Fatalf("install succeeded:\n%s", out)
	}
	if !strings.Contains(out, "empreinte SHA-256") {
		t.Fatalf("output %q", out)
	}
	if _, err := os.Stat(filepath.Join(home, ".local", "bin", "crewdeck-runner")); !os.IsNotExist(err) {
		t.Fatalf("a binary was installed: %v", err)
	}
}

func TestAnUnsupportedSystemIsReportedThenRefusedInFrench(t *testing.T) {
	d := &dist{checksum: sum(fakeRunner)}
	srv := d.serve(t)

	_, out, err := run(t, srv.URL, "FreeBSD", "riscv64", "--link", code)
	if err == nil {
		t.Fatalf("install succeeded:\n%s", out)
	}
	if !strings.Contains(out, "n’est pas pris en charge") {
		t.Fatalf("output %q", out)
	}
	if !strings.Contains(out, "curl -fsSL "+srv.URL+"/runner/install.sh | sh -s -- --link "+code) {
		t.Fatalf("the command is not printed again: %q", out)
	}
	if len(d.requests) != 1 || d.requests[0] != "POST /api/runner/link-failures" {
		t.Fatalf("requests %v", d.requests)
	}
	if want := `{"shortId":"7KQ4","reason":"unsupported-system","os":"FreeBSD","arch":"riscv64"}`; d.bodies[0] != want {
		t.Fatalf("body %s, want %s", d.bodies[0], want)
	}
}

func TestAnUnknownOptionIsRefused(t *testing.T) {
	srv := (&dist{}).serve(t)
	_, out, err := run(t, srv.URL, "Linux", "x86_64", "--lien", code)
	if err == nil || !strings.Contains(out, "option inconnue") {
		t.Fatalf("err %v, output %q", err, out)
	}
}
