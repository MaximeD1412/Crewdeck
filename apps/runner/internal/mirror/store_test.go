package mirror

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

func openStore(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "miroir.db")
	store, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return store, path
}

// query reads the copy as an agent's `sql` would, on its own read-only connection.
func query(t *testing.T, path, statement string, args ...any) [][]any {
	t.Helper()
	reader, err := OpenReadOnly(path)
	if err != nil {
		t.Fatalf("OpenReadOnly: %v", err)
	}
	defer reader.Close()
	rows, err := reader.DB().Query(statement, args...)
	if err != nil {
		t.Fatalf("%s: %v", statement, err)
	}
	defer rows.Close()
	columns, _ := rows.Columns()
	var out [][]any
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			t.Fatal(err)
		}
		for i, v := range values {
			if b, ok := v.([]byte); ok {
				values[i] = string(b)
			}
		}
		out = append(out, values)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func count(t *testing.T, path, statement string, args ...any) int64 {
	t.Helper()
	return query(t, path, statement, args...)[0][0].(int64)
}

var atelier = Project{Repository: "acme/atelier", ProjectID: "prj_1", GitHubRepoID: 101, InstallationID: 7, DisplayName: "Atelier", IntegrationBranch: "develop"}

func TestOpenCreatesTheDatabaseAndItsWALFilesReadableByThePiloteOnly(t *testing.T) {
	store, path := openStore(t)
	if err := store.PutProjects([]Project{atelier}); err != nil {
		t.Fatalf("PutProjects: %v", err)
	}
	for _, name := range []string{path, path + "-wal", path + "-shm"} {
		info, err := os.Stat(name)
		if err != nil {
			t.Fatalf("%s: %v", filepath.Base(name), err)
		}
		if mode := info.Mode().Perm(); mode != 0o600 {
			t.Errorf("%s mode %o, want 600", filepath.Base(name), mode)
		}
	}
	if got := query(t, path, "PRAGMA journal_mode")[0][0]; got != "wal" {
		t.Errorf("journal_mode %v, want wal", got)
	}
	if got := query(t, path, "PRAGMA user_version")[0][0]; got != int64(SchemaVersion) {
		t.Errorf("user_version %v, want %d", got, SchemaVersion)
	}
}

func TestOpenTightensTheModeOfAnExistingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "miroir.db")
	if err := os.WriteFile(path, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()
	info, _ := os.Stat(path)
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("mode %o, want 600", mode)
	}
}

func TestOpenTightensTheModeOfAnExistingFolder(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "crewdeck")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0o777); err != nil {
		t.Fatal(err)
	}
	store, err := Open(filepath.Join(dir, "miroir.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()
	info, _ := os.Stat(dir)
	if mode := info.Mode().Perm(); mode != 0o700 {
		t.Errorf("folder mode %o, want 700", mode)
	}
}

func TestOpenRebuildsADatabaseOfAnotherSchemaVersionEmpty(t *testing.T) {
	store, path := openStore(t)
	if err := store.PutProjects([]Project{atelier}); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkFilled(atelier.Repository, time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	if err := store.Update(func(tx *sql.Tx) error {
		if err := PutObject(tx, Object{Repository: "acme/atelier", Number: 38, Title: "Un ticket", State: "OPEN"}); err != nil {
			return err
		}
		return SetMeta(tx, MetaMirrorAfter, "41")
	}); err != nil {
		t.Fatal(err)
	}
	store.Close()

	// An older Runner's copy: version 0, a table of its own.
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{"PRAGMA user_version = 0", "CREATE TABLE old_things (x)"} {
		if _, err := raw.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	raw.Close()

	store, err = Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer store.Close()
	if got := query(t, path, "PRAGMA user_version")[0][0]; got != int64(SchemaVersion) {
		t.Errorf("user_version %v, want %d", got, SchemaVersion)
	}
	if n := count(t, path, "SELECT count(*) FROM sqlite_master WHERE name = 'old_things'"); n != 0 {
		t.Error("the old table survived the rebuild")
	}
	if n := count(t, path, "SELECT count(*) FROM issues"); n != 0 {
		t.Errorf("%d issues after the rebuild, want none", n)
	}
	if n := count(t, path, "SELECT count(*) FROM meta"); n != 0 {
		t.Errorf("the cursor survived the rebuild")
	}
	rows := query(t, path, "SELECT repository, project_id, filled_at, synced_at FROM projects")
	if len(rows) != 1 || rows[0][0] != "acme/atelier" || rows[0][1] != "prj_1" || rows[0][2] != nil || rows[0][3] != nil {
		t.Errorf("projects after the rebuild %v, want acme/atelier back to unfilled", rows)
	}
}

func TestOpenReadOnlyRefusesToWrite(t *testing.T) {
	_, path := openStore(t)
	reader, err := OpenReadOnly(path)
	if err != nil {
		t.Fatalf("OpenReadOnly: %v", err)
	}
	defer reader.Close()
	if _, err := reader.DB().Exec("INSERT INTO meta (key, value) VALUES ('x', 'y')"); err == nil {
		t.Fatal("a read-only connection wrote")
	}
}

func TestDefaultPathIsInTheRunnersFolder(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(state.HomeEnv, dir)
	path, err := DefaultPath()
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(dir, "miroir.db") {
		t.Errorf("DefaultPath %s", path)
	}
}

func TestPutProjectsDeletesTheCopyOfARepositoryNoLongerAProjet(t *testing.T) {
	store, path := openStore(t)
	outils := Project{Repository: "acme/outils", ProjectID: "prj_2", GitHubRepoID: 102, InstallationID: 7, DisplayName: "Outils", IntegrationBranch: "main"}
	if err := store.PutProjects([]Project{atelier, outils}); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkFilled("acme/atelier", time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	if err := store.Update(func(tx *sql.Tx) error {
		for _, repo := range []string{"acme/atelier", "acme/outils"} {
			if err := PutObject(tx, Object{Repository: repo, Number: 1, Title: "Un", State: "OPEN", Labels: []string{"bug"}}); err != nil {
				return err
			}
			if err := PutCollections(tx, repo, []Label{{Name: "bug"}}, nil, nil); err != nil {
				return err
			}
			if err := PutChecks(tx, repo, "abc", "SUCCESS", []Check{{Typename: "CheckRun", Name: "ci"}}); err != nil {
				return err
			}
		}
		// The checks of a repository whose objects the copy does not have.
		return PutChecks(tx, "acme/ancien", "abc", "SUCCESS", []Check{{Typename: "CheckRun", Name: "ci"}})
	}); err != nil {
		t.Fatal(err)
	}

	renamed := atelier
	renamed.DisplayName = "L'atelier"
	if err := store.PutProjects([]Project{renamed}); err != nil {
		t.Fatal(err)
	}
	rows := query(t, path, "SELECT repository, display_name, filled_at FROM projects")
	if len(rows) != 1 || rows[0][1] != "L'atelier" || rows[0][2] == nil {
		t.Errorf("projects %v, want acme/atelier renamed, still filled", rows)
	}
	if n := count(t, path, "SELECT count(*) FROM checks WHERE repository = 'acme/ancien'"); n != 0 {
		t.Errorf("checks keeps %d rows of acme/ancien", n)
	}
	for _, table := range []string{"issues", "issue_labels", "repo_labels", "checks", "checks_read", "search"} {
		if n := count(t, path, "SELECT count(*) FROM "+table+" WHERE repository = 'acme/outils'"); n != 0 {
			t.Errorf("%s keeps %d rows of acme/outils", table, n)
		}
		if n := count(t, path, "SELECT count(*) FROM "+table+" WHERE repository = 'acme/atelier'"); n == 0 {
			t.Errorf("%s lost acme/atelier", table)
		}
	}
}
