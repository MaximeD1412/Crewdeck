package local

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// ArchivePrefix starts the name of the folder `tickets/` becomes once a
// migration moved its Tickets (`tickets.archive-<YYYY-MM-DD>`).
const ArchivePrefix = TicketsDir + ".archive-"

// Copier is a Local Projet's Tickets as a migration of Source reads and
// writes them (SOURCE-8): the files of `tickets/`, or of its archive once
// frozen, and their comments in local.db. Its writes are in the working
// tree, never committed.
type Copier struct {
	p   *Project
	dir string // from the folder: TicketsDir, or its archive once frozen
	now func() time.Time
}

var _ source.Copier = (*Copier)(nil)

// Copier is the Projet's Tickets for a migration, read in dir (TicketsDir
// when "": the archive's name once Freeze renamed it).
func (p *Project) Copier(dir string) *Copier {
	if dir == "" {
		dir = TicketsDir
	}
	return &Copier{p: p, dir: dir, now: time.Now}
}

// Dir is where it reads: TicketsDir, or the archive once frozen.
func (c *Copier) Dir() string { return c.dir }

// Kind is "local".
func (c *Copier) Kind() string { return "local" }

// ReadAll is every Ticket of the folder, by number, with its comments, and
// the milestones; source.ErrUnreadable when a file, or milestones.yml, does
// not parse (or two files hold one number). In `tickets/`, a file without
// a number is numbered first.
func (c *Copier) ReadAll(ctx context.Context) ([]source.CopiedTicket, []source.Milestone, error) {
	if c.dir == TicketsDir {
		scan, err := c.p.Scan(ctx)
		if err != nil {
			return nil, nil, err
		}
		if len(scan.Unreadable) > 0 {
			return nil, nil, fmt.Errorf("%w: %d files", source.ErrUnreadable, len(scan.Unreadable))
		}
	}
	files, milestones, err := c.files()
	if err != nil {
		return nil, nil, err
	}
	numbers := make([]int, 0, len(files))
	for n := range files {
		numbers = append(numbers, n)
	}
	slices.Sort(numbers)
	tickets := make([]source.CopiedTicket, 0, len(numbers))
	for _, n := range numbers {
		f := files[n].file
		t := source.CopiedTicket{From: f.From, Ticket: source.Ticket{
			Number: n, Title: f.Title, Body: f.Body, State: f.State, StateReason: f.StateReason, Ready: f.Ready,
			Labels: nonNil(f.Labels), BlockedBy: nonNil(f.BlockedBy), Parent: f.Parent,
		}}
		if f.Milestone != "" {
			t.Milestone = &source.Milestone{Title: f.Milestone}
			for _, m := range milestones {
				if m.Title == f.Milestone {
					m := m
					t.Milestone = &m
				}
			}
		}
		if t.Comments, err = c.comments(ctx, n); err != nil {
			return nil, nil, err
		}
		tickets = append(tickets, t)
	}
	return tickets, milestones, nil
}

// files are the numbered Tickets' files of the folder read, and its milestones.
func (c *Copier) files() (map[int]file, []source.Milestone, error) {
	dir := filepath.Join(c.p.folder, filepath.FromSlash(c.dir))
	files := map[int]file{}
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return files, nil, nil
	}
	if err != nil {
		return nil, nil, fmt.Errorf("local: read %s: %w", c.dir, err)
	}
	var milestones []source.Milestone
	if data, err := os.ReadFile(filepath.Join(dir, MilestonesFile)); err == nil {
		if milestones, err = parseMilestones(data); err != nil {
			return nil, nil, fmt.Errorf("%w: %s", source.ErrUnreadable, MilestonesFile)
		}
	}
	for _, entry := range entries {
		name := entry.Name()
		if !entry.Type().IsRegular() || !strings.HasSuffix(name, ".md") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return nil, nil, fmt.Errorf("local: read a Ticket's file: %w", err)
		}
		f, err := Parse(data)
		if err != nil {
			return nil, nil, fmt.Errorf("%w: a file of %s", source.ErrUnreadable, c.dir)
		}
		if _, taken := files[f.Number]; taken && f.Number != 0 {
			return nil, nil, fmt.Errorf("%w: two files of %s hold one number", source.ErrUnreadable, c.dir)
		}
		if f.Number != 0 {
			files[f.Number] = file{path: c.dir + "/" + name, file: f}
		}
	}
	return files, milestones, nil
}

func (c *Copier) comments(ctx context.Context, number int) ([]source.CopiedComment, error) {
	rows, err := c.p.db.db.QueryContext(ctx, `SELECT id, author, body, created_at, COALESCE(origin, '') FROM comments WHERE project_id = ? AND number = ? ORDER BY created_at, id`, c.p.id, number)
	if err != nil {
		return nil, fmt.Errorf("local: read the comments: %w", err)
	}
	defer rows.Close()
	comments := []source.CopiedComment{}
	for rows.Next() {
		var cc source.CopiedComment
		var created string
		if err := rows.Scan(&cc.ID, &cc.Author, &cc.Body, &created, &cc.From); err != nil {
			return nil, fmt.Errorf("local: read the comments: %w", err)
		}
		cc.CreatedAt = parseTime(created)
		comments = append(comments, cc)
	}
	return comments, rows.Err()
}

// PutMilestone adds the milestone at the end of tickets/milestones.yml (its
// number is its rank), or sets the title and due date of the number-th.
func (c *Copier) PutMilestone(ctx context.Context, number int, m source.Milestone) (int, error) {
	err := c.p.locked(ctx, func(s *scanned) error {
		path := filepath.Join(c.p.folder, TicketsDir, MilestonesFile)
		data, err := os.ReadFile(path)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("local: read milestones.yml: %w", err)
		}
		if number > 0 {
			edited, err := withMilestone(data, number, m)
			if err != nil {
				return err
			}
			if _, err := c.p.writeFile(TicketsDir+"/"+MilestonesFile, edited); err != nil {
				return err
			}
			s.changed = append(s.changed, source.Changed{ProjectID: c.p.id, Kind: source.KindMilestone})
			return nil
		}
		entry := map[string]any{"title": m.Title}
		if m.DueOn != nil {
			entry["due_on"] = m.DueOn.UTC().Format(time.DateOnly)
		}
		added, err := yaml.Marshal([]map[string]any{entry})
		if err != nil {
			return err
		}
		text := string(data)
		if text != "" && !strings.HasSuffix(text, "\n") {
			text += "\n"
		}
		if _, err := c.p.writeFile(TicketsDir+"/"+MilestonesFile, []byte(text+string(added))); err != nil {
			return err
		}
		number = len(s.Milestones) + 1
		s.changed = append(s.changed, source.Changed{ProjectID: c.p.id, Kind: source.KindMilestone})
		return nil
	})
	return number, err
}

// withMilestone is milestones.yml with the number-th milestone's title and
// due_on set to m's (due_on removed for nil), the rest as it was.
func withMilestone(data []byte, number int, m source.Milestone) ([]byte, error) {
	due := m.DueOn
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil || len(doc.Content) != 1 || doc.Content[0].Kind != yaml.SequenceNode || len(doc.Content[0].Content) < number {
		return nil, fmt.Errorf("local: milestones.yml has no milestone %d: %w", number, source.ErrUnreadable)
	}
	entry := doc.Content[0].Content[number-1]
	if entry.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("local: milestones.yml's milestone %d: %w", number, source.ErrUnreadable)
	}
	titled := false
	for i := 0; i+1 < len(entry.Content); i += 2 {
		if entry.Content[i].Value == "title" {
			entry.Content[i+1].Value = m.Title
			titled = true
		}
	}
	if !titled {
		entry.Content = append([]*yaml.Node{
			{Kind: yaml.ScalarNode, Value: "title"},
			{Kind: yaml.ScalarNode, Value: m.Title},
		}, entry.Content...)
	}
	for i := 0; i+1 < len(entry.Content); i += 2 {
		if entry.Content[i].Value == "due_on" {
			entry.Content = slices.Delete(entry.Content, i, i+2)
			break
		}
	}
	if due != nil {
		entry.Content = append(entry.Content,
			&yaml.Node{Kind: yaml.ScalarNode, Value: "due_on"},
			&yaml.Node{Kind: yaml.ScalarNode, Style: yaml.DoubleQuotedStyle, Value: due.UTC().Format(time.DateOnly)})
	}
	return yaml.Marshal(&doc)
}

// PutTicket writes the Ticket's file, `from:` in its front matter: a new
// one numbered from the Projet's counter when number is 0.
func (c *Copier) PutTicket(ctx context.Context, number int, t source.Ticket, from string) (int, error) {
	err := c.p.locked(ctx, func(s *scanned) error {
		tx, err := c.p.db.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		f := TicketFile{gap: "\n"}
		var path string
		if number == 0 {
			if number, err = c.p.allocate(ctx, tx); err != nil {
				return err
			}
			f.Number = number
			if path, err = c.p.freePath(number, t.Title); err != nil {
				return err
			}
		} else {
			current, ok := s.files[number]
			if !ok {
				return source.ErrNotFound
			}
			f, path = current.file, current.path
		}
		f.Title, f.Body, f.State, f.StateReason, f.Ready = strings.TrimSpace(t.Title), t.Body, t.State, t.StateReason, t.Ready
		f.Labels, f.From, f.Milestone = slices.Clone(t.Labels), from, ""
		if t.State == source.TicketOpen {
			f.StateReason = source.ReasonNone
		}
		if t.Milestone != nil {
			f.Milestone = t.Milestone.Title
		}
		if _, err := c.p.writeTicket(ctx, tx, s, path, f); err != nil {
			return err
		}
		return tx.Commit()
	})
	return number, err
}

// AddComment writes the comment in local.db, by its author and at its date.
func (c *Copier) AddComment(ctx context.Context, number int, comment source.Comment, from string) error {
	return c.p.locked(ctx, func(s *scanned) error {
		if _, ok := s.files[number]; !ok {
			return source.ErrNotFound
		}
		_, err := c.p.db.db.ExecContext(ctx, `INSERT INTO comments (id, project_id, number, author, body, created_at, origin) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			newID(c.now()), c.p.id, number, comment.Author, comment.Body, formatTime(comment.CreatedAt), sql.NullString{String: from, Valid: from != ""})
		if err != nil {
			return fmt.Errorf("local: write a comment: %w", err)
		}
		s.changed = append(s.changed, source.Changed{ProjectID: c.p.id, Kind: source.KindTicket, Number: number})
		return nil
	})
}

// Link rewrites the file's parent and blocked_by.
func (c *Copier) Link(ctx context.Context, was source.CopiedTicket, parent int, blockedBy []int) error {
	_, err := c.p.rewrite(ctx, was.Number, func(f *TicketFile, _ []source.Milestone) error {
		f.Parent = nil
		if parent > 0 {
			f.Parent = &parent
		}
		f.BlockedBy = slices.Clone(blockedBy)
		return nil
	})
	return err
}

// Freeze archives `tickets/` under NextArchive's name.
func (c *Copier) Freeze(ctx context.Context) error {
	name, err := c.NextArchive()
	if err != nil {
		return err
	}
	return c.FreezeAs(ctx, name)
}

// NextArchive is the name `tickets/` would be archived under:
// `tickets.archive-<YYYY-MM-DD>` (`-2`, `-3` when taken).
func (c *Copier) NextArchive() (string, error) {
	base := ArchivePrefix + c.now().UTC().Format(time.DateOnly)
	for i := 1; ; i++ {
		name := base
		if i > 1 {
			name += "-" + strconv.Itoa(i)
		}
		if _, err := os.Lstat(filepath.Join(c.p.folder, name)); errors.Is(err, os.ErrNotExist) {
			return name, nil
		} else if err != nil {
			return "", fmt.Errorf("local: archive tickets/: %w", err)
		}
	}
}

// FreezeAs numbers what is not yet, then renames `tickets/` to name (a
// name kept before, so that a freeze cut after the rename finds its
// archive again): nothing reads nor writes there again, and the Copier
// reads the archive from then on.
func (c *Copier) FreezeAs(ctx context.Context, name string) error {
	if c.dir != TicketsDir {
		return nil // frozen already
	}
	from, to := filepath.Join(c.p.folder, TicketsDir), filepath.Join(c.p.folder, name)
	if _, err := os.Stat(from); errors.Is(err, os.ErrNotExist) {
		if _, err := os.Stat(to); err == nil {
			c.dir = name // renamed already
		}
		return nil // else nothing to archive
	}
	if _, err := c.p.Scan(ctx); err != nil {
		return err
	}
	if err := os.Rename(from, to); err != nil {
		return fmt.Errorf("local: archive tickets/: %w", err)
	}
	c.dir = name
	return nil
}
