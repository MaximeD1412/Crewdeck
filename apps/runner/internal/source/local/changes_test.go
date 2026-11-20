package local_test

import (
	"context"
	"errors"
	"path/filepath"
	"slices"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// changesFolder is a Local Projet with Tickets 1 to 3 and a branch the
// Session committed in its clone, not pushed to the folder yet.
func changesFolder(t *testing.T) (dir, clone string, p opened) {
	t.Helper()
	dir = folder(t, map[string]string{
		"tickets/1-a.md": "---\nnumber: 1\ntitle: A\n---\n",
		"tickets/3-c.md": "---\nnumber: 3\ntitle: C\n---\n",
	})
	clone = filepath.Join(t.TempDir(), "clone")
	git(t, filepath.Dir(clone), "clone", "--quiet", dir, clone)
	git(t, clone, "checkout", "--quiet", "-b", "feat/4-x")
	write(t, clone, "x.txt", "x\n")
	git(t, clone, "add", "x.txt")
	git(t, clone, "commit", "--quiet", "-m", "feat : x")
	p = open(t, dir)
	p.SetClone(clone)
	if _, err := p.Scan(context.Background()); err != nil {
		t.Fatal(err)
	}
	*p.changes = nil
	return dir, clone, p
}

func TestLocalCreateChangeRefusesABranchAbsentFromTheFolderThenRecordsItOncePushed(t *testing.T) {
	ctx := context.Background()
	dir, clone, p := changesFolder(t)
	change := source.NewChange{Title: "Le x", Body: "Closes #3", Head: "feat/4-x", Base: "main", Labels: []string{"conception"}, Author: "code", SessionID: "s-1"}

	_, err := p.CreateChange(ctx, change)
	var missing *source.BranchMissingError
	if !errors.As(err, &missing) || missing.Branch != "feat/4-x" {
		t.Fatalf("a branch not pushed: %v", err)
	}

	git(t, clone, "push", "--quiet", "origin", "feat/4-x")
	head := git(t, dir, "rev-parse", "feat/4-x")
	created, err := p.CreateChange(ctx, change)
	if err != nil {
		t.Fatal(err)
	}
	if created.Number != 4 || created.HeadOid != head || created.HeadRef != "feat/4-x" || created.BaseRef != "main" ||
		created.State != source.ChangeOpen || created.Author != "code" || !slices.Equal(created.Labels, []string{"conception"}) {
		t.Errorf("created %+v", created)
	}
	if !slices.Contains(*p.changes, source.Changed{ProjectID: projectID, Kind: source.KindChange, Number: 4}) {
		t.Errorf("OnChange %+v", *p.changes)
	}
	if n, err := p.NextNumber(ctx); err != nil || n != 5 {
		t.Errorf("the counter after the change: %d %v", n, err)
	}

	_, err = p.CreateChange(ctx, change)
	var open *source.ChangeOpenError
	if !errors.As(err, &open) || open.Number != 4 || open.Branch != "feat/4-x" {
		t.Errorf("a second open change: %v", err)
	}
}

func TestLocalCreateChangeRefusesAssigneesAndMilestones(t *testing.T) {
	ctx := context.Background()
	_, clone, p := changesFolder(t)
	git(t, clone, "push", "--quiet", "origin", "feat/4-x")
	if _, err := p.CreateChange(ctx, source.NewChange{Title: "x", Head: "feat/4-x", Base: "main", Assignees: []string{"octo"}}); !errors.Is(err, source.ErrNoAssignees) {
		t.Errorf("assignees: %v", err)
	}
	if _, err := p.CreateChange(ctx, source.NewChange{Title: "x", Head: "feat/4-x", Base: "main", Milestone: "M1"}); !errors.Is(err, source.ErrNoChangeMilestone) {
		t.Errorf("milestone: %v", err)
	}
}

func TestLocalReviewRecordsItsVerdictAtTheHeadOfThatMoment(t *testing.T) {
	ctx := context.Background()
	_, clone, p := changesFolder(t)
	git(t, clone, "push", "--quiet", "origin", "feat/4-x")
	created, err := p.CreateChange(ctx, source.NewChange{Title: "x", Head: "feat/4-x", Base: "main", Author: "code"})
	if err != nil {
		t.Fatal(err)
	}
	write(t, clone, "y.txt", "y\n")
	git(t, clone, "add", "y.txt")
	git(t, clone, "commit", "--quiet", "-m", "feat : y")
	head := git(t, clone, "rev-parse", "HEAD")

	review, err := p.Review(ctx, created.Number, source.NewReview{State: source.ReviewChangesRequested, Body: "x", Author: "review", SessionID: "s-2"})
	if err != nil {
		t.Fatal(err)
	}
	reviews, err := p.Reviews(ctx, created.Number)
	if err != nil || len(reviews) != 1 {
		t.Fatalf("reviews %+v %v", reviews, err)
	}
	if r := reviews[0]; r.ID != review.ID || r.State != source.ReviewChangesRequested || r.Body != "x" || r.Author != "review" || r.CommitOid != head {
		t.Errorf("review %+v, head %s", r, head)
	}
	if _, err := p.Review(ctx, 99, source.NewReview{State: source.ReviewApproved}); !errors.Is(err, source.ErrNotFound) {
		t.Errorf("a review of no change: %v", err)
	}
}

func TestLocalChangeEditCommentCloseAndReopen(t *testing.T) {
	ctx := context.Background()
	dir, clone, p := changesFolder(t)
	git(t, clone, "push", "--quiet", "origin", "feat/4-x")
	created, err := p.CreateChange(ctx, source.NewChange{Title: "x", Head: "feat/4-x", Base: "main", Labels: []string{"a"}, Author: "code"})
	if err != nil {
		t.Fatal(err)
	}
	title, base := "Le x, mieux", "develop"
	edited, err := p.EditChange(ctx, created.Number, source.ChangeEdit{Title: &title, Base: &base, AddLabels: []string{"b"}, RemoveLabels: []string{"a"}})
	if err != nil {
		t.Fatal(err)
	}
	if edited.Title != title || edited.BaseRef != base || !slices.Equal(edited.Labels, []string{"b"}) {
		t.Errorf("edited %+v", edited)
	}
	if _, err := p.EditChange(ctx, created.Number, source.ChangeEdit{AddAssignees: []string{"octo"}}); !errors.Is(err, source.ErrNoAssignees) {
		t.Errorf("an assignee: %v", err)
	}

	if _, err := p.CommentChange(ctx, created.Number, "code", "Une remarque.", "s-1"); err != nil {
		t.Fatal(err)
	}
	comments, err := p.Comments(ctx, created.Number)
	if err != nil || len(comments) != 1 || comments[0].Author != "code" || comments[0].Body != "Une remarque." {
		t.Errorf("comments %+v %v", comments, err)
	}
	if _, err := p.CommentChange(ctx, 1, "code", "x", ""); !errors.Is(err, source.ErrNotFound) {
		t.Errorf("a change's comment on a Ticket: %v", err)
	}

	closed, err := p.SetChangeState(ctx, created.Number, source.ChangeClosed, true)
	if err != nil {
		t.Fatal(err)
	}
	if closed.State != source.ChangeClosed || closed.ClosedAt == nil {
		t.Errorf("closed %+v", closed)
	}
	if refs := git(t, dir, "branch", "--list", "feat/4-x"); refs != "" {
		t.Errorf("the branch is still in the folder: %q", refs)
	}
	reopened, err := p.SetChangeState(ctx, created.Number, source.ChangeOpen, false)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.State != source.ChangeOpen || reopened.ClosedAt != nil {
		t.Errorf("reopened %+v", reopened)
	}
}

func TestLocalTicketRefusesAssigneesAndChangesItsBlockersOneByOne(t *testing.T) {
	ctx := context.Background()
	dir := folder(t, map[string]string{"tickets/1-a.md": "---\nnumber: 1\ntitle: A\nblocked_by: [2, 3]\n---\n"})
	p := open(t, dir)
	if _, err := p.CreateTicket(ctx, source.NewTicket{Title: "B", Assignees: []string{"octo"}}); !errors.Is(err, source.ErrNoAssignees) {
		t.Errorf("create with an assignee: %v", err)
	}
	if _, err := p.EditTicket(ctx, 1, source.TicketEdit{AddAssignees: []string{"octo"}}); !errors.Is(err, source.ErrNoAssignees) {
		t.Errorf("edit with an assignee: %v", err)
	}
	edited, err := p.EditTicket(ctx, 1, source.TicketEdit{AddBlockedBy: []int{4, 3}, RemoveBlockedBy: []int{2}})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(edited.BlockedBy, []int{3, 4}) {
		t.Errorf("blocked by %v", edited.BlockedBy)
	}
}
