// Package local is the Local Source (ADR 0012): a Projet whose folder of the
// Pilote's machine is the source of truth, its Tickets Markdown files of
// `tickets/`, what the work writes about them in local.db. The Runner writes
// the files in place and never commits them.
package local

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	_ "modernc.org/sqlite" // pure Go: the binaries stay static
)

// FileName is local.db in the Runner's folder, beside miroir.db and apart
// from it: original data, never rebuilt (risk OPS-10).
const FileName = "local.db"

//go:embed migrations/*.sql
var migrations embed.FS

// SchemaVersion is the last migration this binary knows, kept in PRAGMA
// user_version once applied.
var SchemaVersion = len(mustMigrations())

// ErrNewerVersion: local.db was migrated by a newer Runner; it is never opened.
var ErrNewerVersion = errors.New("local.db vient d'une version plus récente du Runner : mets-le à jour avec crewdeck-runner update.")

const (
	dirMode  os.FileMode = 0o700
	fileMode os.FileMode = 0o600
)

// DB is local.db, opened by the running Runner, its one writer.
type DB struct {
	db   *sql.DB
	path string
}

// DefaultPath is local.db in the Runner's folder.
func DefaultPath(home string) string { return filepath.Join(home, FileName) }

// OpenDB opens local.db, creating it mode 600 when it does not exist, and
// applies the migrations it lacks in order, one transaction each. A file of
// a newer version than this binary knows is not touched.
func OpenDB(path string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), dirMode); err != nil {
		return nil, fmt.Errorf("local: create local.db's folder: %w", err)
	}
	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, fileMode)
	if err != nil {
		return nil, fmt.Errorf("local: create local.db: %w", err)
	}
	file.Close()
	if err := os.Chmod(path, fileMode); err != nil {
		return nil, fmt.Errorf("local: chmod local.db: %w", err)
	}
	// Read the version before WAL: a newer file is left byte for byte.
	version, err := readVersion(path)
	if err != nil {
		return nil, err
	}
	if version > SchemaVersion {
		return nil, ErrNewerVersion
	}
	db, err := sql.Open("sqlite", dsn(path, "_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"))
	if err != nil {
		return nil, fmt.Errorf("local: open local.db: %w", err)
	}
	db.SetMaxOpenConns(1)
	d := &DB{db: db, path: path}
	if err := d.migrate(version); err != nil {
		db.Close()
		return nil, err
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		if err := os.Chmod(path+suffix, fileMode); err != nil && !errors.Is(err, os.ErrNotExist) {
			db.Close()
			return nil, fmt.Errorf("local: chmod local.db's %s file: %w", suffix, err)
		}
	}
	return d, nil
}

// OpenReadOnly opens local.db for a reader other than the running Runner (an
// agent's command, `uninstall`), which never writes.
func OpenReadOnly(path string) (*DB, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("local: local.db: %w", err)
	}
	version, err := readVersion(path)
	if err != nil {
		return nil, err
	}
	if version > SchemaVersion {
		return nil, ErrNewerVersion
	}
	db, err := sql.Open("sqlite", dsn(path, "mode=ro&_pragma=busy_timeout(5000)&_pragma=query_only(1)"))
	if err != nil {
		return nil, fmt.Errorf("local: open local.db: %w", err)
	}
	return &DB{db: db, path: path}, nil
}

func readVersion(path string) (int, error) {
	db, err := sql.Open("sqlite", dsn(path, "mode=ro&_pragma=busy_timeout(5000)"))
	if err != nil {
		return 0, fmt.Errorf("local: open local.db: %w", err)
	}
	defer db.Close()
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return 0, fmt.Errorf("local: read local.db's version: %w", err)
	}
	return version, nil
}

// SQL is the connection, for the queries of this package and its tests.
func (d *DB) SQL() *sql.DB { return d.db }

// Close closes the connection.
func (d *DB) Close() error { return d.db.Close() }

// HoldsWork says whether local.db holds what the work wrote and nothing else
// has: a comment, a change or a review (`uninstall` warns before removing it).
func (d *DB) HoldsWork() (bool, error) {
	var held bool
	err := d.db.QueryRow(`SELECT EXISTS (SELECT 1 FROM comments) OR EXISTS (SELECT 1 FROM changes) OR EXISTS (SELECT 1 FROM reviews)`).Scan(&held)
	if err != nil {
		return false, fmt.Errorf("local: read local.db: %w", err)
	}
	return held, nil
}

func (d *DB) migrate(from int) error {
	for i, script := range mustMigrations() {
		version := i + 1
		if version <= from {
			continue
		}
		tx, err := d.db.Begin()
		if err != nil {
			return fmt.Errorf("local: migrate local.db to v%d: %w", version, err)
		}
		if _, err := tx.Exec(script); err != nil {
			tx.Rollback()
			return fmt.Errorf("local: migrate local.db to v%d: %w", version, err)
		}
		// PRAGMA user_version is written in the transaction: a migration is applied whole, or not.
		if _, err := tx.Exec("PRAGMA user_version = " + strconv.Itoa(version)); err != nil {
			tx.Rollback()
			return fmt.Errorf("local: migrate local.db to v%d: %w", version, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("local: migrate local.db to v%d: %w", version, err)
		}
	}
	return nil
}

// mustMigrations is the migrations' scripts, `NNNN_<name>.sql` in order, each
// numbered from 1 without a gap.
func mustMigrations() []string {
	names, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		panic(err)
	}
	sort.Strings(names)
	scripts := make([]string, 0, len(names))
	for i, name := range names {
		if !strings.HasPrefix(filepath.Base(name), fmt.Sprintf("%04d_", i+1)) {
			panic("local: migration " + name + " out of order")
		}
		data, err := migrations.ReadFile(name)
		if err != nil {
			panic(err)
		}
		scripts = append(scripts, string(data))
	}
	return scripts
}

func dsn(path, query string) string {
	return "file:" + (&url.URL{Path: path}).EscapedPath() + "?" + query
}
