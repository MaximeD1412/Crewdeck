package local

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// The local changes as a migration of the code reads and writes them
// (SOURCE-9): each with its comments and reviews, and the origin marker a
// copy from GitHub left on it (`github#12`), by which a resumed copy finds
// it again.

// CopiedChange is a local change read whole: its comments and reviews in
// order, and From, its origin marker ("" when no migration wrote it).
type CopiedChange struct {
	source.Change
	From     string
	Comments []source.CopiedComment
	Reviews  []CopiedReview
}

// CopiedReview is a review with its origin marker ("" for none).
type CopiedReview struct {
	source.Review
	From string
}

// CopiedChanges are every local change of the Projet, by number, whole.
func (p *Project) CopiedChanges(ctx context.Context) ([]CopiedChange, error) {
	changes, err := p.Changes(ctx)
	if err != nil {
		return nil, err
	}
	origins := map[int]string{}
	rows, err := p.db.db.QueryContext(ctx, `SELECT number, COALESCE(origin, '') FROM changes WHERE project_id = ?`, p.id)
	if err != nil {
		return nil, fmt.Errorf("local: read the changes: %w", err)
	}
	for rows.Next() {
		var n int
		var from string
		if err := rows.Scan(&n, &from); err != nil {
			rows.Close()
			return nil, fmt.Errorf("local: read the changes: %w", err)
		}
		origins[n] = from
	}
	rows.Close()
	copier := Copier{p: p}
	out := make([]CopiedChange, 0, len(changes))
	for _, c := range changes {
		comments, err := copier.comments(ctx, c.Number)
		if err != nil {
			return nil, err
		}
		reviews, err := p.Reviews(ctx, c.Number)
		if err != nil {
			return nil, err
		}
		reviewOrigins, err := p.reviewOrigins(ctx, c.Number)
		if err != nil {
			return nil, err
		}
		copied := CopiedChange{Change: c, From: origins[c.Number], Comments: comments, Reviews: make([]CopiedReview, 0, len(reviews))}
		for _, r := range reviews {
			copied.Reviews = append(copied.Reviews, CopiedReview{Review: r, From: reviewOrigins[r.ID]})
		}
		out = append(out, copied)
	}
	return out, nil
}

func (p *Project) reviewOrigins(ctx context.Context, number int) (map[string]string, error) {
	rows, err := p.db.db.QueryContext(ctx, `SELECT id, COALESCE(origin, '') FROM reviews WHERE project_id = ? AND number = ?`, p.id, number)
	if err != nil {
		return nil, fmt.Errorf("local: read the reviews: %w", err)
	}
	defer rows.Close()
	origins := map[string]string{}
	for rows.Next() {
		var id, from string
		if err := rows.Scan(&id, &from); err != nil {
			return nil, fmt.Errorf("local: read the reviews: %w", err)
		}
		origins[id] = from
	}
	return origins, rows.Err()
}

// PutChange writes c as the copy of from: a new open change numbered from
// the Projet's counter when number is 0 (its number given), else number's
// title, body, head, base and draft, and its origin from (a change of this
// folder found again on its way back from GitHub). Its head is recorded as
// given: the branch is the copy's of the code, made before.
func (p *Project) PutChange(ctx context.Context, number int, c source.Change, from string) (int, error) {
	err := p.locked(ctx, func(s *scanned) error {
		tx, err := p.db.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		now := formatTime(time.Now())
		if number == 0 {
			if number, err = p.allocate(ctx, tx); err != nil {
				return err
			}
			created := now
			if !c.CreatedAt.IsZero() {
				created = formatTime(c.CreatedAt)
			}
			_, err = tx.ExecContext(ctx, `INSERT INTO changes (project_id, number, title, body, head_ref, head_oid, base_ref, state, is_draft,
				author, created_at, updated_at, labels, origin) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`,
				p.id, number, c.Title, c.Body, c.HeadRef, c.HeadOid, c.BaseRef, c.IsDraft, c.Author, created, now, labelsJSON(c.Labels), nullable(from))
		} else {
			_, err = tx.ExecContext(ctx, `UPDATE changes SET title = ?, body = ?, head_ref = ?, head_oid = ?, base_ref = ?, is_draft = ?, updated_at = ?,
				origin = COALESCE(?, origin) WHERE project_id = ? AND number = ?`, c.Title, c.Body, c.HeadRef, c.HeadOid, c.BaseRef, c.IsDraft, now, nullable(from), p.id, number)
		}
		if err != nil {
			return fmt.Errorf("local: write a change: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		s.changed = append(s.changed, p.changeChanged(number))
		return nil
	})
	return number, err
}

// AddChangeComment writes the comment on the change, by its author and at
// its date, as the copy of from.
func (p *Project) AddChangeComment(ctx context.Context, number int, c source.Comment, from string) error {
	return p.locked(ctx, func(s *scanned) error {
		if _, err := p.Change(ctx, number); err != nil {
			return err
		}
		_, err := p.db.db.ExecContext(ctx, `INSERT INTO comments (id, project_id, number, author, body, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			newID(time.Now()), p.id, number, c.Author, c.Body, formatTime(c.CreatedAt), nullable(from))
		if err != nil {
			return fmt.Errorf("local: write a comment: %w", err)
		}
		s.changed = append(s.changed, p.changeChanged(number))
		return nil
	})
}

// AddChangeReview writes the review on the change, with its remarks, by its
// author and at its date, as the copy of from.
func (p *Project) AddChangeReview(ctx context.Context, number int, r source.Review, from string) error {
	return p.putReview(ctx, number, r, from, false)
}

// PutChangeReview writes r again as the copy of from, in place of the one
// an earlier pass copied (its text or remarks edited since on GitHub).
func (p *Project) PutChangeReview(ctx context.Context, number int, r source.Review, from string) error {
	return p.putReview(ctx, number, r, from, true)
}

func (p *Project) putReview(ctx context.Context, number int, r source.Review, from string, replace bool) error {
	switch r.State {
	case source.ReviewApproved, source.ReviewChangesRequested, source.ReviewCommented:
	default:
		return ErrInvalidState
	}
	return p.locked(ctx, func(s *scanned) error {
		if _, err := p.Change(ctx, number); err != nil {
			return err
		}
		tx, err := p.db.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if replace && from != "" {
			if _, err := tx.ExecContext(ctx, `DELETE FROM review_comments WHERE review_id IN (SELECT id FROM reviews WHERE project_id = ? AND number = ? AND origin = ?)`, p.id, number, from); err != nil {
				return fmt.Errorf("local: replace a review: %w", err)
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM reviews WHERE project_id = ? AND number = ? AND origin = ?`, p.id, number, from); err != nil {
				return fmt.Errorf("local: replace a review: %w", err)
			}
		}
		id := newID(time.Now())
		if _, err := tx.ExecContext(ctx, `INSERT INTO reviews (id, project_id, number, author, state, body, commit_oid, submitted_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, p.id, number, r.Author, string(r.State), r.Body, r.CommitOid, formatTime(r.SubmittedAt), nullable(from)); err != nil {
			return fmt.Errorf("local: write a review: %w", err)
		}
		for _, c := range r.Comments {
			line := sql.NullInt64{Int64: int64(c.Line), Valid: c.Line > 0}
			if _, err := tx.ExecContext(ctx, `INSERT INTO review_comments (id, review_id, path, line, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
				newID(time.Now()), id, c.Path, line, c.Body, formatTime(c.CreatedAt)); err != nil {
				return fmt.Errorf("local: write a remark: %w", err)
			}
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		s.changed = append(s.changed, p.changeChanged(number))
		return nil
	})
}

// PutChangeComment writes body as the text of the change's comment copied
// from from (edited since on GitHub).
func (p *Project) PutChangeComment(ctx context.Context, number int, body, from string) error {
	return p.locked(ctx, func(s *scanned) error {
		if _, err := p.db.db.ExecContext(ctx, `UPDATE comments SET body = ? WHERE project_id = ? AND number = ? AND origin = ?`, body, p.id, number, from); err != nil {
			return fmt.Errorf("local: write a comment: %w", err)
		}
		s.changed = append(s.changed, p.changeChanged(number))
		return nil
	})
}

// SetCopiedState records the change closed or merged as its copy on GitHub
// was (a change of this folder found again on its way back), at at.
func (p *Project) SetCopiedState(ctx context.Context, number int, state source.ChangeState, at time.Time) error {
	if state != source.ChangeClosed && state != source.ChangeMerged {
		return ErrInvalidState
	}
	if at.IsZero() {
		at = time.Now()
	}
	return p.locked(ctx, func(s *scanned) error {
		closed, merged := sql.NullString{String: formatTime(at), Valid: true}, sql.NullString{}
		if state == source.ChangeMerged {
			merged = closed
		}
		if _, err := p.db.db.ExecContext(ctx, `UPDATE changes SET state = ?, closed_at = ?, merged_at = ?, updated_at = ? WHERE project_id = ? AND number = ?`,
			string(state), closed, merged, formatTime(time.Now()), p.id, number); err != nil {
			return fmt.Errorf("local: write a change: %w", err)
		}
		s.changed = append(s.changed, p.changeChanged(number))
		return nil
	})
}
