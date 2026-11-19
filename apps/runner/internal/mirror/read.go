package mirror

import (
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// ErrNotFound: the copy has no issue nor PR of that number under the key.
var ErrNotFound = errors.New("mirror: not in the copy")

// Object reads the issue or PR back from the copy's rows.
func (s *Store) Object(key string, number int) (Object, error) {
	objects, err := s.objects(key, "i.number = ?", number)
	if err != nil {
		return Object{}, err
	}
	if len(objects) == 0 {
		return Object{}, fmt.Errorf("%w: %s#%d", ErrNotFound, key, number)
	}
	return objects[0], nil
}

// objects are the key's objects matching where (on issues i), by number.
func (s *Store) objects(key, where string, args ...any) ([]Object, error) {
	query := `SELECT i.number, i.is_pull, i.title, i.body, i.state, coalesce(i.state_reason, ''), i.url, coalesce(i.author, ''),
		coalesce(i.milestone_number, 0), coalesce(i.created_at, ''), coalesce(i.updated_at, ''), coalesce(i.closed_at, ''),
		coalesce(p.head_ref, ''), coalesce(p.head_oid, ''), coalesce(p.base_ref, ''), coalesce(p.is_draft, 0), coalesce(p.mergeable, ''),
		coalesce(p.merge_commit_oid, ''), coalesce(p.merged_at, ''), coalesce(p.checks_state, '')
		FROM issues i LEFT JOIN pulls p ON p.repository = i.repository AND p.number = i.number
		WHERE i.repository = ?`
	if where != "" {
		query += " AND " + where
	}
	rows, err := s.db.Query(query+" ORDER BY i.number", append([]any{key}, args...)...)
	if err != nil {
		return nil, fmt.Errorf("mirror: read the copy: %w", err)
	}
	var out []Object
	for rows.Next() {
		o := Object{Repository: key}
		var p Pull
		if err := rows.Scan(&o.Number, &o.IsPull, &o.Title, &o.Body, &o.State, &o.StateReason, &o.URL, &o.Author, &o.Milestone,
			&o.CreatedAt, &o.UpdatedAt, &o.ClosedAt, &p.HeadRef, &p.HeadOid, &p.BaseRef, &p.IsDraft, &p.Mergeable,
			&p.MergeCommit, &p.MergedAt, &p.ChecksState); err != nil {
			rows.Close()
			return nil, err
		}
		if o.IsPull {
			o.Pull = &p
		}
		out = append(out, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		if err := s.fill(&out[i]); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Store) strings(query string, args ...any) ([]string, error) {
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("mirror: read the copy: %w", err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// fill reads the object's lists: labels, assignees, comments, relations,
// and a PR's commits, closing issues and reviews.
func (s *Store) fill(o *Object) error {
	var err error
	k, n := o.Repository, o.Number
	if o.Labels, err = s.strings("SELECT name FROM issue_labels WHERE repository = ? AND number = ? ORDER BY name", k, n); err != nil {
		return err
	}
	if o.Assignees, err = s.strings("SELECT login FROM issue_assignees WHERE repository = ? AND number = ? ORDER BY login", k, n); err != nil {
		return err
	}
	rows, err := s.db.Query(`SELECT id, coalesce(author, ''), body, url, coalesce(created_at, ''), coalesce(updated_at, '')
		FROM comments WHERE repository = ? AND number = ? ORDER BY created_at, id`, k, n)
	if err != nil {
		return fmt.Errorf("mirror: read the copy: %w", err)
	}
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.ID, &c.Author, &c.Body, &c.URL, &c.CreatedAt, &c.UpdatedAt); err != nil {
			rows.Close()
			return err
		}
		o.Comments = append(o.Comments, c)
	}
	rows.Close()
	if err := s.db.QueryRow("SELECT coalesce(min(parent), 0) FROM sub_issues WHERE repository = ? AND child = ?", k, n).Scan(&o.Parent); err != nil {
		return fmt.Errorf("mirror: read the copy: %w", err)
	}
	if err := s.ints(&o.SubIssues, "SELECT child FROM sub_issues WHERE repository = ? AND parent = ? ORDER BY coalesce(position, 1000000), child", k, n); err != nil {
		return err
	}
	if o.BlockedBy, err = s.refs("SELECT blocker_repository, blocker_number FROM blocked_by WHERE repository = ? AND number = ? ORDER BY blocker_repository, blocker_number", k, n); err != nil {
		return err
	}
	if o.Pull == nil {
		return nil
	}
	p := o.Pull
	commits, err := s.db.Query("SELECT oid, message FROM pull_commits WHERE repository = ? AND number = ? ORDER BY position", k, n)
	if err != nil {
		return fmt.Errorf("mirror: read the copy: %w", err)
	}
	for commits.Next() {
		var c Commit
		if err := commits.Scan(&c.Oid, &c.Message); err != nil {
			commits.Close()
			return err
		}
		p.Commits = append(p.Commits, c)
	}
	commits.Close()
	if p.ClosingIssues, err = s.refs("SELECT issue_repository, issue_number FROM closing_issues WHERE repository = ? AND number = ? ORDER BY issue_repository, issue_number", k, n); err != nil {
		return err
	}
	if err := s.closingOfLocalTickets(o); err != nil {
		return err
	}
	reviews, err := s.db.Query(`SELECT id, coalesce(author, ''), state, body, coalesce(commit_oid, ''), coalesce(submitted_at, '')
		FROM reviews WHERE repository = ? AND number = ? ORDER BY submitted_at, id`, k, n)
	if err != nil {
		return fmt.Errorf("mirror: read the copy: %w", err)
	}
	for reviews.Next() {
		var r Review
		if err := reviews.Scan(&r.ID, &r.Author, &r.State, &r.Body, &r.CommitOid, &r.SubmittedAt); err != nil {
			reviews.Close()
			return err
		}
		p.Reviews = append(p.Reviews, r)
	}
	reviews.Close()
	return nil
}

// closingOfLocalTickets makes a GitHub PR's closing issues the Local
// Tickets its body closes when its Projet's Tickets are Local.
func (s *Store) closingOfLocalTickets(o *Object) error {
	if o.Pull == nil || IsLocal(o.Repository) {
		return nil
	}
	ticketKey, err := s.localTickets(o.Repository)
	if err != nil || ticketKey == "" {
		return err
	}
	o.Pull.ClosingIssues = closingRefs(o.Body, ticketKey)
	return nil
}

func (s *Store) ints(out *[]int, query string, args ...any) error {
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return fmt.Errorf("mirror: read the copy: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			return err
		}
		*out = append(*out, v)
	}
	return rows.Err()
}

func (s *Store) refs(query string, args ...any) ([]Ref, error) {
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("mirror: read the copy: %w", err)
	}
	defer rows.Close()
	var out []Ref
	for rows.Next() {
		var r Ref
		if err := rows.Scan(&r.Repository, &r.Number); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Checks are the copy's checks of the commit.
func (s *Store) Checks(key, sha string) ([]Check, error) {
	rows, err := s.db.Query(`SELECT typename, name, coalesce(status, ''), coalesce(conclusion, ''), coalesce(details_url, ''),
		coalesce(started_at, ''), coalesce(completed_at, '') FROM checks WHERE repository = ? AND sha = ? ORDER BY typename, name`, key, sha)
	if err != nil {
		return nil, fmt.Errorf("mirror: read the copy: %w", err)
	}
	defer rows.Close()
	out := []Check{}
	for rows.Next() {
		var c Check
		if err := rows.Scan(&c.Typename, &c.Name, &c.Status, &c.Conclusion, &c.DetailsURL, &c.StartedAt, &c.CompletedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Milestones are the copy's milestones of the key, by number.
func (s *Store) Milestones(key string) (map[int]Milestone, error) {
	rows, err := s.db.Query("SELECT number, title, state, coalesce(description, ''), coalesce(due_on, '') FROM milestones WHERE repository = ?", key)
	if err != nil {
		return nil, fmt.Errorf("mirror: read the copy: %w", err)
	}
	defer rows.Close()
	out := map[int]Milestone{}
	for rows.Next() {
		var m Milestone
		if err := rows.Scan(&m.Number, &m.Title, &m.State, &m.Description, &m.DueOn); err != nil {
			return nil, err
		}
		out[m.Number] = m
	}
	return out, rows.Err()
}

// Shape is what an object's gh answer needs beyond it.
type Shape struct {
	Milestones map[int]Milestone
	Checks     []Check // of a PR's head
	// URLOf is a closing issue's url, "" when unknown.
	URLOf func(Ref) string
}

// View is the object as `gh issue|pr view --json` prints it, every field
// (ADR 0010's table); the commands keep those asked.
func View(o Object, shape Shape) map[string]any {
	labels := []any{}
	for _, name := range o.Labels {
		labels = append(labels, map[string]any{"name": name})
	}
	assignees := []any{}
	for _, login := range o.Assignees {
		assignees = append(assignees, map[string]any{"login": login})
	}
	comments := []any{}
	for _, c := range o.Comments {
		comments = append(comments, map[string]any{"author": actorOf(c.Author), "body": c.Body, "createdAt": orNull(c.CreatedAt)})
	}
	var milestone any
	if o.Milestone != 0 {
		m, ok := shape.Milestones[o.Milestone]
		if !ok {
			m = Milestone{Number: o.Milestone}
		}
		milestone = map[string]any{"number": m.Number, "title": m.Title, "description": m.Description, "dueOn": orNull(m.DueOn)}
	}
	blockedBy := []int{}
	for _, b := range o.BlockedBy {
		if strings.EqualFold(b.Repository, o.Repository) {
			blockedBy = append(blockedBy, b.Number)
		}
	}
	var parent any
	if o.Parent != 0 {
		parent = o.Parent
	}
	subIssues := append([]int{}, o.SubIssues...)
	v := map[string]any{
		"number": o.Number, "title": o.Title, "body": o.Body, "state": o.State, "stateReason": o.StateReason, "url": o.URL,
		"labels": labels, "assignees": assignees, "milestone": milestone, "author": actorOf(o.Author), "comments": comments,
		"createdAt": orNull(o.CreatedAt), "updatedAt": orNull(o.UpdatedAt), "closedAt": orNull(o.ClosedAt),
		"blockedBy": blockedBy, "parent": parent, "subIssues": subIssues,
	}
	if o.Pull == nil {
		return v
	}
	p := o.Pull
	var mergeCommit any
	if p.MergeCommit != "" {
		mergeCommit = map[string]any{"oid": p.MergeCommit}
	}
	closing := []any{}
	for _, ref := range p.ClosingIssues {
		owner, name, _ := strings.Cut(ref.Repository, "/")
		url := ""
		if shape.URLOf != nil {
			url = shape.URLOf(ref)
		}
		closing = append(closing, map[string]any{"number": ref.Number, "url": url,
			"repository": map[string]any{"name": name, "owner": map[string]any{"login": owner}}})
	}
	commits := []any{}
	for _, c := range p.Commits {
		headline, body := splitMessage(c.Message)
		commits = append(commits, map[string]any{"oid": c.Oid, "messageHeadline": headline, "messageBody": body})
	}
	reviews := []any{}
	for _, r := range p.Reviews {
		var commit any
		if r.CommitOid != "" {
			commit = map[string]any{"oid": r.CommitOid}
		}
		reviews = append(reviews, map[string]any{"author": actorOf(r.Author), "state": r.State, "body": r.Body,
			"submittedAt": orNull(r.SubmittedAt), "commit": commit})
	}
	rollup := []any{}
	for _, c := range shape.Checks {
		check := map[string]any{"__typename": c.Typename, "name": c.Name, "status": c.Status, "conclusion": c.Conclusion,
			"detailsUrl": orNull(c.DetailsURL)}
		if c.Typename == "StatusContext" {
			// gh's own keys of a commit status, beside the common ones.
			check["context"], check["state"], check["targetUrl"] = c.Name, c.Conclusion, orNull(c.DetailsURL)
		}
		rollup = append(rollup, check)
	}
	for k, value := range map[string]any{
		"headRefName": p.HeadRef, "headRefOid": p.HeadOid, "baseRefName": p.BaseRef, "isDraft": p.IsDraft,
		"mergeable": orDefault(p.Mergeable, "UNKNOWN"), "mergeCommit": mergeCommit, "mergedAt": orNull(p.MergedAt),
		"closingIssuesReferences": closing, "commits": commits, "reviews": reviews, "statusCheckRollup": rollup,
	} {
		v[k] = value
	}
	return v
}

// IssueFields and PullFields are the fields `--json` offers.
var (
	IssueFields = []string{"assignees", "author", "blockedBy", "body", "closedAt", "comments", "createdAt", "labels", "milestone",
		"number", "parent", "state", "stateReason", "subIssues", "title", "updatedAt", "url"}
	PullFields = func() []string {
		fields := append([]string{}, IssueFields...)
		fields = append(fields, "baseRefName", "closingIssuesReferences", "commits", "headRefName", "headRefOid", "isDraft",
			"mergeCommit", "mergeable", "mergedAt", "reviews", "statusCheckRollup")
		sort.Strings(fields)
		return fields
	}()
)

func actorOf(name string) any {
	if name == "" {
		return nil
	}
	return map[string]any{"login": name}
}

func orNull(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func orDefault(s, d string) string {
	if s == "" {
		return d
	}
	return s
}

// splitMessage is GitHub's messageHeadline and messageBody of a commit message.
func splitMessage(message string) (string, string) {
	headline, body, _ := strings.Cut(message, "\n")
	return strings.TrimSpace(headline), strings.Trim(body, "\n")
}

// View reads the issue, or the PR when pull, and gives its gh answer; an
// object of the other kind is not found, as with gh.
func (s *Store) View(key string, number int, pull bool) (map[string]any, error) {
	o, err := s.Object(key, number)
	if err != nil {
		return nil, err
	}
	if o.IsPull != pull { // gh's `pr view` of an issue, `issue view` of a PR
		return nil, fmt.Errorf("%w: %s#%d", ErrNotFound, key, number)
	}
	return s.view(o)
}

func (s *Store) view(o Object) (map[string]any, error) {
	milestones, err := s.Milestones(o.Repository)
	if err != nil {
		return nil, err
	}
	shape := Shape{Milestones: milestones, URLOf: s.urlOf}
	if o.Pull != nil && o.Pull.HeadOid != "" {
		if shape.Checks, err = s.Checks(o.Repository, o.Pull.HeadOid); err != nil {
			return nil, err
		}
	}
	return View(o, shape), nil
}

func (s *Store) urlOf(ref Ref) string {
	var url string
	if err := s.db.QueryRow("SELECT url FROM issues WHERE repository = ? AND number = ?", ref.Repository, ref.Number).Scan(&url); err == nil {
		return url
	}
	if IsLocal(ref.Repository) {
		return ""
	}
	return fmt.Sprintf("https://github.com/%s/issues/%d", ref.Repository, ref.Number)
}

// Filter is a list's flags, as gh's.
type Filter struct {
	Pulls  bool
	State  string   // open, closed, merged, all ("" is open)
	Labels []string // all of them
	Author string
	Head   string // a PR's head branch
	Limit  int    // 0 is 30
}

// Matches says whether the object passes the filter.
func (f Filter) Matches(o Object) bool {
	if o.IsPull != f.Pulls {
		return false
	}
	switch strings.ToLower(f.State) {
	case "", "open":
		if o.State != "OPEN" {
			return false
		}
	case "closed":
		// gh's closed PRs include the merged ones.
		if o.State != "CLOSED" && !(f.Pulls && o.State == "MERGED") {
			return false
		}
	case "merged":
		if o.State != "MERGED" {
			return false
		}
	}
	for _, want := range f.Labels {
		found := false
		for _, l := range o.Labels {
			if strings.EqualFold(l, want) {
				found = true
			}
		}
		if !found {
			return false
		}
	}
	if f.Author != "" && !strings.EqualFold(f.Author, o.Author) {
		return false
	}
	if f.Head != "" && (o.Pull == nil || o.Pull.HeadRef != f.Head) {
		return false
	}
	return true
}

func (f Filter) limit() int {
	if f.Limit <= 0 {
		return 30
	}
	return f.Limit
}

// SortNewest sorts as gh lists: the newest created first; a Local key by
// number, highest first (its dates are its files').
func SortNewest(key string, objects []Object) {
	sort.SliceStable(objects, func(i, j int) bool {
		a, b := objects[i], objects[j]
		if !IsLocal(key) && a.CreatedAt != b.CreatedAt {
			return a.CreatedAt > b.CreatedAt
		}
		return a.Number > b.Number
	})
}

// List is the key's objects passing the filter, newest first, up to its
// limit, as gh's answer.
func (s *Store) List(key string, f Filter) ([]map[string]any, error) {
	objects, err := s.objects(key, "i.is_pull = ?", f.Pulls)
	if err != nil {
		return nil, err
	}
	var kept []Object
	for _, o := range objects {
		if f.Matches(o) {
			kept = append(kept, o)
		}
	}
	SortNewest(key, kept)
	if len(kept) > f.limit() {
		kept = kept[:f.limit()]
	}
	out := []map[string]any{}
	for _, o := range kept {
		v, err := s.view(o)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// Count is the key's issues and PRs in the copy.
func (s *Store) Count(key string) (issues, pulls int, err error) {
	err = s.db.QueryRow("SELECT coalesce(sum(1 - is_pull), 0), coalesce(sum(is_pull), 0) FROM issues WHERE repository = ?", key).Scan(&issues, &pulls)
	if err != nil {
		err = fmt.Errorf("mirror: read the copy: %w", err)
	}
	return issues, pulls, err
}

// Marks are the key's filled and synced marks, as the copy has them.
func (s *Store) Marks(key string) (filled bool, synced string, err error) {
	var f sql.NullString
	var sy sql.NullString
	err = s.db.QueryRow("SELECT filled_at, synced_at FROM projects WHERE repository = ?", key).Scan(&f, &sy)
	if errors.Is(err, sql.ErrNoRows) {
		return false, "", fmt.Errorf("%w: %s", ErrNotAProject, key)
	}
	if err != nil {
		return false, "", fmt.Errorf("mirror: projects: %w", err)
	}
	return f.Valid, sy.String, nil
}
