package session

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// codedError is a runner.sock reply's error code.
type codedError string

func (e codedError) Error() string { return "session: " + string(e) }
func (e codedError) Code() string  { return string(e) }

// ServeGitHubTokens has runner.sock give a running Session's current GitHub
// token (github.OpSessionToken) to git's askpass and to the Session's gh
// shim (RUNNER-10): `not-found` for a Session not running, or without one.
func (m *Manager) ServeGitHubTokens(sock *localsock.Server) {
	sock.Handle(github.OpSessionToken, func(ctx context.Context, raw json.RawMessage) (any, error) {
		var request github.SessionTokenRequest
		if err := json.Unmarshal(raw, &request); err != nil || request.SessionID == "" {
			return nil, codedError("bad-request")
		}
		m.mu.Lock()
		s := m.sessions[request.SessionID]
		m.mu.Unlock()
		if s == nil {
			return nil, codedError("not-found")
		}
		s.mu.Lock()
		tokens, alive := s.token, s.alive
		s.mu.Unlock()
		if tokens == nil || !alive {
			return nil, codedError("not-found")
		}
		token, err := tokens.Token(ctx)
		if err != nil {
			m.cfg.Logger.Warn("session.github-token", "sessionId", request.SessionID, "error", errorKind(err))
			return nil, codedError("unavailable")
		}
		return github.SessionTokenReply{Token: token}, nil
	})
}

// sessionToken is the token of the run of s, a GitHub Projet's when the
// manager has GitHubTokens: fetched now, then kept renewed until its end,
// returned.
func (m *Manager) sessionToken(ctx context.Context, s *live, sessionID string) (*github.SessionToken, func(), error) {
	tokens := &github.SessionToken{
		Fetch: func(ctx context.Context) (github.Issued, error) { return m.cfg.GitHubTokens(ctx, sessionID) },
		Now:   m.cfg.Now,
		After: m.cfg.After,
	}
	keep, stop := context.WithCancel(ctx)
	end := func() {
		stop()
		tokens.End()
		s.mu.Lock()
		if s.token == tokens {
			s.token = nil
		}
		s.mu.Unlock()
	}
	s.mu.Lock()
	s.token = tokens
	s.mu.Unlock()
	if _, err := tokens.Token(ctx); err != nil {
		end()
		return nil, nil, err
	}
	go tokens.Keep(keep)
	return tokens, end, nil
}

// runnerPath is the askpass and the shims' program: crewdeck-runner.
func (m *Manager) runnerPath() string {
	if m.cfg.RunnerPath != "" {
		return m.cfg.RunnerPath
	}
	path, err := os.Executable()
	if err != nil {
		return "crewdeck-runner"
	}
	return path
}

// ShimsDir is the folder of a Session's shims, first in its Moteur's PATH.
func ShimsDir(home, sessionID string) string {
	return filepath.Join(sessionDir(home, sessionID), "bin")
}

// moteurEnv is what the Moteur of a Session runs with: its shims first in
// its PATH, written now, the Runner's folder, the Session's id (for
// `crewdeck-runner etape`), and git's askpass when the Session has a token
// (gitEnv).
func (m *Manager) moteurEnv(sessionID string, gitEnv []string) ([]string, error) {
	bin := ShimsDir(m.cfg.Home, sessionID)
	if err := WriteShims(bin, m.runnerPath(), sessionID); err != nil {
		return nil, err
	}
	env := []string{"PATH=" + bin + string(os.PathListSeparator) + os.Getenv("PATH"), state.HomeEnv + "=" + m.cfg.Home, SessionEnv + "=" + sessionID}
	return append(env, gitEnv...), nil
}

// WriteShims writes in bin the Session's `gh` shim, `crewdeck-runner gh --`,
// its `mirror` shim, `crewdeck-runner miroir`, and its `crewdeck-runner`,
// all for the Session, so that an agent's `gh` gets the Session's token and
// refreshes the Miroir, a Skill's `mirror` commands run as they are (ADR
// 0010), and its `crewdeck-runner etape` names its Session (RUNNER-12).
func WriteShims(bin, runner, sessionID string) error {
	if err := os.MkdirAll(bin, 0o700); err != nil {
		return err
	}
	shims := map[string]string{
		"gh":              "#!/bin/sh\n" + github.AskpassSessionEnv + "=" + quote(sessionID) + " exec " + quote(runner) + ` gh -- "$@"` + "\n",
		"mirror":          "#!/bin/sh\n" + github.AskpassSessionEnv + "=" + quote(sessionID) + " exec " + quote(runner) + ` miroir "$@"` + "\n",
		"crewdeck-runner": "#!/bin/sh\n" + SessionEnv + "=" + quote(sessionID) + " exec " + quote(runner) + ` "$@"` + "\n",
	}
	for name, script := range shims {
		path := filepath.Join(bin, name)
		if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
			return err
		}
		if err := os.Chmod(path, 0o700); err != nil {
			return err
		}
	}
	return nil
}

// quote is s single-quoted for sh.
func quote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
