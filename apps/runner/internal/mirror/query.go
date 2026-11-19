package mirror

import (
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// ReadyIssue is one line of `miroir ready`, the shape of pick-issue's
// ready-issues.sh (without its Project fields and week).
type ReadyIssue struct {
	Number    int      `json:"number"`
	Title     string   `json:"title"`
	Labels    []string `json:"labels"`
	Assignees []string `json:"assignees"`
	Milestone *string  `json:"milestone"`
	Due       *string  `json:"due"`
	Priority  *string  `json:"priority"`
	Size      *string  `json:"size"`
	// A blocker of the same key is its number, another's `<key>#<n>`.
	BlockedBy    []any `json:"blockedBy"`
	OpenBlockers []any `json:"openBlockers"`
	Available    bool  `json:"available"`

	milestoneNumber int
}

// ReadyOptions are `ready`'s flags.
type ReadyOptions struct {
	All     bool  // the unavailable ones too, after the available ones
	Numbers []int // only these
}

var (
	priorityLabel = regexp.MustCompile(`(?i)^(?:priority[:/ -]?)?(p[0-9])$`)
	sizeLabel     = regexp.MustCompile(`(?i)^size[:/ -]?(xs|s|m|l|xl)$`)
	sizeRank      = map[string]int{"XS": 0, "S": 1, "M": 2, "L": 3, "XL": 4}
)

// Ready is `ready` on the Projet's Tickets under ticketKey, its PRs under
// codeKey: the open issues labelled ready-for-agent, an issue available
// when none of its blockers is open in the copy and no open PR of codeKey
// closes it nor is on a branch <feat|fix|chore>/<n>-… (BOUCLE-1's rule).
func (s *Store) Ready(ticketKey, codeKey string, opts ReadyOptions) ([]ReadyIssue, error) {
	issues, err := s.objects(ticketKey, "i.is_pull = 0 AND i.state = 'OPEN'")
	if err != nil {
		return nil, err
	}
	milestones, err := s.Milestones(ticketKey)
	if err != nil {
		return nil, err
	}
	pulls, err := s.objects(codeKey, "i.is_pull = 1 AND i.state = 'OPEN'")
	if err != nil {
		return nil, err
	}
	taken := map[int]bool{}
	branch := regexp.MustCompile(`^(?:feat|fix|chore)/([0-9]+)-`)
	for _, p := range pulls {
		for _, ref := range p.Pull.ClosingIssues {
			if strings.EqualFold(ref.Repository, ticketKey) {
				taken[ref.Number] = true
			}
		}
		if m := branch.FindStringSubmatch(p.Pull.HeadRef); m != nil {
			n, _ := strconv.Atoi(m[1])
			taken[n] = true
		}
	}
	only := map[int]bool{}
	for _, n := range opts.Numbers {
		only[n] = true
	}
	out := []ReadyIssue{}
	for _, o := range issues {
		if len(only) > 0 && !only[o.Number] {
			continue
		}
		if !hasLabel(o.Labels, ReadyLabel) {
			continue
		}
		r := ReadyIssue{Number: o.Number, Title: o.Title, Labels: nonNil(o.Labels), Assignees: nonNil(o.Assignees),
			BlockedBy: []any{}, OpenBlockers: []any{}}
		if m, ok := milestones[o.Milestone]; ok && o.Milestone != 0 {
			title := m.Title
			r.Milestone, r.milestoneNumber = &title, m.Number
			if m.DueOn != "" {
				due := m.DueOn
				r.Due = &due
			}
		}
		for _, l := range o.Labels {
			if m := priorityLabel.FindStringSubmatch(l); m != nil && r.Priority == nil {
				p := strings.ToUpper(m[1])
				r.Priority = &p
			}
			if m := sizeLabel.FindStringSubmatch(l); m != nil && r.Size == nil {
				size := strings.ToUpper(m[1])
				r.Size = &size
			}
		}
		for _, b := range o.BlockedBy {
			var ref any = b.Number
			if !strings.EqualFold(b.Repository, ticketKey) {
				ref = fmt.Sprintf("%s#%d", b.Repository, b.Number)
			}
			r.BlockedBy = append(r.BlockedBy, ref)
			open, err := s.isOpen(b)
			if err != nil {
				return nil, err
			}
			if open {
				r.OpenBlockers = append(r.OpenBlockers, ref)
			}
		}
		r.Available = len(r.OpenBlockers) == 0 && !taken[o.Number]
		if r.Available || opts.All {
			out = append(out, r)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return readyLess(out[i], out[j]) })
	return out, nil
}

func readyLess(a, b ReadyIssue) bool {
	if a.Available != b.Available {
		return a.Available
	}
	if da, db := orLast(a.Due, "9999"), orLast(b.Due, "9999"); da != db {
		return da < db
	}
	if ma, mb := milestoneRank(a), milestoneRank(b); ma != mb {
		return ma < mb
	}
	if pa, pb := priorityRank(a.Priority), priorityRank(b.Priority); pa != pb {
		return pa < pb
	}
	if sa, sb := rankOf(a.Size), rankOf(b.Size); sa != sb {
		return sa < sb
	}
	return a.Number < b.Number
}

func orLast(s *string, last string) string {
	if s == nil {
		return last
	}
	return *s
}

func milestoneRank(r ReadyIssue) int {
	if r.Milestone == nil {
		return 1 << 30
	}
	return r.milestoneNumber
}

func priorityRank(p *string) int {
	if p == nil {
		return 99
	}
	n, err := strconv.Atoi((*p)[1:])
	if err != nil {
		return 98
	}
	return n
}

func rankOf(size *string) int {
	if size == nil {
		return 99
	}
	return sizeRank[*size]
}

func hasLabel(labels []string, name string) bool {
	for _, l := range labels {
		if strings.EqualFold(l, name) {
			return true
		}
	}
	return false
}

func nonNil(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

// isOpen: the copy has the issue or PR, open.
func (s *Store) isOpen(ref Ref) (bool, error) {
	var state string
	err := s.db.QueryRow("SELECT state FROM issues WHERE repository = ? COLLATE NOCASE AND number = ?", ref.Repository, ref.Number).Scan(&state)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("mirror: read the copy: %w", err)
	}
	return state == "OPEN", nil
}

// SearchRow is one row of `miroir search`.
type SearchRow struct {
	Kind       string  `json:"kind"`
	Repository string  `json:"repository"`
	Number     *int    `json:"number"`
	Path       *string `json:"path"`
	Title      string  `json:"title"`
	Snippet    string  `json:"snippet"`
}

// SearchKinds are the kinds `--kind` takes.
var SearchKinds = []string{"issue", "comment", "doc"}

// ErrBadQuery: a search text without a word, or an SQL statement that is
// not one SELECT.
var ErrBadQuery = errors.New("mirror: bad query")

// Search is FTS5 on the copy's search table: each word of text a quoted
// term, all required; under keys (none: every key), of kind ("": all).
func (s *Store) Search(text, kind string, keys []string, limit int) ([]SearchRow, error) {
	var terms []string
	for _, word := range strings.Fields(text) {
		terms = append(terms, `"`+strings.ReplaceAll(word, `"`, `""`)+`"`)
	}
	if len(terms) == 0 {
		return nil, fmt.Errorf("%w: no word to search", ErrBadQuery)
	}
	if limit <= 0 {
		limit = 20
	}
	query := `SELECT kind, repository, number, path, title, snippet(search, -1, '[', ']', '…', 10) FROM search WHERE search MATCH ?`
	args := []any{strings.Join(terms, " ")}
	if kind != "" {
		query += " AND kind = ?"
		args = append(args, kind)
	}
	if len(keys) > 0 {
		query += " AND repository IN (" + strings.TrimSuffix(strings.Repeat("?,", len(keys)), ",") + ")"
		for _, k := range keys {
			args = append(args, k)
		}
	}
	query += " ORDER BY rank LIMIT ?"
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("mirror: search: %w", err)
	}
	defer rows.Close()
	out := []SearchRow{}
	for rows.Next() {
		var r SearchRow
		var number sql.NullInt64
		var path sql.NullString
		if err := rows.Scan(&r.Kind, &r.Repository, &number, &path, &r.Title, &r.Snippet); err != nil {
			return nil, err
		}
		if number.Valid {
			n := int(number.Int64)
			r.Number = &n
		}
		if path.Valid {
			r.Path = &path.String
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

var selectStatement = regexp.MustCompile(`(?is)^\s*(select|with)\b`)

// Query runs one SELECT or WITH statement; each row an object keyed by
// column. The store is meant to be OpenReadOnly: a statement that writes
// fails there too.
func (s *Store) Query(statement string) ([]map[string]any, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(statement), "; \t\n")
	if !selectStatement.MatchString(trimmed) || strings.Contains(trimmed, ";") {
		return nil, fmt.Errorf("%w: only one SELECT or WITH statement", ErrBadQuery)
	}
	rows, err := s.db.Query(trimmed)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBadQuery, err)
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		row := map[string]any{}
		for i, c := range columns {
			if b, ok := values[i].([]byte); ok {
				values[i] = string(b)
			}
			row[c] = values[i]
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrBadQuery, err)
	}
	return out, nil
}
