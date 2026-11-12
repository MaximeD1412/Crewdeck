package mirror

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ErrNotAProject is a repository that is not one of the copy's Projets.
var ErrNotAProject = errors.New("mirror: not a Projet of the copy")

// Mirror fills the copy from GitHub: one object at a time (Refresh), or a
// Projet's whole reconciliation (Reconcile). Its log names a repository, a
// number, a kind and a duration, never a title nor a body (SEC-10).
type Mirror struct {
	Store  *Store
	GitHub *Client
	Logger *slog.Logger
	// Now is time.Now unless a test fixes it.
	Now func() time.Time
}

func (m *Mirror) now() time.Time {
	if m.Now != nil {
		return m.Now()
	}
	return time.Now()
}

func (m *Mirror) logger() *slog.Logger {
	if m.Logger != nil {
		return m.Logger
	}
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// Refresh fetches the issue or PR `number` and replaces it in the copy, or
// deletes it from the copy when GitHub no longer has it (gone).
func (m *Mirror) Refresh(ctx context.Context, repository string, number int) (gone bool, err error) {
	started := m.now()
	o, err := m.GitHub.FetchObject(ctx, repository, number)
	kind := "issue"
	switch {
	case errors.Is(err, ErrGone):
		gone, kind = true, "gone"
		err = m.Store.Update(func(tx *sql.Tx) error { return DeleteObject(tx, repository, number) })
	case err != nil:
		return false, err
	default:
		if o.IsPull {
			kind = "pull"
		}
		err = m.Store.Update(func(tx *sql.Tx) error { return PutObject(tx, o) })
	}
	if err != nil {
		return false, err
	}
	m.logger().Debug("mirror object", "repository", repository, "number", number, "kind", kind, "duration_ms", m.now().Sub(started).Milliseconds())
	return gone, nil
}

// refreshChecks fetches the checks of a PR's head and records, with them, the
// rollup's state the walk saw: the next walk reads them again only when it
// changes, or when this read did not finish.
func (m *Mirror) refreshChecks(ctx context.Context, repository string, number int, sha, state string) error {
	started := m.now()
	checks, err := m.GitHub.FetchChecks(ctx, repository, sha)
	if errors.Is(err, ErrGone) {
		checks, err = nil, nil
	}
	if err != nil {
		return err
	}
	if err := m.Store.Update(func(tx *sql.Tx) error { return PutChecks(tx, repository, sha, state, checks) }); err != nil {
		return err
	}
	m.logger().Debug("mirror checks", "repository", repository, "number", number, "sha", sha, "count", len(checks), "duration_ms", m.now().Sub(started).Milliseconds())
	return nil
}

// Result is what a reconciliation did.
type Result struct {
	Listed  int  // the issues and PRs GitHub listed
	Fetched int  // the objects fetched, absent from the copy or changed
	Checks  int  // the open PRs whose checks were fetched
	Deleted int  // the objects GitHub no longer lists
	Filled  bool // the reconciliation was the Projet's first complete one
}

const issuesWalkQuery = "query MirrorIssues($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) { " +
	"issues(first: 100, after: $after, states: [OPEN, CLOSED], orderBy: {field: UPDATED_AT, direction: DESC}) { " + pageInfo +
	" nodes { number updatedAt state blockedBy(first: 100) { nodes { " + refSelection + " } } } } } }"

const pullsWalkQuery = "query MirrorPulls($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) { " +
	"pullRequests(first: 100, after: $after, states: [OPEN, CLOSED, MERGED], orderBy: {field: UPDATED_AT, direction: DESC}) { " + pageInfo +
	" nodes { number updatedAt state headRefOid statusCheckRollup { state } } } } }"

// listed is an object as the walk lists it: its light fields.
type listed struct {
	Number    int    `json:"number"`
	UpdatedAt string `json:"updatedAt"`
	State     string `json:"state"`
	BlockedBy struct {
		Nodes []refNode `json:"nodes"`
	} `json:"blockedBy"`
	HeadRefOid        string `json:"headRefOid"`
	StatusCheckRollup *struct {
		State string `json:"state"`
	} `json:"statusCheckRollup"`
}

// copied is an object as the copy has it, in the walk's terms.
type copied struct {
	updatedAt  string
	headOid    string
	checksRead bool   // the checks of headOid were read…
	readState  string // …when its rollup's state was this
	blockedBy  string
}

func blockerKey(repository string, number int) string {
	return strings.ToLower(repository) + "#" + strconv.Itoa(number)
}

func blockersOf(refs []refNode) string {
	keys := make([]string, 0, len(refs))
	for _, r := range refs {
		keys = append(keys, blockerKey(r.Repository.NameWithOwner, r.Number))
	}
	sort.Strings(keys)
	return strings.Join(keys, ",")
}

// Reconcile brings the Projet's copy back to GitHub: it walks every issue and
// PR by pages with their light fields, fetches each object absent from the
// copy or whose light fields differ, the checks of an open PR whose head or
// rollup changed, deletes the copy's objects GitHub no longer lists, and
// rereads the labels, milestones and releases. On an empty copy the same walk
// fills it, and the Projet is marked filled once it finished.
func (m *Mirror) Reconcile(ctx context.Context, repository string) (Result, error) {
	started := m.now()
	filled, err := m.Store.filledAt(repository)
	if err != nil {
		return Result{}, err
	}
	owner, name, err := splitRepository(repository)
	if err != nil {
		return Result{}, err
	}
	variables := map[string]any{"owner": owner, "name": name}
	issues, err := pages[listed](ctx, m.GitHub, repository, "MirrorIssues", issuesWalkQuery, variables, []string{"repository", "issues"}, "")
	if err != nil {
		return Result{}, err
	}
	pulls, err := pages[listed](ctx, m.GitHub, repository, "MirrorPulls", pullsWalkQuery, variables, []string{"repository", "pullRequests"}, "")
	if err != nil {
		return Result{}, err
	}
	local, err := m.Store.copied(repository)
	if err != nil {
		return Result{}, err
	}

	result := Result{Listed: len(issues) + len(pulls)}
	seen := map[int]bool{}
	for _, l := range issues {
		seen[l.Number] = true
		c, ok := local[l.Number]
		if ok && c.updatedAt == l.UpdatedAt && (l.State != "OPEN" || c.blockedBy == blockersOf(l.BlockedBy.Nodes)) {
			continue
		}
		if _, err := m.Refresh(ctx, repository, l.Number); err != nil {
			return result, err
		}
		result.Fetched++
	}
	for _, l := range pulls {
		seen[l.Number] = true
		c, ok := local[l.Number]
		open := l.State == "OPEN"
		if !ok || c.updatedAt != l.UpdatedAt || (open && c.headOid != l.HeadRefOid) {
			gone, err := m.Refresh(ctx, repository, l.Number)
			if err != nil {
				return result, err
			}
			result.Fetched++
			if gone {
				continue
			}
		}
		rollup := ""
		if l.StatusCheckRollup != nil {
			rollup = l.StatusCheckRollup.State
		}
		if open && (!ok || c.headOid != l.HeadRefOid || !c.checksRead || c.readState != rollup) {
			if err := m.refreshChecks(ctx, repository, l.Number, l.HeadRefOid, rollup); err != nil {
				return result, err
			}
			result.Checks++
		}
	}
	var absent []int
	for number := range local {
		if !seen[number] {
			absent = append(absent, number)
		}
	}
	sort.Ints(absent)
	if len(absent) > 0 {
		if err := m.Store.Update(func(tx *sql.Tx) error {
			for _, number := range absent {
				if err := DeleteObject(tx, repository, number); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			return result, err
		}
		result.Deleted = len(absent)
	}

	collections, err := m.GitHub.FetchCollections(ctx, repository)
	if err != nil {
		return result, err
	}
	if err := m.Store.Update(func(tx *sql.Tx) error {
		return PutCollections(tx, repository, collections.Labels, collections.Milestones, collections.Releases)
	}); err != nil {
		return result, err
	}
	at := m.now()
	if !filled {
		if err := m.Store.MarkFilled(repository, at); err != nil {
			return result, err
		}
		result.Filled = true
	}
	if err := m.Store.MarkSynced(repository, at); err != nil {
		return result, err
	}
	m.logger().Info("mirror reconcile", "repository", repository, "listed", result.Listed, "fetched", result.Fetched, "checks", result.Checks,
		"deleted", result.Deleted, "filled", result.Filled, "duration_ms", m.now().Sub(started).Milliseconds())
	return result, nil
}

// filledAt says whether the Projet's copy was filled; ErrNotAProject when the
// repository is not a Projet.
func (s *Store) filledAt(repository string) (bool, error) {
	var filled sql.NullString
	err := s.db.QueryRow("SELECT filled_at FROM projects WHERE repository = ?", repository).Scan(&filled)
	if errors.Is(err, sql.ErrNoRows) {
		return false, fmt.Errorf("%w: %s", ErrNotAProject, repository)
	}
	if err != nil {
		return false, fmt.Errorf("mirror: projects: %w", err)
	}
	return filled.Valid, nil
}

// copied is the repository's objects as the copy has them, by number.
func (s *Store) copied(repository string) (map[int]copied, error) {
	rows, err := s.db.Query(`SELECT i.number, coalesce(i.updated_at, ''), coalesce(p.head_oid, ''), r.sha IS NOT NULL, coalesce(r.state, '')
		FROM issues i LEFT JOIN pulls p ON p.repository = i.repository AND p.number = i.number
		LEFT JOIN checks_read r ON r.repository = p.repository AND r.sha = p.head_oid
		WHERE i.repository = ?`, repository)
	if err != nil {
		return nil, fmt.Errorf("mirror: read the copy: %w", err)
	}
	out := map[int]copied{}
	for rows.Next() {
		var number int
		var c copied
		if err := rows.Scan(&number, &c.updatedAt, &c.headOid, &c.checksRead, &c.readState); err != nil {
			rows.Close()
			return nil, err
		}
		out[number] = c
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	blockers, err := s.db.Query("SELECT number, blocker_repository, blocker_number FROM blocked_by WHERE repository = ?", repository)
	if err != nil {
		return nil, fmt.Errorf("mirror: read the copy: %w", err)
	}
	defer blockers.Close()
	keys := map[int][]string{}
	for blockers.Next() {
		var number, blocker int
		var repo string
		if err := blockers.Scan(&number, &repo, &blocker); err != nil {
			return nil, err
		}
		keys[number] = append(keys[number], blockerKey(repo, blocker))
	}
	for number, list := range keys {
		if c, ok := out[number]; ok {
			sort.Strings(list)
			c.blockedBy = strings.Join(list, ",")
			out[number] = c
		}
	}
	return out, blockers.Err()
}
