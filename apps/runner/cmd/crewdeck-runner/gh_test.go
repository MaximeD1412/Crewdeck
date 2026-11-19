package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mirror"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
)

// mainEnv makes this test binary run crewdeck-runner's main (mcp_test.go's TestMain).
const mainEnv = "CREWDECK_TEST_MAIN"

const ghSession = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b01"

// ghHarness is a Session's shims around the miroir fixture's running Runner:
// it gives the Session's token and records the refreshes asked.
type ghHarness struct {
	*miroirFixture
	bin string
	// gitOnly is a folder of PATH with git, and no gh.
	gitOnly string

	mu        sync.Mutex
	fetches   []mirror.FetchRequest
	syncs     []mirror.SyncRequest
	refreshes error
}

func newGhHarness(t *testing.T) *ghHarness {
	t.Helper()
	h := &ghHarness{miroirFixture: newMiroirFixture(t)}
	runner, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	h.gitOnly = t.TempDir()
	git, err := exec.LookPath("git")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(git, filepath.Join(h.gitOnly, "git")); err != nil {
		t.Fatal(err)
	}
	h.bin = session.ShimsDir(h.home, ghSession)
	if err := session.WriteShims(h.bin, runner, ghSession); err != nil {
		t.Fatal(err)
	}
	h.sock.Handle(github.OpSessionToken, func(_ context.Context, raw json.RawMessage) (any, error) {
		var request github.SessionTokenRequest
		if err := json.Unmarshal(raw, &request); err != nil || request.SessionID != ghSession {
			return nil, &localsock.Failed{Code: "not-found"}
		}
		return github.SessionTokenReply{Token: "ghs_session"}, nil
	})
	h.sock.Handle(mirror.OpFetch, func(_ context.Context, raw json.RawMessage) (any, error) {
		var request mirror.FetchRequest
		_ = json.Unmarshal(raw, &request)
		h.mu.Lock()
		defer h.mu.Unlock()
		h.fetches = append(h.fetches, request)
		return struct{}{}, h.refreshes
	})
	h.sock.Handle(mirror.OpSync, func(_ context.Context, raw json.RawMessage) (any, error) {
		var request mirror.SyncRequest
		_ = json.Unmarshal(raw, &request)
		h.mu.Lock()
		defer h.mu.Unlock()
		h.syncs = append(h.syncs, request)
		return mirror.SyncReply{}, h.refreshes
	})
	return h
}

// fakeGh is a gh on PATH that records its token, host and arguments, prints
// out and exits with code.
func fakeGh(t *testing.T, out string, code int) (dir, record string) {
	t.Helper()
	dir = t.TempDir()
	record = filepath.Join(dir, "calls")
	script := fmt.Sprintf("#!/bin/sh\nprintf '%%s %%s %%s\\n' \"$GH_TOKEN\" \"$GH_HOST\" \"$*\" >> '%s'\nprintf '%%s' '%s'\nexit %d\n", record, out, code)
	if err := os.WriteFile(filepath.Join(dir, "gh"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	return dir, record
}

// shim runs the Session's shim name with args in dir, PATH being the
// Session's bin, path, then git alone.
func (h *ghHarness) shim(t *testing.T, dir, path, name string, args ...string) (stdout, stderr string, code int) {
	t.Helper()
	cmd := exec.Command(filepath.Join(h.bin, name), args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), mainEnv+"=1", "PATH="+strings.Join([]string{h.bin, path, h.gitOnly}, string(os.PathListSeparator)))
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	err := cmd.Run()
	var exit *exec.ExitError
	switch {
	case errors.As(err, &exit):
		code = exit.ExitCode()
	case err != nil:
		t.Fatal(err)
	}
	return out.String(), errOut.String(), code
}

func (h *ghHarness) refreshed() ([]mirror.FetchRequest, []mirror.SyncRequest) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]mirror.FetchRequest(nil), h.fetches...), append([]mirror.SyncRequest(nil), h.syncs...)
}

func calls(t *testing.T, record string) string {
	t.Helper()
	data, err := os.ReadFile(record)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func TestTheMirrorShimRunsTheMiroir(t *testing.T) {
	h := newGhHarness(t)
	dir := githubDir(t)
	want, _, err := runMiroir(t, dir, "issue", "view", "12", "--json", "title")
	if err != nil {
		t.Fatal(err)
	}

	out, stderr, code := h.shim(t, dir, os.Getenv("PATH"), "mirror", "issue", "view", "12", "--json", "title")

	if code != 0 || out != want || !strings.Contains(out, "title") {
		t.Fatalf("mirror issue view: %d %q (stderr %q), want %q", code, out, stderr, want)
	}
}

func TestMirrorGhRunsTheRealGhWithTheSessionsTokenThenRefreshesTheIssueBeforeItReturns(t *testing.T) {
	h := newGhHarness(t)
	dir := githubDir(t)
	gh, record := fakeGh(t, "https://github.com/acme/atelier/issues/12#issuecomment-1\n", 0)

	out, stderr, code := h.shim(t, dir, gh, "mirror", "gh", "issue", "comment", "12", "--body", "x")

	if code != 0 || out != "https://github.com/acme/atelier/issues/12#issuecomment-1\n" || stderr != "" {
		t.Fatalf("mirror gh: %d %q %q", code, out, stderr)
	}
	if got := calls(t, record); got != "ghs_session github.com issue comment 12 --body x" {
		t.Fatalf("gh ran as %q", got)
	}
	if fetches, syncs := h.refreshed(); len(fetches) != 1 || fetches[0] != (mirror.FetchRequest{Repository: ghKey, Number: 12}) || len(syncs) != 0 {
		t.Fatalf("refreshes %+v %+v, want issue 12 fetched", fetches, syncs)
	}
}

func TestTheGhShimFindsAPRByItsBranchInTheCopyAndSyncsWhenNothingIsNamed(t *testing.T) {
	h := newGhHarness(t)
	dir := githubDir(t)
	gh, record := fakeGh(t, "", 0)
	pulls, err := h.store.List(ghKey, mirror.Filter{Pulls: true, State: "all", Head: "feat/12-x"})
	if err != nil || len(pulls) != 1 {
		t.Fatalf("the copy's PR of feat/12-x: %v, %v", pulls, err)
	}

	if _, stderr, code := h.shim(t, dir, gh, "gh", "pr", "ready", "feat/12-x"); code != 0 {
		t.Fatalf("gh pr ready: %d %q", code, stderr)
	}
	if _, stderr, code := h.shim(t, dir, gh, "gh", "label", "create", "urgent"); code != 0 {
		t.Fatalf("gh label create: %d %q", code, stderr)
	}
	if _, _, code := h.shim(t, dir, gh, "gh", "pr", "list"); code != 0 {
		t.Fatal("gh pr list failed")
	}

	if got := calls(t, record); got != "ghs_session github.com pr ready feat/12-x\nghs_session github.com label create urgent\nghs_session github.com pr list" {
		t.Fatalf("gh ran as %q", got)
	}
	fetches, syncs := h.refreshed()
	if len(fetches) != 1 || fetches[0] != (mirror.FetchRequest{Repository: ghKey, Number: pulls[0]["number"].(int)}) {
		t.Fatalf("fetches %+v, want the PR of feat/12-x", fetches)
	}
	if len(syncs) != 1 || syncs[0] != (mirror.SyncRequest{Repository: ghKey, OpenOnly: true}) {
		t.Fatalf("syncs %+v, want the open objects after the label", syncs)
	}
}

func TestAFailedRefreshLeavesGhsOutputAndExitCodeAsTheyAre(t *testing.T) {
	h := newGhHarness(t)
	h.refreshes = &localsock.Failed{Code: "unavailable"}
	dir := githubDir(t)
	gh, _ := fakeGh(t, "fermé\n", 0)

	out, stderr, code := h.shim(t, dir, gh, "gh", "issue", "close", "12")
	if code != 0 || out != "fermé\n" || stderr != "" {
		t.Fatalf("gh issue close with a failed refresh: %d %q %q", code, out, stderr)
	}
	if fetches, _ := h.refreshed(); len(fetches) != 1 {
		t.Fatalf("fetches %+v, want the refresh asked", fetches)
	}

	failing, _ := fakeGh(t, "refusé\n", 4)
	out, stderr, code = h.shim(t, dir, failing, "gh", "issue", "close", "13")
	if code != 4 || out != "refusé\n" || stderr != "" {
		t.Fatalf("a failing gh: %d %q %q, want its code and output", code, out, stderr)
	}
	if fetches, _ := h.refreshed(); len(fetches) != 1 {
		t.Fatalf("fetches %+v, want none after a failing gh", fetches)
	}
}

func TestWithoutGhTheShimExits127WithItsMessage(t *testing.T) {
	h := newGhHarness(t)

	out, stderr, code := h.shim(t, githubDir(t), t.TempDir(), "gh", "issue", "view", "12")

	if code != 127 || out != "" || strings.TrimSpace(stderr) != "gh n'est pas installé sur cette machine." {
		t.Fatalf("without gh: %d %q %q", code, out, stderr)
	}
}
