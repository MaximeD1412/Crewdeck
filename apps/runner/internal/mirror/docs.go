package mirror

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	osexec "os/exec"
	"strings"
	"sync"

	"github.com/bmatcuk/doublestar/v4"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
)

// DocGlobs are a Projet's validated documents (ADR 0010): no other file's
// content is copied.
var DocGlobs = []string{"docs/**/*.md", "backlog/**/*.md", "design/DESIGN.md", "AGENTS.md", "CONTEXT.md"}

// Origin is a key's clone of the Runner (session.Origin): Clone makes it
// when missing, else fetches it, and gives its folder and the environment
// git reaches its origin with (a partial clone fetches a blob as it is read).
type Origin interface {
	Dir() string
	Clone(ctx context.Context) (dir string, auth []string, err error)
}

// Clones are the Runner's clones of the Projets' code, which the
// documentation index reads (MIROIR-5): RUNNER-9's for a GitHub key, with
// the repository's « Miroir » token, SOURCE-2's for a Local one, its origin
// the folder.
type Clones struct {
	// Origin is the key's clone; nil, or a nil Origin, indexes no document.
	Origin func(p Project, tokens github.TokenSource) Origin
	// Lock holds a clone's lock (session.LockClone), shared with the
	// Sessions; nil holds none.
	Lock func(dir string) (unlock func())
}

// gitFunc runs one git command and gives its standard output.
type gitFunc func(ctx context.Context, dir string, env []string, args ...string) ([]byte, error)

// docsGitError is a git command of the index that failed: its subcommand and
// exit code, never its output (it may name a file, a branch, a URL).
type docsGitError struct {
	command string
	err     error
}

func (e *docsGitError) Error() string { return fmt.Sprintf("mirror: git %s: %v", e.command, e.err) }
func (e *docsGitError) Unwrap() error { return e.err }

// runGit runs git in dir, env added to the Runner's: the token, when there
// is one, in this process's environment only (RUNNER-9).
func runGit(ctx context.Context, dir string, env []string, args ...string) ([]byte, error) {
	cmd := osexec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "LC_ALL=C")
	cmd.Env = append(cmd.Env, env...)
	out, err := cmd.Output()
	if err != nil {
		return nil, &docsGitError{command: args[0], err: err}
	}
	return out, nil
}

func (m *Mirror) runGit(ctx context.Context, dir string, env []string, args ...string) ([]byte, error) {
	if m.git != nil {
		return m.git(ctx, dir, env, args...)
	}
	return runGit(ctx, dir, env, args...)
}

// lockDocs serialises the indexes of one key.
func (m *Mirror) lockDocs(key string) func() {
	m.docsMu.Lock()
	if m.docsLocks == nil {
		m.docsLocks = map[string]*sync.Mutex{}
	}
	l, ok := m.docsLocks[key]
	if !ok {
		l = &sync.Mutex{}
		m.docsLocks[key] = l
	}
	m.docsMu.Unlock()
	l.Lock()
	return l.Unlock
}

// doc is one document of the index.
type doc struct {
	path, blob, title, content string
	read                       bool // its content was read: a new or changed blob
}

// IndexDocs makes the key's documentation index the validated documents of
// origin/<integration branch> in the Runner's clone (ADR 0010, ADR 0012):
// it fetches the clone (making it when missing), lists the branch's files
// matching DocGlobs, reads each whose blob changed, and in one transaction
// replaces the key's docs rows and their search rows (kind doc), then
// stores the indexed head in projects.docs_head. A head already indexed is
// not listed again; a key without the code group has no document. A failed
// fetch (GitHub out of reach, a Local folder gone) keeps the previous index
// and is ErrUnavailable.
func (m *Mirror) IndexDocs(ctx context.Context, key string) error {
	if m.Clones.Origin == nil {
		return nil
	}
	started := m.now()
	p, err := m.Store.project(key)
	if err != nil {
		return err
	}
	key = p.Repository
	unlock := m.lockDocs(key)
	defer unlock()
	indexed, err := m.Store.docsHead(key)
	if err != nil {
		return err
	}
	if !p.Has(GroupCode) {
		return m.clearDocs(key, indexed)
	}
	var tokens github.TokenSource
	if p.Source != SourceLocal && m.GitHub != nil && m.GitHub.Tokens != nil {
		tokens = m.GitHub.Tokens(key)
	}
	origin := m.Clones.Origin(p, tokens)
	if origin == nil {
		return nil
	}
	dir, env, err := origin.Clone(ctx)
	if err != nil {
		return fmt.Errorf("%w: fetch the clone of %s: %w", ErrUnavailable, key, err)
	}
	head, docs, err := m.readDocs(ctx, p, dir, env, indexed)
	if err != nil {
		return err
	}
	if indexed.Valid && indexed.String == head {
		m.logger().Debug("mirror docs unchanged", "repository", key, "duration_ms", m.now().Sub(started).Milliseconds())
		return nil
	}
	removed := 0
	err = m.Store.Update(func(tx *sql.Tx) error {
		var err error
		removed, err = putDocs(tx, key, head, docs)
		return err
	})
	if err != nil {
		return err
	}
	read := 0
	for _, d := range docs {
		if d.read {
			read++
		}
	}
	m.logger().Info("mirror docs", "repository", key, "listed", len(docs), "read", read, "removed", removed,
		"duration_ms", m.now().Sub(started).Milliseconds())
	return nil
}

// readDocs lists the documents of origin/<integration branch> in the clone
// at dir, under its lock, and reads those whose blob the index does not
// have; nothing when the head is the one indexed. A branch origin does not
// have has no document.
func (m *Mirror) readDocs(ctx context.Context, p Project, dir string, env []string, indexed sql.NullString) (string, []doc, error) {
	if m.Clones.Lock != nil {
		unlock := m.Clones.Lock(dir)
		defer unlock()
	}
	out, err := m.runGit(ctx, dir, env, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/"+p.IntegrationBranch+"^{commit}")
	var exit *osexec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == 1 {
		return "", nil, nil
	}
	if err != nil {
		return "", nil, err
	}
	head := strings.TrimSpace(string(out))
	if indexed.Valid && indexed.String == head {
		return head, nil, nil
	}
	if out, err = m.runGit(ctx, dir, env, "ls-tree", "-r", "-z", "--full-tree", head); err != nil {
		return "", nil, err
	}
	known, err := m.Store.docBlobs(p.Repository)
	if err != nil {
		return "", nil, err
	}
	var docs []doc
	for _, entry := range bytes.Split(out, []byte{0}) {
		// <mode> SP <type> SP <object> TAB <path>
		meta, path, ok := strings.Cut(string(entry), "\t")
		fields := strings.Fields(meta)
		if !ok || len(fields) != 3 || fields[1] != "blob" || !isDoc(path) {
			continue
		}
		d := doc{path: path, blob: fields[2]}
		if known[path] != d.blob {
			content, err := m.runGit(ctx, dir, env, "show", head+":"+path)
			if err != nil {
				return "", nil, err
			}
			d.content, d.read = strings.ToValidUTF8(string(content), "�"), true
			d.title = docTitle(d.content, path)
		}
		docs = append(docs, d)
	}
	return head, docs, nil
}

// isDoc says whether a file of the branch is one of DocGlobs.
func isDoc(path string) bool {
	for _, glob := range DocGlobs {
		if ok, _ := doublestar.Match(glob, path); ok {
			return true
		}
	}
	return false
}

// docTitle is the document's first `# ` heading, outside its frontmatter
// and its fenced code; else its path.
func docTitle(content, path string) string {
	lines := strings.Split(content, "\n")
	i := 0
	if len(lines) > 0 && strings.TrimSpace(lines[0]) == "---" {
		for i = 1; i < len(lines) && strings.TrimSpace(lines[i]) != "---"; i++ {
		}
		i++
	}
	fence := ""
	for ; i < len(lines); i++ {
		line := strings.TrimRight(lines[i], "\r")
		indented := strings.TrimLeft(line, " ")
		switch {
		case fence != "":
			if strings.HasPrefix(indented, fence) {
				fence = ""
			}
		case strings.HasPrefix(indented, "```"):
			fence = "```"
		case strings.HasPrefix(indented, "~~~"):
			fence = "~~~"
		case strings.HasPrefix(line, "# "):
			if title := strings.TrimSpace(strings.TrimRight(strings.TrimSpace(line[2:]), "#")); title != "" {
				return title
			}
		}
	}
	return path
}

// putDocs makes the key's docs and their search rows these, the head
// indexed; a doc not read keeps its rows. It gives how many docs went.
func putDocs(tx *sql.Tx, key, head string, docs []doc) (int, error) {
	listed := map[string]bool{}
	for _, d := range docs {
		listed[d.path] = true
	}
	rows, err := tx.Query("SELECT path FROM docs WHERE repository = ?", key)
	if err != nil {
		return 0, fmt.Errorf("mirror: docs: %w", err)
	}
	var gone []string
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			rows.Close()
			return 0, err
		}
		if !listed[path] {
			gone = append(gone, path)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, path := range gone {
		if err := deleteDoc(tx, key, path); err != nil {
			return 0, err
		}
	}
	for _, d := range docs {
		if !d.read {
			continue
		}
		if err := deleteDoc(tx, key, d.path); err != nil {
			return 0, err
		}
		if _, err := tx.Exec("INSERT INTO docs (repository, path, blob_sha, title) VALUES (?, ?, ?, ?)", key, d.path, d.blob, d.title); err != nil {
			return 0, fmt.Errorf("mirror: docs: %w", err)
		}
		if _, err := tx.Exec("INSERT INTO search (kind, repository, number, path, title, content) VALUES ('doc', ?, NULL, ?, ?, ?)",
			key, d.path, d.title, d.content); err != nil {
			return 0, fmt.Errorf("mirror: docs: %w", err)
		}
	}
	if _, err := tx.Exec("UPDATE projects SET docs_head = ? WHERE repository = ?", null(head), key); err != nil {
		return 0, fmt.Errorf("mirror: docs: %w", err)
	}
	return len(gone), nil
}

func deleteDoc(tx *sql.Tx, key, path string) error {
	if _, err := tx.Exec("DELETE FROM docs WHERE repository = ? AND path = ?", key, path); err != nil {
		return fmt.Errorf("mirror: docs: %w", err)
	}
	if _, err := tx.Exec("DELETE FROM search WHERE kind = 'doc' AND repository = ? AND path = ?", key, path); err != nil {
		return fmt.Errorf("mirror: docs: %w", err)
	}
	return nil
}

// clearDocs drops the documents of a key that no longer holds the code group.
func (m *Mirror) clearDocs(key string, indexed sql.NullString) error {
	known, err := m.Store.docBlobs(key)
	if err != nil {
		return err
	}
	if len(known) == 0 && !indexed.Valid {
		return nil
	}
	return m.Store.Update(func(tx *sql.Tx) error {
		_, err := putDocs(tx, key, "", nil)
		return err
	})
}

// docsHead is the head the key's documents were indexed at; null before any.
func (s *Store) docsHead(key string) (sql.NullString, error) {
	var head sql.NullString
	if err := s.db.QueryRow("SELECT docs_head FROM projects WHERE repository = ?", key).Scan(&head); err != nil {
		return head, fmt.Errorf("mirror: docs: %w", err)
	}
	return head, nil
}

// docBlobs are the blobs of the key's indexed documents, by path.
func (s *Store) docBlobs(key string) (map[string]string, error) {
	rows, err := s.db.Query("SELECT path, blob_sha FROM docs WHERE repository = ?", key)
	if err != nil {
		return nil, fmt.Errorf("mirror: docs: %w", err)
	}
	defer rows.Close()
	blobs := map[string]string{}
	for rows.Next() {
		var path, blob string
		if err := rows.Scan(&path, &blob); err != nil {
			return nil, err
		}
		blobs[path] = blob
	}
	return blobs, rows.Err()
}
