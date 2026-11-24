package github

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// The pull requests as a migration of the code reads and writes them
// (SOURCE-9), through the same REST calls as the issues: a pull request a
// copy writes ends its body with the origin marker of the local change
// (`<!-- crewdeck:from local#3 -->`), each comment with its own.

type restPull struct {
	Number    int     `json:"number"`
	Title     string  `json:"title"`
	Body      *string `json:"body"`
	State     string  `json:"state"`
	Draft     bool    `json:"draft"`
	MergedAt  *string `json:"merged_at"`
	CreatedAt string  `json:"created_at"`
	Head      struct {
		Ref string `json:"ref"`
		Sha string `json:"sha"`
	} `json:"head"`
	Base struct {
		Ref string `json:"ref"`
	} `json:"base"`
	User struct {
		Login string `json:"login"`
	} `json:"user"`
}

type restReview struct {
	ID          int64  `json:"id"`
	State       string `json:"state"`
	Body        string `json:"body"`
	CommitID    string `json:"commit_id"`
	SubmittedAt string `json:"submitted_at"`
	User        struct {
		Login string `json:"login"`
	} `json:"user"`
}

type restRemark struct {
	ID       int64  `json:"id"`
	ReviewID int64  `json:"pull_request_review_id"`
	Path     string `json:"path"`
	Line     *int   `json:"line"`
	Body     string `json:"body"`
	Created  string `json:"created_at"`
}

// Pull is a pull request read whole: its body without the marker, and
// From, the marker's origin ("" for none).
type Pull struct {
	source.Change
	From string
}

func pullOf(p restPull) Pull {
	body, from := unmarked(deref(p.Body))
	c := source.Change{Number: p.Number, Title: p.Title, Body: body, HeadRef: p.Head.Ref, HeadOid: p.Head.Sha, BaseRef: p.Base.Ref,
		State: source.ChangeState(p.State), IsDraft: p.Draft, Author: p.User.Login, CreatedAt: parseTime(p.CreatedAt), Labels: []string{}}
	if p.MergedAt != nil {
		c.State = source.ChangeMerged
	}
	return Pull{Change: c, From: from}
}

func parseTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339, s)
	return t
}

// Pulls are every pull request of the repository, open or not, by number.
func (t *Tickets) Pulls(ctx context.Context) ([]Pull, error) {
	listed, err := listAll[restPull](ctx, t, "/pulls?state=all")
	if err != nil {
		return nil, err
	}
	pulls := make([]Pull, 0, len(listed))
	for _, p := range listed {
		pulls = append(pulls, pullOf(p))
	}
	slices.SortFunc(pulls, func(a, b Pull) int { return a.Number - b.Number })
	return pulls, nil
}

// CreatePull opens the pull request of c (its head, base, title, body and
// draft) as the copy of from, found by its marker should GitHub hold it
// already; its number.
func (t *Tickets) CreatePull(ctx context.Context, c source.Change, from string) (int, error) {
	var created restPull
	err := t.create(ctx, "/pulls", map[string]any{"title": c.Title, "head": c.HeadRef, "base": c.BaseRef, "body": Marked(c.Body, from), "draft": c.IsDraft}, &created,
		func(ctx context.Context) (bool, error) {
			pulls, err := t.Pulls(ctx)
			if err != nil {
				return false, err
			}
			for _, p := range pulls {
				if p.From == from {
					created.Number = p.Number
					return true, nil
				}
			}
			return false, nil
		})
	return created.Number, err
}

// EditPull sets the pull request's title, body (from's marker kept) and base.
func (t *Tickets) EditPull(ctx context.Context, number int, c source.Change, from string) error {
	return t.call(ctx, http.MethodPatch, fmt.Sprintf("/pulls/%d", number), map[string]any{"title": c.Title, "body": Marked(c.Body, from), "base": c.BaseRef}, nil)
}

// PullComments are the pull request's comments, oldest first, each without
// its marker and with its origin.
func (t *Tickets) PullComments(ctx context.Context, number int) ([]source.CopiedComment, error) {
	listed, err := listAll[restComment](ctx, t, fmt.Sprintf("/issues/%d/comments", number))
	if err != nil {
		return nil, err
	}
	comments := make([]source.CopiedComment, 0, len(listed))
	for _, c := range listed {
		body, from := unmarked(c.Body)
		comments = append(comments, source.CopiedComment{Comment: source.Comment{ID: strconv.FormatInt(c.ID, 10), Author: c.User.Login, Body: body, CreatedAt: parseTime(c.CreatedAt)}, From: from})
	}
	return comments, nil
}

// PullReviews are the pull request's submitted reviews, oldest first, each
// with its remarks; a pending or dismissed one is left out.
func (t *Tickets) PullReviews(ctx context.Context, number int) ([]source.Review, error) {
	listed, err := listAll[restReview](ctx, t, fmt.Sprintf("/pulls/%d/reviews", number))
	if err != nil {
		return nil, err
	}
	remarks, err := listAll[restRemark](ctx, t, fmt.Sprintf("/pulls/%d/comments", number))
	if err != nil {
		return nil, err
	}
	reviews := []source.Review{}
	for _, r := range listed {
		state := source.ReviewState(r.State)
		if state != source.ReviewApproved && state != source.ReviewChangesRequested && state != source.ReviewCommented {
			continue
		}
		review := source.Review{ID: strconv.FormatInt(r.ID, 10), Author: r.User.Login, State: state, Body: r.Body, CommitOid: r.CommitID,
			SubmittedAt: parseTime(r.SubmittedAt), Comments: []source.ReviewComment{}}
		for _, m := range remarks {
			if m.ReviewID != r.ID {
				continue
			}
			line := 0
			if m.Line != nil {
				line = *m.Line
			}
			review.Comments = append(review.Comments, source.ReviewComment{ID: strconv.FormatInt(m.ID, 10), Path: m.Path, Line: line, Body: m.Body, CreatedAt: parseTime(m.Created)})
		}
		reviews = append(reviews, review)
	}
	return reviews, nil
}
