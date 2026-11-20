package local_test

import (
	"context"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

// results is the server's side of merge.local.result.
type results chan contracts.RunnerMergeLocalResult

func (r results) send(_ context.Context, m contracts.RunnerMergeLocalResult) error {
	r <- m
	return nil
}

func (r results) next(t *testing.T, within time.Duration) contracts.RunnerMergeLocalResult {
	t.Helper()
	select {
	case m := <-r:
		return m
	case <-time.After(within):
		t.Fatalf("no merge.local.result within %s", within)
		return contracts.RunnerMergeLocalResult{}
	}
}

func (r results) none(t *testing.T, during time.Duration) {
	t.Helper()
	select {
	case m := <-r:
		t.Fatalf("an unexpected result %+v", m)
	case <-time.After(during):
	}
}

func runMerges(t *testing.T, m merging, every time.Duration) (*local.Merges, results) {
	t.Helper()
	got := make(results, 10)
	merges := local.NewMerges(local.MergesConfig{
		DB:         m.db,
		Project:    func(id string) (*local.Project, bool) { return m.Project, id == projectID },
		Send:       got.send,
		RetryEvery: every,
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		merges.Run(ctx)
	}()
	t.Cleanup(func() {
		cancel()
		<-done
	})
	return merges, got
}

func request(m merging, sha string) contracts.RunnerMergeLocal {
	return contracts.RunnerMergeLocal{Type: "merge.local", Id: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c10", At: time.Now(), ProjectId: projectID, ChangeNumber: 3, Sha: sha}
}

func TestMergesAnswerARequestWithItsResult(t *testing.T) {
	m := mergeFolder(t)
	merges, got := runMerges(t, m, 0)
	merges.Request(request(m, m.head))
	result := got.next(t, 5*time.Second)
	if result.Type != "merge.local.result" || result.ProjectId != projectID || result.ChangeNumber != 3 || result.Sha != m.head ||
		result.Outcome != contracts.RunnerMergeLocalResultOutcomeMerged || result.MergeSha == nil || *result.MergeSha != git(t, m.dir, "rev-parse", "develop") {
		t.Errorf("result %+v", result)
	}
}

func TestMergesRetryABlockedMergeWithinSixSecondsOfTheFileReverted(t *testing.T) {
	m := mergeFolder(t)
	write(t, m.dir, "a.txt", "a, du Pilote\n")
	merges, got := runMerges(t, m, 0) // every 5 s, as the Runner does
	merges.Request(request(m, m.head))
	if result := got.next(t, 5*time.Second); result.Outcome != contracts.RunnerMergeLocalResultOutcomeBlocked || result.MergeSha != nil {
		t.Fatalf("result %+v", result)
	}
	got.none(t, 5500*time.Millisecond) // still modified: no retry sent

	write(t, m.dir, "a.txt", "a\n")
	reverted := time.Now()
	result := got.next(t, 6*time.Second)
	if result.Outcome != contracts.RunnerMergeLocalResultOutcomeMerged {
		t.Fatalf("retried %+v", result)
	}
	if took := time.Since(reverted); took > 6*time.Second {
		t.Errorf("retried %s after", took)
	}
}

func TestMergesRetryABlockedMergeAtOnceWhenARefMoved(t *testing.T) {
	m := mergeFolder(t)
	write(t, m.dir, "a.txt", "a, du Pilote\n")
	merges, got := runMerges(t, m, time.Hour)
	merges.Request(request(m, m.head))
	if result := got.next(t, 5*time.Second); result.Outcome != contracts.RunnerMergeLocalResultOutcomeBlocked {
		t.Fatalf("result %+v", result)
	}
	merges.RefsMoved(projectID)
	if result := got.next(t, 2*time.Second); result.Outcome != contracts.RunnerMergeLocalResultOutcomeBlocked {
		t.Fatalf("its retry %+v", result)
	}
	merges.RefsMoved("019a6f00-0000-7000-8000-00000000ffff")
	got.none(t, 500*time.Millisecond)
}

func TestMergesEndAPendingMergeOfAChangeClosedAsStale(t *testing.T) {
	ctx := context.Background()
	m := mergeFolder(t)
	write(t, m.dir, "a.txt", "a, du Pilote\n")
	merges, got := runMerges(t, m, 200*time.Millisecond)
	merges.Request(request(m, m.head))
	if result := got.next(t, 5*time.Second); result.Outcome != contracts.RunnerMergeLocalResultOutcomeBlocked {
		t.Fatalf("result %+v", result)
	}
	if _, err := m.SetChangeState(ctx, 3, source.ChangeClosed, false); err != nil {
		t.Fatal(err)
	}
	if result := got.next(t, 2*time.Second); result.Outcome != contracts.RunnerMergeLocalResultOutcomeStale {
		t.Fatalf("result %+v", result)
	}
	got.none(t, 500*time.Millisecond)
	if read(t, m.dir, "a.txt") != "a, du Pilote\n" {
		t.Error("the Pilote's work was touched")
	}
}
