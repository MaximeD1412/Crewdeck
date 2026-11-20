// Package github writes a GitHub Projet's issues and pull requests with the
// Session's token (MIROIR-7, ADR 0012): the agent's own writes, as
// `crewdeck[bot]` (ADR 0002). What it needs and GitHub's REST does not take
// by title (a milestone's number, an issue's current parent, a PR's head) it
// reads in the Miroir's copy.
package github

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// Copy is what the writer reads in the Miroir's copy of the repository.
type Copy interface {
	// MilestoneNumber is the number of the milestone titled title.
	MilestoneNumber(title string) (int, bool)
	// Parent is the issue's parent's number, 0 for none.
	Parent(number int) int
	// HeadOid is the PR's head commit, "" when the copy has none.
	HeadOid(number int) string
}

// Writer is a GitHub repository's source.Target.
type Writer struct {
	// BaseURL is https://api.github.com unless a test points it at a fake.
	BaseURL string
	// HTTP has a 30 s timeout when nil.
	HTTP  *http.Client
	Token string
	Owner string
	Name  string
	Copy  Copy
}

var _ source.Target = (*Writer)(nil)

// HTTPError is GitHub's refusal, printed as gh prints it.
type HTTPError struct {
	Status  int
	Message string
	Errors  []string
	URL     string
}

func (e *HTTPError) Error() string {
	var b strings.Builder
	fmt.Fprintf(&b, "HTTP %d: %s (%s)", e.Status, e.Message, e.URL)
	for _, line := range e.Errors {
		b.WriteString("\n" + line)
	}
	return b.String()
}

// issue is the part of GitHub's issue, and pull request, answers read.
type issue struct {
	ID      int64  `json:"id"`
	Number  int    `json:"number"`
	HTMLURL string `json:"html_url"`
	Head    struct {
		Ref string `json:"ref"`
	} `json:"head"`
}

// CreateTicket creates the issue, then its blockers and its parent.
func (w *Writer) CreateTicket(ctx context.Context, t source.NewTicket) (source.Ticket, error) {
	body := map[string]any{"title": t.Title, "body": t.Body}
	labels := append([]string{}, t.Labels...)
	if t.Ready {
		labels = append(labels, source.ReadyLabel)
	}
	if len(labels) > 0 {
		body["labels"] = labels
	}
	if len(t.Assignees) > 0 {
		body["assignees"] = t.Assignees
	}
	if t.Milestone != "" {
		number, ok := w.Copy.MilestoneNumber(t.Milestone)
		if !ok {
			return source.Ticket{}, source.ErrUnknownMilestone
		}
		body["milestone"] = number
	}
	var created issue
	if err := w.do(ctx, http.MethodPost, "/issues", body, &created); err != nil {
		return source.Ticket{}, err
	}
	ticket := source.Ticket{Number: created.Number, URL: created.HTMLURL}
	for _, blocker := range t.BlockedBy {
		if err := w.block(ctx, created.Number, blocker); err != nil {
			return ticket, err
		}
	}
	if t.Parent != nil && *t.Parent > 0 {
		if err := w.do(ctx, http.MethodPost, fmt.Sprintf("/issues/%d/sub_issues", *t.Parent), map[string]any{"sub_issue_id": created.ID}, nil); err != nil {
			return ticket, err
		}
	}
	return ticket, nil
}

// EditTicket changes what the edit gives.
func (w *Writer) EditTicket(ctx context.Context, number int, e source.TicketEdit) (source.Ticket, error) {
	ticket := source.Ticket{Number: number}
	patch := map[string]any{}
	if e.Title != nil {
		patch["title"] = *e.Title
	}
	if e.Body != nil {
		patch["body"] = *e.Body
	}
	if err := w.milestone(patch, e.Milestone); err != nil {
		return ticket, err
	}
	if len(patch) > 0 {
		if err := w.do(ctx, http.MethodPatch, fmt.Sprintf("/issues/%d", number), patch, nil); err != nil {
			return ticket, err
		}
	}
	add, remove := e.AddLabels, e.RemoveLabels
	if e.Ready != nil && *e.Ready {
		add = append(append([]string{}, add...), source.ReadyLabel)
	}
	if e.Ready != nil && !*e.Ready {
		remove = append(append([]string{}, remove...), source.ReadyLabel)
	}
	if err := w.labels(ctx, number, add, remove); err != nil {
		return ticket, err
	}
	if err := w.assignees(ctx, number, e.AddAssignees, e.RemoveAssignees); err != nil {
		return ticket, err
	}
	for _, blocker := range e.AddBlockedBy {
		if err := w.block(ctx, number, blocker); err != nil {
			return ticket, err
		}
	}
	for _, blocker := range e.RemoveBlockedBy {
		id, err := w.issueID(ctx, blocker)
		if err != nil {
			return ticket, err
		}
		if err := w.do(ctx, http.MethodDelete, fmt.Sprintf("/issues/%d/dependencies/blocked_by/%d", number, id), nil, nil); err != nil {
			return ticket, err
		}
	}
	if e.Parent != nil {
		if err := w.parent(ctx, number, *e.Parent); err != nil {
			return ticket, err
		}
	}
	return ticket, nil
}

// SetTicketState closes the issue with its reason, or reopens it.
func (w *Writer) SetTicketState(ctx context.Context, number int, state source.TicketState, reason source.StateReason) (source.Ticket, error) {
	patch := map[string]any{"state": string(state)}
	if state == source.TicketClosed {
		if reason == source.ReasonNone {
			reason = source.ReasonCompleted
		}
		patch["state_reason"] = string(reason)
	}
	return source.Ticket{Number: number, State: state, StateReason: reason}, w.do(ctx, http.MethodPatch, fmt.Sprintf("/issues/%d", number), patch, nil)
}

// Comment comments the issue, or the pull request.
func (w *Writer) Comment(ctx context.Context, number int, _, body, _ string) (source.Comment, error) {
	var created struct {
		ID int64 `json:"id"`
	}
	err := w.do(ctx, http.MethodPost, fmt.Sprintf("/issues/%d/comments", number), map[string]any{"body": body}, &created)
	return source.Comment{ID: fmt.Sprint(created.ID), Body: body}, err
}

// CreateChange opens the pull request, then its labels, assignees and milestone.
func (w *Writer) CreateChange(ctx context.Context, c source.NewChange) (source.Change, error) {
	patch := map[string]any{}
	if len(c.Labels) > 0 {
		patch["labels"] = c.Labels
	}
	if len(c.Assignees) > 0 {
		patch["assignees"] = c.Assignees
	}
	if c.Milestone != "" {
		if err := w.milestone(patch, &c.Milestone); err != nil {
			return source.Change{}, err
		}
	}
	var created issue
	err := w.do(ctx, http.MethodPost, "/pulls", map[string]any{"title": c.Title, "body": c.Body, "head": c.Head, "base": c.Base, "draft": c.Draft}, &created)
	if err != nil {
		return source.Change{}, err
	}
	change := source.Change{Number: created.Number, URL: created.HTMLURL, HeadRef: c.Head, BaseRef: c.Base}
	if len(patch) > 0 {
		err = w.do(ctx, http.MethodPatch, fmt.Sprintf("/issues/%d", created.Number), patch, nil)
	}
	return change, err
}

// EditChange changes what the edit gives.
func (w *Writer) EditChange(ctx context.Context, number int, e source.ChangeEdit) (source.Change, error) {
	change := source.Change{Number: number}
	patch := map[string]any{}
	if e.Title != nil {
		patch["title"] = *e.Title
	}
	if e.Body != nil {
		patch["body"] = *e.Body
	}
	if e.Base != nil {
		patch["base"] = *e.Base
	}
	if len(patch) > 0 {
		if err := w.do(ctx, http.MethodPatch, fmt.Sprintf("/pulls/%d", number), patch, nil); err != nil {
			return change, err
		}
	}
	milestone := map[string]any{}
	if err := w.milestone(milestone, e.Milestone); err != nil {
		return change, err
	}
	if len(milestone) > 0 {
		if err := w.do(ctx, http.MethodPatch, fmt.Sprintf("/issues/%d", number), milestone, nil); err != nil {
			return change, err
		}
	}
	if err := w.labels(ctx, number, e.AddLabels, e.RemoveLabels); err != nil {
		return change, err
	}
	return change, w.assignees(ctx, number, e.AddAssignees, e.RemoveAssignees)
}

// SetChangeState closes the pull request, its branch deleted with
// deleteBranch, or reopens it.
func (w *Writer) SetChangeState(ctx context.Context, number int, state source.ChangeState, deleteBranch bool) (source.Change, error) {
	var pull issue
	if err := w.do(ctx, http.MethodPatch, fmt.Sprintf("/pulls/%d", number), map[string]any{"state": string(state)}, &pull); err != nil {
		return source.Change{}, err
	}
	change := source.Change{Number: number, State: state, HeadRef: pull.Head.Ref, URL: pull.HTMLURL}
	if deleteBranch && pull.Head.Ref != "" {
		return change, w.do(ctx, http.MethodDelete, "/git/refs/heads/"+escapeRef(pull.Head.Ref), nil, nil)
	}
	return change, nil
}

// reviewEvents are the verdicts as GitHub's create of a review names them.
var reviewEvents = map[source.ReviewState]string{
	source.ReviewApproved:         "APPROVE",
	source.ReviewChangesRequested: "REQUEST_CHANGES",
	source.ReviewCommented:        "COMMENT",
}

// Review submits a review at the head the copy has.
func (w *Writer) Review(ctx context.Context, number int, r source.NewReview) (source.Review, error) {
	event, ok := reviewEvents[r.State]
	if !ok {
		return source.Review{}, fmt.Errorf("github: no review %q", r.State)
	}
	body := map[string]any{"event": event, "body": r.Body}
	head := w.Copy.HeadOid(number)
	if head != "" {
		body["commit_id"] = head
	}
	var created struct {
		ID int64 `json:"id"`
	}
	err := w.do(ctx, http.MethodPost, fmt.Sprintf("/pulls/%d/reviews", number), body, &created)
	return source.Review{ID: fmt.Sprint(created.ID), State: r.State, Body: r.Body, CommitOid: head}, err
}

// CommentChange comments the pull request: an issue's comment on GitHub.
func (w *Writer) CommentChange(ctx context.Context, number int, author, body, sessionID string) (source.Comment, error) {
	return w.Comment(ctx, number, author, body, sessionID)
}

// milestone sets patch's milestone from title: its number, null for "".
func (w *Writer) milestone(patch map[string]any, title *string) error {
	if title == nil {
		return nil
	}
	if *title == "" {
		patch["milestone"] = nil
		return nil
	}
	number, ok := w.Copy.MilestoneNumber(*title)
	if !ok {
		return source.ErrUnknownMilestone
	}
	patch["milestone"] = number
	return nil
}

func (w *Writer) labels(ctx context.Context, number int, add, remove []string) error {
	if len(add) > 0 {
		if err := w.do(ctx, http.MethodPost, fmt.Sprintf("/issues/%d/labels", number), map[string]any{"labels": add}, nil); err != nil {
			return err
		}
	}
	for _, label := range remove {
		if err := w.do(ctx, http.MethodDelete, fmt.Sprintf("/issues/%d/labels/%s", number, url.PathEscape(label)), nil, nil); err != nil {
			return err
		}
	}
	return nil
}

func (w *Writer) assignees(ctx context.Context, number int, add, remove []string) error {
	if len(add) > 0 {
		if err := w.do(ctx, http.MethodPost, fmt.Sprintf("/issues/%d/assignees", number), map[string]any{"assignees": add}, nil); err != nil {
			return err
		}
	}
	if len(remove) > 0 {
		return w.do(ctx, http.MethodDelete, fmt.Sprintf("/issues/%d/assignees", number), map[string]any{"assignees": remove}, nil)
	}
	return nil
}

// block marks number blocked by blocker (GitHub's issue dependencies).
func (w *Writer) block(ctx context.Context, number, blocker int) error {
	id, err := w.issueID(ctx, blocker)
	if err != nil {
		return err
	}
	return w.do(ctx, http.MethodPost, fmt.Sprintf("/issues/%d/dependencies/blocked_by", number), map[string]any{"issue_id": id}, nil)
}

// parent makes parent the issue's parent, none for 0.
func (w *Writer) parent(ctx context.Context, number, parent int) error {
	current := w.Copy.Parent(number)
	if parent == current {
		return nil
	}
	id, err := w.issueID(ctx, number)
	if err != nil {
		return err
	}
	if parent == 0 {
		return w.do(ctx, http.MethodDelete, fmt.Sprintf("/issues/%d/sub_issue", current), map[string]any{"sub_issue_id": id}, nil)
	}
	return w.do(ctx, http.MethodPost, fmt.Sprintf("/issues/%d/sub_issues", parent), map[string]any{"sub_issue_id": id, "replace_parent": current != 0}, nil)
}

// issueID is the issue's database id, which dependencies and sub-issues
// take, the copy keeping numbers only.
func (w *Writer) issueID(ctx context.Context, number int) (int64, error) {
	var found issue
	if err := w.do(ctx, http.MethodGet, fmt.Sprintf("/issues/%d", number), nil, &found); err != nil {
		return 0, err
	}
	return found.ID, nil
}

// do calls the repository's path with the Session's token; a refusal is an
// *HTTPError.
func (w *Writer) do(ctx context.Context, method, path string, body, reply any) error {
	base := strings.TrimSuffix(w.BaseURL, "/")
	if base == "" {
		base = "https://api.github.com"
	}
	target := fmt.Sprintf("%s/repos/%s/%s%s", base, url.PathEscape(w.Owner), url.PathEscape(w.Name), path)
	var in io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		in = bytes.NewReader(data)
	}
	request, err := http.NewRequestWithContext(ctx, method, target, in)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("Authorization", "Bearer "+w.Token)
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	client := w.HTTP
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("github: %s %s: %w", method, path, err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<22))
	if err != nil {
		return fmt.Errorf("github: %s %s: %w", method, path, err)
	}
	if response.StatusCode >= 300 {
		return refusal(response.StatusCode, target, data)
	}
	if reply == nil || len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, reply); err != nil {
		return fmt.Errorf("github: %s %s: %w", method, path, err)
	}
	return nil
}

// refusal reads GitHub's error body: its message and its errors' lines.
func refusal(status int, target string, data []byte) *HTTPError {
	var answer struct {
		Message string            `json:"message"`
		Errors  []json.RawMessage `json:"errors"`
	}
	_ = json.Unmarshal(data, &answer)
	e := &HTTPError{Status: status, Message: answer.Message, URL: target}
	if e.Message == "" {
		e.Message = http.StatusText(status)
	}
	for _, raw := range answer.Errors {
		var text string
		if json.Unmarshal(raw, &text) == nil {
			e.Errors = append(e.Errors, text)
			continue
		}
		var item struct {
			Message, Resource, Field, Code string
		}
		if json.Unmarshal(raw, &item) != nil {
			continue
		}
		switch {
		case item.Message != "":
			e.Errors = append(e.Errors, item.Message)
		case item.Resource != "":
			e.Errors = append(e.Errors, fmt.Sprintf("%s.%s %s", item.Resource, item.Field, item.Code))
		}
	}
	return e
}

// escapeRef escapes each segment of a branch's name, keeping its slashes.
func escapeRef(ref string) string {
	parts := strings.Split(ref, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}
