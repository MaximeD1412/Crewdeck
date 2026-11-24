package checks

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

const statusLine = `^> \*\*Status:\*\* `

func writeFiles(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	for name, content := range files {
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestEachFileHasLinePassesOnlyWhenEveryMatchedFileHasTheLine(t *testing.T) {
	fn, ok := Lookup("each-file-has-line")
	if !ok {
		t.Fatal("each-file-has-line is not registered")
	}
	params := map[string]any{"glob": "docs/adr/[0-9][0-9][0-9][0-9]-*.md", "regex": statusLine}
	cases := map[string]struct {
		files map[string]string
		want  bool
	}{
		"every file": {map[string]string{
			"docs/adr/0001-a.md": "# 1. A\n\n> **Status:** accepted, recorded from the code, 2026-11-24.\n",
			"docs/adr/0002-b.md": "# 2. B\n> **Status:** accepted.\n",
		}, true},
		"one without": {map[string]string{
			"docs/adr/0001-a.md": "# 1. A\n\n> **Status:** accepted.\n",
			"docs/adr/0002-b.md": "# 2. B\n\nStatus: accepted.\n",
		}, false},
		"the line not at a line's start": {map[string]string{"docs/adr/0001-a.md": "# 1. A — > **Status:** accepted.\n"}, false},
		"no file matched":                {map[string]string{"docs/adr/README.md": "nothing"}, true},
	}
	for name, c := range cases {
		dir := t.TempDir()
		writeFiles(t, dir, c.files)
		got, err := fn(context.Background(), target.Target{Dir: dir}, params)
		if err != nil || got != c.want {
			t.Errorf("%s: %v, %v, want %v", name, got, err, c.want)
		}
	}
}

func TestEachFileHasLineFailsALinkOutAndRefusesBadParams(t *testing.T) {
	dir, out := t.TempDir(), t.TempDir()
	writeFiles(t, out, map[string]string{"0001-a.md": "> **Status:** accepted.\n"})
	if err := os.MkdirAll(filepath.Join(dir, "docs", "adr"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(out, "0001-a.md"), filepath.Join(dir, "docs", "adr", "0001-a.md")); err != nil {
		t.Fatal(err)
	}
	fn, _ := Lookup("each-file-has-line")
	got, err := fn(context.Background(), target.Target{Dir: dir}, map[string]any{"glob": "docs/adr/*.md", "regex": statusLine})
	if got || err != nil {
		t.Errorf("a link out: %v, %v; want false, no error", got, err)
	}
	for _, params := range []map[string]any{nil, {"glob": "docs/*.md"}, {"regex": statusLine}, {"glob": 3, "regex": statusLine}, {"glob": "docs/*.md", "regex": "("}, {"glob": "../*.md", "regex": statusLine}, {"glob": "docs/[.md", "regex": statusLine}} {
		if _, err := fn(context.Background(), target.Target{Dir: dir}, params); err == nil {
			t.Errorf("params %v: no error", params)
		}
	}
}
