package mirror

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/github/githubtest"
)

func newMirror(t *testing.T, fake *githubtest.Server) (*Mirror, string) {
	t.Helper()
	store, path := openStore(t)
	if err := store.PutProjects([]Project{atelier}); err != nil {
		t.Fatal(err)
	}
	return &Mirror{Store: store, GitHub: newClient(fake), Logger: testLogger, Now: func() time.Time { return now }}, path
}

func TestReconcileOnAnEmptyCopyFillsItAndMarksTheProjetFilled(t *testing.T) {
	fake := newFake(t, "testdata/graphql")
	m, path := newMirror(t, fake)

	result, err := m.Reconcile(context.Background(), "acme/atelier")
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	if want := (Result{Listed: 5, Fetched: 5, Checks: 1, Filled: true}); result != want {
		t.Errorf("result %+v, want %+v", result, want)
	}
	assertRows(t, path, "SELECT number, is_pull, state FROM issues ORDER BY number", [][]any{
		{38, 0, "OPEN"}, {39, 0, "CLOSED"}, {40, 0, "OPEN"}, {44, 1, "MERGED"}, {45, 1, "OPEN"},
	})
	// The checks of the open PR's head only.
	assertRows(t, path, "SELECT DISTINCT sha FROM checks", [][]any{{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}})
	assertRows(t, path, "SELECT name FROM repo_labels ORDER BY name", [][]any{{"priority:P1"}, {"ready-for-agent"}})
	assertRows(t, path, "SELECT number, title, due_on FROM milestones", [][]any{{3, "M3 Sessions", "2026-12-01T00:00:00Z"}})
	assertRows(t, path, "SELECT tag, is_prerelease FROM releases", [][]any{{"v0.3.0", 1}})
	assertRows(t, path, "SELECT filled_at, synced_at FROM projects", [][]any{{"2026-11-12T10:00:00Z", "2026-11-12T10:00:00Z"}})
	// Both pages of the issues were walked.
	if n := fake.Count("MirrorIssues"); n != 2 {
		t.Errorf("%d pages of issues, want 2", n)
	}
}

func TestReconcileOnAFullCopyFetchesOnlyTheChangedObjectsAndRemovesTheUnlisted(t *testing.T) {
	fake := newFake(t, "testdata/graphql")
	m, path := newMirror(t, fake)
	if _, err := m.Reconcile(context.Background(), "acme/atelier"); err != nil {
		t.Fatal(err)
	}

	// Nothing changed: nothing is fetched but the walk and the collections.
	fake.Reset()
	result, err := m.Reconcile(context.Background(), "acme/atelier")
	if err != nil {
		t.Fatal(err)
	}
	if want := (Result{Listed: 5}); result != want {
		t.Errorf("unchanged: result %+v, want %+v", result, want)
	}
	if n, c := fake.Count("MirrorObject"), fake.Count("MirrorChecks"); n != 0 || c != 0 {
		t.Errorf("unchanged: %d objects and %d checks fetched, want none", n, c)
	}

	// #38 edited, #39 no longer listed, a new head on #45.
	fake.Load("testdata/changed")
	fake.Reset()
	later := now.Add(15 * time.Minute)
	m.Now = func() time.Time { return later }
	result, err = m.Reconcile(context.Background(), "acme/atelier")
	if err != nil {
		t.Fatal(err)
	}
	if want := (Result{Listed: 4, Fetched: 2, Checks: 1, Deleted: 1}); result != want {
		t.Errorf("changed: result %+v, want %+v", result, want)
	}
	var fetched []any
	for _, call := range fake.Calls() {
		if call.Operation == "MirrorObject" {
			fetched = append(fetched, call.Variables["number"])
		}
	}
	if len(fetched) != 2 || fetched[0] != float64(38) || fetched[1] != float64(45) {
		t.Errorf("fetched %v, want 38 and 45", fetched)
	}
	if n := fake.Count("MirrorChecks"); n != 1 {
		t.Errorf("%d checks fetched, want the new head's", n)
	}
	assertRows(t, path, "SELECT number, title FROM issues WHERE number = 38", [][]any{{38, "Le store du Miroir, revu"}})
	assertRows(t, path, "SELECT head_oid FROM pulls WHERE number = 45", [][]any{{"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}})
	if n := count(t, path, "SELECT count(*) FROM checks WHERE sha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'"); n != 2 {
		t.Errorf("%d checks of the new head", n)
	}
	if n := count(t, path, "SELECT count(*) FROM issues WHERE number = 39") + count(t, path, "SELECT count(*) FROM search WHERE number = 39"); n != 0 {
		t.Error("#39 survived its absence from the walk")
	}
	assertRows(t, path, "SELECT filled_at, synced_at FROM projects", [][]any{{"2026-11-12T10:00:00Z", "2026-11-12T10:15:00Z"}})
}

func TestReconcileRefetchesTheChecksOfAnOpenPRWhoseRollupChanged(t *testing.T) {
	fake := newFake(t, "testdata/graphql")
	m, _ := newMirror(t, fake)
	if _, err := m.Reconcile(context.Background(), "acme/atelier"); err != nil {
		t.Fatal(err)
	}
	fake.Reply("MirrorPulls", map[string]any{"owner": "acme", "name": "atelier", "after": nil}, map[string]any{"repository": map[string]any{"pullRequests": page([]any{
		map[string]any{"number": 45, "updatedAt": "2026-11-09T09:00:00Z", "state": "OPEN", "headRefOid": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "statusCheckRollup": map[string]any{"state": "FAILURE"}},
		map[string]any{"number": 44, "updatedAt": "2026-11-02T09:00:00Z", "state": "MERGED", "headRefOid": "dddddddddddddddddddddddddddddddddddddddd", "statusCheckRollup": map[string]any{"state": "SUCCESS"}},
	}, false, "")}})
	fake.Reset()
	result, err := m.Reconcile(context.Background(), "acme/atelier")
	if err != nil {
		t.Fatal(err)
	}
	if result.Fetched != 0 || result.Checks != 1 || fake.Count("MirrorObject") != 0 {
		t.Errorf("result %+v, %d objects fetched: want only the checks", result, fake.Count("MirrorObject"))
	}
}

func TestReconcileRefetchesAnOpenIssueWhoseBlockersChanged(t *testing.T) {
	fake := newFake(t, "testdata/graphql")
	m, _ := newMirror(t, fake)
	if _, err := m.Reconcile(context.Background(), "acme/atelier"); err != nil {
		t.Fatal(err)
	}
	fake.Reply("MirrorIssues", map[string]any{"owner": "acme", "name": "atelier", "after": "c1"}, map[string]any{"repository": map[string]any{"issues": page([]any{
		map[string]any{"number": 40, "updatedAt": "2026-11-04T12:00:00Z", "state": "OPEN", "blockedBy": map[string]any{"nodes": []any{map[string]any{"number": 38, "repository": map[string]any{"nameWithOwner": "acme/atelier"}}}}},
	}, false, "")}})
	fake.Reset()
	if _, err := m.Reconcile(context.Background(), "acme/atelier"); err != nil {
		t.Fatal(err)
	}
	var fetched []any
	for _, call := range fake.Calls() {
		if call.Operation == "MirrorObject" {
			fetched = append(fetched, call.Variables["number"])
		}
	}
	if len(fetched) != 1 || fetched[0] != float64(40) {
		t.Errorf("fetched %v, want 40", fetched)
	}
}

func TestReconcileOfARepositoryNotAProjetChangesNothing(t *testing.T) {
	fake := newFake(t, "testdata/graphql")
	m, _ := newMirror(t, fake)
	if _, err := m.Reconcile(context.Background(), "acme/inconnu"); !errors.Is(err, ErrNotAProject) {
		t.Errorf("Reconcile = %v, want ErrNotAProject", err)
	}
	if len(fake.Calls()) != 0 {
		t.Error("GitHub was asked")
	}
}

func TestAReconciliationThatFailsDoesNotMarkTheProjetFilled(t *testing.T) {
	fake := newFake(t, "testdata/graphql")
	m, path := newMirror(t, fake)
	fake.Fail("MirrorObject", githubtest.BadGateway(), 1)
	if _, err := m.Reconcile(context.Background(), "acme/atelier"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("Reconcile = %v, want ErrUnavailable", err)
	}
	assertRows(t, path, "SELECT filled_at FROM projects", [][]any{{nil}})
	// The next one finishes the filling.
	if result, err := m.Reconcile(context.Background(), "acme/atelier"); err != nil || !result.Filled {
		t.Errorf("Reconcile = %+v, %v", result, err)
	}
}

func TestAReadOfTheChecksThatFailedIsReadAgainByTheNextReconciliation(t *testing.T) {
	fake := newFake(t, "testdata/graphql")
	m, path := newMirror(t, fake)
	fake.Fail("MirrorChecks", githubtest.BadGateway(), 1)
	if _, err := m.Reconcile(context.Background(), "acme/atelier"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("Reconcile = %v, want ErrUnavailable", err)
	}
	// The PR is in the copy, its head and rollup with it, but not its checks.
	fake.Reset()
	result, err := m.Reconcile(context.Background(), "acme/atelier")
	if err != nil {
		t.Fatal(err)
	}
	if result.Checks != 1 || !result.Filled || fake.Count("MirrorChecks") != 1 {
		t.Errorf("result %+v, %d checks fetched: want the checks read again, then the Projet filled", result, fake.Count("MirrorChecks"))
	}
	if n := count(t, path, "SELECT count(*) FROM checks WHERE sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'"); n == 0 {
		t.Error("no check of the open PR's head")
	}
}

func TestTheChecksOfANewHeadWhoseReadFailedAreReadAgain(t *testing.T) {
	fake := newFake(t, "testdata/graphql")
	m, path := newMirror(t, fake)
	if _, err := m.Reconcile(context.Background(), "acme/atelier"); err != nil {
		t.Fatal(err)
	}
	fake.Load("testdata/changed")
	fake.Fail("MirrorChecks", githubtest.RateLimited(now.Add(time.Hour)), 1)
	var limited *LimitedError
	if _, err := m.Reconcile(context.Background(), "acme/atelier"); !errors.As(err, &limited) {
		t.Fatalf("Reconcile = %v, want a LimitedError", err)
	}
	fake.Reset()
	result, err := m.Reconcile(context.Background(), "acme/atelier")
	if err != nil {
		t.Fatal(err)
	}
	if result.Checks != 1 || fake.Count("MirrorChecks") != 1 {
		t.Errorf("result %+v: want the new head's checks read again", result)
	}
	if n := count(t, path, "SELECT count(*) FROM checks WHERE sha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'"); n != 2 {
		t.Errorf("%d checks of the new head, want 2", n)
	}
}
