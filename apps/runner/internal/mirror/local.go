package mirror

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// LocalSources are the Local Projets' Sources the copy reads (SOURCE-2,
// ADR 0012): the copy never parses a Ticket file nor opens local.db itself.
type LocalSources interface {
	// Source is the Local Projet's; false when the Runner's state has no folder for it.
	Source(projectID string) (source.Reader, bool)
}

// ReadyLabel is the label an agent's ready issue carries; a Local Ticket's
// `ready: true` is shown as it, never written to the file.
const ReadyLabel = "ready-for-agent"

// closingKeywords are GitHub's: a PR's body closing an issue.
var closingKeywords = regexp.MustCompile(`(?i)\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)\b`)

// localProject is the key's row and its Source.
func (m *Mirror) localProject(key string) (Project, source.Reader, error) {
	p, err := m.Store.project(key)
	if err != nil {
		return Project{}, nil, err
	}
	if p.Source != SourceLocal {
		return Project{}, nil, fmt.Errorf("%w: %s is not Local", ErrNotAProject, key)
	}
	if m.Locals == nil {
		return Project{}, nil, fmt.Errorf("%w: no Local Source", ErrUnavailable)
	}
	r, ok := m.Locals.Source(p.ProjectID)
	if !ok {
		return Project{}, nil, fmt.Errorf("%w: the folder of %s is not in the Runner's state", ErrUnavailable, key)
	}
	return p, r, nil
}

// unavailable makes a folder gone (PROJET-6's project.folder-missing) the
// copy's ErrUnavailable: the read fails, the copy is kept.
func unavailable(err error) error {
	if errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	return err
}

// localRead is what a Local key's Source has now, the groups it holds.
type localRead struct {
	tickets    []source.Ticket
	milestones []source.Milestone
	changes    []source.Change
}

// readLocal reads the key's groups from its Source, after checking that the
// Source can be read at all (a folder gone fails a code-only key too). A key
// not filled yet (a first fill, the refill of a rebuild) reads the Tickets
// as they are, so that filling the copy writes nothing of local.db.
func (m *Mirror) readLocal(ctx context.Context, p Project, r source.Reader) (localRead, error) {
	var out localRead
	var err error
	if a, ok := r.(source.Available); ok {
		if err := a.Available(ctx); err != nil {
			return out, unavailable(err)
		}
	}
	if p.Has(GroupTicket) {
		filled, err := m.Store.filledAt(p.Repository)
		if err != nil {
			return out, err
		}
		if asIs, ok := r.(source.AsIs); ok && !filled {
			if out.tickets, out.milestones, err = asIs.TicketsAsIs(ctx); err != nil {
				return out, unavailable(err)
			}
		} else {
			if out.tickets, err = r.Tickets(ctx); err != nil {
				return out, unavailable(err)
			}
			if out.milestones, err = r.Milestones(ctx); err != nil {
				return out, unavailable(err)
			}
		}
	}
	if p.Has(GroupCode) {
		if out.changes, err = r.Changes(ctx); err != nil {
			return out, unavailable(err)
		}
	}
	return out, nil
}

// RefreshLocal reads one Ticket or one local change of the Local key from its
// Source and replaces it in the copy, or deletes it from the copy when the
// Source no longer has it (gone).
func (m *Mirror) RefreshLocal(ctx context.Context, key string, number int) (gone bool, err error) {
	started := m.now()
	p, r, err := m.localProject(key)
	if err != nil {
		return false, err
	}
	read, err := m.readLocal(ctx, p, r)
	if err != nil {
		return false, err
	}
	var write func(*sql.Tx) error
	for _, t := range read.tickets {
		if t.Number == number {
			o, err := m.ticketObject(ctx, key, r, t, read.tickets)
			if err != nil {
				return false, err
			}
			write = func(tx *sql.Tx) error { return PutObject(tx, o) }
		}
	}
	for _, c := range read.changes {
		if c.Number == number && write == nil {
			o, checks, err := m.changeObject(ctx, p, r, c)
			if err != nil {
				return false, err
			}
			write = func(tx *sql.Tx) error {
				if err := PutObject(tx, o); err != nil {
					return err
				}
				return PutChecks(tx, key, o.Pull.HeadOid, "", checks)
			}
		}
	}
	if write == nil {
		gone = true
		write = func(tx *sql.Tx) error { return DeleteObject(tx, key, number) }
	}
	if p.Has(GroupTicket) {
		milestones := localMilestones(read.milestones)
		inner := write
		write = func(tx *sql.Tx) error {
			if err := inner(tx); err != nil {
				return err
			}
			return PutCollections(tx, key, nil, milestones, nil)
		}
	}
	if err := m.Store.Update(write); err != nil {
		return false, err
	}
	m.logger().Debug("mirror local object", "repository", key, "number", number, "gone", gone, "duration_ms", m.now().Sub(started).Milliseconds())
	return gone, nil
}

// ReconcileLocal brings the Local key's copy back to its Source: every
// Ticket file and local change its groups hold, the milestones; deletes from
// the copy what the Source no longer has; marks the key filled and synced.
// It writes the copy in one transaction: a Local copy is never half read.
func (m *Mirror) ReconcileLocal(ctx context.Context, key string) (Result, error) {
	started := m.now()
	p, r, err := m.localProject(key)
	if err != nil {
		return Result{}, err
	}
	filled, err := m.Store.filledAt(key)
	if err != nil {
		return Result{}, err
	}
	read, err := m.readLocal(ctx, p, r)
	if err != nil {
		return Result{}, err
	}
	var objects []Object
	type checksOf struct {
		sha    string
		checks []Check
	}
	var checks []checksOf
	for _, t := range read.tickets {
		o, err := m.ticketObject(ctx, key, r, t, read.tickets)
		if err != nil {
			return Result{}, err
		}
		objects = append(objects, o)
	}
	for _, c := range read.changes {
		o, cs, err := m.changeObject(ctx, p, r, c)
		if err != nil {
			return Result{}, err
		}
		objects = append(objects, o)
		checks = append(checks, checksOf{o.Pull.HeadOid, cs})
	}
	local, err := m.Store.copied(key)
	if err != nil {
		return Result{}, err
	}
	seen := map[int]bool{}
	for _, o := range objects {
		seen[o.Number] = true
	}
	var absent []int
	for number := range local {
		if !seen[number] {
			absent = append(absent, number)
		}
	}
	sort.Ints(absent)
	result := Result{Listed: len(objects), Fetched: len(objects), Checks: len(checks), Deleted: len(absent)}
	err = m.Store.Update(func(tx *sql.Tx) error {
		for _, number := range absent {
			if err := DeleteObject(tx, key, number); err != nil {
				return err
			}
		}
		for _, o := range objects {
			if err := PutObject(tx, o); err != nil {
				return err
			}
		}
		for _, c := range checks {
			if err := PutChecks(tx, key, c.sha, "", c.checks); err != nil {
				return err
			}
		}
		if p.Has(GroupTicket) {
			return PutCollections(tx, key, nil, localMilestones(read.milestones), nil)
		}
		return nil
	})
	if err != nil {
		return result, err
	}
	at := m.now()
	if !filled {
		if err := m.Store.MarkFilled(key, at); err != nil {
			return result, err
		}
		result.Filled = true
	}
	if err := m.Store.MarkSynced(key, at); err != nil {
		return result, err
	}
	m.logger().Info("mirror local reconcile", "repository", key, "listed", result.Listed, "deleted", result.Deleted,
		"filled", result.Filled, "duration_ms", m.now().Sub(started).Milliseconds())
	return result, nil
}

func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func formatTimePtr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return formatTime(*t)
}

// localMilestones are milestones.yml's, numbered by their rank.
func localMilestones(milestones []source.Milestone) []Milestone {
	out := make([]Milestone, 0, len(milestones))
	for i, ms := range milestones {
		number := ms.Number
		if number == 0 {
			number = i + 1
		}
		out = append(out, Milestone{Number: number, Title: ms.Title, State: "OPEN", DueOn: formatTimePtr(ms.DueOn)})
	}
	return out
}

// ticketObject is a Ticket file as an issue (ADR 0012's one shape).
func (m *Mirror) ticketObject(ctx context.Context, key string, r source.Reader, t source.Ticket, all []source.Ticket) (Object, error) {
	o := Object{
		Repository: key, Number: t.Number, Title: t.Title, Body: t.Body,
		State: strings.ToUpper(string(t.State)), StateReason: strings.ToUpper(string(t.StateReason)), URL: t.URL,
		CreatedAt: formatTime(t.CreatedAt), UpdatedAt: formatTime(t.UpdatedAt), ClosedAt: formatTimePtr(t.ClosedAt),
		Assignees: []string{},
	}
	if o.State == "" {
		o.State = "OPEN"
	}
	labels := map[string]bool{}
	for _, l := range t.Labels {
		if !labels[l] {
			labels[l] = true
			o.Labels = append(o.Labels, l)
		}
	}
	if t.Ready && !labels[ReadyLabel] {
		o.Labels = append(o.Labels, ReadyLabel)
	}
	if t.Milestone != nil {
		o.Milestone = t.Milestone.Number
	}
	if t.Parent != nil {
		o.Parent = *t.Parent
	}
	for _, other := range all {
		if other.Parent != nil && *other.Parent == t.Number && other.Number != t.Number {
			o.SubIssues = append(o.SubIssues, other.Number)
		}
	}
	sort.Ints(o.SubIssues)
	for _, b := range t.BlockedBy {
		o.BlockedBy = append(o.BlockedBy, Ref{Repository: key, Number: b})
	}
	comments, err := r.Comments(ctx, t.Number)
	if err != nil {
		return Object{}, unavailable(err)
	}
	for _, c := range comments {
		at := formatTime(c.CreatedAt)
		o.Comments = append(o.Comments, Comment{ID: c.ID, Author: c.Author, Body: c.Body, CreatedAt: at, UpdatedAt: at})
	}
	return o, nil
}

// changeObject is a local change as a PR, with its head's checks.
func (m *Mirror) changeObject(ctx context.Context, p Project, r source.Reader, c source.Change) (Object, []Check, error) {
	o := Object{
		Repository: p.Repository, Number: c.Number, IsPull: true, Title: c.Title, Body: c.Body,
		State: strings.ToUpper(string(c.State)), Author: c.Author,
		CreatedAt: formatTime(c.CreatedAt), UpdatedAt: formatTime(c.UpdatedAt), ClosedAt: formatTimePtr(c.ClosedAt),
		Labels: append([]string{}, c.Labels...), Assignees: []string{},
	}
	if o.State == "" {
		o.State = "OPEN"
	}
	comments, err := r.Comments(ctx, c.Number)
	if err != nil {
		return Object{}, nil, unavailable(err)
	}
	for _, cm := range comments {
		at := formatTime(cm.CreatedAt)
		o.Comments = append(o.Comments, Comment{ID: cm.ID, Author: cm.Author, Body: cm.Body, CreatedAt: at, UpdatedAt: at})
	}
	history, err := r.History(ctx, c.Number)
	if err != nil {
		return Object{}, nil, unavailable(err)
	}
	pull := &Pull{
		HeadRef: c.HeadRef, HeadOid: history.HeadOid, BaseRef: c.BaseRef, IsDraft: c.IsDraft, Mergeable: "UNKNOWN",
		MergeCommit: c.MergeCommitOid, MergedAt: formatTimePtr(c.MergedAt),
	}
	if pull.HeadOid == "" {
		pull.HeadOid = c.HeadOid
	}
	for _, commit := range history.Commits {
		pull.Commits = append(pull.Commits, Commit{Oid: commit.Oid, Message: commit.Message})
	}
	ticketKey := p.Repository
	if !p.Has(GroupTicket) {
		ticketKey, err = m.Store.keyOf(p.ProjectID, GroupTicket)
		if err != nil {
			return Object{}, nil, err
		}
	}
	if ticketKey != "" {
		pull.ClosingIssues = closingRefs(c.Body, ticketKey)
	}
	reviews, err := r.Reviews(ctx, c.Number)
	if err != nil {
		return Object{}, nil, unavailable(err)
	}
	for _, rv := range reviews {
		pull.Reviews = append(pull.Reviews, Review{ID: rv.ID, Author: rv.Author, State: string(rv.State), Body: rv.Body,
			CommitOid: rv.CommitOid, SubmittedAt: formatTime(rv.SubmittedAt)})
		for _, rc := range rv.Comments {
			pull.ReviewComments = append(pull.ReviewComments, ReviewComment{ID: rc.ID, ReviewID: rv.ID, Author: rv.Author,
				Body: rc.Body, Path: rc.Path, Line: rc.Line, CreatedAt: formatTime(rc.CreatedAt)})
		}
	}
	o.Pull = pull
	var checks []Check
	if pull.HeadOid != "" {
		found, err := r.Checks(ctx, pull.HeadOid)
		if err != nil {
			return Object{}, nil, unavailable(err)
		}
		for _, ch := range found {
			checks = append(checks, Check{Typename: "CheckRun", Name: ch.Name, Status: ch.Status, Conclusion: ch.Conclusion})
		}
	}
	return o, checks, nil
}

// project is the copy's key; ErrNotAProject when it has none such.
func (s *Store) project(key string) (Project, error) {
	rows, err := s.db.Query("SELECT "+projectColumns+" FROM projects WHERE repository = ? COLLATE NOCASE", key)
	if err != nil {
		return Project{}, fmt.Errorf("mirror: projects: %w", err)
	}
	defer rows.Close()
	projects, err := scanProjects(rows)
	if err != nil {
		return Project{}, err
	}
	if len(projects) == 0 {
		return Project{}, fmt.Errorf("%w: %s", ErrNotAProject, key)
	}
	return projects[0], nil
}

// closingRefs are the Tickets under ticketKey a change's body closes, with
// GitHub's keywords, in their order.
func closingRefs(body, ticketKey string) []Ref {
	var out []Ref
	seen := map[int]bool{}
	for _, match := range closingKeywords.FindAllStringSubmatch(body, -1) {
		n, err := strconv.Atoi(match[1])
		if err != nil || seen[n] {
			continue
		}
		seen[n] = true
		out = append(out, Ref{Repository: ticketKey, Number: n})
	}
	return out
}

// localTickets is the Local key of the Tickets of the GitHub key's Projet,
// "" when they are on GitHub too: GitHub's closingIssuesReferences of a PR
// under the key then name GitHub's issues, never the Local Tickets, which
// only its body's keywords can close.
func (s *Store) localTickets(key string) (string, error) {
	p, err := s.project(key)
	if errors.Is(err, ErrNotAProject) {
		return "", nil
	}
	if err != nil || p.Source == SourceLocal || p.Has(GroupTicket) {
		return "", err
	}
	ticketKey, err := s.keyOf(p.ProjectID, GroupTicket)
	if err != nil || !IsLocal(ticketKey) {
		return "", err
	}
	return ticketKey, nil
}

// keyOf is the key of the Projet's group, "" when the copy has none.
func (s *Store) keyOf(projectID, group string) (string, error) {
	projects, err := s.Projects()
	if err != nil {
		return "", err
	}
	p, _ := KeyOf(projects, projectID, group)
	return p.Repository, nil
}
