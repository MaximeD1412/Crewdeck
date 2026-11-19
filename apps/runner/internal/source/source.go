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
	Author         string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	ClosedAt       *time.Time
	MergedAt       *time.Time
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
	// Parent is the parent Ticket's number; 0 removes it.
	Parent *int
}

// Writer writes a Projet's Tickets and their comments.
type Writer interface {
	CreateTicket(ctx context.Context, ticket NewTicket) (Ticket, error)
	EditTicket(ctx context.Context, number int, edit TicketEdit) (Ticket, error)
	SetTicketState(ctx context.Context, number int, state TicketState, reason StateReason) (Ticket, error)
	Comment(ctx context.Context, number int, author, body, sessionID string) (Comment, error)
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

// Copier copies a Projet's Tickets from one Source to another (SOURCE-8).
type Copier interface {
	Copy(ctx context.Context, to Writer) error
}
