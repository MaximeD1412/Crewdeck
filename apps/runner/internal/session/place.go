package session

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"

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

// unhold gives dir back, and resumes the Sessions whose resume waited for
// it: armed in the same hold of m.mu that gives dir back, so that a Stop
// that comes after finds them alive and stops them.
func (m *Manager) unhold(dir string) {
	m.mu.Lock()
	delete(m.held, dir)
	var resumes []func()
	for _, s := range m.waiting[dir] {
		resumes = append(resumes, m.reviveLocked(s))
	}
	delete(m.waiting, dir)
	gap := m.afterUnhold
	m.mu.Unlock()
	if gap != nil {
		gap()
	}
	for _, resume := range resumes {
		resume()
	}
}

// TicketWorktree is the worktree of the Ticket's branch at sha, for a run.
// Absent, it is made detached at sha after a fetch, prepared by the Hooks
// with prep as a Session's, then cleaned and removed at Release; a
// preparation that fails removes it and gives a *SetupError. A stopped
// Session's is used as it is when its HEAD is sha, not prepared again, and
// kept. A live Session's, another run's, or one at another commit gives
// ErrPlaceUnavailable.
func (m *Manager) TicketWorktree(ctx context.Context, projectID string, from contracts.Origin, branch, sha string, prep Preparation) (*Place, error) {
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

	origin, err := m.originOf(projectID, from)
	if err != nil {
		unhold()
		return nil, ErrPlaceUnavailable
	}
	clone, auth, err := origin.Clone(ctx)
	if err != nil {
		unhold()
		return nil, err
	}
	prep.Commands = m.cfg.Hooks.keep(projectID, prep.Commands)
	w := Worktree{ProjectID: projectID, Dir: dir, Branch: branch, Clone: clone, Preparation: prep}
	unlock := m.locks.lock(clone)
	removeWorktree(ctx, clone, dir) // one a killed Runner left there
	err = os.MkdirAll(filepath.Dir(dir), 0o700)
	if err == nil {
		err = runGit(ctx, clone, auth, "worktree", "add", "--quiet", "--detach", dir, sha)
	}
	unlock()
	remove := func() {
		m.remove(w)
		unhold()
	}
	if err != nil {
		unlock := m.locks.lock(clone)
		removeWorktree(ctx, clone, dir)
		unlock()
		unhold()
		return nil, ErrPlaceUnavailable
	}
	if err := m.cfg.Hooks.prepare(ctx, withEnv(ctx, w)); err != nil {
		remove()
		return nil, setupFailed(err)
	}
	return &Place{Dir: dir, release: remove}, nil
}

// IntegrationCheckout is the Projet's checkout of its integration branch,
// `worktrees/<projectId>/.integration`, made detached once and kept: before
// each run it is fetched, moved to sha (else to the head of
// origin/<integrationBranch>) and cleaned of its untracked files, its
// ignored ones (the dependencies) kept.
func (m *Manager) IntegrationCheckout(ctx context.Context, projectID string, from contracts.Origin, integrationBranch, sha string) (*Place, error) {
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
	origin, err := m.originOf(projectID, from)
	if err != nil {
		unhold()
		return nil, ErrPlaceUnavailable
	}
	clone, auth, err := origin.Clone(ctx)
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
