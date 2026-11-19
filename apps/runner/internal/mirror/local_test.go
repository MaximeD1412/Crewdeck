package mirror

import (
	"bytes"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

// The Miroir is a copy, rebuilt at will; local.db beside it is original
// data (ADR 0012, risk OPS-10): neither a rebuild nor a new SchemaVersion
// touches it.
func TestRebuildAndANewSchemaVersionLeaveLocalDBByteForByte(t *testing.T) {
	home := filepath.Join(t.TempDir(), ".crewdeck")
	t.Setenv("CREWDECK_HOME", home)
	db, err := local.OpenDB(local.DefaultPath(home))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.SQL().Exec(`INSERT INTO comments (id, project_id, number, author, body, created_at) VALUES ('c1', 'p1', 3, 'agent', 'Revu.', '2026-11-19T09:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	before := localFiles(t, home)

	path, err := DefaultPath()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(path) != home {
		t.Fatalf("miroir.db at %s, want it beside local.db", path)
	}
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Rebuild(); err != nil {
		t.Fatal(err)
	}
	store.Close()
	// Another SchemaVersion: Open rebuilds the copy.
	raw, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec("PRAGMA user_version = 0"); err != nil {
		t.Fatal(err)
	}
	raw.Close()
	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	store.Close()

	after := localFiles(t, home)
	if len(after) != len(before) {
		t.Fatalf("local.db's files %v after, want %v", keys(after), keys(before))
	}
	for name, data := range before {
		if !bytes.Equal(after[name], data) {
			t.Fatalf("%s changed", name)
		}
	}
}

// localFiles are local.db and its WAL files, by name.
func localFiles(t *testing.T, home string) map[string][]byte {
	t.Helper()
	files := map[string][]byte{}
	for _, name := range []string{local.FileName, local.FileName + "-wal", local.FileName + "-shm"} {
		data, err := os.ReadFile(filepath.Join(home, name))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		files[name] = data
	}
	if _, ok := files[local.FileName]; !ok {
		t.Fatal("no local.db")
	}
	return files
}

func keys(files map[string][]byte) []string {
	var names []string
	for name := range files {
		names = append(names, name)
	}
	return names
}
