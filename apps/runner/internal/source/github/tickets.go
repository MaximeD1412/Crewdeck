package github

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// ArchiveLabel marks the issues of a repository whose Tickets moved to
// Local (SOURCE-8): with the lock, nothing writes there again.
const ArchiveLabel = "crewdeck:archive"

// ErrUnavailable: GitHub did not answer, or answered 5xx or 429, after the
// retries (`github.unavailable`); a 4xx is an *HTTPError (`github.refused`).
var ErrUnavailable = errors.New("github: unavailable")

// Tickets is a repository's issues as a migration of Source reads and
// writes them (SOURCE-8, ADR 0012), through the REST API with the
// migration's token: issues (never pull requests), labels, milestones,
// comments, sub-issues, blocked-by and the lock. The origin markers
// (`<!-- crewdeck:from local#12 -->`) end the bodies a copy writes.
type Tickets struct {
	// BaseURL is https://api.github.com unless a test points it at a fake.
	BaseURL string
	HTTP    *http.Client
	Owner   string
	Name    string
	// Token gives the migration's token at each call (renewed as it nears its expiry).
	Token func(ctx context.Context) (string, error)
	// Retries is how many times a call GitHub did not answer is tried again (3 when 0), Wait how long before each.
	Retries int
	Wait    func(attempt int) time.Duration

	ids    map[int]int64   // an issue's number: its database id, which sub-issues and dependencies take
	labels map[string]bool // the repository's labels, once read
}

var _ source.Copier = (*Tickets)(nil)

// Kind is "github".
func (t *Tickets) Kind() string { return "github" }

var markerPattern = regexp.MustCompile(`\s*<!-- crewdeck:from ([a-z]+#[0-9]+(?:/comment/[A-Za-z0-9-]+)?) -->\s*$`)

// Marked is text ending with the origin marker of from.
func Marked(text, from string) string {
	text = strings.TrimRight(text, " \t\r\n")
	if text != "" {
		text += "\n\n"
	}
	return text + "<!-- crewdeck:from " + from + " -->"
}

// unmarked is text without its origin marker, and the marker's origin ("" for none).
func unmarked(text string) (string, string) {
	if m := markerPattern.FindStringSubmatchIndex(text); m != nil {
		return text[:m[0]], text[m[2]:m[3]]
	}
	return text, ""
}

type restLabel struct {
	Name string `json:"name"`
}

type restMilestone struct {
	Number int     `json:"number"`
	Title  string  `json:"title"`
	DueOn  *string `json:"due_on"`
}

type restIssue struct {
	ID          int64          `json:"id"`
	Number      int            `json:"number"`
	Title       string         `json:"title"`
	Body        *string        `json:"body"`
	State       string         `json:"state"`
	StateReason *string        `json:"state_reason"`
	Locked      bool           `json:"locked"`
	Labels      []restLabel    `json:"labels"`
	Milestone   *restMilestone `json:"milestone"`
	Comments    int            `json:"comments"`
	HTMLURL     string         `json:"html_url"`
	PullRequest *struct{}      `json:"pull_request"`
	SubIssues   *struct {
		Total int `json:"total"`
	} `json:"sub_issues_summary"`
	Dependencies *struct {
		BlockedBy int `json:"blocked_by"`
	} `json:"issue_dependencies_summary"`
}

type restComment struct {
	ID        int64  `json:"id"`
	Body      string `json:"body"`
	CreatedAt string `json:"created_at"`
	User      struct {
		Login string `json:"login"`
	} `json:"user"`
}

// ReadAll is every issue of the repository by number (the pull requests
// left out) with its comments, parent and blockers, and every milestone.
func (t *Tickets) ReadAll(ctx context.Context) ([]source.CopiedTicket, []source.Milestone, error) {
	issues, err := t.issues(ctx)
	if err != nil {
		return nil, nil, err
	}
	parents := map[int]int{}
	tickets := make([]source.CopiedTicket, 0, len(issues))
	for _, is := range issues {
		ticket, err := t.ticket(ctx, is)
		if err != nil {
			return nil, nil, err
		}
		if is.SubIssues == nil || is.SubIssues.Total > 0 {
			children, err := listAll[restIssue](ctx, t, fmt.Sprintf("/issues/%d/sub_issues", is.Number))
			if err != nil {
				return nil, nil, err
			}
			for _, child := range children {
				parents[child.Number] = is.Number
			}
		}
		tickets = append(tickets, ticket)
	}
	for i := range tickets {
		if parent, ok := parents[tickets[i].Number]; ok {
			tickets[i].Parent = &parent
		}
	}
	listed, err := listAll[restMilestone](ctx, t, "/milestones?state=all&sort=due_on")
	if err != nil {
		return nil, nil, err
	}
	slices.SortFunc(listed, func(a, b restMilestone) int { return a.Number - b.Number })
	milestones := make([]source.Milestone, 0, len(listed))
	for _, m := range listed {
		milestones = append(milestones, milestoneOf(m))
	}
	return tickets, milestones, nil
}

// issues are the repository's issues, oldest first, the pull requests left out.
func (t *Tickets) issues(ctx context.Context) ([]restIssue, error) {
	listed, err := listAll[restIssue](ctx, t, "/issues?state=all&sort=created&direction=asc")
	if err != nil {
		return nil, err
	}
	issues := listed[:0]
	for _, is := range listed {
		if is.PullRequest == nil {
			issues = append(issues, is)
			t.remember(is.Number, is.ID)
		}
	}
	slices.SortFunc(issues, func(a, b restIssue) int { return a.Number - b.Number })
	return issues, nil
}

func (t *Tickets) ticket(ctx context.Context, is restIssue) (source.CopiedTicket, error) {
	body := ""
	if is.Body != nil {
		body = *is.Body
	}
	body, from := unmarked(body)
	ticket := source.CopiedTicket{ID: is.ID, From: from, Ticket: source.Ticket{
		Number: is.Number, Title: is.Title, Body: body, State: source.TicketState(is.State), URL: is.HTMLURL,
		Labels: []string{}, BlockedBy: []int{},
	}}
	if ticket.State == source.TicketClosed {
		ticket.StateReason = source.ReasonCompleted
		if is.StateReason != nil && *is.StateReason == string(source.ReasonNotPlanned) {
			ticket.StateReason = source.ReasonNotPlanned
		}
	}
	for _, l := range is.Labels {
		switch l.Name {
		case source.ReadyLabel:
			ticket.Ready = true
		case ArchiveLabel:
		default:
			ticket.Labels = append(ticket.Labels, l.Name)
		}
	}
	if is.Milestone != nil {
		m := milestoneOf(*is.Milestone)
		ticket.Milestone = &m
	}
	if is.Comments > 0 {
		comments, err := listAll[restComment](ctx, t, fmt.Sprintf("/issues/%d/comments", is.Number))
		if err != nil {
			return ticket, err
		}
		for _, c := range comments {
			text, from := unmarked(c.Body)
			created, _ := time.Parse(time.RFC3339, c.CreatedAt)
			ticket.Comments = append(ticket.Comments, source.CopiedComment{From: from, Comment: source.Comment{
				ID: strconv.FormatInt(c.ID, 10), Author: c.User.Login, Body: text, CreatedAt: created,
			}})
		}
	}
	if is.Dependencies == nil || is.Dependencies.BlockedBy > 0 {
		blockers, err := listAll[restIssue](ctx, t, fmt.Sprintf("/issues/%d/dependencies/blocked_by", is.Number))
		if err != nil {
			return ticket, err
		}
		for _, b := range blockers {
			ticket.BlockedBy = append(ticket.BlockedBy, b.Number)
			t.remember(b.Number, b.ID)
		}
		slices.Sort(ticket.BlockedBy)
	}
	return ticket, nil
}

func milestoneOf(m restMilestone) source.Milestone {
	out := source.Milestone{Number: m.Number, Title: m.Title}
	if m.DueOn != nil {
		if due, err := time.Parse(time.RFC3339, *m.DueOn); err == nil {
			out.DueOn = &due
		}
	}
	return out
}

// CreateMilestone creates the milestone, its due date with it.
func (t *Tickets) CreateMilestone(ctx context.Context, m source.Milestone) (int, error) {
	body := map[string]any{"title": m.Title}
	if m.DueOn != nil {
		body["due_on"] = m.DueOn.UTC().Format(time.RFC3339)
	}
	var created restMilestone
	err := t.call(ctx, http.MethodPost, "/milestones", body, &created)
	return created.Number, err
}

// PutTicket creates the issue (then closes it when the Ticket is closed),
// or edits it; its body ends with from's marker, its labels created first
// when the repository lacks them.
func (t *Tickets) PutTicket(ctx context.Context, number int, ticket source.Ticket, from string) (int, error) {
	labels := slices.Clone(ticket.Labels)
	if ticket.Ready {
		labels = append(labels, source.ReadyLabel)
	}
	if err := t.ensureLabels(ctx, labels); err != nil {
		return number, err
	}
	body := map[string]any{"title": ticket.Title, "body": Marked(ticket.Body, from), "labels": labels, "milestone": nil}
	if ticket.Milestone != nil {
		body["milestone"] = ticket.Milestone.Number
	}
	if number == 0 {
		var created restIssue
		if err := t.call(ctx, http.MethodPost, "/issues", body, &created); err != nil {
			return 0, err
		}
		number = created.Number
		t.remember(created.Number, created.ID)
		if ticket.State != source.TicketClosed {
			return number, nil
		}
		body = map[string]any{}
	}
	body["state"] = string(ticket.State)
	if ticket.State == source.TicketClosed {
		reason := ticket.StateReason
		if reason == source.ReasonNone {
			reason = source.ReasonCompleted
		}
		body["state_reason"] = string(reason)
	}
	return number, t.call(ctx, http.MethodPatch, fmt.Sprintf("/issues/%d", number), body, nil)
}

// CommentHeading is « **<author>**, le <date> : », the first line of a comment
// a copy writes on GitHub, where its author is crewdeck[bot].
func CommentHeading(author string, at time.Time) string {
	return fmt.Sprintf("**%s**, le %s :", author, at.UTC().Format("2006-01-02 à 15:04 UTC"))
}

// AddComment comments the issue: its heading, its text, from's marker.
func (t *Tickets) AddComment(ctx context.Context, number int, c source.Comment, from string) error {
	text := CommentHeading(c.Author, c.CreatedAt) + "\n\n" + c.Body
	return t.call(ctx, http.MethodPost, fmt.Sprintf("/issues/%d/comments", number), map[string]any{"body": Marked(text, from)}, nil)
}

// Link makes parent the issue's parent (none for 0) and blockedBy its blockers.
func (t *Tickets) Link(ctx context.Context, was source.CopiedTicket, parent int, blockedBy []int) error {
	id, err := t.id(ctx, was.Number)
	if err != nil {
		return err
	}
	current := 0
	if was.Parent != nil {
		current = *was.Parent
	}
	if parent != current {
		if parent == 0 {
			err = t.call(ctx, http.MethodDelete, fmt.Sprintf("/issues/%d/sub_issue", current), map[string]any{"sub_issue_id": id}, nil)
		} else {
			err = t.call(ctx, http.MethodPost, fmt.Sprintf("/issues/%d/sub_issues", parent), map[string]any{"sub_issue_id": id, "replace_parent": current != 0}, nil)
		}
		if err != nil {
			return err
		}
	}
	for _, b := range blockedBy {
		if slices.Contains(was.BlockedBy, b) {
			continue
		}
		blocker, err := t.id(ctx, b)
		if err != nil {
			return err
		}
		if err := t.call(ctx, http.MethodPost, fmt.Sprintf("/issues/%d/dependencies/blocked_by", was.Number), map[string]any{"issue_id": blocker}, nil); err != nil {
			return err
		}
	}
	for _, b := range was.BlockedBy {
		if slices.Contains(blockedBy, b) {
			continue
		}
		blocker, err := t.id(ctx, b)
		if err != nil {
			return err
		}
		if err := t.call(ctx, http.MethodDelete, fmt.Sprintf("/issues/%d/dependencies/blocked_by/%d", was.Number, blocker), nil, nil); err != nil {
			return err
		}
	}
	return nil
}

// Freeze labels every issue crewdeck:archive (created when absent) and
// locks it, open or closed as it was.
func (t *Tickets) Freeze(ctx context.Context) error {
	issues, err := t.issues(ctx)
	if err != nil {
		return err
	}
	if err := t.ensureLabels(ctx, []string{ArchiveLabel}); err != nil {
		return err
	}
	for _, is := range issues {
		if !slices.ContainsFunc(is.Labels, func(l restLabel) bool { return l.Name == ArchiveLabel }) {
			if err := t.call(ctx, http.MethodPost, fmt.Sprintf("/issues/%d/labels", is.Number), map[string]any{"labels": []string{ArchiveLabel}}, nil); err != nil {
				return err
			}
		}
		if !is.Locked {
			if err := t.call(ctx, http.MethodPut, fmt.Sprintf("/issues/%d/lock", is.Number), map[string]any{}, nil); err != nil {
				return err
			}
		}
	}
	return nil
}

// ensureLabels creates the labels the repository lacks.
func (t *Tickets) ensureLabels(ctx context.Context, labels []string) error {
	if t.labels == nil {
		listed, err := listAll[restLabel](ctx, t, "/labels")
		if err != nil {
			return err
		}
		t.labels = map[string]bool{}
		for _, l := range listed {
			t.labels[l.Name] = true
		}
	}
	for _, name := range labels {
		if t.labels[name] {
			continue
		}
		if err := t.call(ctx, http.MethodPost, "/labels", map[string]any{"name": name, "color": "ededed"}, nil); err != nil {
			var refused *HTTPError
			if !errors.As(err, &refused) || refused.Status != http.StatusUnprocessableEntity { // 422: it exists already
				return err
			}
		}
		t.labels[name] = true
	}
	return nil
}

func (t *Tickets) remember(number int, id int64) {
	if t.ids == nil {
		t.ids = map[int]int64{}
	}
	if id != 0 {
		t.ids[number] = id
	}
}

// id is the issue's database id, read once.
func (t *Tickets) id(ctx context.Context, number int) (int64, error) {
	if id, ok := t.ids[number]; ok {
		return id, nil
	}
	var found restIssue
	if err := t.call(ctx, http.MethodGet, fmt.Sprintf("/issues/%d", number), nil, &found); err != nil {
		return 0, err
	}
	t.remember(number, found.ID)
	return found.ID, nil
}

// pageSize is how many items each page of a list asks for.
const pageSize = 100

// listAll reads every page of a list.
func listAll[T any](ctx context.Context, t *Tickets, path string) ([]T, error) {
	sep := "?"
	if strings.Contains(path, "?") {
		sep = "&"
	}
	var all []T
	for page := 1; ; page++ {
		var items []T
		if err := t.call(ctx, http.MethodGet, fmt.Sprintf("%s%sper_page=%d&page=%d", path, sep, pageSize, page), nil, &items); err != nil {
			return nil, err
		}
		all = append(all, items...)
		if len(items) < pageSize {
			return all, nil
		}
	}
}

// call is one call with the migration's token, tried again while GitHub
// does not answer; ErrUnavailable once the retries are spent.
func (t *Tickets) call(ctx context.Context, method, path string, body, reply any) error {
	token, err := t.Token(ctx)
	if err != nil {
		return err
	}
	w := Writer{BaseURL: t.BaseURL, HTTP: t.HTTP, Token: token, Owner: t.Owner, Name: t.Name}
	retries := t.Retries
	if retries == 0 {
		retries = 3
	}
	for attempt := 0; ; attempt++ {
		err = w.do(ctx, method, path, body, reply)
		var refused *HTTPError
		if err == nil || ctx.Err() != nil || errors.As(err, &refused) && refused.Status < 500 && refused.Status != http.StatusTooManyRequests {
			return err
		}
		if attempt >= retries {
			return fmt.Errorf("%w: %v", ErrUnavailable, err)
		}
		wait := time.Duration(attempt+1) * 2 * time.Second
		if t.Wait != nil {
			wait = t.Wait(attempt)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
	}
}
