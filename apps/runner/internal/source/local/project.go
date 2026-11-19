package local

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	"golang.org/x/text/unicode/norm"
	"gopkg.in/yaml.v3"
)

// TicketsDir is the folder of a Local Projet's Tickets, in its working tree.
const TicketsDir = "tickets"

// MilestonesFile is the milestones' file in TicketsDir.
const MilestonesFile = "milestones.yml"

// UnreadableReason is why a file of TicketsDir is not a Ticket.
type UnreadableReason string

const (
	// ReasonFrontMatter: its front matter (or milestones.yml) does not parse.
	ReasonFrontMatter UnreadableReason = "front-matter"
	// ReasonDuplicateNumber: another file, first by path, has its number.
	ReasonDuplicateNumber UnreadableReason = "duplicate-number"
)

// Unreadable is a file the scan skipped, by its path from the folder.
type Unreadable struct {
	Path   string
	Reason UnreadableReason
}

// Scan is what a scan of the folder found.
type Scan struct {
	Tickets    []source.Ticket
	Milestones []source.Milestone
	Unreadable []Unreadable
}

// ErrNoTitle: a Ticket without a title.
var ErrNoTitle = errors.New("local: a Ticket has a title")

// ErrInvalidState: a state, or a reason, a Ticket cannot have.
var ErrInvalidState = errors.New("local: not a Ticket's state")

// ErrUnwritable: the Ticket's file, rewritten, would no longer parse (a
// Pilote's alias of an anchor inside a value the write replaces); the file is
// left as it is.
var ErrUnwritable = errors.New("local: the Ticket's file would no longer read once rewritten")

// Project is a Local Projet's Source: the Tickets of its folder's working
// tree, what the work wrote about them in local.db. Its writes are the
// files' (in place, never added nor committed) and local.db's.
type Project struct {
	db     *DB
	vault  func() *keys.Vault
	id     string
	folder string

	mu         sync.Mutex
	clone      string // the Runner's clone of the folder, "" when unknown
	listeners  []func(source.Changed)
	milestones *string // milestones.yml as last seen; nil before the first scan
}

var (
	_ source.Reader    = (*Project)(nil)
	_ source.Writer    = (*Project)(nil)
	_ source.Watcher   = (*Project)(nil)
	_ source.Available = (*Project)(nil)
	_ source.AsIs      = (*Project)(nil)
)

// Open is the Local Projet projectID, its folder an absolute path (the
// Runner's state, PROJET-6); vault gives the vault key held, for the
// Tickets' content hashes.
func Open(db *DB, vault func() *keys.Vault, projectID, folder string) *Project {
	return &Project{db: db, vault: vault, id: projectID, folder: folder}
}

// ID is the Projet's id.
func (p *Project) ID() string { return p.id }

// Folder is the Projet's folder.
func (p *Project) Folder() string { return p.folder }

// SetClone names the Runner's clone of the folder (Origin.Dir), where a
// change's branch is read first: a Session commits there before it pushes.
func (p *Project) SetClone(dir string) {
	p.mu.Lock()
	p.clone = dir
	p.mu.Unlock()
}

// OnChange registers fn, called after every write and every change a scan
// finds (SOURCE-3 reports them to the server), outside the Projet's lock.
func (p *Project) OnChange(fn func(source.Changed)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.listeners = append(p.listeners, fn)
}

// file is a readable Ticket's file as a scan found it.
type file struct {
	path  string // from the folder, with "/"
	file  TicketFile
	mtime time.Time
}

// scanned is a scan's result under the lock: the Tickets' files by number.
type scanned struct {
	Scan
	files   map[int]file
	changed []source.Changed
	asIs    bool // nothing written: local.db, the files and what the Projet last saw as they are
}

// Scan reads `tickets/*.md` and `tickets/milestones.yml` from the folder's
// working tree: a file without a number gets the next one and its name
// `<n>-<slug>.md` (the only change the Runner makes to a file it did not
// write); a number two files hold stays the first's by path, the others are
// `duplicate-number`; dates and hashes go to local.db.
func (p *Project) Scan(ctx context.Context) (Scan, error) {
	p.mu.Lock()
	s, err := p.scan(ctx, false)
	listeners := slices.Clone(p.listeners)
	p.mu.Unlock()
	if err != nil {
		return Scan{}, err
	}
	notify(listeners, s.changed)
	return s.Scan, nil
}

func notify(listeners []func(source.Changed), changes []source.Changed) {
	for _, c := range changes {
		for _, fn := range listeners {
			fn(c)
		}
	}
}

// locked runs fn under the Projet's lock after a scan, then calls the
// listeners on what the scan and fn changed.
func (p *Project) locked(ctx context.Context, fn func(s *scanned) error) error {
	p.mu.Lock()
	s, err := p.scan(ctx, false)
	if err == nil {
		err = fn(&s)
	}
	listeners := slices.Clone(p.listeners)
	p.mu.Unlock()
	notify(listeners, s.changed)
	return err
}

// TicketsAsIs is the scan writing nothing: the numbered Tickets and the
// milestones as the folder and local.db have them now; a file without a
// number is left out, a Ticket local.db has not seen yet dated now.
func (p *Project) TicketsAsIs(ctx context.Context) ([]source.Ticket, []source.Milestone, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	s, err := p.scan(ctx, true)
	return s.Tickets, s.Milestones, err
}

// Available is nil when the Projet's folder is there, else an error
// wrapping os.ErrNotExist.
func (p *Project) Available(context.Context) error {
	if info, err := os.Stat(p.folder); err != nil || !info.IsDir() {
		return fmt.Errorf("local: the Projet's folder is gone: %w", errors.Join(err, os.ErrNotExist))
	}
	return nil
}

func (p *Project) scan(ctx context.Context, asIs bool) (scanned, error) {
	s := scanned{files: map[int]file{}, asIs: asIs}
	if err := p.Available(ctx); err != nil {
		return s, err
	}
	dir := filepath.Join(p.folder, TicketsDir)
	entries, err := os.ReadDir(dir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return s, fmt.Errorf("local: read tickets/: %w", err)
	}
	s.Milestones = p.readMilestones(&s)

	var fresh []file
	maxSeen := 0
	for _, entry := range entries { // ReadDir sorts by name: the first by path wins
		name := entry.Name()
		if !entry.Type().IsRegular() || !strings.HasSuffix(name, ".md") {
			continue
		}
		rel := TicketsDir + "/" + name
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue // gone since ReadDir
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		f, err := Parse(data)
		if err != nil {
			s.Unreadable = append(s.Unreadable, Unreadable{Path: rel, Reason: ReasonFrontMatter})
			continue
		}
		if f.Number == 0 {
			fresh = append(fresh, file{path: rel, file: f, mtime: info.ModTime()})
			continue
		}
		maxSeen = max(maxSeen, f.Number)
		if _, taken := s.files[f.Number]; taken {
			s.Unreadable = append(s.Unreadable, Unreadable{Path: rel, Reason: ReasonDuplicateNumber})
			continue
		}
		s.files[f.Number] = file{path: rel, file: f, mtime: info.ModTime()}
	}

	tx, err := p.db.db.BeginTx(ctx, nil)
	if err != nil {
		return s, fmt.Errorf("local: scan: %w", err)
	}
	defer tx.Rollback()
	if asIs {
		fresh = nil
	} else if err := p.keepCounterAbove(ctx, tx, maxSeen); err != nil {
		return s, err
	}
	for _, f := range fresh {
		// Checked before a number is taken: a file numbering would make unreadable is left as it is.
		probe := f.file
		probe.Number = 1
		if _, _, err := rewrite(probe); err != nil {
			s.Unreadable = append(s.Unreadable, Unreadable{Path: f.path, Reason: ReasonFrontMatter})
			continue
		}
		n, err := p.allocate(ctx, tx)
		if err != nil {
			return s, err
		}
		f.file.Number = n
		data, reparsed, err := rewrite(f.file)
		if err != nil {
			return s, err
		}
		target, err := p.freePath(n, f.file.Title)
		if err != nil {
			return s, err
		}
		mtime, err := p.writeFile(target, data)
		if err != nil {
			return s, err
		}
		if err := os.Remove(filepath.Join(p.folder, filepath.FromSlash(f.path))); err != nil && !errors.Is(err, os.ErrNotExist) {
			return s, fmt.Errorf("local: rename a Ticket's file: %w", err)
		}
		s.files[n] = file{path: target, file: reparsed, mtime: mtime}
	}

	numbers := make([]int, 0, len(s.files))
	for n := range s.files {
		numbers = append(numbers, n)
	}
	slices.Sort(numbers)
	for _, n := range numbers {
		ticket, changed, err := p.record(ctx, tx, s.files[n], s.Milestones, !asIs)
		if err != nil {
			return s, err
		}
		s.Tickets = append(s.Tickets, ticket)
		if changed {
			s.changed = append(s.changed, source.Changed{ProjectID: p.id, Kind: source.KindTicket, Number: n})
		}
	}
	if asIs {
		return s, nil // the transaction rolls back: it wrote nothing
	}
	gone, err := p.forgetGone(ctx, tx, s.files)
	if err != nil {
		return s, err
	}
	for _, n := range gone {
		s.changed = append(s.changed, source.Changed{ProjectID: p.id, Kind: source.KindTicket, Number: n})
	}
	if err := tx.Commit(); err != nil {
		return s, fmt.Errorf("local: scan: %w", err)
	}
	return s, nil
}

// record keeps what the file does not hold in local.db (its first sight,
// its modification time, its first sight closed, its hash) and gives the
// Ticket; changed says whether it is new or differs from the last scan.
// Without write, it only reads local.db.
func (p *Project) record(ctx context.Context, tx *sql.Tx, f file, milestones []source.Milestone, write bool) (source.Ticket, bool, error) {
	now := time.Now().UTC()
	hash := source.ContentHash(p.vault(), f.file.Title, f.file.Body)
	updated := f.mtime.UTC()
	var path, created, updatedAt, oldHash string
	var closed sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT path, created_at, updated_at, closed_at, content_hash FROM tickets WHERE project_id = ? AND number = ?`, p.id, f.file.Number).
		Scan(&path, &created, &updatedAt, &closed, &oldHash)
	known := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return source.Ticket{}, false, fmt.Errorf("local: read a Ticket's dates: %w", err)
	}
	if !known {
		created = formatTime(now)
	}
	closedAt := sql.NullString{}
	if f.file.State == source.TicketClosed {
		closedAt = closed
		if !closedAt.Valid {
			closedAt = sql.NullString{String: formatTime(now), Valid: true}
		}
	}
	changed := !known || path != f.path || updatedAt != formatTime(updated) || oldHash != hash || closed != closedAt
	if changed && write {
		_, err = tx.ExecContext(ctx, `INSERT INTO tickets (project_id, number, path, created_at, updated_at, closed_at, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (project_id, number) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at, closed_at = excluded.closed_at, content_hash = excluded.content_hash`,
			p.id, f.file.Number, f.path, created, formatTime(updated), closedAt, hash)
		if err != nil {
			return source.Ticket{}, false, fmt.Errorf("local: write a Ticket's dates: %w", err)
		}
	}
	ticket := source.Ticket{
		Number: f.file.Number, Title: f.file.Title, Body: f.file.Body, State: f.file.State, StateReason: f.file.StateReason,
		Ready: f.file.Ready, Labels: nonNil(f.file.Labels), BlockedBy: nonNil(f.file.BlockedBy), Parent: f.file.Parent,
		CreatedAt: parseTime(created), UpdatedAt: updated, URL: fileURL(filepath.Join(p.folder, filepath.FromSlash(f.path))),
	}
	if closedAt.Valid {
		t := parseTime(closedAt.String)
		ticket.ClosedAt = &t
	}
	if f.file.Milestone != "" {
		ticket.Milestone = &source.Milestone{Title: f.file.Milestone}
		for _, m := range milestones {
			if m.Title == f.file.Milestone {
				m := m
				ticket.Milestone = &m
				break
			}
		}
	}
	return ticket, changed, nil
}

// forgetGone empties the path of the Tickets whose file is gone (their rows,
// and their comments, stay) and gives their numbers.
func (p *Project) forgetGone(ctx context.Context, tx *sql.Tx, files map[int]file) ([]int, error) {
	rows, err := tx.QueryContext(ctx, `SELECT number FROM tickets WHERE project_id = ? AND path <> '' ORDER BY number`, p.id)
	if err != nil {
		return nil, fmt.Errorf("local: read the Tickets: %w", err)
	}
	var gone []int
	for rows.Next() {
		var n int
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return nil, err
		}
		if _, ok := files[n]; !ok {
			gone = append(gone, n)
		}
	}
	rows.Close()
	for _, n := range gone {
		if _, err := tx.ExecContext(ctx, `UPDATE tickets SET path = '' WHERE project_id = ? AND number = ?`, p.id, n); err != nil {
			return nil, fmt.Errorf("local: forget a Ticket's file: %w", err)
		}
	}
	return gone, nil
}

// keepCounterAbove keeps next_number above every number seen, the files'
// and the changes'.
func (p *Project) keepCounterAbove(ctx context.Context, tx *sql.Tx, seen int) error {
	var changes sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT MAX(number) FROM changes WHERE project_id = ?`, p.id).Scan(&changes); err != nil {
		return fmt.Errorf("local: read the changes' numbers: %w", err)
	}
	seen = max(seen, int(changes.Int64))
	_, err := tx.ExecContext(ctx, `INSERT INTO projects (project_id, next_number) VALUES (?, ?)
		ON CONFLICT (project_id) DO UPDATE SET next_number = MAX(next_number, excluded.next_number)`, p.id, seen+1)
	if err != nil {
		return fmt.Errorf("local: keep the counter: %w", err)
	}
	return nil
}

func (p *Project) allocate(ctx context.Context, tx *sql.Tx) (int, error) {
	var n int
	if err := tx.QueryRowContext(ctx, `UPDATE projects SET next_number = next_number + 1 WHERE project_id = ? RETURNING next_number - 1`, p.id).Scan(&n); err != nil {
		return 0, fmt.Errorf("local: take a number: %w", err)
	}
	return n, nil
}

// NextNumber takes the next number of the counter the Tickets and the
// changes share (MIROIR-7 numbers a change with it).
func (p *Project) NextNumber(ctx context.Context) (int, error) {
	var n int
	err := p.locked(ctx, func(*scanned) error {
		tx, err := p.db.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if n, err = p.allocate(ctx, tx); err != nil {
			return err
		}
		return tx.Commit()
	})
	return n, err
}

type milestoneEntry struct {
	Title string    `yaml:"title"`
	DueOn yaml.Node `yaml:"due_on"`
}

// readMilestones reads tickets/milestones.yml in its order, each one's
// Number its rank from 1; a file that does not parse is Unreadable and
// gives none.
func (p *Project) readMilestones(s *scanned) []source.Milestone {
	data, err := os.ReadFile(filepath.Join(p.folder, TicketsDir, MilestonesFile))
	text := string(data)
	if err != nil {
		text = ""
	}
	if !s.asIs && (p.milestones == nil || *p.milestones != text) {
		p.milestones = &text
		s.changed = append(s.changed, source.Changed{ProjectID: p.id, Kind: source.KindMilestone})
	}
	if err != nil {
		return nil
	}
	var entries []milestoneEntry
	unreadable := yaml.Unmarshal(data, &entries) != nil
	milestones := make([]source.Milestone, 0, len(entries))
	for i, e := range entries {
		m := source.Milestone{Number: i + 1, Title: strings.TrimSpace(e.Title)}
		if m.Title == "" {
			unreadable = true
			break
		}
		if e.DueOn.Kind == yaml.ScalarNode && e.DueOn.Tag != "!!null" {
			due, err := parseDue(e.DueOn.Value)
			if err != nil {
				unreadable = true
				break
			}
			m.DueOn = &due
		}
		milestones = append(milestones, m)
	}
	if unreadable {
		s.Unreadable = append(s.Unreadable, Unreadable{Path: TicketsDir + "/" + MilestonesFile, Reason: ReasonFrontMatter})
		return nil
	}
	return milestones
}

func parseDue(value string) (time.Time, error) {
	if t, err := time.Parse(time.DateOnly, value); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC3339, value)
}

// Tickets are the readable Tickets of the folder, by number.
func (p *Project) Tickets(ctx context.Context) ([]source.Ticket, error) {
	s, err := p.Scan(ctx)
	return s.Tickets, err
}

// Ticket is the Ticket of that number.
func (p *Project) Ticket(ctx context.Context, number int) (source.Ticket, error) {
	tickets, err := p.Tickets(ctx)
	if err != nil {
		return source.Ticket{}, err
	}
	for _, t := range tickets {
		if t.Number == number {
			return t, nil
		}
	}
	return source.Ticket{}, source.ErrNotFound
}

// Milestones are tickets/milestones.yml's, in its order.
func (p *Project) Milestones(ctx context.Context) ([]source.Milestone, error) {
	s, err := p.Scan(ctx)
	return s.Milestones, err
}

// Comments are the Ticket's comments, oldest first.
func (p *Project) Comments(ctx context.Context, number int) ([]source.Comment, error) {
	rows, err := p.db.db.QueryContext(ctx, `SELECT id, author, body, created_at FROM comments WHERE project_id = ? AND number = ? ORDER BY created_at, id`, p.id, number)
	if err != nil {
		return nil, fmt.Errorf("local: read the comments: %w", err)
	}
	defer rows.Close()
	comments := []source.Comment{}
	for rows.Next() {
		var c source.Comment
		var created string
		if err := rows.Scan(&c.ID, &c.Author, &c.Body, &created); err != nil {
			return nil, fmt.Errorf("local: read the comments: %w", err)
		}
		c.CreatedAt = parseTime(created)
		comments = append(comments, c)
	}
	return comments, rows.Err()
}

const changeColumns = `number, title, body, head_ref, head_oid, base_ref, state, is_draft, COALESCE(merge_commit_oid, ''), author, created_at, updated_at, closed_at, merged_at`

func scanChange(row interface{ Scan(...any) error }) (source.Change, error) {
	var c source.Change
	var state, created, updated string
	var closed, merged sql.NullString
	if err := row.Scan(&c.Number, &c.Title, &c.Body, &c.HeadRef, &c.HeadOid, &c.BaseRef, &state, &c.IsDraft, &c.MergeCommitOid, &c.Author, &created, &updated, &closed, &merged); err != nil {
		return c, err
	}
	c.State, c.CreatedAt, c.UpdatedAt = source.ChangeState(state), parseTime(created), parseTime(updated)
	c.ClosedAt, c.MergedAt = optionalTime(closed), optionalTime(merged)
	return c, nil
}

// Changes are the Projet's local changes, by number.
func (p *Project) Changes(ctx context.Context) ([]source.Change, error) {
	rows, err := p.db.db.QueryContext(ctx, `SELECT `+changeColumns+` FROM changes WHERE project_id = ? ORDER BY number`, p.id)
	if err != nil {
		return nil, fmt.Errorf("local: read the changes: %w", err)
	}
	defer rows.Close()
	changes := []source.Change{}
	for rows.Next() {
		c, err := scanChange(rows)
		if err != nil {
			return nil, fmt.Errorf("local: read the changes: %w", err)
		}
		changes = append(changes, c)
	}
	return changes, rows.Err()
}

// Change is the local change of that number.
func (p *Project) Change(ctx context.Context, number int) (source.Change, error) {
	c, err := scanChange(p.db.db.QueryRowContext(ctx, `SELECT `+changeColumns+` FROM changes WHERE project_id = ? AND number = ?`, p.id, number))
	if errors.Is(err, sql.ErrNoRows) {
		return source.Change{}, source.ErrNotFound
	}
	if err != nil {
		return source.Change{}, fmt.Errorf("local: read a change: %w", err)
	}
	return c, nil
}

// Reviews are the change's reviews, oldest first, each with its remarks.
func (p *Project) Reviews(ctx context.Context, number int) ([]source.Review, error) {
	rows, err := p.db.db.QueryContext(ctx, `SELECT id, author, state, body, commit_oid, submitted_at FROM reviews WHERE project_id = ? AND number = ? ORDER BY submitted_at, id`, p.id, number)
	if err != nil {
		return nil, fmt.Errorf("local: read the reviews: %w", err)
	}
	reviews := []source.Review{}
	for rows.Next() {
		var r source.Review
		var state, submitted string
		if err := rows.Scan(&r.ID, &r.Author, &state, &r.Body, &r.CommitOid, &submitted); err != nil {
			rows.Close()
			return nil, fmt.Errorf("local: read the reviews: %w", err)
		}
		r.State, r.SubmittedAt, r.Comments = source.ReviewState(state), parseTime(submitted), []source.ReviewComment{}
		reviews = append(reviews, r)
	}
	rows.Close()
	for i := range reviews {
		remarks, err := p.db.db.QueryContext(ctx, `SELECT id, path, COALESCE(line, 0), body, created_at FROM review_comments WHERE review_id = ? ORDER BY created_at, id`, reviews[i].ID)
		if err != nil {
			return nil, fmt.Errorf("local: read the remarks: %w", err)
		}
		for remarks.Next() {
			var c source.ReviewComment
			var created string
			if err := remarks.Scan(&c.ID, &c.Path, &c.Line, &c.Body, &created); err != nil {
				remarks.Close()
				return nil, fmt.Errorf("local: read the remarks: %w", err)
			}
			c.CreatedAt = parseTime(created)
			reviews[i].Comments = append(reviews[i].Comments, c)
		}
		remarks.Close()
	}
	return reviews, nil
}

// Checks gives none until BOUCLE-9 records the Checks' Commandes of a Local Projet.
func (p *Project) Checks(context.Context, string) ([]source.Check, error) {
	return []source.Check{}, nil
}

// CreateTicket writes `tickets/<n>-<slug>.md` with the next number of the
// counter shared with the changes.
func (p *Project) CreateTicket(ctx context.Context, ticket source.NewTicket) (source.Ticket, error) {
	var created source.Ticket
	err := p.locked(ctx, func(s *scanned) error {
		title := strings.TrimSpace(ticket.Title)
		if title == "" {
			return ErrNoTitle
		}
		if err := knownMilestone(s.Milestones, ticket.Milestone); err != nil {
			return err
		}
		tx, err := p.db.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		n, err := p.allocate(ctx, tx)
		if err != nil {
			return err
		}
		f := TicketFile{
			Number: n, Title: title, State: source.TicketOpen, Ready: ticket.Ready, Labels: ticket.Labels,
			BlockedBy: ticket.BlockedBy, Parent: ticket.Parent, Milestone: ticket.Milestone, Body: ticket.Body, gap: "\n",
		}
		path, err := p.freePath(n, title)
		if err != nil {
			return err
		}
		if created, err = p.writeTicket(ctx, tx, s, path, f); err != nil {
			return err
		}
		return tx.Commit()
	})
	return created, err
}

// EditTicket rewrites the fields the edit gives, the others as they are.
func (p *Project) EditTicket(ctx context.Context, number int, edit source.TicketEdit) (source.Ticket, error) {
	return p.rewrite(ctx, number, func(f *TicketFile, milestones []source.Milestone) error {
		if edit.Title != nil {
			title := strings.TrimSpace(*edit.Title)
			if title == "" {
				return ErrNoTitle
			}
			f.Title = title
		}
		if edit.Body != nil {
			f.Body = *edit.Body
		}
		for _, label := range edit.AddLabels {
			if !slices.Contains(f.Labels, label) {
				f.Labels = append(f.Labels, label)
			}
		}
		if len(edit.RemoveLabels) > 0 {
			f.Labels = slices.DeleteFunc(slices.Clone(f.Labels), func(l string) bool { return slices.Contains(edit.RemoveLabels, l) })
		}
		if edit.Ready != nil {
			f.Ready = *edit.Ready
		}
		if edit.Milestone != nil {
			if err := knownMilestone(milestones, *edit.Milestone); err != nil {
				return err
			}
			f.Milestone = *edit.Milestone
		}
		if edit.BlockedBy != nil {
			f.BlockedBy = slices.Clone(*edit.BlockedBy)
		}
		if edit.Parent != nil {
			f.Parent = nil
			if *edit.Parent > 0 {
				parent := *edit.Parent
				f.Parent = &parent
			}
		}
		return nil
	})
}

// SetTicketState opens or closes the Ticket; a closed one without a reason
// is `completed`.
func (p *Project) SetTicketState(ctx context.Context, number int, state source.TicketState, reason source.StateReason) (source.Ticket, error) {
	switch {
	case state == source.TicketOpen && reason == source.ReasonNone:
	case state == source.TicketClosed && (reason == source.ReasonCompleted || reason == source.ReasonNotPlanned):
	case state == source.TicketClosed && reason == source.ReasonNone:
		reason = source.ReasonCompleted
	default:
		return source.Ticket{}, ErrInvalidState
	}
	return p.rewrite(ctx, number, func(f *TicketFile, _ []source.Milestone) error {
		f.State, f.StateReason = state, reason
		return nil
	})
}

func (p *Project) rewrite(ctx context.Context, number int, change func(*TicketFile, []source.Milestone) error) (source.Ticket, error) {
	var edited source.Ticket
	err := p.locked(ctx, func(s *scanned) error {
		current, ok := s.files[number]
		if !ok {
			return source.ErrNotFound
		}
		f := current.file
		if err := change(&f, s.Milestones); err != nil {
			return err
		}
		tx, err := p.db.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if edited, err = p.writeTicket(ctx, tx, s, current.path, f); err != nil {
			return err
		}
		return tx.Commit()
	})
	return edited, err
}

// writeTicket writes the file at path, records it and says it changed.
func (p *Project) writeTicket(ctx context.Context, tx *sql.Tx, s *scanned, path string, f TicketFile) (source.Ticket, error) {
	data, written, err := rewrite(f)
	if err != nil {
		return source.Ticket{}, err
	}
	mtime, err := p.writeFile(path, data)
	if err != nil {
		return source.Ticket{}, err
	}
	ticket, _, err := p.record(ctx, tx, file{path: path, file: written, mtime: mtime}, s.Milestones, true)
	if err != nil {
		return source.Ticket{}, err
	}
	s.changed = append(s.changed, source.Changed{ProjectID: p.id, Kind: source.KindTicket, Number: f.Number})
	return ticket, nil
}

// Comment writes a comment on the Ticket in local.db.
func (p *Project) Comment(ctx context.Context, number int, author, body, sessionID string) (source.Comment, error) {
	c := source.Comment{ID: newID(time.Now()), Author: author, Body: body, CreatedAt: time.Now().UTC()}
	err := p.locked(ctx, func(s *scanned) error {
		if _, ok := s.files[number]; !ok {
			return source.ErrNotFound
		}
		session := sql.NullString{String: sessionID, Valid: sessionID != ""}
		_, err := p.db.db.ExecContext(ctx, `INSERT INTO comments (id, project_id, number, author, body, created_at, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			c.ID, p.id, number, author, body, formatTime(c.CreatedAt), session)
		if err != nil {
			return fmt.Errorf("local: write a comment: %w", err)
		}
		s.changed = append(s.changed, source.Changed{ProjectID: p.id, Kind: source.KindTicket, Number: number})
		return nil
	})
	return c, err
}

func knownMilestone(milestones []source.Milestone, title string) error {
	if title == "" || slices.ContainsFunc(milestones, func(m source.Milestone) bool { return m.Title == title }) {
		return nil
	}
	return source.ErrUnknownMilestone
}

// freePath is `tickets/<n>-<slug>.md`, `-2`, `-3` when taken.
func (p *Project) freePath(n int, title string) (string, error) {
	base := strconv.Itoa(n) + "-" + Slug(title)
	for i := 1; ; i++ {
		name := base
		if i > 1 {
			name += "-" + strconv.Itoa(i)
		}
		rel := TicketsDir + "/" + name + ".md"
		if _, err := os.Lstat(filepath.Join(p.folder, filepath.FromSlash(rel))); errors.Is(err, os.ErrNotExist) {
			return rel, nil
		} else if err != nil {
			return "", fmt.Errorf("local: name a Ticket's file: %w", err)
		}
	}
}

// writeFile writes the file at once in the working tree: a temporary file
// beside it, then a rename. It gives the file's modification time.
func (p *Project) writeFile(rel string, data []byte) (time.Time, error) {
	path := filepath.Join(p.folder, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return time.Time{}, fmt.Errorf("local: create tickets/: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".crewdeck-*.tmp")
	if err != nil {
		return time.Time{}, fmt.Errorf("local: write a Ticket's file: %w", err)
	}
	defer os.Remove(tmp.Name())
	mode := os.FileMode(0o644)
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
	}
	_, err = tmp.Write(data)
	if err == nil {
		err = tmp.Chmod(mode)
	}
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(tmp.Name(), path)
	}
	if err != nil {
		return time.Time{}, fmt.Errorf("local: write a Ticket's file: %w", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		return time.Time{}, fmt.Errorf("local: write a Ticket's file: %w", err)
	}
	return info.ModTime(), nil
}

var notSlug = regexp.MustCompile(`[^a-z0-9]+`)

// Slug is a file's name from a title: accents removed, lower case, every
// other run of characters a `-`, 50 characters at most cut at a `-`,
// `ticket` when nothing is left.
func Slug(title string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(title)) {
		if !unicode.Is(unicode.Mn, r) {
			b.WriteRune(r)
		}
	}
	s := strings.Trim(notSlug.ReplaceAllString(b.String(), "-"), "-")
	if len(s) > 50 {
		if cut := strings.LastIndex(s[:51], "-"); cut > 0 {
			s = s[:cut]
		} else {
			s = s[:50]
		}
	}
	if s = strings.Trim(s, "-"); s == "" {
		return "ticket"
	}
	return s
}

func formatTime(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

func parseTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339Nano, s)
	return t
}

func optionalTime(s sql.NullString) *time.Time {
	if !s.Valid {
		return nil
	}
	t := parseTime(s.String)
	return &t
}

func nonNil[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}

// newID is a UUIDv7, as the protocol's ids.
func newID(now time.Time) string {
	var b [16]byte
	if _, err := rand.Read(b[6:]); err != nil {
		panic(fmt.Sprintf("local: random id: %v", err))
	}
	var ms [8]byte
	binary.BigEndian.PutUint64(ms[:], uint64(now.UnixMilli()))
	copy(b[:6], ms[2:])
	b[6] = 0x70 | (b[6] & 0x0f)
	b[8] = 0x80 | (b[8] & 0x3f)
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
