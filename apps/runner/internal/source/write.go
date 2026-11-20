package source

import (
	"context"
	"errors"
	"slices"
)

// The agents' writes, one for every Source (MIROIR-7, ADR 0012): the
// command line of `crewdeck-runner miroir` becomes a WriteOp and its
// WriteFields; Apply turns them into the calls of the Source's writers, so
// a GitHub key and a Local one do the same thing for the same flags.

// OpWrite is runner.sock's op of a Local key's write: the running Runner
// alone writes the folder's Tickets and local.db.
const OpWrite = "source.write"

// WriteOp is a write of the Miroir.
type WriteOp string

const (
	IssueCreate  WriteOp = "issue.create"
	IssueEdit    WriteOp = "issue.edit"
	IssueComment WriteOp = "issue.comment"
	IssueClose   WriteOp = "issue.close"
	IssueReopen  WriteOp = "issue.reopen"
	PrCreate     WriteOp = "pr.create"
	PrEdit       WriteOp = "pr.edit"
	PrComment    WriteOp = "pr.comment"
	PrReview     WriteOp = "pr.review"
	PrClose      WriteOp = "pr.close"
	PrReopen     WriteOp = "pr.reopen"
)

// ReadyLabel is the label a Ticket's `ready` is shown as, and written with.
const ReadyLabel = "ready-for-agent"

// WriteFields are a write's flags; a field the command line does not give
// stays at its zero value.
type WriteFields struct {
	Title *string `json:"title,omitempty"`
	Body  *string `json:"body,omitempty"`
	// Labels, Assignees, Milestone (a title), BlockedBy and Parent of a create.
	Labels    []string `json:"labels,omitempty"`
	Assignees []string `json:"assignees,omitempty"`
	// Milestone is a title; "" in an edit removes it.
	Milestone       *string  `json:"milestone,omitempty"`
	BlockedBy       []int    `json:"blockedBy,omitempty"`
	AddLabels       []string `json:"addLabels,omitempty"`
	RemoveLabels    []string `json:"removeLabels,omitempty"`
	AddAssignees    []string `json:"addAssignees,omitempty"`
	RemoveAssignees []string `json:"removeAssignees,omitempty"`
	AddBlockedBy    []int    `json:"addBlockedBy,omitempty"`
	RemoveBlockedBy []int    `json:"removeBlockedBy,omitempty"`
	// Parent is the parent Ticket's number; 0 in an edit removes it.
	Parent *int `json:"parent,omitempty"`
	// Reason of a close: completed or not_planned.
	Reason StateReason `json:"reason,omitempty"`
	// Comment is written before a close or a reopen.
	Comment string `json:"comment,omitempty"`
	Head    string `json:"head,omitempty"`
	// Base of a create; of an edit, when given.
	Base         *string     `json:"base,omitempty"`
	Draft        bool        `json:"draft,omitempty"`
	Review       ReviewState `json:"review,omitempty"`
	DeleteBranch bool        `json:"deleteBranch,omitempty"`
}

// WriteRequest is OpWrite's request.
type WriteRequest struct {
	Key string `json:"key"`
	// Op is named write: the socket's envelope owns "op".
	Op        WriteOp     `json:"write"`
	Number    int         `json:"number,omitempty"`
	Fields    WriteFields `json:"fields"`
	SessionID string      `json:"sessionId"`
}

// WriteReply is OpWrite's reply: the number written (the new one of a create).
type WriteReply struct {
	Number int `json:"number"`
	// URL is a create's, as its Source answered it; "" when it has none.
	URL string `json:"url,omitempty"`
}

// Target is what a Source writes.
type Target interface {
	Writer
	ChangeWriter
}

// ErrUnknownOp: a WriteOp Apply does not know.
var ErrUnknownOp = errors.New("source: unknown write")

// Apply does op on number (none for a create) with fields, written by
// author for the Session sessionID; it returns the number written, and a
// create's URL.
func Apply(ctx context.Context, t Target, op WriteOp, number int, f WriteFields, author, sessionID string) (WriteReply, error) {
	switch op {
	case IssueCreate:
		ticket := NewTicket{Title: value(f.Title), Body: value(f.Body), Milestone: value(f.Milestone), BlockedBy: f.BlockedBy,
			Parent: f.Parent, Assignees: f.Assignees}
		ticket.Labels, ticket.Ready = withoutReady(f.Labels)
		created, err := t.CreateTicket(ctx, ticket)
		return WriteReply{Number: created.Number, URL: created.URL}, err
	case IssueEdit:
		edit := TicketEdit{Title: f.Title, Body: f.Body, Milestone: f.Milestone, AddBlockedBy: f.AddBlockedBy, RemoveBlockedBy: f.RemoveBlockedBy,
			Parent: f.Parent, AddAssignees: f.AddAssignees, RemoveAssignees: f.RemoveAssignees}
		var ready bool
		if edit.AddLabels, ready = withoutReady(f.AddLabels); ready {
			edit.Ready = &ready
		}
		var unready bool
		if edit.RemoveLabels, unready = withoutReady(f.RemoveLabels); unready {
			no := false
			edit.Ready = &no
		}
		_, err := t.EditTicket(ctx, number, edit)
		return WriteReply{Number: number}, err
	case IssueComment:
		_, err := t.Comment(ctx, number, author, value(f.Body), sessionID)
		return WriteReply{Number: number}, err
	case IssueClose, IssueReopen:
		if f.Comment != "" {
			if _, err := t.Comment(ctx, number, author, f.Comment, sessionID); err != nil {
				return WriteReply{Number: number}, err
			}
		}
		state, reason := TicketOpen, ReasonNone
		if op == IssueClose {
			state, reason = TicketClosed, f.Reason
		}
		_, err := t.SetTicketState(ctx, number, state, reason)
		return WriteReply{Number: number}, err
	case PrCreate:
		created, err := t.CreateChange(ctx, NewChange{Title: value(f.Title), Body: value(f.Body), Head: f.Head, Base: value(f.Base),
			Draft: f.Draft, Labels: f.Labels, Assignees: f.Assignees, Milestone: value(f.Milestone), Author: author, SessionID: sessionID})
		return WriteReply{Number: created.Number, URL: created.URL}, err
	case PrEdit:
		_, err := t.EditChange(ctx, number, ChangeEdit{Title: f.Title, Body: f.Body, Base: f.Base, AddLabels: f.AddLabels, RemoveLabels: f.RemoveLabels,
			AddAssignees: f.AddAssignees, RemoveAssignees: f.RemoveAssignees, Milestone: f.Milestone})
		return WriteReply{Number: number}, err
	case PrComment:
		_, err := t.CommentChange(ctx, number, author, value(f.Body), sessionID)
		return WriteReply{Number: number}, err
	case PrReview:
		_, err := t.Review(ctx, number, NewReview{State: f.Review, Body: value(f.Body), Author: author, SessionID: sessionID})
		return WriteReply{Number: number}, err
	case PrClose, PrReopen:
		if f.Comment != "" {
			if _, err := t.CommentChange(ctx, number, author, f.Comment, sessionID); err != nil {
				return WriteReply{Number: number}, err
			}
		}
		state := ChangeOpen
		if op == PrClose {
			state = ChangeClosed
		}
		_, err := t.SetChangeState(ctx, number, state, op == PrClose && f.DeleteBranch)
		return WriteReply{Number: number}, err
	}
	return WriteReply{}, ErrUnknownOp
}

// withoutReady are the labels but ReadyLabel, and whether it was there.
func withoutReady(labels []string) ([]string, bool) {
	if !slices.Contains(labels, ReadyLabel) {
		return labels, false
	}
	return slices.DeleteFunc(slices.Clone(labels), func(l string) bool { return l == ReadyLabel }), true
}

func value(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
