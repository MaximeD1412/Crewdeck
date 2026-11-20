package local

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// The merge of a local change of code (SOURCE-5, ADR 0012, « The Local
// folder »), bound to the SHA every Verdict judged (ADR 0002): squashed in
// the Runner's clone on the folder's integration head as just fetched, the
// squash pushed to the folder, then the folder's integration branch moved
// onto it, `git merge --ff-only` when it is checked out there, `git
// update-ref` with its old value otherwise. The Pilote's working tree is
// never touched but by `merge --ff-only`, which refuses rather than
// overwrite their uncommitted work (risk AGT-8): no stash, reset, checkout
// nor clean in the folder.

// MergeOutcome is how a merge ended (`merge.local.result`).
type MergeOutcome string

const (
	// MergeMerged: the folder's integration branch is the squash commit.
	MergeMerged MergeOutcome = "merged"
	// MergeConflict: the change does not squash on the integration head.
	MergeConflict MergeOutcome = "conflict"
	// MergeBlocked: the Pilote's uncommitted changes touch the same files;
	// kept in pending_merges and retried (Merges).
	MergeBlocked MergeOutcome = "blocked"
	// MergeStale: the change's head is not the SHA judged, it is no longer
	// open, or the integration branch kept moving: nothing merged.
	MergeStale MergeOutcome = "stale"
)

// MergeResult is a merge's outcome, MergeSha the squash commit when merged.
type MergeResult struct {
	Outcome  MergeOutcome
	MergeSha string
}

// mergeAttempts: the folder's integration branch moved meanwhile this many
// times, the merge is `stale`.
const mergeAttempts = 3

// The squash commit's identity when the folder has none.
const (
	fallbackName  = "Crewdeck"
	fallbackEmail = "crewdeck@localhost"
)

// SetWorktrees names the folder of the Projet's worktrees of the Runner
// (`~/.crewdeck/worktrees/<projectId>`), where a merge squashes.
func (p *Project) SetWorktrees(dir string) {
	p.mu.Lock()
	p.worktrees = dir
	p.mu.Unlock()
}

// Merge merges the change number at sha, one merge at a time per Projet: a
// head other than sha is never merged. A blocked merge is kept in
// pending_merges with the files git named, any other outcome ends the one
// pending for the change.
func (p *Project) Merge(ctx context.Context, number int, sha string) (MergeResult, error) {
	p.gitMu.Lock()
	defer p.gitMu.Unlock()
	result, files, err := p.merge(ctx, number, sha)
	if err != nil {
		return MergeResult{}, err
	}
	if result.Outcome == MergeBlocked {
		data, _ := json.Marshal(files)
		_, err = p.db.db.ExecContext(ctx, `INSERT INTO pending_merges (project_id, number, sha, files, since) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (project_id, number) DO UPDATE SET files = excluded.files,
			since = CASE WHEN pending_merges.sha = excluded.sha THEN pending_merges.since ELSE excluded.since END, sha = excluded.sha`,
			p.id, number, sha, string(data), formatTime(time.Now()))
	} else {
		_, err = p.db.db.ExecContext(ctx, `DELETE FROM pending_merges WHERE project_id = ? AND number = ?`, p.id, number)
	}
	if err != nil {
		return MergeResult{}, fmt.Errorf("local: write a pending merge: %w", err)
	}
	return result, nil
}

func (p *Project) merge(ctx context.Context, number int, sha string) (MergeResult, []string, error) {
	c, err := p.Change(ctx, number)
	if errors.Is(err, source.ErrNotFound) {
		return MergeResult{Outcome: MergeStale}, nil, nil
	}
	if err != nil {
		return MergeResult{}, nil, err
	}
	switch c.State {
	case source.ChangeMerged:
		// Asked again (a result lost): the same answer, at the same head only.
		if c.HeadOid == sha && c.MergeCommitOid != "" {
			return MergeResult{Outcome: MergeMerged, MergeSha: c.MergeCommitOid}, nil, nil
		}
		return MergeResult{Outcome: MergeStale}, nil, nil
	case source.ChangeClosed:
		return MergeResult{Outcome: MergeStale}, nil, nil
	}
	p.mu.Lock()
	clone, worktrees := p.clone, p.worktrees
	p.mu.Unlock()
	if clone == "" {
		return MergeResult{}, nil, errors.New("local: no clone to merge in")
	}
	if worktrees == "" {
		worktrees = filepath.Join(os.TempDir(), "crewdeck-worktrees", p.id)
	}
	for range mergeAttempts {
		if err := cloneOrFetch(ctx, p.folder, clone); err != nil {
			return MergeResult{}, nil, err
		}
		if head, ok := branchOf(ctx, p.folder, c.HeadRef); !ok || head != sha {
			return MergeResult{Outcome: MergeStale}, nil, nil
		}
		base, ok := originBranch(ctx, clone, c.BaseRef)
		if !ok {
			return MergeResult{Outcome: MergeConflict}, nil, nil
		}
		// A branch's component never starts with a dot: no Session's worktree there.
		squash, err := squash(ctx, clone, filepath.Join(worktrees, ".merge-"+strconv.Itoa(number)), base, sha, c.Title+" (#"+strconv.Itoa(number)+")", p.identity(ctx))
		if errors.Is(err, errConflict) {
			return MergeResult{Outcome: MergeConflict}, nil, nil
		}
		if err != nil {
			return MergeResult{}, nil, err
		}
		files, err := p.moveBase(ctx, clone, number, c.BaseRef, base, squash, c.HeadRef, sha)
		if errors.Is(err, errBaseMoved) {
			continue // squashed again on what the Pilote committed meanwhile
		}
		if errors.Is(err, errHeadMoved) {
			return MergeResult{Outcome: MergeStale}, nil, nil // pushed after the Verdicts (ADR 0002)
		}
		if err != nil {
			return MergeResult{}, nil, err
		}
		if len(files) > 0 {
			return MergeResult{Outcome: MergeBlocked}, files, nil
		}
		if err := p.merged(ctx, number, sha, squash); err != nil {
			return MergeResult{}, nil, err
		}
		return MergeResult{Outcome: MergeMerged, MergeSha: squash}, nil, nil
	}
	return MergeResult{Outcome: MergeStale}, nil, nil
}

var (
	errConflict  = errors.New("local: the change does not squash")
	errBaseMoved = errors.New("local: the integration branch moved")
	errHeadMoved = errors.New("local: the change's head moved")
)

// squash makes, in a worktree of the clone detached at base, the squash
// commit of sha titled message, and removes the worktree.
func squash(ctx context.Context, clone, dir, base, sha, message string, who identity) (string, error) {
	removeWorktree(ctx, clone, dir)
	defer removeWorktree(ctx, clone, dir)
	if err := os.MkdirAll(filepath.Dir(dir), dirMode); err != nil {
		return "", fmt.Errorf("local: the worktrees' folder: %w", err)
	}
	if err := runGit(ctx, clone, "worktree", "add", "--quiet", "--detach", dir, base); err != nil {
		return "", err
	}
	if err := runGit(ctx, dir, "merge", "--squash", "--quiet", sha); err != nil {
		if unmerged, _ := gitOutput(ctx, dir, "diff", "--name-only", "--diff-filter=U"); unmerged != "" {
			return "", errConflict
		}
		return "", err
	}
	commit := gitCommand(ctx, dir, "commit", "--quiet", "--no-verify", "--no-gpg-sign", "--allow-empty", "-m", message)
	commit.Env = append(commit.Env, "GIT_AUTHOR_NAME="+who.name, "GIT_AUTHOR_EMAIL="+who.email, "GIT_COMMITTER_NAME="+who.name, "GIT_COMMITTER_EMAIL="+who.email)
	if err := commit.Run(); err != nil {
		return "", &gitError{command: "commit", err: err}
	}
	return gitOutput(ctx, dir, "rev-parse", "HEAD")
}

// moveBase moves the folder's branch from base to squash, pushed there as
// refs/crewdeck/merge/<n> for the time of it, while the change's branch
// headRef is still sha: the files git names when the Pilote's uncommitted
// changes touch the same ones; errBaseMoved when the branch is no longer
// base, errHeadMoved when headRef is no longer sha. `update-ref` checks both
// in one transaction; `merge --ff-only`, which has the working tree to
// update, right before.
func (p *Project) moveBase(ctx context.Context, clone string, number int, branch, base, squash, headRef, sha string) ([]string, error) {
	ref := "refs/crewdeck/merge/" + strconv.Itoa(number)
	if err := runGit(ctx, clone, "push", "--quiet", "--force", "--no-verify", "origin", squash+":"+ref); err != nil {
		return nil, err
	}
	defer runGit(context.WithoutCancel(ctx), p.folder, "update-ref", "-d", ref)
	moved := func() bool {
		now, ok := branchOf(ctx, p.folder, branch)
		return !ok || now != base
	}
	headMoved := func() bool {
		now, ok := branchOf(ctx, p.folder, headRef)
		return !ok || now != sha
	}
	if moved() {
		return nil, errBaseMoved
	}
	if headMoved() {
		return nil, errHeadMoved
	}
	if head, err := gitOutput(ctx, p.folder, "symbolic-ref", "--quiet", "HEAD"); err == nil && head == "refs/heads/"+branch {
		// --no-autostash: the Pilote's merge.autoStash would stash their
		// work and apply it again over the merge, conflicts and all.
		out, err := gitCommand(ctx, p.folder, "merge", "--ff-only", "--no-autostash", "--quiet", squash).CombinedOutput()
		if err == nil {
			return nil, nil
		}
		if files := overwritten(string(out)); len(files) > 0 {
			return files, nil
		}
		if moved() {
			return nil, errBaseMoved
		}
		return nil, &gitError{command: "merge", err: err}
	}
	update := gitCommand(ctx, p.folder, "update-ref", "--stdin")
	update.Stdin = strings.NewReader("start\nverify refs/heads/" + headRef + " " + sha + "\nupdate refs/heads/" + branch + " " + squash + " " + base + "\ncommit\n")
	if err := update.Run(); err != nil {
		switch {
		case headMoved():
			return nil, errHeadMoved
		case moved():
			return nil, errBaseMoved
		}
		return nil, &gitError{command: "update-ref", err: err}
	}
	return nil, nil
}

// overwritten are the files git names when a merge would overwrite the
// working tree's changes (tracked or untracked), from its output.
func overwritten(out string) []string {
	var files []string
	listing := false
	for _, line := range strings.Split(out, "\n") {
		switch {
		case strings.Contains(line, "would be overwritten by merge"):
			listing = true
		case listing && strings.HasPrefix(line, "\t"):
			files = append(files, strings.TrimSpace(line))
		default:
			listing = false
		}
	}
	return files
}

// merged records the change merged at its head sha (the one checked in the
// folder, maybe not followed yet) as squash, and says it (OnChange).
func (p *Project) merged(ctx context.Context, number int, sha, squash string) error {
	now := formatTime(time.Now())
	_, err := p.db.db.ExecContext(ctx, `UPDATE changes SET state = 'merged', head_oid = ?, merge_commit_oid = ?, merged_at = ?, updated_at = ? WHERE project_id = ? AND number = ?`,
		sha, squash, now, now, p.id, number)
	if err != nil {
		return fmt.Errorf("local: write a change merged: %w", err)
	}
	p.notifyChanges(number)
	return nil
}

// notifyChanges calls the listeners on the changes of those numbers.
func (p *Project) notifyChanges(numbers ...int) {
	changed := make([]source.Changed, 0, len(numbers))
	for _, n := range numbers {
		changed = append(changed, p.changeChanged(n))
	}
	p.mu.Lock()
	listeners := slices.Clone(p.listeners)
	p.mu.Unlock()
	notify(listeners, changed)
}

type identity struct{ name, email string }

// identity is the folder's user.name and user.email (its own, else the
// Pilote's global ones), Crewdeck's when unset: the squash lands in the
// Pilote's history.
func (p *Project) identity(ctx context.Context) identity {
	who := identity{name: fallbackName, email: fallbackEmail}
	if name, err := gitOutput(ctx, p.folder, "config", "user.name"); err == nil && name != "" {
		who.name = name
	}
	if email, err := gitOutput(ctx, p.folder, "config", "user.email"); err == nil && email != "" {
		who.email = email
	}
	return who
}

// originBranch is the folder's branch as the clone last fetched it.
func originBranch(ctx context.Context, clone, branch string) (string, bool) {
	if branch == "" || strings.HasPrefix(branch, "-") {
		return "", false
	}
	oid, err := gitOutput(ctx, clone, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/"+branch+"^{commit}")
	return oid, err == nil && oid != ""
}

func removeWorktree(ctx context.Context, clone, dir string) {
	ctx = context.WithoutCancel(ctx)
	_ = runGit(ctx, clone, "worktree", "remove", "--force", dir)
	_ = os.RemoveAll(dir)
	_ = runGit(ctx, clone, "worktree", "prune")
}
