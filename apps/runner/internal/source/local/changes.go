package local

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// The local changes of code (MIROIR-7, ADR 0012): a branch of the folder
// proposed for a base, a row of local.db numbered from the counter the
// Tickets share; its reviews and comments rows beside it. A local change has
// no assignee nor milestone: those are refused, never dropped.

var _ source.ChangeWriter = (*Project)(nil)

// CreateChange records a change of Head for Base: Head must be a branch of
// the folder (pushed), with no other change open for it; its head is the
// folder's.
func (p *Project) CreateChange(ctx context.Context, change source.NewChange) (source.Change, error) {
	if len(change.Assignees) > 0 {
		return source.Change{}, source.ErrNoAssignees
	}
	if change.Milestone != "" {
		return source.Change{}, source.ErrNoChangeMilestone
	}
	title := strings.TrimSpace(change.Title)
	if title == "" {
		return source.Change{}, ErrNoTitle
	}
	var number int
	err := p.locked(ctx, func(s *scanned) error {
		head, ok := branchOf(ctx, p.folder, change.Head)
		if !ok {
			return &source.BranchMissingError{Branch: change.Head}
		}
		var open int
		err := p.db.db.QueryRowContext(ctx, `SELECT number FROM changes WHERE project_id = ? AND head_ref = ? AND state = 'open' ORDER BY number LIMIT 1`,
			p.id, change.Head).Scan(&open)
		if err == nil {
			return &source.ChangeOpenError{Branch: change.Head, Number: open}
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("local: read the open changes: %w", err)
		}
		tx, err := p.db.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if number, err = p.allocate(ctx, tx); err != nil {
			return err
		}
		now := formatTime(time.Now())
		_, err = tx.ExecContext(ctx, `INSERT INTO changes (project_id, number, title, body, head_ref, head_oid, base_ref, state, is_draft,
			author, session_id, created_at, updated_at, labels) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
			p.id, number, title, change.Body, change.Head, head, change.Base, change.Draft, change.Author, nullable(change.SessionID), now, now,
			labelsJSON(change.Labels))
		if err != nil {
			return fmt.Errorf("local: write a change: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		s.changed = append(s.changed, p.changeChanged(number))
		return nil
	})
	if err != nil {
		return source.Change{}, err
	}
	return p.Change(ctx, number)
}

// EditChange rewrites the fields the edit gives, the others as they are.
func (p *Project) EditChange(ctx context.Context, number int, edit source.ChangeEdit) (source.Change, error) {
	if len(edit.AddAssignees) > 0 || len(edit.RemoveAssignees) > 0 {
		return source.Change{}, source.ErrNoAssignees
	}
	if edit.Milestone != nil && *edit.Milestone != "" {
		return source.Change{}, source.ErrNoChangeMilestone
	}
	return p.updateChange(ctx, number, func(c *source.Change) error {
		if edit.Title != nil {
			title := strings.TrimSpace(*edit.Title)
			if title == "" {
				return ErrNoTitle
			}
			c.Title = title
		}
		if edit.Body != nil {
			c.Body = *edit.Body
		}
		if edit.Base != nil {
			c.BaseRef = *edit.Base
		}
		for _, label := range edit.AddLabels {
			if !slices.Contains(c.Labels, label) {
				c.Labels = append(c.Labels, label)
			}
		}
		c.Labels = slices.DeleteFunc(c.Labels, func(l string) bool { return slices.Contains(edit.RemoveLabels, l) })
		return nil
	})
}

// SetChangeState closes the change, its branch deleted from the folder with
// deleteBranch (`git push origin --delete` from the Runner's clone), or
// reopens it; a merged change is neither.
func (p *Project) SetChangeState(ctx context.Context, number int, state source.ChangeState, deleteBranch bool) (source.Change, error) {
	if state != source.ChangeOpen && state != source.ChangeClosed {
		return source.Change{}, ErrInvalidState
	}
	changed, err := p.updateChange(ctx, number, func(c *source.Change) error {
		if c.State == source.ChangeMerged {
			return source.ErrMerged
		}
		if c.State != state {
			c.State = state
			c.ClosedAt = nil
			if state == source.ChangeClosed {
				now := time.Now().UTC()
				c.ClosedAt = &now
			}
		}
		return nil
	})
	if err != nil || !deleteBranch || state != source.ChangeClosed {
		return changed, err
	}
	p.mu.Lock()
	clone := p.clone
	p.mu.Unlock()
	dir := clone
	if dir == "" {
		dir = p.folder
	}
	if _, ok := branchOf(ctx, p.folder, changed.HeadRef); !ok {
		return changed, nil
	}
	if clone != "" {
		err = runGit(ctx, dir, "push", "--quiet", "origin", "--delete", "--", changed.HeadRef)
	} else {
		err = runGit(ctx, dir, "branch", "-D", "--", changed.HeadRef)
	}
	if err != nil {
		return changed, fmt.Errorf("local: delete the change's branch: %w", err)
	}
	return changed, nil
}

// updateChange reads the change, applies fn and writes it back.
func (p *Project) updateChange(ctx context.Context, number int, fn func(*source.Change) error) (source.Change, error) {
	err := p.locked(ctx, func(s *scanned) error {
		c, err := p.Change(ctx, number)
		if err != nil {
			return err
		}
		if err := fn(&c); err != nil {
			return err
		}
		var closed sql.NullString
		if c.ClosedAt != nil {
			closed = sql.NullString{String: formatTime(*c.ClosedAt), Valid: true}
		}
		_, err = p.db.db.ExecContext(ctx, `UPDATE changes SET title = ?, body = ?, base_ref = ?, state = ?, labels = ?, closed_at = ?, updated_at = ?
			WHERE project_id = ? AND number = ?`, c.Title, c.Body, c.BaseRef, string(c.State), labelsJSON(c.Labels), closed, formatTime(time.Now()), p.id, number)
		if err != nil {
			return fmt.Errorf("local: write a change: %w", err)
		}
		s.changed = append(s.changed, p.changeChanged(number))
		return nil
	})
	if err != nil {
		return source.Change{}, err
	}
	return p.Change(ctx, number)
}

// Review records a review of the change at its head of this moment (History's).
func (p *Project) Review(ctx context.Context, number int, review source.NewReview) (source.Review, error) {
	switch review.State {
	case source.ReviewApproved, source.ReviewChangesRequested, source.ReviewCommented:
	default:
		return source.Review{}, ErrInvalidState
	}
	r := source.Review{ID: newID(time.Now()), Author: review.Author, State: review.State, Body: review.Body,
		SubmittedAt: time.Now().UTC(), Comments: []source.ReviewComment{}}
	history, err := p.History(ctx, number)
	if err != nil {
		return source.Review{}, err
	}
	r.CommitOid = history.HeadOid
	err = p.locked(ctx, func(s *scanned) error {
		_, err := p.db.db.ExecContext(ctx, `INSERT INTO reviews (id, project_id, number, author, state, body, commit_oid, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			r.ID, p.id, number, r.Author, string(r.State), r.Body, r.CommitOid, formatTime(r.SubmittedAt))
		if err != nil {
			return fmt.Errorf("local: write a review: %w", err)
		}
		s.changed = append(s.changed, p.changeChanged(number))
		return nil
	})
	return r, err
}

// CommentChange writes a comment on the change in local.db.
func (p *Project) CommentChange(ctx context.Context, number int, author, body, sessionID string) (source.Comment, error) {
	c := source.Comment{ID: newID(time.Now()), Author: author, Body: body, CreatedAt: time.Now().UTC()}
	err := p.locked(ctx, func(s *scanned) error {
		if _, err := p.Change(ctx, number); err != nil {
			return err
		}
		_, err := p.db.db.ExecContext(ctx, `INSERT INTO comments (id, project_id, number, author, body, created_at, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			c.ID, p.id, number, author, body, formatTime(c.CreatedAt), nullable(sessionID))
		if err != nil {
			return fmt.Errorf("local: write a comment: %w", err)
		}
		s.changed = append(s.changed, p.changeChanged(number))
		return nil
	})
	return c, err
}

func (p *Project) changeChanged(number int) source.Changed {
	return source.Changed{ProjectID: p.id, Kind: source.KindChange, Number: number}
}

// branchOf is the folder's own branch's commit, false when it has none such.
func branchOf(ctx context.Context, dir, branch string) (string, bool) {
	if branch == "" || strings.HasPrefix(branch, "-") {
		return "", false
	}
	oid, err := gitOutput(ctx, dir, "rev-parse", "--verify", "--quiet", "refs/heads/"+branch+"^{commit}")
	return oid, err == nil && oid != ""
}

func labelsJSON(labels []string) string {
	data, _ := json.Marshal(nonNil(labels))
	return string(data)
}

func nullable(s string) sql.NullString { return sql.NullString{String: s, Valid: s != ""} }
