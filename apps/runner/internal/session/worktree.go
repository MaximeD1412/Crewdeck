package session

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// validBranch is what the contract's `isGitBranch` accepts, checked again
// here before the branch names a folder.
func validBranch(branch string) bool {
	if branch == "" || len(branch) > 200 {
		return false
	}
	for _, r := range branch {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '.' || r == '_' || r == '/' || r == '-') {
			return false
		}
	}
	for _, prefix := range []string{"-", "/", "."} {
		if strings.HasPrefix(branch, prefix) {
			return false
		}
	}
	for _, suffix := range []string{"/", ".", ".lock"} {
		if strings.HasSuffix(branch, suffix) {
			return false
		}
	}
	for _, part := range []string{"..", "//", "/.", "__"} {
		if strings.Contains(branch, part) {
			return false
		}
	}
	return true
}

// worktreeDir is `<home>/worktrees/<projectId>/<branch, "/" as "__">`: one
// per branch, so that one live Session holds a branch.
func worktreeDir(home, projectID, branch string) string {
	return filepath.Join(home, "worktrees", projectID, strings.ReplaceAll(branch, "/", "__"))
}

// addWorktree makes the worktree of `branch` in clone: from origin/<branch>
// when the remote has it, else from origin/<base>. A folder a killed Runner
// left there is removed first. auth is the Origin's environment: the
// checkout of a partial clone fetches the files it lacks.
func addWorktree(ctx context.Context, clone string, auth []string, dir, branch, base string) error {
	if !validBranch(branch) || !validBranch(base) {
		return errors.New("session: not a branch")
	}
	removeWorktree(ctx, clone, dir)
	if err := os.MkdirAll(filepath.Dir(dir), 0o700); err != nil {
		return err
	}
	from := "origin/" + base
	if runGit(ctx, clone, nil, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/"+branch) == nil {
		from = "origin/" + branch
	}
	return runGit(ctx, clone, auth, "worktree", "add", "--quiet", "--no-track", "-B", branch, dir, from)
}

// removeWorktree removes the worktree and what git knows of it; the branch
// stays, in the clone and on the remote.
func removeWorktree(ctx context.Context, clone, dir string) {
	_ = runGit(ctx, clone, nil, "worktree", "remove", "--force", dir)
	_ = os.RemoveAll(dir)
	_ = runGit(ctx, clone, nil, "worktree", "prune")
}
