package session

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// The places a Commande runs in (RUNNER-18, ADR 0013): the Ticket's
// worktree, or the Projet's integration checkout. The manager gives them, so
// that a worktree is held by one Session or one run at a time: a Session
// started on a worktree a run holds gets `branch-busy`, a run asked on a
// worktree a live Session or another run holds gets ErrPlaceUnavailable,
// and the resume of a stopped Session whose worktree a run holds waits for
// the run to release it.

// ErrPlaceUnavailable: the place is held, at another commit, or cannot be made.
var ErrPlaceUnavailable = errors.New("session: place unavailable")

// integrationDir is the integration checkout's folder name under
// `worktrees/<projectId>/`: a name no branch's worktree has (validBranch
// refuses a leading dot), so that a run on a branch named `integration`
// never removes the checkout.
const integrationDir = ".integration"

var gitSha = regexp.MustCompile(`^[0-9a-f]{40}(?:[0-9a-f]{24})?$`)

// Place is a folder a run holds until Release.
type Place struct {
	Dir     string
	release func()
}

// Release gives the place back: a worktree made for the run is cleaned (the
// Hooks' Clean) and removed, as a Session's.
func (p *Place) Release() {
	if p.release != nil {
		p.release()
		p.release = nil
	}
}

// hold marks dir held by a run unless a Session not ended or another run
// holds it; it says whether a stopped Session holds it (the run then uses
// its worktree as it is). Called with m.mu held.
func (m *Manager) hold(dir string) (byStopped bool, ok bool) {
	if m.closed || m.held[dir] {
		return false, false
	}
	for _, s := range m.sessions {
		s.mu.Lock()
		holds := s.rec.State != contracts.RunnerSessionStateStateEnded && s.rec.Worktree == dir
		alive := s.alive
		s.mu.Unlock()
		if holds && alive {
			return false, false
		}
		byStopped = byStopped || holds
	}
	if m.held == nil {
		m.held = map[string]bool{}
	}
	m.held[dir] = true
	return byStopped, true
}

// unhold gives dir back, and resumes the Sessions whose resume waited for it.
func (m *Manager) unhold(dir string) {
	m.mu.Lock()
	delete(m.held, dir)
	waiting := m.waiting[dir]
	delete(m.waiting, dir)
	m.mu.Unlock()
	for _, s := range waiting {
		m.revive(s)
	}
}

func (m *Manager) origin(owner, name string) *GitHubOrigin {
	return &GitHubOrigin{Home: m.cfg.Home, URL: m.cfg.GitHubURL, Owner: owner, Name: name, Tokens: m.cfg.Tokens, locks: &m.locks}
}

// TicketWorktree is the worktree of the Ticket's branch at sha, for a run.
// Absent, it is made detached at sha after a fetch, prepared by the Hooks as
// a Session's, and removed at Release; a stopped Session's is used as it is
// when its HEAD is sha, and kept. A live Session's, another run's, or one at
// another commit gives ErrPlaceUnavailable.
func (m *Manager) TicketWorktree(ctx context.Context, projectID, owner, name, branch, sha string) (*Place, error) {
	if !uuid.MatchString(projectID) || !validBranch(branch) || !gitSha.MatchString(sha) {
		return nil, ErrPlaceUnavailable
	}
	dir := worktreeDir(m.cfg.Home, projectID, branch)
	m.mu.Lock()
	byStopped, ok := m.hold(dir)
	m.mu.Unlock()
	if !ok {
		return nil, ErrPlaceUnavailable
	}
	unhold := func() { m.unhold(dir) }
	if byStopped {
		if head, err := gitOutput(ctx, dir, "rev-parse", "HEAD"); err != nil || head != sha {
			unhold()
			return nil, ErrPlaceUnavailable
		}
		return &Place{Dir: dir, release: unhold}, nil
	}

	origin := m.origin(owner, name)
	clone, auth, err := origin.Clone(ctx)
	if err != nil {
		unhold()
		return nil, err
	}
	w := Worktree{ProjectID: projectID, Dir: dir, Branch: branch, Clone: clone}
	unlock := m.locks.lock(clone)
	removeWorktree(ctx, clone, dir) // one a killed Runner left there
	err = os.MkdirAll(filepath.Dir(dir), 0o700)
	if err == nil {
		err = runGit(ctx, clone, auth, "worktree", "add", "--quiet", "--detach", dir, sha)
	}
	unlock()
	remove := func() {
		// The run's own context may be gone; the cleaning has its own.
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		if err := m.cfg.Hooks.clean(ctx, w); err != nil {
			m.cfg.Logger.Warn("command.clean", "error", errorKind(err))
		}
		unlock := m.locks.lock(clone)
		removeWorktree(ctx, clone, dir)
		unlock()
		unhold()
	}
	if err != nil {
		unlock := m.locks.lock(clone)
		removeWorktree(ctx, clone, dir)
		unlock()
		unhold()
		return nil, ErrPlaceUnavailable
	}
	if err := m.cfg.Hooks.prepare(ctx, w); err != nil {
		remove()
		return nil, err
	}
	return &Place{Dir: dir, release: remove}, nil
}

// IntegrationCheckout is the Projet's checkout of its integration branch,
// `worktrees/<projectId>/.integration`, made detached once and kept: before
// each run it is fetched, moved to sha (else to the head of
// origin/<integrationBranch>) and cleaned of its untracked files, its
// ignored ones (the dependencies) kept.
func (m *Manager) IntegrationCheckout(ctx context.Context, projectID, owner, name, integrationBranch, sha string) (*Place, error) {
	if !uuid.MatchString(projectID) || !validBranch(integrationBranch) || (sha != "" && !gitSha.MatchString(sha)) {
		return nil, ErrPlaceUnavailable
	}
	dir := filepath.Join(m.cfg.Home, "worktrees", projectID, integrationDir)
	m.mu.Lock()
	_, ok := m.hold(dir)
	m.mu.Unlock()
	if !ok {
		return nil, ErrPlaceUnavailable
	}
	unhold := func() { m.unhold(dir) }
	clone, auth, err := m.origin(owner, name).Clone(ctx)
	if err != nil {
		unhold()
		return nil, err
	}
	target := sha
	if target == "" {
		target = "origin/" + integrationBranch
	}
	unlock := m.locks.lock(clone)
	if _, statErr := os.Stat(filepath.Join(dir, ".git")); statErr != nil {
		removeWorktree(ctx, clone, dir)
		if err = os.MkdirAll(filepath.Dir(dir), 0o700); err == nil {
			err = runGit(ctx, clone, auth, "worktree", "add", "--quiet", "--detach", dir, target)
		}
	}
	if err == nil {
		err = runGit(ctx, dir, auth, "checkout", "--quiet", "--detach", "--force", target)
	}
	if err == nil {
		err = runGit(ctx, dir, nil, "clean", "-fdq")
	}
	unlock()
	if err != nil {
		unhold()
		return nil, ErrPlaceUnavailable
	}
	return &Place{Dir: dir, release: unhold}, nil
}
