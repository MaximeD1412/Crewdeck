package github_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/github/githubtest"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	ghsource "github.com/maximed1412/crewdeck/apps/runner/internal/source/github"
)

type fakeCopy struct {
	milestones map[string]int
	parents    map[int]int
	heads      map[int]string
}

func (c fakeCopy) MilestoneNumber(title string) (int, bool) {
	n, ok := c.milestones[title]
	return n, ok
}
func (c fakeCopy) Parent(number int) int     { return c.parents[number] }
func (c fakeCopy) HeadOid(number int) string { return c.heads[number] }

func writer(fake *githubtest.Server) *ghsource.Writer {
	return &ghsource.Writer{BaseURL: fake.URL, Token: "ghs_session", Owner: "acme", Name: "atelier", Copy: fakeCopy{
		milestones: map[string]int{"M1 Fondations": 1},
		parents:    map[int]int{20: 1},
		heads:      map[int]string{7: "aaaa7"},
	}}
}

// requests are the fake's calls as "METHOD /path body", each with the token.
func requests(t *testing.T, fake *githubtest.Server) []string {
	t.Helper()
	var out []string
	for _, c := range fake.Calls() {
		if c.Authorization != "Bearer ghs_session" {
			t.Errorf("%s %s with %q, want the Session's token", c.Method, c.Path, c.Authorization)
		}
		line := c.Method + " " + c.Path
		if c.Body != "" {
			var body any
			if err := json.Unmarshal([]byte(c.Body), &body); err != nil {
				t.Fatalf("%s: %v", line, err)
			}
			normal, _ := json.Marshal(body)
			line += " " + string(normal)
		}
		out = append(out, line)
	}
	return out
}

func TestGithubIssueCreateCallsTheCreateDependencyAndSubIssueEndpoints(t *testing.T) {
	fake := githubtest.New(t)
	fake.REST(http.MethodPost, "/repos/acme/atelier/issues", http.StatusCreated, `{"id": 9016, "number": 16, "html_url": "https://github.com/acme/atelier/issues/16"}`)
	fake.REST(http.MethodGet, "/repos/acme/atelier/issues/3", http.StatusOK, `{"id": 9003, "number": 3}`)
	fake.REST(http.MethodPost, "/repos/acme/atelier/issues/16/dependencies/blocked_by", http.StatusCreated, `{}`)
	fake.REST(http.MethodPost, "/repos/acme/atelier/issues/1/sub_issues", http.StatusCreated, `{}`)
	title, body, milestone, parent := "T", "B", "M1 Fondations", 1

	n, err := source.Apply(context.Background(), writer(fake), source.IssueCreate, 0, source.WriteFields{
		Title: &title, Body: &body, Labels: []string{"size:S", "ready-for-agent"}, Milestone: &milestone, BlockedBy: []int{3}, Parent: &parent,
	}, "code", "s-1")
	if err != nil || n != (source.WriteReply{Number: 16, URL: "https://github.com/acme/atelier/issues/16"}) {
		t.Fatalf("created %v, %v", n, err)
	}
	want := []string{
		`POST /repos/acme/atelier/issues {"body":"B","labels":["size:S","ready-for-agent"],"milestone":1,"title":"T"}`,
		`GET /repos/acme/atelier/issues/3`,
		`POST /repos/acme/atelier/issues/16/dependencies/blocked_by {"issue_id":9003}`,
		`POST /repos/acme/atelier/issues/1/sub_issues {"sub_issue_id":9016}`,
	}
	if got := requests(t, fake); !reflect.DeepEqual(got, want) {
		t.Errorf("requests\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestGithubIssueEditLabelsReadyBlockersAndParentOneByOne(t *testing.T) {
	fake := githubtest.New(t)
	fake.REST(http.MethodPost, "/repos/acme/atelier/issues/20/labels", http.StatusOK, `[]`)
	fake.REST(http.MethodDelete, "/repos/acme/atelier/issues/20/labels/ready-for-agent", http.StatusOK, `[]`)
	fake.REST(http.MethodGet, "/repos/acme/atelier/issues/3", http.StatusOK, `{"id": 9003, "number": 3}`)
	fake.REST(http.MethodDelete, "/repos/acme/atelier/issues/20/dependencies/blocked_by/9003", http.StatusOK, `{}`)
	fake.REST(http.MethodGet, "/repos/acme/atelier/issues/20", http.StatusOK, `{"id": 9020, "number": 20}`)
	fake.REST(http.MethodDelete, "/repos/acme/atelier/issues/1/sub_issue", http.StatusOK, `{}`)
	fake.REST(http.MethodPatch, "/repos/acme/atelier/issues/20", http.StatusOK, `{}`)
	none, noParent := "", 0

	_, err := source.Apply(context.Background(), writer(fake), source.IssueEdit, 20, source.WriteFields{
		AddLabels: []string{"size:M"}, RemoveLabels: []string{"ready-for-agent"}, RemoveBlockedBy: []int{3}, Parent: &noParent, Milestone: &none,
	}, "code", "s-1")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		`PATCH /repos/acme/atelier/issues/20 {"milestone":null}`,
		`POST /repos/acme/atelier/issues/20/labels {"labels":["size:M"]}`,
		`DELETE /repos/acme/atelier/issues/20/labels/ready-for-agent`,
		`GET /repos/acme/atelier/issues/3`,
		`DELETE /repos/acme/atelier/issues/20/dependencies/blocked_by/9003`,
		`GET /repos/acme/atelier/issues/20`,
		`DELETE /repos/acme/atelier/issues/1/sub_issue {"sub_issue_id":9020}`,
	}
	if got := requests(t, fake); !reflect.DeepEqual(got, want) {
		t.Errorf("requests\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestGithubCloseNotPlannedCommentsFirstAndReopenReverses(t *testing.T) {
	fake := githubtest.New(t)
	fake.REST(http.MethodPost, "/repos/acme/atelier/issues/4/comments", http.StatusCreated, `{"id": 1}`)
	fake.REST(http.MethodPatch, "/repos/acme/atelier/issues/4", http.StatusOK, `{}`)
	w := writer(fake)
	ctx := context.Background()
	if _, err := source.Apply(ctx, w, source.IssueClose, 4, source.WriteFields{Reason: source.ReasonNotPlanned, Comment: "x"}, "code", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := source.Apply(ctx, w, source.IssueReopen, 4, source.WriteFields{}, "code", ""); err != nil {
		t.Fatal(err)
	}
	want := []string{
		`POST /repos/acme/atelier/issues/4/comments {"body":"x"}`,
		`PATCH /repos/acme/atelier/issues/4 {"state":"closed","state_reason":"not_planned"}`,
		`PATCH /repos/acme/atelier/issues/4 {"state":"open"}`,
	}
	if got := requests(t, fake); !reflect.DeepEqual(got, want) {
		t.Errorf("requests\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestGithubPullCreateReviewAtTheCopysHeadAndCloseDeletingItsBranch(t *testing.T) {
	fake := githubtest.New(t)
	fake.REST(http.MethodPost, "/repos/acme/atelier/pulls", http.StatusCreated, `{"id": 7007, "number": 7, "html_url": "https://github.com/acme/atelier/pull/7"}`)
	fake.REST(http.MethodPatch, "/repos/acme/atelier/issues/7", http.StatusOK, `{}`)
	fake.REST(http.MethodPost, "/repos/acme/atelier/pulls/7/reviews", http.StatusOK, `{"id": 1}`)
	fake.REST(http.MethodPatch, "/repos/acme/atelier/pulls/7", http.StatusOK, `{"number": 7, "head": {"ref": "feat/12-x"}}`)
	fake.REST(http.MethodDelete, "/repos/acme/atelier/git/refs/heads/feat/12-x", http.StatusNoContent, ``)
	w := writer(fake)
	ctx := context.Background()
	title, base, body := "Le x", "develop", "x"
	n, err := source.Apply(ctx, w, source.PrCreate, 0, source.WriteFields{Title: &title, Body: &body, Head: "feat/12-x", Base: &base, Draft: true, Labels: []string{"conception"}}, "code", "")
	if err != nil || n != (source.WriteReply{Number: 7, URL: "https://github.com/acme/atelier/pull/7"}) {
		t.Fatalf("created %v, %v", n, err)
	}
	if _, err := source.Apply(ctx, w, source.PrReview, 7, source.WriteFields{Review: source.ReviewChangesRequested, Body: &body}, "review", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := source.Apply(ctx, w, source.PrClose, 7, source.WriteFields{DeleteBranch: true}, "code", ""); err != nil {
		t.Fatal(err)
	}
	want := []string{
		`POST /repos/acme/atelier/pulls {"base":"develop","body":"x","draft":true,"head":"feat/12-x","title":"Le x"}`,
		`PATCH /repos/acme/atelier/issues/7 {"labels":["conception"]}`,
		`POST /repos/acme/atelier/pulls/7/reviews {"body":"x","commit_id":"aaaa7","event":"REQUEST_CHANGES"}`,
		`PATCH /repos/acme/atelier/pulls/7 {"state":"closed"}`,
		`DELETE /repos/acme/atelier/git/refs/heads/feat/12-x`,
	}
	if got := requests(t, fake); !reflect.DeepEqual(got, want) {
		t.Errorf("requests\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

func TestGithubRefusalIsItsStatusMessageAndErrors(t *testing.T) {
	fake := githubtest.New(t)
	fake.REST(http.MethodPost, "/repos/acme/atelier/pulls", http.StatusUnprocessableEntity,
		`{"message": "Validation Failed", "errors": [{"resource": "PullRequest", "code": "custom", "message": "A pull request already exists for acme:feat/12-x."}]}`)
	title, base := "x", "develop"
	_, err := source.Apply(context.Background(), writer(fake), source.PrCreate, 0, source.WriteFields{Title: &title, Head: "feat/12-x", Base: &base}, "code", "")
	var refused *ghsource.HTTPError
	if !errors.As(err, &refused) || refused.Status != 422 {
		t.Fatalf("refusal %v", err)
	}
	want := "HTTP 422: Validation Failed (" + fake.URL + "/repos/acme/atelier/pulls)\nA pull request already exists for acme:feat/12-x."
	if err.Error() != want {
		t.Errorf("printed\n%s\nwant\n%s", err, want)
	}
	if _, err := source.Apply(context.Background(), writer(fake), source.IssueCreate, 0, source.WriteFields{Title: &title, Milestone: &base}, "code", ""); !errors.Is(err, source.ErrUnknownMilestone) {
		t.Errorf("an unknown milestone: %v", err)
	}
}
