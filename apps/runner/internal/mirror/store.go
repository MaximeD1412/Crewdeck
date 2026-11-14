// Package mirror is the Runner's Miroir (ADR 0010): miroir.db, one SQLite
// copy of GitHub for every Projet of the Pilote, written only from what
// GitHub answers, read by the agents. The copy holds the Projets' content on
// the Pilote's disk (risk SEC-10): its files are mode 600, and nothing of it
// (a title, a body, a message) is ever in a log or an error.
package mirror

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
	_ "modernc.org/sqlite" // pure Go, FTS5 included: the binaries stay static
)

// SchemaVersion is schema.sql's version, kept in PRAGMA user_version; a copy
// of another version is rebuilt.
const SchemaVersion = 1

// FileName is the copy's file in the Runner's folder.
const FileName = "miroir.db"

// MetaMirrorAfter is the meta key of the last github_changes.seq applied (MIROIR-4).
const MetaMirrorAfter = "mirror_after"

//go:embed schema.sql
var schema string

const (
	dirMode  os.FileMode = 0o700
	fileMode os.FileMode = 0o600
)

// Store is a connection to miroir.db: the writer's (Open), else a reader's (OpenReadOnly).
type Store struct {
	db   *sql.DB
	path string
}

// DefaultPath is miroir.db in the Runner's folder ($CREWDECK_HOME or ~/.crewdeck).
func DefaultPath() (string, error) {
	dir, err := state.Default()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir.Dir, FileName), nil
}

// Open opens the writer's connection, creating the copy (mode 600) when it
// does not exist and rebuilding it empty when it is of another SchemaVersion.
// There is one writer, the running Runner.
func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), dirMode); err != nil {
		return nil, fmt.Errorf("mirror: create the copy's folder: %w", err)
	}
	// MkdirAll keeps the mode of a folder that already exists.
	if err := os.Chmod(filepath.Dir(path), dirMode); err != nil {
		return nil, fmt.Errorf("mirror: chmod the copy's folder: %w", err)
	}
	// Created mode 600 before SQLite opens it, so that it never is readable by others.
	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, fileMode)
	if err != nil {
		return nil, fmt.Errorf("mirror: create the copy: %w", err)
	}
	file.Close()
	if err := os.Chmod(path, fileMode); err != nil {
		return nil, fmt.Errorf("mirror: chmod the copy: %w", err)
	}
	db, err := sql.Open("sqlite", dsn(path, "_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"))
	if err != nil {
		return nil, fmt.Errorf("mirror: open the copy: %w", err)
	}
	// One connection: one writer, whose transactions never wait on each other.
	db.SetMaxOpenConns(1)
	store := &Store{db: db, path: path}
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		db.Close()
		return nil, fmt.Errorf("mirror: read the copy's version: %w", err)
	}
	if version != SchemaVersion {
		if err := store.Rebuild(); err != nil {
			db.Close()
			return nil, err
		}
	}
	if err := store.tightenWAL(); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

// OpenReadOnly opens a reader's connection (an agent's command, MIROIR-6),
// which never writes; WAL lets it read while the Runner writes.
func OpenReadOnly(path string) (*Store, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("mirror: the copy: %w", err)
	}
	db, err := sql.Open("sqlite", dsn(path, "mode=ro&_pragma=busy_timeout(5000)&_pragma=query_only(1)"))
	if err != nil {
		return nil, fmt.Errorf("mirror: open the copy: %w", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("mirror: open the copy: %w", err)
	}
	return &Store{db: db, path: path}, nil
}

func dsn(path, query string) string {
	return "file:" + (&url.URL{Path: path}).EscapedPath() + "?" + query
}

// tightenWAL gives the -wal and -shm files mode 600, once SQLite created them.
func (s *Store) tightenWAL() error {
	for _, suffix := range []string{"-wal", "-shm"} {
		err := os.Chmod(s.path+suffix, fileMode)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("mirror: chmod the copy's %s file: %w", suffix, err)
		}
	}
	return nil
}

// DB is the connection, for the readers' queries.
func (s *Store) DB() *sql.DB { return s.db }

// Close closes the connection.
func (s *Store) Close() error { return s.db.Close() }

// Update runs fn in one transaction, committed when fn returns nil.
func (s *Store) Update(fn func(tx *sql.Tx) error) error {
	tx, err := s.db.BeginTx(context.Background(), nil)
	if err != nil {
		return fmt.Errorf("mirror: begin: %w", err)
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("mirror: commit: %w", err)
	}
	return s.tightenWAL()
}

// Rebuild drops the copy and recreates it empty at SchemaVersion: every
// Projet is kept, back to unfilled; the cursor is dropped, so that the
// server resyncs it (`crewdeck-runner miroir rebuild`, a new version).
func (s *Store) Rebuild() error {
	ctx := context.Background()
	conn, err := s.db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("mirror: rebuild: %w", err)
	}
	defer conn.Close()
	projects := s.keptProjects(ctx, conn)
	// Dropping a table with foreign keys on deletes its rows one by one first.
	if _, err := conn.ExecContext(ctx, "PRAGMA foreign_keys = OFF"); err != nil {
		return fmt.Errorf("mirror: rebuild: %w", err)
	}
	defer conn.ExecContext(ctx, "PRAGMA foreign_keys = ON")
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("mirror: rebuild: %w", err)
	}
	defer tx.Rollback()
	// The virtual tables first: they drop their shadow tables with them.
	for _, kind := range []string{"sql LIKE 'CREATE VIRTUAL TABLE%'", "1"} {
		names, err := tableNames(ctx, tx, kind)
		if err != nil {
			return err
		}
		for _, name := range names {
			if _, err := tx.ExecContext(ctx, `DROP TABLE IF EXISTS "`+name+`"`); err != nil {
				return fmt.Errorf("mirror: rebuild: drop a table: %w", err)
			}
		}
	}
	if _, err := tx.ExecContext(ctx, schema); err != nil {
		return fmt.Errorf("mirror: rebuild: create the schema: %w", err)
	}
	if _, err := tx.ExecContext(ctx, fmt.Sprintf("PRAGMA user_version = %d", SchemaVersion)); err != nil {
		return fmt.Errorf("mirror: rebuild: %w", err)
	}
	if err := putProjects(ctx, tx, projects); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("mirror: rebuild: %w", err)
	}
	return nil
}

func tableNames(ctx context.Context, tx *sql.Tx, where string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND "+where)
	if err != nil {
		return nil, fmt.Errorf("mirror: rebuild: list the tables: %w", err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

// keptProjects reads the Projets of the copy before a rebuild; none when its
// schema does not have them as this version does.
func (s *Store) keptProjects(ctx context.Context, conn *sql.Conn) []Project {
	rows, err := conn.QueryContext(ctx, "SELECT repository, project_id, github_repo_id, installation_id, display_name, integration_branch FROM projects")
	if err != nil {
		return nil
	}
	defer rows.Close()
	var projects []Project
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.Repository, &p.ProjectID, &p.GitHubRepoID, &p.InstallationID, &p.DisplayName, &p.IntegrationBranch); err != nil {
			return nil
		}
		projects = append(projects, p)
	}
	if rows.Err() != nil {
		return nil
	}
	return projects
}

// Project is a Projet of the Pilote, as the server names it (mirror.projects).
type Project struct {
	Repository        string // owner/name
	ProjectID         string
	GitHubRepoID      int64
	InstallationID    int64
	DisplayName       string
	IntegrationBranch string
}

// repositoryTables are the tables keyed by a repository, which a repository
// no longer a Projet leaves.
var repositoryTables = []string{
	"issues", "issue_labels", "issue_assignees", "comments", "sub_issues", "blocked_by",
	"pulls", "pull_commits", "closing_issues", "reviews", "review_comments",
	"checks", "checks_read", "repo_labels", "milestones", "releases", "search",
}

// PutProjects makes the copy's Projets these: adds the new ones (unfilled),
// updates the others (keeping their filled_at and synced_at), and deletes every
// row of a repository no longer a Projet.
func (s *Store) PutProjects(projects []Project) error {
	return s.Update(func(tx *sql.Tx) error {
		ctx := context.Background()
		kept := map[string]bool{}
		for _, p := range projects {
			kept[p.Repository] = true
		}
		every := "SELECT repository FROM projects"
		for _, table := range repositoryTables {
			every += " UNION SELECT repository FROM " + table
		}
		rows, err := tx.QueryContext(ctx, every)
		if err != nil {
			return fmt.Errorf("mirror: projects: %w", err)
		}
		var gone []string
		for rows.Next() {
			var repo string
			if err := rows.Scan(&repo); err != nil {
				rows.Close()
				return err
			}
			if !kept[repo] {
				gone = append(gone, repo)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for _, repo := range gone {
			for _, table := range append([]string{"projects"}, repositoryTables...) {
				if _, err := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE repository = ?", repo); err != nil {
					return fmt.Errorf("mirror: projects: %w", err)
				}
			}
		}
		return putProjects(ctx, tx, projects)
	})
}

func putProjects(ctx context.Context, tx *sql.Tx, projects []Project) error {
	for _, p := range projects {
		if _, err := tx.ExecContext(ctx, `INSERT INTO projects (repository, project_id, github_repo_id, installation_id, display_name, integration_branch)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (repository) DO UPDATE SET project_id = excluded.project_id, github_repo_id = excluded.github_repo_id,
				installation_id = excluded.installation_id, display_name = excluded.display_name, integration_branch = excluded.integration_branch`,
			p.Repository, p.ProjectID, p.GitHubRepoID, p.InstallationID, p.DisplayName, p.IntegrationBranch); err != nil {
			return fmt.Errorf("mirror: projects: %w", err)
		}
	}
	return nil
}

// Projects are the copy's Projets.
func (s *Store) Projects() ([]Project, error) {
	rows, err := s.db.Query("SELECT repository, project_id, github_repo_id, installation_id, display_name, integration_branch FROM projects ORDER BY repository")
	if err != nil {
		return nil, fmt.Errorf("mirror: projects: %w", err)
	}
	defer rows.Close()
	var projects []Project
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.Repository, &p.ProjectID, &p.GitHubRepoID, &p.InstallationID, &p.DisplayName, &p.IntegrationBranch); err != nil {
			return nil, err
		}
		projects = append(projects, p)
	}
	return projects, rows.Err()
}

// MarkFilled records the end of the Projet's first complete reconciliation.
func (s *Store) MarkFilled(repository string, at time.Time) error {
	return s.mark("filled_at", repository, at)
}

// MarkSynced records the Projet's last applied envelope or reconciliation.
func (s *Store) MarkSynced(repository string, at time.Time) error {
	return s.mark("synced_at", repository, at)
}

func (s *Store) mark(column, repository string, at time.Time) error {
	if _, err := s.db.Exec("UPDATE projects SET "+column+" = ? WHERE repository = ?", at.UTC().Format(time.RFC3339), repository); err != nil {
		return fmt.Errorf("mirror: %s of %s: %w", column, repository, err)
	}
	return s.tightenWAL()
}

// SetMeta writes one of the Runner's values, in the transaction that needs it.
func SetMeta(tx *sql.Tx, key, value string) error {
	if _, err := tx.Exec("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, value); err != nil {
		return fmt.Errorf("mirror: meta %s: %w", key, err)
	}
	return nil
}
