package target

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// The worktree's git, for what only git says (its HEAD, what its origin
// holds). Never a folder that is not a repository of its own: a `Dir`
// without `.git` (a fixture inside another repository) has no HEAD, rather
// than the HEAD of the repository around it.

// IsRepository says whether the worktree is a git repository or worktree of its own.
func (t Target) IsRepository() bool {
	_, err := os.Lstat(filepath.Join(t.Dir, ".git"))
	return err == nil
}

// Head is the commit the worktree's HEAD points to; ok is false when it is
// not a repository or has no commit yet.
func (t Target) Head(ctx context.Context) (sha string, ok bool, err error) {
	return t.Ref(ctx, "HEAD")
}

// Ref is the commit `ref` names in the worktree; ok is false when it names none.
func (t Target) Ref(ctx context.Context, ref string) (sha string, ok bool, err error) {
	if !t.IsRepository() {
		return "", false, nil
	}
	out, err := t.Git(ctx, "rev-parse", "--verify", "--quiet", "--end-of-options", ref+"^{commit}")
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return strings.TrimSpace(out), true, nil
}

// Git runs git in the worktree, with GitEnv, never prompting; its output,
// which the caller never logs (it may name a file, a branch, a URL).
func (t Target) Git(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = t.Dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "LC_ALL=C")
	cmd.Env = append(cmd.Env, t.GitEnv...)
	// A transport git started (ssh) may hold its output once git is killed.
	cmd.WaitDelay = time.Second
	out, err := cmd.Output()
	return string(out), err
}
