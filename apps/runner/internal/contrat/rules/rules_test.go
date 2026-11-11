package rules

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// worktree writes `files` (path → content) into a temporary folder.
func worktree(t *testing.T, files map[string]string) target.Target {
	t.Helper()
	dir := t.TempDir()
	for path, content := range files {
		full := filepath.Join(dir, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return target.Target{Dir: dir}
}

func evaluate(t *testing.T, tg target.Target, r Rule) bool {
	t.Helper()
	r.ID, r.Label, r.Severity = "x.rule", "Une règle", Bloquant
	if err := Validate(r); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	passed, err := Evaluate(context.Background(), tg, r)
	if err != nil {
		t.Fatalf("Evaluate: %v", err)
	}
	return passed
}

func TestAFileRuleAcceptsAFolderAndCountsOnlyFilesForAGlob(t *testing.T) {
	tg := worktree(t, map[string]string{"docs/a.md": "", "docs/sub/b.md": "", "docs/c.txt": ""})
	if !evaluate(t, tg, Rule{Kind: KindFile, Path: "docs"}) {
		t.Error("a folder at path should pass")
	}
	if !evaluate(t, tg, Rule{Kind: KindFile, Glob: "docs/**/*.md", Min: 2}) {
		t.Error("two .md under docs/ should pass min 2")
	}
	if evaluate(t, tg, Rule{Kind: KindFile, Glob: "docs/**/*.md", Min: 3}) {
		t.Error("two .md under docs/ should fail min 3")
	}
	if evaluate(t, tg, Rule{Kind: KindFile, Glob: "do*"}) {
		t.Error("a glob matching only a folder should fail")
	}
}

func TestASectionsRuleCountsOnlyItsLevelAndReadsTheHeadingsText(t *testing.T) {
	tg := worktree(t, map[string]string{"prd.md": "# PRD\n\n### Problème\n\n## Le `code` *vrai*\n\n## Problème\n"})
	if evaluate(t, tg, Rule{Kind: KindSections, Path: "prd.md", Headings: []string{"Problème", "Le code vrai"}, Level: 2}) {
		t.Error("a level 3 heading should not count for level 2")
	}
	if !evaluate(t, tg, Rule{Kind: KindSections, Path: "prd.md", Headings: []string{"Problème", "Le code vrai"}}) {
		t.Error("without a level, every heading counts")
	}
	if !evaluate(t, tg, Rule{Kind: KindSections, Path: "prd.md", Headings: []string{"PRD", "Problème"}}) {
		t.Error("headings with others between them should pass")
	}
	if evaluate(t, tg, Rule{Kind: KindSections, Path: "absent.md", Headings: []string{"PRD"}}) {
		t.Error("a missing file should fail")
	}
}

func TestAPatternRuleCountsAndDedupesAcrossTheFilesOfItsGlob(t *testing.T) {
	tg := worktree(t, map[string]string{"a/1.md": "id: A-1\r\nid: A-2\r\n", "a/2.md": "id: A-3\n", "b/1.md": "id: A-1\n"})
	if !evaluate(t, tg, Rule{Kind: KindPattern, Glob: "a/*.md", Regex: `^id: (A-\d+)$`, Unique: true, Min: 3}) {
		t.Error("three distinct ids over a/ should pass, CRLF included")
	}
	if evaluate(t, tg, Rule{Kind: KindPattern, Glob: "*/1.md", Regex: `^id: (A-\d+)$`, Unique: true}) {
		t.Error("A-1 in two files should fail unique")
	}
	if !evaluate(t, tg, Rule{Kind: KindPattern, Glob: "*/1.md", Regex: `^id: (A-\d+)$`}) {
		t.Error("A-1 in two files should pass without unique")
	}
	if evaluate(t, tg, Rule{Kind: KindPattern, Glob: "c/*.md", Regex: `^id`}) {
		t.Error("a glob with no file should fail")
	}
	if evaluate(t, tg, Rule{Kind: KindPattern, Path: "absent.md", Regex: `^id`}) {
		t.Error("a missing file should fail")
	}
}

var ticketSchema = json.RawMessage(`{"type":"object","required":["id"],"properties":{"id":{"type":"string"},"due":{"type":"string"}}}`)

func TestAFrontMatterRuleNeedsAValidHeaderInEveryFile(t *testing.T) {
	cases := map[string]struct {
		content string
		passes  bool
	}{
		"a valid header":           {"---\nid: T-1\ndue: 2026-11-11\n---\n# T-1\n", true},
		"a header at the very end": {"---\nid: T-1\n---", true},
		"no header":                {"# T-1\n\nid: T-1\n", false},
		"an unclosed header":       {"---\nid: T-1\n# T-1\n", false},
		"invalid YAML":             {"---\nid: [T-1\n---\n", false},
		"a header off its schema":  {"---\nid: 1\n---\n", false},
		"an empty header":          {"---\n---\n", false},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			tg := worktree(t, map[string]string{"backlog/ok.md": "---\nid: T-0\n---\n", "backlog/t.md": tc.content})
			if got := evaluate(t, tg, Rule{Kind: KindFrontMatter, Glob: "backlog/*.md", Schema: ticketSchema}); got != tc.passes {
				t.Fatalf("passed %v, want %v", got, tc.passes)
			}
		})
	}
	if evaluate(t, worktree(t, nil), Rule{Kind: KindFrontMatter, Glob: "backlog/*.md", Schema: ticketSchema}) {
		t.Error("no file matching the glob should fail")
	}
}

func TestAJSONRuleFailsOnAMissingOrMalformedFile(t *testing.T) {
	schema := json.RawMessage(`{"type":"array"}`)
	tg := worktree(t, map[string]string{"ok.json": "[1]", "bad.json": "[1", "object.json": "{}"})
	for path, passes := range map[string]bool{"ok.json": true, "bad.json": false, "object.json": false, "absent.json": false} {
		if got := evaluate(t, tg, Rule{Kind: KindJSON, Path: path, Schema: schema}); got != passes {
			t.Errorf("%s passed %v, want %v", path, got, passes)
		}
	}
}

func TestValidateRefusesWhatTheRunnerCannotInterpret(t *testing.T) {
	base := func(r Rule) Rule { r.ID, r.Label, r.Severity = "x.rule", "Une règle", Bloquant; return r }
	cases := map[string]Rule{
		"an unknown severity":            {ID: "x.rule", Label: "l", Severity: "info", Kind: KindFile, Path: "a"},
		"an unknown kind":                base(Rule{Kind: "lint"}),
		"a lookahead, not in RE2":        base(Rule{Kind: KindPattern, Path: "a", Regex: `^(?=US)`}),
		"a unique pattern with no group": base(Rule{Kind: KindPattern, Path: "a", Regex: `^US`, Unique: true}),
		"a path out of the worktree":     base(Rule{Kind: KindFile, Path: "../secret"}),
		"both a path and a glob":         base(Rule{Kind: KindFile, Path: "a", Glob: "*.md"}),
		"an invalid glob":                base(Rule{Kind: KindFile, Glob: "docs/[a"}),
		"a schema that is not one":       base(Rule{Kind: KindJSON, Path: "a.json", Schema: json.RawMessage(`{"type":12}`)}),
		"a schema loading a file":        base(Rule{Kind: KindJSON, Path: "a.json", Schema: json.RawMessage(`{"$ref":"file:///etc/passwd"}`)}),
		"a json rule without its schema": base(Rule{Kind: KindJSON, Path: "a.json"}),
		"an unregistered check":          base(Rule{Kind: KindCheck, Name: "nowhere"}),
		"a pr body regex RE2 refuses":    base(Rule{Kind: KindPR, Body: []string{`(?<=a)b`}}),
	}
	for name, r := range cases {
		t.Run(name, func(t *testing.T) {
			if err := Validate(r); err == nil {
				t.Fatal("Validate accepted it")
			}
		})
	}
}

func TestACheckThatCannotRunIsAnErrorNotAFailure(t *testing.T) {
	r := Rule{ID: "x.check", Label: "l", Severity: Bloquant, Kind: KindCheck, Name: "example-nonempty-dir"}
	_, err := Evaluate(context.Background(), worktree(t, nil), r)
	if err == nil || !strings.Contains(err.Error(), "x.check") {
		t.Fatalf("Evaluate = %v, want an error naming the rule", err)
	}
}
