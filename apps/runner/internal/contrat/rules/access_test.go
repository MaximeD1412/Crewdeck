package rules

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

const conformingPRD = "## Problème\n\n- **US-1** a\n- **US-2** b\n"

// outside writes, out of any worktree, the files a rule would accept.
func outside(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for path, content := range map[string]string{"prd.md": conformingPRD, "screens.json": "[]", "docs/prd.md": conformingPRD, "T-1.md": "---\nid: T-1\n---\n"} {
		full := filepath.Join(dir, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func symlink(t *testing.T, to, at string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(at), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(to, at); err != nil {
		t.Fatal(err)
	}
}

var sectionsRule = Rule{Kind: KindSections, Path: "docs/prd.md", Headings: []string{"Problème"}}
var patternRule = Rule{Kind: KindPattern, Path: "docs/prd.md", Regex: `^- \*\*US-(\d+)\*\* `, Unique: true}
var jsonRule = Rule{Kind: KindJSON, Path: "design/screens.json", Schema: []byte(`{"type":"array"}`)}

// A deliverable is the worktree's own: a link out of it, to a file that
// would pass or to a device, fails the rule like a missing file, whether it
// is the file itself or a folder above it.
func TestALinkOutOfTheWorktreeFailsTheRule(t *testing.T) {
	out := outside(t)
	direct := worktree(t, map[string]string{"backlog/T-0.md": "---\nid: T-0\n---\n"})
	symlink(t, filepath.Join(out, "prd.md"), filepath.Join(direct.Dir, "docs", "prd.md"))
	symlink(t, filepath.Join(out, "screens.json"), filepath.Join(direct.Dir, "design", "screens.json"))
	symlink(t, filepath.Join(out, "T-1.md"), filepath.Join(direct.Dir, "backlog", "T-1.md"))
	symlink(t, filepath.Join(out, "prd.md"), filepath.Join(direct.Dir, "notes", "a.md"))
	parent := worktree(t, nil)
	symlink(t, filepath.Join(out, "docs"), filepath.Join(parent.Dir, "docs"))
	symlink(t, out, filepath.Join(parent.Dir, "design"))

	for name, tg := range map[string]struct {
		target target.Target
		rules  []Rule
	}{
		"the file itself": {direct, []Rule{
			{Kind: KindFile, Path: "docs/prd.md"}, sectionsRule, patternRule, jsonRule,
			{Kind: KindFrontMatter, Glob: "backlog/*.md", Schema: []byte(`{"required":["id"]}`)},
			{Kind: KindFile, Glob: "notes/*.md"},
		}},
		"a folder above it": {parent, []Rule{
			{Kind: KindFile, Path: "docs/prd.md"}, sectionsRule, patternRule, jsonRule,
			{Kind: KindFile, Glob: "docs/**/*.md"}, {Kind: KindPattern, Glob: "docs/*.md", Regex: "US-"},
		}},
	} {
		for _, r := range tg.rules {
			failsWithoutError(t, name, tg.target, r)
		}
	}
}

// A device is never read: a link to /dev/zero would never end.
func TestALinkToADeviceFailsTheRule(t *testing.T) {
	tg := worktree(t, nil)
	symlink(t, "/dev/zero", filepath.Join(tg.Dir, "docs", "prd.md"))
	symlink(t, "/dev/zero", filepath.Join(tg.Dir, "design", "screens.json"))
	for _, r := range []Rule{sectionsRule, patternRule, jsonRule} {
		failsWithoutError(t, "a device", tg, r)
	}
}

func failsWithoutError(t *testing.T, name string, tg target.Target, r Rule) {
	t.Helper()
	r.ID, r.Label, r.Severity = "x.rule", "Une règle", Bloquant
	passed, err := Evaluate(context.Background(), tg, r)
	if passed || err != nil {
		t.Errorf("%s, %s %s%s: %v, %v; want failed, no error", name, r.Kind, r.Path, r.Glob, passed, err)
	}
}

func TestALinkInsideTheWorktreeIsFollowed(t *testing.T) {
	tg := worktree(t, map[string]string{"real/prd.md": conformingPRD, "real/screens.json": "[]"})
	symlink(t, filepath.Join("..", "real", "prd.md"), filepath.Join(tg.Dir, "docs", "prd.md"))
	symlink(t, "real", filepath.Join(tg.Dir, "design"))
	for _, r := range []Rule{{Kind: KindFile, Path: "docs/prd.md"}, sectionsRule, patternRule, jsonRule, {Kind: KindFile, Glob: "design/*.json"}} {
		if !evaluate(t, tg, r) {
			t.Errorf("%s %s%s: failed through a link inside the worktree", r.Kind, r.Path, r.Glob)
		}
	}
}

// A folder where a file is due, or a file where a folder is, fails the rule
// with a verdict, not an error.
func TestAFileOfTheWrongTypeFailsTheRule(t *testing.T) {
	tg := worktree(t, map[string]string{"docs/prd.md/a.md": "", "design/screens.json/a": "", "README.md": ""})
	for _, r := range []Rule{
		sectionsRule, patternRule, jsonRule,
		{Kind: KindFrontMatter, Glob: "design/*", Schema: []byte(`{}`)},
		{Kind: KindFile, Path: "README.md/x"},
		{Kind: KindSections, Path: "README.md/x", Headings: []string{"A"}},
		{Kind: KindPattern, Path: "README.md/x", Regex: "a"},
		{Kind: KindJSON, Path: "README.md/x.json", Schema: []byte(`{}`)},
	} {
		failsWithoutError(t, "wrong type", tg, r)
	}
}

// What is not the output's fault stays an error: a file the Runner may not read.
func TestAnUnreadableFileIsAnError(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root reads any file")
	}
	tg := worktree(t, map[string]string{"docs/prd.md": conformingPRD})
	if err := os.Chmod(filepath.Join(tg.Dir, "docs", "prd.md"), 0); err != nil {
		t.Fatal(err)
	}
	r := sectionsRule
	r.ID, r.Label, r.Severity = "x.rule", "Une règle", Bloquant
	if _, err := Evaluate(context.Background(), tg, r); err == nil {
		t.Error("an unreadable file gave no error")
	}
}

func TestAFileAboveTheSizeLimitFailsTheRule(t *testing.T) {
	tg := worktree(t, map[string]string{"design/screens.json": "[" + strings.Repeat(" ", target.MaxFileSize) + "]"})
	if evaluate(t, tg, jsonRule) {
		t.Error("a file above the limit passed")
	}
}
