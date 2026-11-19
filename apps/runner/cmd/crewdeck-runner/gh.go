package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mirror"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
	"github.com/spf13/cobra"
)

// newGhCommand is `crewdeck-runner gh -- <args>`, what a Session's `gh`
// shim runs (RUNNER-10); `miroir gh <args>` is the same, under the Miroir.
func newGhCommand(use, short string) *cobra.Command {
	return &cobra.Command{
		Use:                use + " -- <args>",
		Short:              short,
		DisableFlagParsing: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) > 0 && args[0] == "--" {
				args = args[1:]
			}
			return runGh(cmd.Context(), args, cmd.InOrStdin(), cmd.OutOrStdout(), cmd.ErrOrStderr())
		},
	}
}

// stdoutKept is how much of gh's stdout is kept for the URL a create prints.
const stdoutKept = 1 << 20

// runGh runs the real gh with the Session's current token (GH_TOKEN, for
// github.com), its stdio its own, then, once it exited 0, refreshes in the
// Miroir what the command changed, waiting for that refresh (risk AGT-7),
// whose failure prints nothing; it exits with gh's code. Outside a Session
// (no AskpassSessionEnv), gh runs as the machine has it.
func runGh(ctx context.Context, args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	home, err := state.Default()
	if err != nil {
		return err
	}
	sessionID := os.Getenv(github.AskpassSessionEnv)
	path, err := realGh(home.Dir)
	if err != nil {
		fmt.Fprintln(stderr, "gh n'est pas installé sur cette machine.")
		return silentExit(127)
	}
	socket := filepath.Join(home.Dir, localsock.SocketName)
	env := os.Environ()
	if sessionID != "" {
		tokenCtx, cancel := context.WithTimeout(ctx, localsock.Timeout)
		token, err := github.SessionTokenOf(tokenCtx, socket, sessionID)
		cancel()
		if err != nil {
			fmt.Fprintln(stderr, "Le jeton GitHub de cette Session n'est pas disponible : le Runner tourne-t-il ?")
			return silentExit(1)
		}
		env = append(env, "GH_TOKEN="+token, "GH_HOST=github.com")
	}
	kept := &limited{max: stdoutKept}
	command := exec.CommandContext(ctx, path, args...)
	command.Env = env
	command.Stdin, command.Stdout, command.Stderr = stdin, io.MultiWriter(stdout, kept), stderr
	if err := command.Run(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() > 0 {
			return silentExit(exit.ExitCode())
		}
		return silentExit(1)
	}
	refresh(ctx, socket, args, github.Named(args, kept.String()))
	return nil
}

// realGh is gh on PATH, the Sessions' shims (<home>/sessions/<id>/bin)
// left out.
func realGh(home string) (string, error) {
	sessions := filepath.Join(home, "sessions")
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		if dir == "" || filepath.Base(dir) == "bin" && filepath.Dir(filepath.Dir(filepath.Clean(dir))) == sessions {
			continue
		}
		path := filepath.Join(dir, "gh")
		if info, err := os.Stat(path); err == nil && !info.IsDir() && info.Mode()&0o111 != 0 {
			return path, nil
		}
	}
	return "", exec.ErrNotFound
}

// refresh asks the running Runner to fetch the object r names, or to
// synchronize the open objects of its repository when it names none or a
// branch the copy has no PR of: at most localsock.Timeout, silent.
func refresh(ctx context.Context, socket string, args []string, r github.Refresh) {
	if r.None {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, localsock.Timeout)
	defer cancel()
	key := ""
	if m, err := openMiroirTo(io.Discard); err == nil {
		defer m.Close()
		key = m.keyOf(ctx, r.Repository, groupOf(args))
		if r.Branch != "" && key != "" {
			if pulls, err := m.store.List(key, mirror.Filter{Pulls: true, State: "all", Head: r.Branch, Limit: 1}); err == nil && len(pulls) > 0 {
				r.Number, _ = pulls[0]["number"].(int)
			}
		}
	} else if r.Repository != "" {
		key = r.Repository
	}
	if key == "" && r.Repository != "" {
		return // a repository of no Projet of this Runner's
	}
	if r.Number > 0 && key != "" {
		_ = localsock.Call(ctx, socket, mirror.OpFetch, mirror.FetchRequest{Repository: key, Number: r.Number}, nil)
		return
	}
	_ = localsock.Call(ctx, socket, mirror.OpSync, mirror.SyncRequest{Repository: key, OpenOnly: true}, nil)
}

// groupOf is the group of the objects a gh command writes: a PR's code, else
// the Tickets.
func groupOf(args []string) string {
	if len(args) > 0 && args[0] == "pr" || len(args) > 1 && args[0] == "api" && strings.Contains(strings.Join(args[1:], " "), "/pulls") {
		return mirror.GroupCode
	}
	return mirror.GroupTicket
}

// keyOf is the copy's key of the repository named (`owner/name`), else of
// the Projet the current directory is a checkout of; "" when it has none.
func (m *miroir) keyOf(ctx context.Context, repository, group string) string {
	if repository != "" {
		for _, p := range m.projects {
			if strings.EqualFold(p.Repository, repository) {
				return p.Repository
			}
		}
		return ""
	}
	p, err := m.key(ctx, "", group)
	if err != nil {
		return ""
	}
	return p.Repository
}

// limited keeps the first max bytes written to it.
type limited struct {
	bytes.Buffer
	max int
}

func (l *limited) Write(p []byte) (int, error) {
	if room := l.max - l.Len(); room > 0 {
		l.Buffer.Write(p[:min(room, len(p))])
	}
	return len(p), nil
}
