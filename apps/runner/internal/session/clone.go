package session

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
)

// Origin is where a Session's code comes from (ADR 0012): Clone makes its
// clone once, fetches it before each Session, and gives its folder and the
// environment git needs to read it (a partial clone fetches the worktree's
// files at its checkout), never kept in the clone. The GitHub one is here;
// SOURCE-2 adds the Local one.
type Origin interface {
	Clone(ctx context.Context) (dir string, auth []string, err error)
}

// DefaultGitHubURL is where the GitHub repositories are cloned from.
const DefaultGitHubURL = "https://github.com"

var (
	githubOwner = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,38}$`)
	githubName  = regexp.MustCompile(`^[A-Za-z0-9._-]{1,100}$`)
)

// GitHubOrigin is a GitHub repository, cloned under
// `<home>/repos/github/<owner>/<name>` (never `repos/<owner>/<name>`: a
// GitHub owner may be called `local`, SOURCE-2's folder).
type GitHubOrigin struct {
	// Home is the Runner's folder, ~/.crewdeck.
	Home string
	// URL is GitHub's, DefaultGitHubURL; the tests give a file:// one.
	URL         string
	Owner, Name string
	// Tokens authenticates the clone and its fetches (RUNNER-10 gives the
	// real one); nil, or an empty token, clones without one.
	Tokens github.TokenSource

	locks *locks
}

func (o *GitHubOrigin) dir() string {
	return filepath.Join(o.Home, "repos", "github", o.Owner, o.Name)
}

func (o *GitHubOrigin) Clone(ctx context.Context) (string, []string, error) {
	if !githubOwner.MatchString(o.Owner) || !githubName.MatchString(o.Name) || o.Name == "." || o.Name == ".." {
		return "", nil, errors.New("session: not a GitHub repository")
	}
	env, err := o.auth(ctx)
	if err != nil {
		return "", nil, err
	}
	dir := o.dir()
	unlock := o.locks.lock(dir)
	defer unlock()
	if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
		return dir, env, runGit(ctx, dir, env, "fetch", "--prune", "origin")
	}
	if err := os.MkdirAll(filepath.Dir(dir), 0o700); err != nil {
		return "", nil, err
	}
	_ = os.RemoveAll(dir) // a clone a killed Runner left half made
	url := strings.TrimSuffix(o.URL, "/") + "/" + o.Owner + "/" + o.Name + ".git"
	if err := runGit(ctx, filepath.Dir(dir), env, "clone", "--filter=blob:none", "--no-checkout", "--quiet", url, dir); err != nil {
		_ = os.RemoveAll(dir)
		return "", nil, err
	}
	// The clone's own HEAD holds no branch, so that every branch may have its
	// worktree (git refuses a branch already checked out).
	head, err := gitOutput(ctx, dir, "rev-parse", "HEAD")
	if err == nil {
		err = runGit(ctx, dir, nil, "update-ref", "--no-deref", "HEAD", head)
	}
	return dir, env, err
}

// auth is the environment that gives git the token, as an HTTP header in
// git's configuration from the environment: never in a command line, nor in
// the clone's configuration.
func (o *GitHubOrigin) auth(ctx context.Context) ([]string, error) {
	if o.Tokens == nil {
		return nil, nil
	}
	token, err := o.Tokens.Token(ctx)
	if err != nil || token == "" {
		return nil, err
	}
	basic := base64.StdEncoding.EncodeToString([]byte("x-access-token:" + token))
	return []string{"GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=http.extraHeader", "GIT_CONFIG_VALUE_0=Authorization: Basic " + basic}, nil
}

// locks serialises what changes one clone: its fetch, its worktrees.
type locks struct {
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func (l *locks) lock(dir string) func() {
	l.mu.Lock()
	if l.locks == nil {
		l.locks = map[string]*sync.Mutex{}
	}
	m, ok := l.locks[dir]
	if !ok {
		m = &sync.Mutex{}
		l.locks[dir] = m
	}
	l.mu.Unlock()
	m.Lock()
	return m.Unlock
}

// gitError is a git command that failed: its subcommand and exit code, never
// its output (it may name a file, a branch, a URL).
type gitError struct {
	command string
	err     error
}

func (e *gitError) Error() string { return fmt.Sprintf("session: git %s: %v", e.command, e.err) }
func (e *gitError) Unwrap() error { return e.err }

func gitCommand(ctx context.Context, dir string, env []string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "LC_ALL=C")
	cmd.Env = append(cmd.Env, env...)
	return cmd
}

func runGit(ctx context.Context, dir string, env []string, args ...string) error {
	if err := gitCommand(ctx, dir, env, args...).Run(); err != nil {
		return &gitError{command: args[0], err: err}
	}
	return nil
}

func gitOutput(ctx context.Context, dir string, args ...string) (string, error) {
	out, err := gitCommand(ctx, dir, nil, args...).Output()
	if err != nil {
		return "", &gitError{command: args[0], err: err}
	}
	return strings.TrimSpace(string(out)), nil
}
