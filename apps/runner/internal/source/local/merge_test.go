package local_test

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

// merging is a Local Projet whose folder has `develop` checked out and the
// Pilote's identity, its change #3 on `feat/3-x` pushed by a Session from
// the Runner's clone: `a.txt` changed, `n.txt` added.
type merging struct {
	opened
	dir, clone string
	head       string // the change's head, the SHA the Verdicts judged
	base       string // develop before the merge
}

func mergeFolder(t *testing.T) merging {
	t.Helper()
	ctx := context.Background()
	dir := folder(t, map[string]string{
		"tickets/1-a.md": "---\nnumber: 1\ntitle: A\n---\n",
		"tickets/2-b.md": "---\nnumber: 2\ntitle: B\n---\n",
		"a.txt":          "a\n",
		"b.txt":          "b\n",
	})
	git(t, dir, "checkout", "--quiet", "-b", "develop")
	git(t, dir, "config", "user.name", "Pilote du dossier")
	git(t, dir, "config", "user.email", "dossier@example.test")
	clone := filepath.Join(t.TempDir(), "clone")
	git(t, filepath.Dir(clone), "clone", "--quiet", dir, clone)
	git(t, clone, "checkout", "--quiet", "-b", "feat/3-x", "origin/develop")
	write(t, clone, "a.txt", "a, changé\n")
	write(t, clone, "n.txt", "nouveau\n")
	git(t, clone, "add", "-A")
	git(t, clone, "commit", "--quiet", "-m", "feat : x")
	git(t, clone, "push", "--quiet", "origin", "feat/3-x")
	p := open(t, dir)
	p.SetClone(clone)
	p.SetWorktrees(filepath.Join(t.TempDir(), "worktrees"))
	change, err := p.CreateChange(ctx, source.NewChange{Title: "Le x", Head: "feat/3-x", Base: "develop", Author: "code"})
	if err != nil {
		t.Fatal(err)
	}
	if change.Number != 3 {
		t.Fatalf("change #%d", change.Number)
	}
	*p.changes = nil
	return merging{opened: p, dir: dir, clone: clone, head: git(t, dir, "rev-parse", "feat/3-x"), base: git(t, dir, "rev-parse", "develop")}
}

func TestMergeSquashesTheChangeAndFastForwardsTheFolderWhereDevelopIsCheckedOut(t *testing.T) {
	ctx := context.Background()
	m := mergeFolder(t)

	result, err := m.Merge(ctx, 3, m.head)
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != local.MergeMerged || result.MergeSha == "" {
		t.Fatalf("result %+v", result)
	}
	if got := git(t, m.dir, "rev-parse", "develop"); got != result.MergeSha {
		t.Errorf("develop at %s, the squash %s", got, result.MergeSha)
	}
	if got := git(t, m.dir, "log", "-1", "--format=%s|%an|%ae|%P", "develop"); got != "Le x (#3)|Pilote du dossier|dossier@example.test|"+m.base {
		t.Errorf("the squash commit %q", got)
	}
	if read(t, m.dir, "a.txt") != "a, changé\n" || read(t, m.dir, "n.txt") != "nouveau\n" {
		t.Error("the folder's working tree did not follow develop")
	}
	if status := git(t, m.dir, "status", "--porcelain"); status != "" {
		t.Errorf("the folder is left modified:\n%s", status)
	}
	change, err := m.Change(ctx, 3)
	if err != nil {
		t.Fatal(err)
	}
	if change.State != source.ChangeMerged || change.MergeCommitOid != result.MergeSha || change.MergedAt == nil {
		t.Errorf("change %+v", change)
	}
	if !slices.Contains(*m.changes, source.Changed{ProjectID: projectID, Kind: source.KindChange, Number: 3}) {
		t.Errorf("OnChange %+v", *m.changes)
	}
	if refs := git(t, m.dir, "for-each-ref", "refs/crewdeck/"); refs != "" {
		t.Errorf("a ref left in the folder: %s", refs)
	}
	if worktrees := git(t, m.clone, "worktree", "list", "--porcelain"); strings.Count(worktrees, "worktree ") != 1 {
		t.Errorf("a worktree left in the clone:\n%s", worktrees)
	}
}

func TestMergeKeepsThePilotesUncommittedChangeOfAnotherFile(t *testing.T) {
	m := mergeFolder(t)
	write(t, m.dir, "b.txt", "b, en cours\n")

	result, err := m.Merge(context.Background(), 3, m.head)
	if err != nil || result.Outcome != local.MergeMerged {
		t.Fatalf("result %+v, %v", result, err)
	}
	if read(t, m.dir, "b.txt") != "b, en cours\n" || read(t, m.dir, "a.txt") != "a, changé\n" {
		t.Error("the Pilote's work, or the merge, is not in the working tree")
	}
	if status := git(t, m.dir, "status", "--porcelain"); status != "M b.txt" {
		t.Errorf("status %q", status)
	}
}

func TestMergeIsBlockedByAnUncommittedChangeOfAFileTheChangeTouches(t *testing.T) {
	ctx := context.Background()
	m := mergeFolder(t)
	write(t, m.dir, "a.txt", "a, du Pilote\n")
	write(t, m.dir, "b.txt", "b, en cours\n")

	result, err := m.Merge(ctx, 3, m.head)
	if err != nil || result.Outcome != local.MergeBlocked || result.MergeSha != "" {
		t.Fatalf("result %+v, %v", result, err)
	}
	if read(t, m.dir, "a.txt") != "a, du Pilote\n" || read(t, m.dir, "b.txt") != "b, en cours\n" {
		t.Error("the Pilote's work was touched")
	}
	if got := git(t, m.dir, "rev-parse", "develop"); got != m.base {
		t.Errorf("develop moved to %s", got)
	}
	if refs := git(t, m.dir, "for-each-ref", "refs/crewdeck/"); refs != "" {
		t.Errorf("a ref left in the folder: %s", refs)
	}
	var sha, files string
	if err := m.db.SQL().QueryRow(`SELECT sha, files FROM pending_merges WHERE project_id = ? AND number = 3`, projectID).Scan(&sha, &files); err != nil {
		t.Fatal(err)
	}
	if sha != m.head || files != `["a.txt"]` {
		t.Errorf("pending %s %s", sha, files)
	}
	if change, _ := m.Change(ctx, 3); change.State != source.ChangeOpen {
		t.Errorf("change %+v", change)
	}

	write(t, m.dir, "a.txt", "a\n")
	if result, err := m.Merge(ctx, 3, m.head); err != nil || result.Outcome != local.MergeMerged {
		t.Fatalf("once reverted: %+v, %v", result, err)
	}
	var pending int
	if err := m.db.SQL().QueryRow(`SELECT count(*) FROM pending_merges`).Scan(&pending); err != nil || pending != 0 {
		t.Errorf("pending merges %d, %v", pending, err)
	}
}

func TestMergeOfAShaThatIsNotTheHeadIsStaleAndMergesNothing(t *testing.T) {
	ctx := context.Background()
	m := mergeFolder(t)
	result, err := m.Merge(ctx, 3, strings.Repeat("a1", 20))
	if err != nil || result.Outcome != local.MergeStale {
		t.Fatalf("result %+v, %v", result, err)
	}
	if got := git(t, m.dir, "rev-parse", "develop"); got != m.base {
		t.Errorf("develop moved to %s", got)
	}
	if change, _ := m.Change(ctx, 3); change.State != source.ChangeOpen {
		t.Errorf("change %+v", change)
	}
	if result, err := m.Merge(ctx, 99, m.head); err != nil || result.Outcome != local.MergeStale {
		t.Errorf("an unknown change: %+v, %v", result, err)
	}
}

func TestMergeOfAConflictingChangeIsAConflict(t *testing.T) {
	ctx := context.Background()
	m := mergeFolder(t)
	write(t, m.dir, "a.txt", "a, autrement\n")
	git(t, m.dir, "commit", "--quiet", "-am", "Un commit du Pilote")
	base := git(t, m.dir, "rev-parse", "develop")

	result, err := m.Merge(ctx, 3, m.head)
	if err != nil || result.Outcome != local.MergeConflict {
		t.Fatalf("result %+v, %v", result, err)
	}
	if got := git(t, m.dir, "rev-parse", "develop"); got != base {
		t.Errorf("develop moved to %s", got)
	}
	if worktrees := git(t, m.clone, "worktree", "list", "--porcelain"); strings.Count(worktrees, "worktree ") != 1 {
		t.Errorf("a worktree left in the clone:\n%s", worktrees)
	}
}

func TestMergeAskedAgainOnceMergedSaysTheSame(t *testing.T) {
	ctx := context.Background()
	m := mergeFolder(t)
	first, err := m.Merge(ctx, 3, m.head)
	if err != nil {
		t.Fatal(err)
	}
	if again, err := m.Merge(ctx, 3, m.head); err != nil || again != first {
		t.Errorf("again %+v, %v; first %+v", again, err, first)
	}
}

func TestMergeMovesDevelopWithUpdateRefWhenItIsNotCheckedOut(t *testing.T) {
	ctx := context.Background()
	m := mergeFolder(t)
	git(t, m.dir, "checkout", "--quiet", "main")
	write(t, m.dir, "b.txt", "b, sur main\n")

	result, err := m.Merge(ctx, 3, m.head)
	if err != nil || result.Outcome != local.MergeMerged {
		t.Fatalf("result %+v, %v", result, err)
	}
	if got := git(t, m.dir, "rev-parse", "develop"); got != result.MergeSha {
		t.Errorf("develop at %s, the squash %s", got, result.MergeSha)
	}
	if head := git(t, m.dir, "symbolic-ref", "HEAD"); head != "refs/heads/main" || read(t, m.dir, "a.txt") != "a\n" || read(t, m.dir, "b.txt") != "b, sur main\n" {
		t.Errorf("the checkout of main was touched: %s", head)
	}
}

func TestMergeRedoesTheSquashOnACommitAddedToDevelopMeanwhile(t *testing.T) {
	ctx := context.Background()
	m := mergeFolder(t)
	git(t, m.dir, "checkout", "--quiet", "main")
	// The Pilote commits on develop once, between the fetch and the update:
	// as the squash reaches the folder.
	hook := filepath.Join(m.dir, ".git", "hooks", "post-receive")
	write(t, filepath.Dir(hook), "post-receive", `#!/bin/sh
[ -e "$GIT_DIR/committed" ] && exit 0
touch "$GIT_DIR/committed"
tree=$(git rev-parse develop^{tree})
commit=$(echo "Le commit du Pilote" | GIT_AUTHOR_NAME=Pilote GIT_AUTHOR_EMAIL=p@example.test GIT_COMMITTER_NAME=Pilote GIT_COMMITTER_EMAIL=p@example.test git commit-tree "$tree" -p develop)
git update-ref refs/heads/develop "$commit"
`)
	if err := os.Chmod(hook, 0o755); err != nil {
		t.Fatal(err)
	}

	result, err := m.Merge(ctx, 3, m.head)
	if err != nil || result.Outcome != local.MergeMerged {
		t.Fatalf("result %+v, %v", result, err)
	}
	if got := git(t, m.dir, "log", "--format=%s", m.base+"..develop"); got != "Le x (#3)\nLe commit du Pilote" {
		t.Errorf("develop's history since:\n%s", got)
	}
	if got := git(t, m.dir, "rev-parse", "develop"); got != result.MergeSha {
		t.Errorf("develop at %s, the squash %s", got, result.MergeSha)
	}
}

func TestMergeIsStaleWhenDevelopKeepsMovingThreeTimes(t *testing.T) {
	m := mergeFolder(t)
	git(t, m.dir, "checkout", "--quiet", "main")
	hook := filepath.Join(m.dir, ".git", "hooks", "post-receive")
	write(t, filepath.Dir(hook), "post-receive", `#!/bin/sh
commit=$(echo "Encore un" | GIT_AUTHOR_NAME=Pilote GIT_AUTHOR_EMAIL=p@example.test GIT_COMMITTER_NAME=Pilote GIT_COMMITTER_EMAIL=p@example.test git commit-tree "$(git rev-parse develop^{tree})" -p develop)
git update-ref refs/heads/develop "$commit"
`)
	if err := os.Chmod(hook, 0o755); err != nil {
		t.Fatal(err)
	}
	result, err := m.Merge(context.Background(), 3, m.head)
	if err != nil || result.Outcome != local.MergeStale {
		t.Fatalf("result %+v, %v", result, err)
	}
	if got := git(t, m.dir, "log", "--format=%s", m.base+"..develop"); got != "Encore un\nEncore un\nEncore un" {
		t.Errorf("develop's history since:\n%s", got)
	}
}

func TestMergeCommitsAsCrewdeckWhenTheFolderHasNoIdentity(t *testing.T) {
	empty := filepath.Join(t.TempDir(), "gitconfig")
	write(t, filepath.Dir(empty), "gitconfig", "")
	t.Setenv("GIT_CONFIG_GLOBAL", empty)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	m := mergeFolder(t)
	git(t, m.dir, "config", "--unset", "user.name")
	git(t, m.dir, "config", "--unset", "user.email")

	result, err := m.Merge(context.Background(), 3, m.head)
	if err != nil || result.Outcome != local.MergeMerged {
		t.Fatalf("result %+v, %v", result, err)
	}
	if got := git(t, m.dir, "log", "-1", "--format=%an <%ae>|%cn <%ce>", "develop"); got != "Crewdeck <crewdeck@localhost>|Crewdeck <crewdeck@localhost>" {
		t.Errorf("the squash's identity %q", got)
	}
}

func TestMergeIsBlockedWithoutAutostashWhenTheFolderAsksForIt(t *testing.T) {
	ctx := context.Background()
	m := mergeFolder(t)
	git(t, m.dir, "config", "merge.autoStash", "true")
	write(t, m.dir, "a.txt", "a, du Pilote\n")
	head := git(t, m.dir, "rev-parse", "HEAD")

	result, err := m.Merge(ctx, 3, m.head)
	if err != nil || result.Outcome != local.MergeBlocked {
		t.Fatalf("result %+v, %v", result, err)
	}
	if got := git(t, m.dir, "rev-parse", "HEAD"); got != head {
		t.Errorf("HEAD at %s, was %s", got, head)
	}
	if got := read(t, m.dir, "a.txt"); got != "a, du Pilote\n" {
		t.Errorf("a.txt %q", got)
	}
	if got := git(t, m.dir, "status", "--porcelain"); got != "M a.txt" {
		t.Errorf("status %q", got)
	}
	if got := git(t, m.dir, "stash", "list"); got != "" {
		t.Errorf("stash %q", got)
	}
}

// moveHeadOnPush makes the folder's hook move feat/3-x once, as a Session's
// push would, when the squash reaches the folder: after the head was checked.
func moveHeadOnPush(t *testing.T, m merging) {
	t.Helper()
	hook := filepath.Join(m.dir, ".git", "hooks", "post-receive")
	write(t, filepath.Dir(hook), "post-receive", `#!/bin/sh
[ -e "$GIT_DIR/pushed" ] && exit 0
touch "$GIT_DIR/pushed"
commit=$(echo "feat : poussé pendant le merge" | GIT_AUTHOR_NAME=Agent GIT_AUTHOR_EMAIL=a@example.test GIT_COMMITTER_NAME=Agent GIT_COMMITTER_EMAIL=a@example.test git commit-tree "$(git rev-parse feat/3-x^{tree})" -p feat/3-x)
git update-ref refs/heads/feat/3-x "$commit"
`)
	if err := os.Chmod(hook, 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestMergeIsStaleWhenTheChangesHeadMovesBeforeTheSquashIsApplied(t *testing.T) {
	for _, checkedOut := range []bool{true, false} {
		ctx := context.Background()
		m := mergeFolder(t)
		if !checkedOut {
			git(t, m.dir, "checkout", "--quiet", "main")
		}
		moveHeadOnPush(t, m)

		result, err := m.Merge(ctx, 3, m.head)
		if err != nil || result.Outcome != local.MergeStale {
			t.Fatalf("checked out %v: result %+v, %v", checkedOut, result, err)
		}
		if got := git(t, m.dir, "rev-parse", "develop"); got != m.base {
			t.Errorf("checked out %v: develop at %s, was %s", checkedOut, got, m.base)
		}
		if got := git(t, m.dir, "status", "--porcelain"); got != "" {
			t.Errorf("checked out %v: status %q", checkedOut, got)
		}
		if c, _ := m.Change(ctx, 3); c.State != source.ChangeOpen {
			t.Errorf("checked out %v: change %+v", checkedOut, c)
		}
		if got := git(t, m.dir, "for-each-ref", "refs/crewdeck/"); got != "" {
			t.Errorf("checked out %v: refs left %q", checkedOut, got)
		}
	}
}
