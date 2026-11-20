package local_test

import (
	"context"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

// changeAt finds a report holding the change #3 as ok wants it.
func changeAt(ok func(*contracts.LocalItemChange) bool) func(contracts.RunnerLocalChanged) bool {
	return func(m contracts.RunnerLocalChanged) bool {
		for _, item := range m.Items {
			if item.Change != nil && item.Change.Number == 3 && ok(item.Change) {
				return true
			}
		}
		return false
	}
}

func mergeable(t *testing.T, m merging) (head, state string) {
	t.Helper()
	c, err := m.Change(context.Background(), 3)
	if err != nil {
		t.Fatal(err)
	}
	return c.HeadOid, c.Mergeable
}

func TestWatchFollowsAChangesBranchASessionPushesAndItsMergeability(t *testing.T) {
	for _, poll := range []bool{false, true} {
		m := mergeFolder(t)
		srv := newServer()
		watch(t, m.Project, local.WatchConfig{Send: srv.send, Poll: poll, PollEvery: 200 * time.Millisecond})
		srv.next(t, 2*time.Second, changeAt(func(c *contracts.LocalItemChange) bool { return c.HeadSha == m.head }))

		write(t, m.clone, "n.txt", "nouveau, encore\n")
		git(t, m.clone, "commit", "--quiet", "-am", "feat : encore")
		git(t, m.clone, "push", "--quiet", "origin", "feat/3-x")
		pushed := git(t, m.clone, "rev-parse", "HEAD")
		srv.next(t, 3*time.Second, changeAt(func(c *contracts.LocalItemChange) bool { return c.HeadSha == pushed }))
		if head, state := mergeable(t, m); head != pushed || state != "MERGEABLE" {
			t.Errorf("poll %v: head %s, mergeable %q", poll, head, state)
		}

		// The Pilote commits on develop what the change's next push conflicts with.
		write(t, m.dir, "n.txt", "du Pilote\n")
		git(t, m.dir, "add", "n.txt")
		git(t, m.dir, "commit", "--quiet", "-m", "Un commit du Pilote")
		write(t, m.clone, "a.txt", "a, encore\n")
		git(t, m.clone, "commit", "--quiet", "-am", "feat : et a")
		git(t, m.clone, "push", "--quiet", "origin", "feat/3-x")
		conflicting := git(t, m.clone, "rev-parse", "HEAD")
		srv.next(t, 3*time.Second, changeAt(func(c *contracts.LocalItemChange) bool { return c.HeadSha == conflicting }))
		if _, state := mergeable(t, m); state != "CONFLICTING" {
			t.Errorf("poll %v: mergeable %q", poll, state)
		}

		git(t, m.dir, "branch", "--quiet", "-D", "feat/3-x")
		srv.next(t, 3*time.Second, changeAt(func(c *contracts.LocalItemChange) bool { return c.State == contracts.LocalItemChangeStateClosed }))
		if change, err := m.Change(context.Background(), 3); err != nil || change.State != source.ChangeClosed || change.ClosedAt == nil {
			t.Errorf("poll %v: change %+v, %v", poll, change, err)
		}
	}
}

func TestFollowChangesClosesNothingWhenTheFolderIsGone(t *testing.T) {
	ctx := context.Background()
	m := mergeFolder(t)
	if err := m.FollowChanges(ctx); err != nil {
		t.Fatal(err)
	}
	broken := local.Open(m.db, func() *keys.Vault { return m.vault }, projectID, t.TempDir())
	_ = broken.FollowChanges(ctx)
	if change, _ := m.Change(ctx, 3); change.State != source.ChangeOpen {
		t.Errorf("change %+v", change)
	}
}
