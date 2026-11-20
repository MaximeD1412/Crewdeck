package local

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// ErrNoFolder: the Projet has no folder in the Runner's state, or its
// folder is gone or not a git repository; its Session ends `clone-failed`.
var ErrNoFolder = errors.New("local: the Projet's folder is not here")

// Origin is a Local Projet's code for its Sessions and Commandes (the
// session package's Origin): the Runner's clone of the folder, the folder
// its `origin`, under `<home>/repos/local/<projectId>`, made once with
// `--no-hardlinks` and fetched before each Session; its worktrees are made
// as for GitHub, never in the Pilote's checkout, and a Session's `git push
// origin <branch>` lands in the folder. No token, no askpass.
type Origin struct {
	// Home is the Runner's folder, ~/.crewdeck.
	Home      string
	ProjectID string
	// Folder gives a Projet's folder from the Runner's state (PROJET-6),
	// read at each Clone: the Pilote may attach it elsewhere.
	Folder func(projectID string) (string, bool)
}

// Dir is the clone's folder.
func (o *Origin) Dir() string { return filepath.Join(o.Home, "repos", "local", o.ProjectID) }

// Clone makes the clone once, else fetches it, and gives its folder.
func (o *Origin) Clone(ctx context.Context) (string, []string, error) {
	if o.ProjectID == "" || strings.ContainsAny(o.ProjectID, `/\.`) || o.Folder == nil {
		return "", nil, ErrNoFolder
	}
	folder, ok := o.Folder(o.ProjectID)
	if !ok || !filepath.IsAbs(folder) {
		return "", nil, ErrNoFolder
	}
	if err := runGit(ctx, folder, "rev-parse", "--git-dir"); err != nil {
		return "", nil, ErrNoFolder
	}
	dir := o.Dir()
	return dir, nil, cloneOrFetch(ctx, folder, dir)
}

// cloneOrFetch makes dir the clone of folder, its `origin`, once, else fetches it.
func cloneOrFetch(ctx context.Context, folder, dir string) error {
	if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
		// The folder the state names now, should the Pilote have moved it.
		if err := runGit(ctx, dir, "remote", "set-url", "origin", folder); err != nil {
			return err
		}
		return runGit(ctx, dir, "fetch", "--prune", "--quiet", "origin")
	}
	if err := os.MkdirAll(filepath.Dir(dir), 0o700); err != nil {
		return err
	}
	_ = os.RemoveAll(dir) // a clone a killed Runner left half made
	if err := runGit(ctx, filepath.Dir(dir), "clone", "--no-hardlinks", "--no-checkout", "--quiet", folder, dir); err != nil {
		_ = os.RemoveAll(dir)
		return err
	}
	// The clone's own HEAD holds no branch, so that every branch may have
	// its worktree (git refuses a branch already checked out).
	head, err := gitOutput(ctx, dir, "rev-parse", "HEAD")
	if err == nil {
		err = runGit(ctx, dir, "update-ref", "--no-deref", "HEAD", head)
	}
	return err
}

// ProjectOfRemote is the Local Projet whose folder a clone's `origin` names
// (`git remote get-url origin` in a worktree), among the Runner's state's
// folders (projectId → absolute path): MIROIR-6 and MIROIR-7 find the
// Projet from a worktree with it.
func ProjectOfRemote(folders map[string]string, url string) (string, bool) {
	path := strings.TrimPrefix(strings.TrimSpace(url), "file://")
	if !filepath.IsAbs(path) {
		return "", false
	}
	want := realPath(path)
	for id, folder := range folders {
		if realPath(folder) == want {
			return id, true
		}
	}
	return "", false
}

func realPath(path string) string {
	path = filepath.Clean(path)
	if real, err := filepath.EvalSymlinks(path); err == nil {
		return real
	}
	return path
}

// gitError is a git command that failed: its subcommand and exit code,
// never its output (it may name a file, a branch, a path).
type gitError struct {
	command string
	err     error
}

func (e *gitError) Error() string { return fmt.Sprintf("local: git %s: %v", e.command, e.err) }
func (e *gitError) Unwrap() error { return e.err }

func gitCommand(ctx context.Context, dir string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "LC_ALL=C")
	return cmd
}

func runGit(ctx context.Context, dir string, args ...string) error {
	if err := gitCommand(ctx, dir, args...).Run(); err != nil {
		return &gitError{command: args[0], err: err}
	}
	return nil
}

func gitOutput(ctx context.Context, dir string, args ...string) (string, error) {
	out, err := gitCommand(ctx, dir, args...).Output()
	if err != nil {
		return "", &gitError{command: args[0], err: err}
	}
	return strings.TrimSpace(string(out)), nil
}
