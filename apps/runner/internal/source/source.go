// Package source is what the Runner reads and writes of a Projet's Source
// (ADR 0012), in neutral values: one package per Source under it
// (`local/` here, GitHub's later), behind the interfaces below, used by the
// Miroir (MIROIR-6 makes gh's shapes from these values, MIROIR-7 writes
// through them) and by the migration (SOURCE-8). Nothing of a value (a
// title, a body) is ever in a log or an error.
package source

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// TicketState is a Ticket's state, as gh says it lower case.
type TicketState string

const (
	TicketOpen   TicketState = "open"
	TicketClosed TicketState = "closed"
)

// StateReason is why a closed Ticket is closed; "" for an open one.
type StateReason string

const (
	ReasonNone       StateReason = ""
	ReasonCompleted  StateReason = "completed"
	ReasonNotPlanned StateReason = "not_planned"
)

// Milestone is a jalon: Number is its rank (from 1) for a Local Projet.
type Milestone struct {
	Number int
	Title  string
	DueOn  *time.Time
}

// Ticket is an issue of GitHub, a file of `tickets/` for Local.
type Ticket struct {
	Number      int
	Title       string
	Body        string
	State       TicketState
	StateReason StateReason
	Ready       bool
	Labels      []string
	Milestone   *Milestone
	BlockedBy   []int
	Parent      *int
	CreatedAt   time.Time
	UpdatedAt   time.Time
	ClosedAt    *time.Time
	// URL is where the Ticket is: its issue's page, its file's file:// URL.
	URL string
}

// Comment is a Ticket's comment.
type Comment struct {
	ID        string
	Author    string
	Body      string
	CreatedAt time.Time
}

// ChangeState is a change's state (a pull request's on GitHub).
type ChangeState string

const (
	ChangeOpen   ChangeState = "open"
	ChangeClosed ChangeState = "closed"
	ChangeMerged ChangeState = "merged"
)

// Change is a change of code: a pull request on GitHub, a row of local.db
// for Local (MIROIR-7 and SOURCE-5 write them).
type Change struct {
	Number         int
	Title          string
	Body           string
	HeadRef        string
	HeadOid        string
	BaseRef        string
	State          ChangeState
	IsDraft        bool
	MergeCommitOid string
	// Mergeable is MERGEABLE, CONFLICTING, or "" while unknown (a local
	// change: computed as it follows its branch).
	Mergeable string
	Author    string
	CreatedAt time.Time
	UpdatedAt time.Time
	ClosedAt  *time.Time
	MergedAt  *time.Time
	Labels    []string
	// URL is the PR's page on GitHub, "" for a local change.
	URL string
}

// ReviewState is a review's verdict.
type ReviewState string

const (
	ReviewApproved         ReviewState = "APPROVED"
	ReviewChangesRequested ReviewState = "CHANGES_REQUESTED"
	ReviewCommented        ReviewState = "COMMENTED"
)

// ReviewComment is a remark of a review on a line of a file.
type ReviewComment struct {
	ID        string
	Path      string
	Line      int
	Body      string
	CreatedAt time.Time
}

// Review is a change's review.
type Review struct {
	ID          string
	Author      string
	State       ReviewState
	Body        string
	CommitOid   string
	SubmittedAt time.Time
	Comments    []ReviewComment
}

// Check is a check of a commit: GitHub's check runs; for Local, the Checks'
// Commandes once BOUCLE-9 records them.
type Check struct {
	Name       string
	Status     string
	Conclusion string
}

// Commit is a commit of a change.
type Commit struct {
	Oid     string
	Message string // the whole message: its headline, a blank line, its body
}

// History is a change's branch as it is now: its head and its commits from
// its base, oldest first.
type History struct {
	HeadOid string
	Commits []Commit
}

// ErrNotFound: no Ticket, or no change, of that number.
var ErrNotFound = errors.New("source: not found")

// ErrUnknownMilestone: a milestone title the Source does not have.
var ErrUnknownMilestone = errors.New("source: unknown milestone")

// Reader reads a Projet's Source.
type Reader interface {
	Tickets(ctx context.Context) ([]Ticket, error)
	Ticket(ctx context.Context, number int) (Ticket, error)
	Comments(ctx context.Context, number int) ([]Comment, error)
	Milestones(ctx context.Context) ([]Milestone, error)
	Changes(ctx context.Context) ([]Change, error)
	Change(ctx context.Context, number int) (Change, error)
	Reviews(ctx context.Context, number int) ([]Review, error)
	Checks(ctx context.Context, sha string) ([]Check, error)
	// History is the change's branch now (MIROIR-6's headRefOid and commits).
	History(ctx context.Context, number int) (History, error)
}

// Available says whether a Source can be read now: an error wrapping
// os.ErrNotExist when a Local Projet's folder is gone (PROJET-6), whatever
// group is read, before any read that would answer from elsewhere.
type Available interface {
	Available(ctx context.Context) error
}

// AsIs reads a Source's Tickets and milestones as they are, writing nothing
// of its own (a Local Projet's local.db and files untouched): what a
// rebuild of the Miroir reads (ADR 0012). A Ticket file not numbered yet is
// left out until a read that numbers it.
type AsIs interface {
	TicketsAsIs(ctx context.Context) ([]Ticket, []Milestone, error)
}

// ErrNoAssignees: an assignee asked of a Source that has none (Local).
var ErrNoAssignees = errors.New("source: no assignees")

// ErrNoChangeMilestone: a milestone asked of a local change.
var ErrNoChangeMilestone = errors.New("source: no milestone on a local change")

// ErrMerged: a change already merged, which can be neither closed nor reopened.
var ErrMerged = errors.New("source: the change is merged")

// BranchMissingError: a change's branch the Local Projet's folder does not
// have (not pushed yet).
type BranchMissingError struct{ Branch string }

func (e *BranchMissingError) Error() string { return "source: the branch is not in the folder" }

// ChangeOpenError: a change already open for that branch.
type ChangeOpenError struct {
	Branch string
	Number int
}

func (e *ChangeOpenError) Error() string {
	return fmt.Sprintf("source: change #%d is open for the branch", e.Number)
}

// NewTicket is a Ticket to create.
type NewTicket struct {
	Title     string
	Body      string
	Labels    []string
	Ready     bool
	Milestone string
	BlockedBy []int
	Parent    *int
	Assignees []string
}

// TicketEdit is what an edit changes: a nil field is left as it is.
type TicketEdit struct {
	Title        *string
	Body         *string
	AddLabels    []string
	RemoveLabels []string
	Ready        *bool
	// Milestone is a milestone's title; "" removes the Ticket's.
	Milestone *string
	BlockedBy *[]int
	// AddBlockedBy and RemoveBlockedBy change the blockers one by one.
	AddBlockedBy    []int
	RemoveBlockedBy []int
	// Parent is the parent Ticket's number; 0 removes it.
	Parent          *int
	AddAssignees    []string
	RemoveAssignees []string
}

// Writer writes a Projet's Tickets and their comments.
type Writer interface {
	CreateTicket(ctx context.Context, ticket NewTicket) (Ticket, error)
	EditTicket(ctx context.Context, number int, edit TicketEdit) (Ticket, error)
	SetTicketState(ctx context.Context, number int, state TicketState, reason StateReason) (Ticket, error)
	Comment(ctx context.Context, number int, author, body, sessionID string) (Comment, error)
}

// NewChange is a change of code to propose: its branch Head for Base.
type NewChange struct {
	Title     string
	Body      string
	Head      string
	Base      string
	Draft     bool
	Labels    []string
	Assignees []string
	Milestone string
	// Author is who writes it on Local (the Session's Rôle), SessionID its Session.
	Author    string
	SessionID string
}

// ChangeEdit is what an edit of a change changes: a nil field is left as it is.
type ChangeEdit struct {
	Title           *string
	Body            *string
	Base            *string
	AddLabels       []string
	RemoveLabels    []string
	AddAssignees    []string
	RemoveAssignees []string
	// Milestone is a milestone's title; "" removes the change's.
	Milestone *string
}

// NewReview is a review to post on a change, at its head.
type NewReview struct {
	State     ReviewState
	Body      string
	Author    string
	SessionID string
}

// ChangeWriter writes a Projet's changes of code (MIROIR-7).
type ChangeWriter interface {
	CreateChange(ctx context.Context, change NewChange) (Change, error)
	EditChange(ctx context.Context, number int, edit ChangeEdit) (Change, error)
	// SetChangeState closes (deleteBranch: its branch deleted too) or reopens the change.
	SetChangeState(ctx context.Context, number int, state ChangeState, deleteBranch bool) (Change, error)
	Review(ctx context.Context, number int, review NewReview) (Review, error)
	CommentChange(ctx context.Context, number int, author, body, sessionID string) (Comment, error)
}

// ChangeKind is what a Watcher's change is about.
type ChangeKind string

const (
	KindTicket    ChangeKind = "ticket"
	KindChange    ChangeKind = "change"
	KindMilestone ChangeKind = "milestone"
)

// Changed says that something of a Projet's Source changed, never what:
// SOURCE-3 reports it to the server.
type Changed struct {
	ProjectID string
	Kind      ChangeKind
	// Number is the Ticket's or the change's; 0 for a milestone.
	Number int
}

// Watcher follows a Source and says what changed (SOURCE-3).
type Watcher interface {
	OnChange(func(Changed))
}

// CopiedComment is a Ticket's comment as a migration reads it: From is the
// origin marker it carries (`local#12/comment/<id>`), "" when no migration
// wrote it.
type CopiedComment struct {
	Comment
	From string
}

// CopiedTicket is a Ticket as a migration reads it whole (SOURCE-8): its
// comments in order, and From, the origin marker it carries (`local#12`,
// `github#57`), "" when no migration wrote it. Its Body is without the
// marker; on GitHub, ID is the issue's database id.
type CopiedTicket struct {
	Ticket
	ID       int64
	From     string
	Comments []CopiedComment
}

// ErrUnreadable: a Ticket's file, or milestones.yml, that does not parse; a
// migration never skips it (`local.unreadable`).
var ErrUnreadable = errors.New("source: a Ticket's file does not parse")

// Copier is a Projet's Tickets on one Source as a migration of Source reads
// and writes them whole (SOURCE-8, ADR 0012): implemented for Local
// (`local/`) and for GitHub (`github/`). The migration's copy, its passes of
// verification and its late changes are written once, over two Copiers;
// the origin markers are its idempotency.
type Copier interface {
	// Kind is the Source's name in the markers: "local" or "github".
	Kind() string
	// ReadAll is every Ticket with its comments, and the milestones.
	ReadAll(ctx context.Context) ([]CopiedTicket, []Milestone, error)
	// PutMilestone adds the milestone when number is 0 (its number given),
	// else sets number's title and due date to m's (no due date for nil).
	PutMilestone(ctx context.Context, number int, m Milestone) (int, error)
	// PutTicket writes t as the copy of from: a new Ticket when number is 0
	// (its number given), else number's title, body, labels, ready,
	// milestone (t.Milestone's Number on this Source, nil for none), state
	// and reason. Its parent and blockers are Link's.
	PutTicket(ctx context.Context, number int, t Ticket, from string) (int, error)
	// AddComment adds c, by its author and at its date, as the copy of from.
	AddComment(ctx context.Context, number int, c Comment, from string) error
	// Link sets the Ticket's parent (0 for none) and blockers, was being it as last read.
	Link(ctx context.Context, was CopiedTicket, parent int, blockedBy []int) error
	// Freeze archives the place once its Tickets moved: nothing writes there again.
	Freeze(ctx context.Context) error
}
