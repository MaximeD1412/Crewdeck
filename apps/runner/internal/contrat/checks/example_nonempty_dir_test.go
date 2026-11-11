package checks

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

func TestExampleNonemptyDirPassesOnlyAFolderWithAnEntry(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "src", "main.txt"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	fn, ok := Lookup("example-nonempty-dir")
	if !ok {
		t.Fatal("example-nonempty-dir is not registered")
	}
	for path, want := range map[string]bool{"src": true, "empty": false, "absent": false} {
		got, err := fn(context.Background(), target.Target{Dir: dir}, map[string]any{"path": path})
		if err != nil || got != want {
			t.Errorf("%s: %v, %v, want %v", path, got, err, want)
		}
	}
	for _, params := range []map[string]any{nil, {"path": 3}, {"path": "../out"}} {
		if _, err := fn(context.Background(), target.Target{Dir: dir}, params); err == nil {
			t.Errorf("params %v: no error", params)
		}
	}
}

func TestANameIsRegisteredOnce(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("a second Register of the same name did not panic")
		}
	}()
	Register("example-nonempty-dir", exampleNonemptyDir)
}

// A file where the folder is due, or a link out of the worktree, fails the
// check without an error.
func TestExampleNonemptyDirFailsAFileOrALinkOut(t *testing.T) {
	dir, out := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "src"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(out, "main.txt"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(out, filepath.Join(dir, "lib")); err != nil {
		t.Fatal(err)
	}
	fn, _ := Lookup("example-nonempty-dir")
	for _, path := range []string{"src", "lib", "src/sub"} {
		got, err := fn(context.Background(), target.Target{Dir: dir}, map[string]any{"path": path})
		if got || err != nil {
			t.Errorf("%s: %v, %v; want false, no error", path, got, err)
		}
	}
}
