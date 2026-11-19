package local_test

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
	_ "modernc.org/sqlite"
)

func TestLocalDBIsCreatedMode600AtV1(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local.db")
	db, err := local.OpenDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("mode %v, want 600", info.Mode().Perm())
	}
	if v := userVersion(t, db.SQL()); v != 1 || local.SchemaVersion != 1 {
		t.Errorf("user_version %d, SchemaVersion %d, want 1", v, local.SchemaVersion)
	}
	var mode string
	if err := db.SQL().QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil || mode != "wal" {
		t.Errorf("journal_mode %q, %v", mode, err)
	}
}

func TestLocalDBOfANewerVersionIsNeverOpened(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local.db")
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec("CREATE TABLE kept (x); INSERT INTO kept VALUES (1); PRAGMA user_version = 2"); err != nil {
		t.Fatal(err)
	}
	raw.Close()
	before, _ := os.ReadFile(path)
	_, err = local.OpenDB(path)
	if err == nil || err.Error() != "local.db vient d'une version plus récente du Runner : mets-le à jour avec crewdeck-runner update." {
		t.Fatalf("OpenDB: %v", err)
	}
	if after, _ := os.ReadFile(path); string(after) != string(before) {
		t.Error("the newer local.db was changed")
	}
}

func TestLocalMigrationAppliesV1OnAnEmptyFileAndKeepsRowsAcrossAReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local.db")
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	db, err := local.OpenDB(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"projects", "tickets", "comments", "changes", "reviews", "review_comments"} {
		if _, err := db.SQL().Exec("SELECT * FROM " + table + " LIMIT 0"); err != nil {
			t.Errorf("table %s: %v", table, err)
		}
	}
	if _, err := db.SQL().Exec(`INSERT INTO comments (id, project_id, number, author, body, created_at) VALUES ('c1', 'p', 1, 'agent', 'Fait.', '2026-11-19T09:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	db, err = local.OpenDB(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var body string
	if err := db.SQL().QueryRow("SELECT body FROM comments WHERE id = 'c1'").Scan(&body); err != nil || body != "Fait." {
		t.Errorf("comment after a re-open: %q, %v", body, err)
	}
	if v := userVersion(t, db.SQL()); v != 1 {
		t.Errorf("user_version %d", v)
	}
}

func userVersion(t *testing.T, db *sql.DB) int {
	t.Helper()
	var v int
	if err := db.QueryRow("PRAGMA user_version").Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}
