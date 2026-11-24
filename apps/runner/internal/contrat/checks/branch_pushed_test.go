package checks

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

func git(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false"}, args...)...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.test", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.test", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

// origins are the two origins a Runner's clone has: a GitHub repository
// (bare) and a Local folder (a plain repository with its own checkout).
func origins(t *testing.T) map[string]string {
	t.Helper()
	bare, folder := filepath.Join(t.TempDir(), "repo.git"), t.TempDir()
	git(t, filepath.Dir(bare), "init", "--bare", bare)
	seed := t.TempDir()
	git(t, seed, "init")
	writeFiles(t, seed, map[string]string{"README.md": "code\n"})
	git(t, seed, "add", "README.md")
	git(t, seed, "commit", "-m", "code")
	git(t, seed, "push", bare, "main")
	git(t, folder, "init")
	writeFiles(t, folder, map[string]string{"README.md": "code\n"})
	git(t, folder, "add", "README.md")
	git(t, folder, "commit", "-m", "code")
	return map[string]string{"bare": bare, "folder": folder}
}

// worktree is a clone of origin on the branch crewdeck/inventaire with one commit of its own.
func worktree(t *testing.T, origin string) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "clone")
	git(t, filepath.Dir(dir), "clone", "--quiet", origin, dir)
	git(t, dir, "checkout", "--quiet", "-b", "crewdeck/inventaire")
	writeFiles(t, dir, map[string]string{"CONTEXT.md": "# Glossary\n"})
	git(t, dir, "add", "CONTEXT.md")
	git(t, dir, "commit", "--quiet", "-m", "docs(crewdeck) : inventaire")
	return dir
}

func TestBranchPushedPassesOnceTheWorktreesHeadIsOnItsOrigin(t *testing.T) {
	fn, ok := Lookup("branch-pushed")
	if !ok {
		t.Fatal("branch-pushed is not registered")
	}
	params := map[string]any{"branch": "crewdeck/inventaire"}
	for name, origin := range origins(t) {
		dir := worktree(t, origin)
		if got, err := fn(context.Background(), target.Target{Dir: dir}, params); got || err != nil {
			t.Errorf("%s, not pushed: %v, %v; want false", name, got, err)
		}
		git(t, dir, "push", "--quiet", "origin", "crewdeck/inventaire")
		if got, err := fn(context.Background(), target.Target{Dir: dir}, params); !got || err != nil {
			t.Errorf("%s, pushed: %v, %v; want true", name, got, err)
		}
		writeFiles(t, dir, map[string]string{"docs/inventory.md": "# Inventory\n"})
		git(t, dir, "add", "docs/inventory.md")
		git(t, dir, "commit", "--quiet", "-m", "more")
		if got, err := fn(context.Background(), target.Target{Dir: dir}, params); got || err != nil {
			t.Errorf("%s, a commit not pushed: %v, %v; want false", name, got, err)
		}
	}
}

// What the origin holds is read from it, never from the worktree's own
// remote-tracking ref: a branch pushed by another clone counts, one deleted
// from the origin no longer does.
func TestBranchPushedReadsTheOriginNotAStaleRef(t *testing.T) {
	fn, _ := Lookup("branch-pushed")
	params := map[string]any{"branch": "crewdeck/inventaire"}
	for name, origin := range origins(t) {
		dir := worktree(t, origin)
		git(t, dir, "push", "--quiet", "origin", "crewdeck/inventaire")
		git(t, dir, "push", "--quiet", "origin", "--delete", "crewdeck/inventaire")
		git(t, dir, "update-ref", "refs/remotes/origin/crewdeck/inventaire", "HEAD")
		if got, err := fn(context.Background(), target.Target{Dir: dir}, params); got || err != nil {
			t.Errorf("%s, deleted from the origin: %v, %v; want false", name, got, err)
		}
	}
}

func TestBranchPushedFailsAFolderThatIsNoRepositoryAndRefusesBadParams(t *testing.T) {
	fn, _ := Lookup("branch-pushed")
	if got, err := fn(context.Background(), target.Target{Dir: t.TempDir()}, map[string]any{"branch": "crewdeck/inventaire"}); got || err != nil {
		t.Errorf("no repository: %v, %v; want false, no error", got, err)
	}
	for _, params := range []map[string]any{nil, {"branch": 3}, {"branch": ""}, {"branch": "-x"}, {"branch": "a..b"}, {"branch": "a b"}} {
		if _, err := fn(context.Background(), target.Target{Dir: t.TempDir()}, params); err == nil {
			t.Errorf("params %v: no error", params)
		}
	}
}
