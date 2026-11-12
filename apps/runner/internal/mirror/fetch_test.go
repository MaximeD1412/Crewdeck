package mirror

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github/githubtest"
)

type staticToken string

func (s staticToken) Token(context.Context) (string, error) { return string(s), nil }

var now = time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC)

func newClient(fake *githubtest.Server) *Client {
	return &Client{
		BaseURL: fake.URL,
		Tokens:  func(repository string) github.TokenSource { return staticToken("ghs_mirror_" + repository) },
		Logger:  testLogger,
		Now:     func() time.Time { return now },
	}
}

func put(t *testing.T, store *Store, o Object) {
	t.Helper()
	if err := store.Update(func(tx *sql.Tx) error { return PutObject(tx, o) }); err != nil {
		t.Fatalf("PutObject: %v", err)
	}
}

func assertRows(t *testing.T, path, statement string, want [][]any, args ...any) {
	t.Helper()
	got := query(t, path, statement, args...)
	if len(got) == 0 && len(want) == 0 {
		return
	}
	// Integers come back as int64.
	normalized := fmt.Sprint(want)
	if fmt.Sprint(got) != normalized {
		t.Errorf("%s\n got %v\nwant %v", statement, got, want)
	}
}

func TestFetchObjectOfAnIssueStoresItsFieldsAndRelations(t *testing.T) {
	fake := githubtest.New(t, "testdata/graphql")
	store, path := openStore(t)
	o, err := newClient(fake).FetchObject(context.Background(), "acme/atelier", 38)
	if err != nil {
		t.Fatalf("FetchObject: %v", err)
	}
	put(t, store, o)

	assertRows(t, path, "SELECT number, is_pull, title, body, state, state_reason, url, author, milestone_number, created_at, updated_at, closed_at FROM issues", [][]any{
		{38, 0, "Le store du Miroir", "Corps confidentiel du ticket trente-huit", "OPEN", nil, "https://github.com/acme/atelier/issues/38", "pilote", 3, "2026-11-01T08:00:00Z", "2026-11-10T09:00:00Z", nil},
	})
	assertRows(t, path, "SELECT name FROM issue_labels WHERE number = 38 ORDER BY name", [][]any{{"priority:P1"}, {"ready-for-agent"}})
	assertRows(t, path, "SELECT login FROM issue_assignees WHERE number = 38", [][]any{{"octo"}})
	assertRows(t, path, "SELECT id, author, body, url, created_at, updated_at FROM comments WHERE number = 38 ORDER BY id", [][]any{
		{"IC_38_1", "octo", "Premier commentaire confidentiel", "https://github.com/acme/atelier/issues/38#issuecomment-1", "2026-11-02T10:00:00Z", "2026-11-02T10:05:00Z"},
		{"IC_38_2", nil, "Second commentaire confidentiel", "https://github.com/acme/atelier/issues/38#issuecomment-2", "2026-11-02T10:00:00Z", "2026-11-02T10:05:00Z"},
	})
	// Its parent (named by its own fetch, without a position) and its sub-issues of the same repository, in order.
	assertRows(t, path, "SELECT parent, child, position FROM sub_issues ORDER BY parent, child", [][]any{{30, 38, nil}, {38, 41, 0}, {38, 42, 1}})
	assertRows(t, path, "SELECT blocker_repository, blocker_number FROM blocked_by WHERE number = 38 ORDER BY blocker_repository", [][]any{{"acme/atelier", 35}, {"acme/outils", 7}})
	assertRows(t, path, "SELECT kind, number, title FROM search WHERE search MATCH 'confidentiel' ORDER BY kind", [][]any{
		{"comment", 38, "Le store du Miroir"}, {"comment", 38, "Le store du Miroir"}, {"issue", 38, "Le store du Miroir"},
	})

	calls := fake.Calls()
	if len(calls) != 1 || calls[0].Operation != "MirrorObject" || calls[0].Authorization != "bearer ghs_mirror_acme/atelier" {
		t.Errorf("calls %+v, want one MirrorObject with the repository's token", calls)
	}
}

func TestFetchObjectOfAPullStoresItsOwnParts(t *testing.T) {
	fake := githubtest.New(t, "testdata/graphql")
	store, path := openStore(t)
	for _, number := range []int{45, 44} {
		o, err := newClient(fake).FetchObject(context.Background(), "acme/atelier", number)
		if err != nil {
			t.Fatalf("FetchObject(%d): %v", number, err)
		}
		put(t, store, o)
	}

	a, c, d := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "cccccccccccccccccccccccccccccccccccccccc", "dddddddddddddddddddddddddddddddddddddddd"
	assertRows(t, path, "SELECT number, is_pull, state, author, milestone_number FROM issues ORDER BY number", [][]any{{44, 1, "MERGED", "agent-bot", 3}, {45, 1, "OPEN", "agent-bot", 3}})
	assertRows(t, path, "SELECT number, head_ref, head_oid, base_ref, is_draft, mergeable, merge_commit_oid, merged_at, checks_state FROM pulls ORDER BY number", [][]any{
		{44, "feat/38-store", d, "develop", 0, "UNKNOWN", c, "2026-11-02T09:00:00Z", "SUCCESS"},
		{45, "feat/38-store", a, "develop", 1, "CONFLICTING", nil, nil, "PENDING"},
	})
	assertRows(t, path, "SELECT name FROM issue_labels WHERE number = 45", [][]any{{"revue-visuelle"}})
	assertRows(t, path, "SELECT login FROM issue_assignees WHERE number = 45", [][]any{{"pilote"}})
	assertRows(t, path, "SELECT body FROM comments WHERE number = 45", [][]any{{"Commentaire confidentiel de la PR"}})
	assertRows(t, path, "SELECT issue_repository, issue_number FROM closing_issues WHERE number = 45", [][]any{{"acme/atelier", 38}})
	assertRows(t, path, "SELECT position, oid, message FROM pull_commits WHERE number = 45 ORDER BY position", [][]any{
		{0, "1111111111111111111111111111111111111111", "feat(runner) : le store, message confidentiel"},
		{1, a, "fix(runner) : la suite confidentielle"},
	})
	assertRows(t, path, "SELECT id, author, state, body, commit_oid, submitted_at FROM reviews WHERE number = 45", [][]any{
		{"PRR_45", "relecteur", "CHANGES_REQUESTED", "Revue confidentielle", "1111111111111111111111111111111111111111", "2026-11-04T09:00:00Z"},
	})
	assertRows(t, path, "SELECT id, review_id, author, body, path, line, created_at FROM review_comments WHERE number = 45", [][]any{
		{"PRRC_45", "PRR_45", "relecteur", "Remarque de ligne confidentielle", "apps/runner/internal/mirror/store.go", 12, "2026-11-04T09:00:00Z"},
	})
	if n := count(t, path, "SELECT count(*) FROM search WHERE number = 45 AND kind = 'comment'"); n != 3 {
		t.Errorf("%d comment rows in search for the PR, want its comment, its review and its review comment", n)
	}
}

func comments(number, from, to int) []map[string]any {
	var nodes []map[string]any
	for i := from; i < to; i++ {
		nodes = append(nodes, map[string]any{"id": fmt.Sprintf("IC_%d_%03d", number, i), "author": map[string]any{"login": "octo"}, "body": fmt.Sprintf("Commentaire %d", i), "url": "https://github.com/acme/atelier/issues/50", "createdAt": "2026-11-02T10:00:00Z", "updatedAt": "2026-11-02T10:00:00Z"})
	}
	return nodes
}

func page(nodes any, more bool, cursor string) map[string]any {
	return map[string]any{"pageInfo": map[string]any{"hasNextPage": more, "endCursor": cursor}, "nodes": nodes}
}

func emptyIssue(number int, comments map[string]any) map[string]any {
	empty := page([]any{}, false, "")
	return map[string]any{"repository": map[string]any{"issueOrPullRequest": map[string]any{
		"__typename": "Issue", "number": number, "title": "Beaucoup de commentaires", "body": "", "state": "OPEN", "url": "https://github.com/acme/atelier/issues/50",
		"updatedAt": "2026-11-10T09:00:00Z", "labels": empty, "assignees": empty, "comments": comments, "subIssues": empty, "blockedBy": empty,
	}}}
}

func TestFetchObjectCompletesACommentListOfMoreThanAHundredByItsPagedQuery(t *testing.T) {
	fake := githubtest.New(t, "testdata/graphql")
	fake.Reply("MirrorObject", map[string]any{"owner": "acme", "name": "atelier", "number": 50}, emptyIssue(50, page(comments(50, 0, 100), true, "c100")))
	fake.Reply("MirrorObjectComments", map[string]any{"number": 50, "after": "c100"}, map[string]any{"repository": map[string]any{"issueOrPullRequest": map[string]any{"page": page(comments(50, 100, 150), false, "c150")}}})
	store, path := openStore(t)

	o, err := newClient(fake).FetchObject(context.Background(), "acme/atelier", 50)
	if err != nil {
		t.Fatalf("FetchObject: %v", err)
	}
	put(t, store, o)
	if n := count(t, path, "SELECT count(*) FROM comments WHERE number = 50"); n != 150 {
		t.Errorf("%d comments, want 150", n)
	}
	if last := query(t, path, "SELECT max(id) FROM comments")[0][0]; last != "IC_50_149" {
		t.Errorf("last comment %v", last)
	}
	if n := fake.Count("MirrorObjectComments"); n != 1 {
		t.Errorf("%d paged queries, want 1", n)
	}
}

func TestFetchingADeletedOrTransferredIssueRemovesItsRelationsAndSearchRows(t *testing.T) {
	fake := githubtest.New(t, "testdata/graphql")
	store, path := openStore(t)
	put(t, store, Object{Repository: "acme/atelier", Number: 60, Title: "Bientôt transféré", Body: "Corps", State: "OPEN",
		Labels: []string{"bug"}, Assignees: []string{"octo"}, Comments: []Comment{{ID: "IC_60", Body: "Un commentaire"}},
		Parent: 30, SubIssues: []int{61}, BlockedBy: []Ref{{Repository: "acme/atelier", Number: 35}}})
	put(t, store, Object{Repository: "acme/atelier", Number: 62, Title: "Bloqué par le 60", State: "OPEN", BlockedBy: []Ref{{Repository: "acme/atelier", Number: 60}}})
	put(t, store, Object{Repository: "acme/atelier", Number: 63, Title: "Une PR le fermant", State: "OPEN", IsPull: true, Pull: &Pull{HeadOid: "x", ClosingIssues: []Ref{{Repository: "acme/atelier", Number: 60}}}})

	m := &Mirror{Store: store, GitHub: newClient(fake), Logger: testLogger}
	gone, err := m.Refresh(context.Background(), "acme/atelier", 60)
	if err != nil || !gone {
		t.Fatalf("Refresh = %v, %v, want gone", gone, err)
	}
	for _, statement := range []string{
		"SELECT count(*) FROM issues WHERE number = 60",
		"SELECT count(*) FROM issue_labels WHERE number = 60",
		"SELECT count(*) FROM issue_assignees WHERE number = 60",
		"SELECT count(*) FROM comments WHERE number = 60",
		"SELECT count(*) FROM sub_issues WHERE parent = 60 OR child = 60",
		"SELECT count(*) FROM blocked_by WHERE number = 60 OR blocker_number = 60",
		"SELECT count(*) FROM closing_issues WHERE issue_number = 60",
		"SELECT count(*) FROM search WHERE number = 60",
	} {
		if n := count(t, path, statement); n != 0 {
			t.Errorf("%s = %d, want 0", statement, n)
		}
	}
	if n := count(t, path, "SELECT count(*) FROM issues"); n != 2 {
		t.Errorf("%d issues left, want 62 and 63", n)
	}
}

func TestFetchChecksStoresTheCheckRunsAndCommitStatusesOfASHA(t *testing.T) {
	fake := githubtest.New(t, "testdata/graphql")
	store, path := openStore(t)
	sha := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	checks, err := newClient(fake).FetchChecks(context.Background(), "acme/atelier", sha)
	if err != nil {
		t.Fatalf("FetchChecks: %v", err)
	}
	if err := store.Update(func(tx *sql.Tx) error { return PutChecks(tx, "acme/atelier", sha, checks) }); err != nil {
		t.Fatal(err)
	}
	assertRows(t, path, "SELECT sha, typename, name, status, conclusion, details_url, started_at, completed_at FROM checks ORDER BY typename", [][]any{
		{sha, "CheckRun", "ci", "COMPLETED", "FAILURE", "https://github.com/acme/atelier/actions/runs/1", "2026-11-09T09:01:00Z", "2026-11-09T09:05:00Z"},
		{sha, "StatusContext", "vercel", nil, "PENDING", "https://vercel.example/acme", "2026-11-09T09:02:00Z", nil},
	})

	none, err := newClient(fake).FetchChecks(context.Background(), "acme/atelier", "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")
	if err != nil || len(none) != 0 {
		t.Errorf("a commit without checks: %v, %v", none, err)
	}
}

func TestFetchCollectionsReadsLabelsMilestonesAndReleases(t *testing.T) {
	fake := githubtest.New(t, "testdata/graphql")
	got, err := newClient(fake).FetchCollections(context.Background(), "acme/atelier")
	if err != nil {
		t.Fatalf("FetchCollections: %v", err)
	}
	want := Collections{
		Labels:     []Label{{Name: "ready-for-agent", Color: "0e8a16", Description: "Prêt pour un agent"}, {Name: "priority:P1", Color: "d93f0b"}},
		Milestones: []Milestone{{Number: 3, Title: "M3 Sessions", State: "OPEN", Description: "Jalon confidentiel", DueOn: "2026-12-01T00:00:00Z"}},
		Releases:   []Release{{Tag: "v0.3.0", Name: "0.3.0", Body: "Notes de version confidentielles", IsPrerelease: true, CreatedAt: "2026-11-01T00:00:00Z", PublishedAt: "2026-11-01T01:00:00Z"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("collections\n got %+v\nwant %+v", got, want)
	}
}

func TestGitHubsRefusalsLimitsAndOutagesAreTyped(t *testing.T) {
	reset := time.Date(2026, 11, 12, 11, 0, 0, 0, time.UTC)
	cases := []struct {
		name    string
		failure githubtest.Failure
		check   func(error) bool
	}{
		{"primary rate limit", githubtest.RateLimited(reset), func(err error) bool {
			var limited *LimitedError
			return errors.As(err, &limited) && limited.RetryAt.Equal(reset)
		}},
		{"secondary rate limit", githubtest.SecondaryLimited(90 * time.Second), func(err error) bool {
			var limited *LimitedError
			return errors.As(err, &limited) && limited.RetryAt.Equal(now.Add(90*time.Second))
		}},
		{"401", githubtest.Unauthorized(), func(err error) bool { return errors.Is(err, ErrRefused) }},
		{"403", githubtest.Forbidden(), func(err error) bool { return errors.Is(err, ErrRefused) }},
		{"502", githubtest.BadGateway(), func(err error) bool { return errors.Is(err, ErrUnavailable) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fake := githubtest.New(t, "testdata/graphql")
			fake.Fail("", tc.failure, 1)
			_, err := newClient(fake).FetchObject(context.Background(), "acme/atelier", 38)
			if !tc.check(err) {
				t.Errorf("FetchObject = %v", err)
			}
		})
	}

	t.Run("a GraphQL rate limit", func(t *testing.T) {
		fake := githubtest.New(t, "testdata/graphql")
		fake.ReplyErrors("MirrorObject", map[string]any{"owner": "acme", "name": "atelier", "number": 38}, []map[string]any{{"type": "RATE_LIMITED", "message": "API rate limit exceeded"}})
		var limited *LimitedError
		if _, err := newClient(fake).FetchObject(context.Background(), "acme/atelier", 38); !errors.As(err, &limited) || !limited.RetryAt.Equal(now.Add(time.Minute)) {
			t.Errorf("FetchObject = %v", err)
		}
	})

	t.Run("GitHub unreachable", func(t *testing.T) {
		srv := httptest.NewServer(nil)
		srv.Close()
		client := &Client{BaseURL: srv.URL, Tokens: func(string) github.TokenSource { return staticToken("t") }}
		if _, err := client.FetchObject(context.Background(), "acme/atelier", 38); !errors.Is(err, ErrUnavailable) {
			t.Errorf("FetchObject = %v", err)
		}
	})

	t.Run("a repository the token cannot see", func(t *testing.T) {
		fake := githubtest.New(t, "testdata/graphql")
		fake.Reply("MirrorObject", map[string]any{"owner": "acme", "name": "secret"}, map[string]any{"repository": nil})
		if _, err := newClient(fake).FetchObject(context.Background(), "acme/secret", 1); !errors.Is(err, ErrRefused) {
			t.Errorf("FetchObject = %v", err)
		}
	})
}

func TestFetchRefusesARepositoryThatIsNotOwnerSlashName(t *testing.T) {
	fake := githubtest.New(t, "testdata/graphql")
	for _, repo := range []string{"atelier", "acme/atelier/pulls", "../acme/atelier", "acme/"} {
		if _, err := newClient(fake).FetchObject(context.Background(), repo, 1); err == nil {
			t.Errorf("repo %q accepted", repo)
		}
	}
	if len(fake.Calls()) != 0 {
		t.Error("a bad repository reached GitHub")
	}
}
