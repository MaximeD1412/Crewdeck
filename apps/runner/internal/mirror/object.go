package mirror

import (
	"database/sql"
	"fmt"
)

// Object is an issue or a PR with everything the Miroir keeps of it. Enums
// are GitHub's GraphQL ones; dates are GitHub's strings, "" for none.
type Object struct {
	Repository  string
	Number      int
	IsPull      bool
	Title       string
	Body        string
	State       string // OPEN, CLOSED, MERGED
	StateReason string // an issue's: COMPLETED, NOT_PLANNED, REOPENED, DUPLICATE
	URL         string
	Author      string // "" for a deleted account
	Milestone   int    // its number, 0 for none
	CreatedAt   string
	UpdatedAt   string
	ClosedAt    string
	Labels      []string
	Assignees   []string
	Comments    []Comment
	// An issue's parent and sub-issues, in Repository (0 and none otherwise);
	// the issues blocking it, in any repository.
	Parent    int
	SubIssues []int
	BlockedBy []Ref
	// Pull is a PR's own part, nil for an issue.
	Pull *Pull
}

// Ref names an issue or a PR, possibly of another repository.
type Ref struct {
	Repository string
	Number     int
}

// Comment is a comment of an issue or a PR.
type Comment struct {
	ID        string // GitHub's node id
	Author    string
	Body      string
	URL       string
	CreatedAt string
	UpdatedAt string
}

// Pull is what a PR has beyond an issue.
type Pull struct {
	HeadRef        string
	HeadOid        string
	BaseRef        string
	IsDraft        bool
	Mergeable      string // MERGEABLE, CONFLICTING, UNKNOWN
	MergeCommit    string // its oid, "" for none
	MergedAt       string
	ChecksState    string // the rollup's state of HeadOid: SUCCESS, FAILURE, PENDING…, "" for none
	ClosingIssues  []Ref
	Commits        []Commit
	Reviews        []Review
	ReviewComments []ReviewComment
}

// Commit is one of a PR's commits.
type Commit struct {
	Oid     string
	Message string
}

// Review is a PR's review.
type Review struct {
	ID          string
	Author      string
	State       string // APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING
	Body        string
	CommitOid   string
	SubmittedAt string
}

// ReviewComment is a comment of a PR's review thread.
type ReviewComment struct {
	ID        string
	ReviewID  string
	Author    string
	Body      string
	Path      string
	Line      int // 0 for none (an outdated comment)
	CreatedAt string
}

// Check is a check run or a commit status of a commit.
type Check struct {
	Typename    string // CheckRun, StatusContext
	Name        string // a StatusContext's context
	Status      string // a CheckRun's
	Conclusion  string // a StatusContext's state
	DetailsURL  string
	StartedAt   string
	CompletedAt string
}

// Label is a repository's label.
type Label struct {
	Name        string
	Color       string
	Description string
}

// Milestone is a repository's milestone.
type Milestone struct {
	Number      int
	Title       string
	State       string // OPEN, CLOSED
	Description string
	DueOn       string
}

// Release is a repository's release.
type Release struct {
	Tag          string
	Name         string
	Body         string
	IsDraft      bool
	IsPrerelease bool
	CreatedAt    string
	PublishedAt  string
}

// null is SQL's null for GitHub's absent value ("" or 0).
func null[T comparable](v T) any {
	var zero T
	if v == zero {
		return nil
	}
	return v
}

func exec(tx *sql.Tx, statement string, args ...any) error {
	if _, err := tx.Exec(statement, args...); err != nil {
		return fmt.Errorf("mirror: %w", err)
	}
	return nil
}

// PutObject replaces, in tx, every row of the object (an issue or a PR) and
// its search rows with o. Its sub-issues are rewritten from it, and its
// parent's link to it; its blocked-by from it.
func PutObject(tx *sql.Tx, o Object) error {
	if err := deleteOwnRows(tx, o.Repository, o.Number); err != nil {
		return err
	}
	if err := exec(tx, `INSERT INTO issues (repository, number, is_pull, title, body, state, state_reason, url, author, milestone_number, created_at, updated_at, closed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		o.Repository, o.Number, o.IsPull, o.Title, o.Body, o.State, null(o.StateReason), o.URL, null(o.Author), null(o.Milestone),
		null(o.CreatedAt), null(o.UpdatedAt), null(o.ClosedAt)); err != nil {
		return err
	}
	if err := exec(tx, "INSERT INTO search (kind, repository, number, title, content) VALUES ('issue', ?, ?, ?, ?)", o.Repository, o.Number, o.Title, o.Body); err != nil {
		return err
	}
	for _, name := range o.Labels {
		if err := exec(tx, "INSERT OR IGNORE INTO issue_labels (repository, number, name) VALUES (?, ?, ?)", o.Repository, o.Number, name); err != nil {
			return err
		}
	}
	for _, login := range o.Assignees {
		if err := exec(tx, "INSERT OR IGNORE INTO issue_assignees (repository, number, login) VALUES (?, ?, ?)", o.Repository, o.Number, login); err != nil {
			return err
		}
	}
	for _, c := range o.Comments {
		if err := exec(tx, "INSERT OR REPLACE INTO comments (repository, number, id, author, body, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			o.Repository, o.Number, c.ID, null(c.Author), c.Body, c.URL, null(c.CreatedAt), null(c.UpdatedAt)); err != nil {
			return err
		}
		if err := searchComment(tx, o, c.Body); err != nil {
			return err
		}
	}
	for position, child := range o.SubIssues {
		if err := exec(tx, "INSERT OR REPLACE INTO sub_issues (repository, parent, child, position) VALUES (?, ?, ?, ?)", o.Repository, o.Number, child, position); err != nil {
			return err
		}
	}
	// The child's side: its parent, kept with the parent's position when the parent's fetch gave one.
	if err := exec(tx, "DELETE FROM sub_issues WHERE repository = ? AND child = ? AND parent <> ?", o.Repository, o.Number, o.Parent); err != nil {
		return err
	}
	if o.Parent != 0 {
		if err := exec(tx, "INSERT OR IGNORE INTO sub_issues (repository, parent, child) VALUES (?, ?, ?)", o.Repository, o.Parent, o.Number); err != nil {
			return err
		}
	}
	for _, b := range o.BlockedBy {
		if err := exec(tx, "INSERT OR IGNORE INTO blocked_by (repository, number, blocker_repository, blocker_number) VALUES (?, ?, ?, ?)", o.Repository, o.Number, b.Repository, b.Number); err != nil {
			return err
		}
	}
	if o.Pull != nil {
		return putPull(tx, o)
	}
	return nil
}

func putPull(tx *sql.Tx, o Object) error {
	p := o.Pull
	if err := exec(tx, "INSERT INTO pulls (repository, number, head_ref, head_oid, base_ref, is_draft, mergeable, merge_commit_oid, merged_at, checks_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		o.Repository, o.Number, p.HeadRef, p.HeadOid, p.BaseRef, p.IsDraft, null(p.Mergeable), null(p.MergeCommit), null(p.MergedAt), null(p.ChecksState)); err != nil {
		return err
	}
	for position, c := range p.Commits {
		if err := exec(tx, "INSERT INTO pull_commits (repository, number, position, oid, message) VALUES (?, ?, ?, ?, ?)", o.Repository, o.Number, position, c.Oid, c.Message); err != nil {
			return err
		}
	}
	for _, ref := range p.ClosingIssues {
		if err := exec(tx, "INSERT OR IGNORE INTO closing_issues (repository, number, issue_repository, issue_number) VALUES (?, ?, ?, ?)", o.Repository, o.Number, ref.Repository, ref.Number); err != nil {
			return err
		}
	}
	for _, r := range p.Reviews {
		if err := exec(tx, "INSERT OR REPLACE INTO reviews (repository, number, id, author, state, body, commit_oid, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			o.Repository, o.Number, r.ID, null(r.Author), r.State, r.Body, null(r.CommitOid), null(r.SubmittedAt)); err != nil {
			return err
		}
		if r.Body != "" {
			if err := searchComment(tx, o, r.Body); err != nil {
				return err
			}
		}
	}
	for _, c := range p.ReviewComments {
		if err := exec(tx, "INSERT OR REPLACE INTO review_comments (repository, number, id, review_id, author, body, path, line, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			o.Repository, o.Number, c.ID, null(c.ReviewID), null(c.Author), c.Body, c.Path, null(c.Line), null(c.CreatedAt)); err != nil {
			return err
		}
		if err := searchComment(tx, o, c.Body); err != nil {
			return err
		}
	}
	return nil
}

func searchComment(tx *sql.Tx, o Object, body string) error {
	return exec(tx, "INSERT INTO search (kind, repository, number, title, content) VALUES ('comment', ?, ?, ?, ?)", o.Repository, o.Number, o.Title, body)
}

// deleteOwnRows deletes the rows an object's fetch rewrites: its own (by
// cascade), its sub-issues, its blocked-by and its search rows.
func deleteOwnRows(tx *sql.Tx, repository string, number int) error {
	for _, statement := range []string{
		"DELETE FROM issues WHERE repository = ? AND number = ?",
		"DELETE FROM sub_issues WHERE repository = ? AND parent = ?",
		"DELETE FROM blocked_by WHERE repository = ? AND number = ?",
		"DELETE FROM search WHERE repository = ? AND number = ? AND kind IN ('issue', 'comment')",
	} {
		if err := exec(tx, statement, repository, number); err != nil {
			return err
		}
	}
	return nil
}

// DeleteObject removes, in tx, an issue or a PR GitHub no longer has (deleted,
// transferred): its rows, every relation naming it and its search rows.
func DeleteObject(tx *sql.Tx, repository string, number int) error {
	if err := deleteOwnRows(tx, repository, number); err != nil {
		return err
	}
	for _, statement := range []string{
		"DELETE FROM sub_issues WHERE repository = ? AND child = ?",
		"DELETE FROM blocked_by WHERE blocker_repository = ? AND blocker_number = ?",
		"DELETE FROM closing_issues WHERE issue_repository = ? AND issue_number = ?",
	} {
		if err := exec(tx, statement, repository, number); err != nil {
			return err
		}
	}
	return nil
}

// PutChecks replaces, in tx, the checks of the commit sha.
func PutChecks(tx *sql.Tx, repository, sha string, checks []Check) error {
	if err := exec(tx, "DELETE FROM checks WHERE repository = ? AND sha = ?", repository, sha); err != nil {
		return err
	}
	for _, c := range checks {
		if err := exec(tx, "INSERT OR REPLACE INTO checks (repository, sha, typename, name, status, conclusion, details_url, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			repository, sha, c.Typename, c.Name, null(c.Status), null(c.Conclusion), null(c.DetailsURL), null(c.StartedAt), null(c.CompletedAt)); err != nil {
			return err
		}
	}
	return nil
}

// setChecksState records, in tx, the rollup's state of a PR's head last read.
func setChecksState(tx *sql.Tx, repository string, number int, state string) error {
	return exec(tx, "UPDATE pulls SET checks_state = ? WHERE repository = ? AND number = ?", null(state), repository, number)
}

// PutCollections replaces, in tx, the repository's labels, milestones and releases.
func PutCollections(tx *sql.Tx, repository string, labels []Label, milestones []Milestone, releases []Release) error {
	for _, table := range []string{"repo_labels", "milestones", "releases"} {
		if err := exec(tx, "DELETE FROM "+table+" WHERE repository = ?", repository); err != nil {
			return err
		}
	}
	for _, l := range labels {
		if err := exec(tx, "INSERT OR REPLACE INTO repo_labels (repository, name, color, description) VALUES (?, ?, ?, ?)", repository, l.Name, l.Color, null(l.Description)); err != nil {
			return err
		}
	}
	for _, m := range milestones {
		if err := exec(tx, "INSERT OR REPLACE INTO milestones (repository, number, title, state, description, due_on) VALUES (?, ?, ?, ?, ?, ?)",
			repository, m.Number, m.Title, m.State, null(m.Description), null(m.DueOn)); err != nil {
			return err
		}
	}
	for _, r := range releases {
		if err := exec(tx, "INSERT OR REPLACE INTO releases (repository, tag, name, body, is_draft, is_prerelease, created_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			repository, r.Tag, null(r.Name), null(r.Body), r.IsDraft, r.IsPrerelease, null(r.CreatedAt), null(r.PublishedAt)); err != nil {
			return err
		}
	}
	return nil
}
