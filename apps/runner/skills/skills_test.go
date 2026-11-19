package skills

import (
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// ghCall is a `gh issue …` or `gh pr …`, its verb kept.
var ghCall = regexp.MustCompile(`(^|[^\w-])gh\s+(issue|pr)\s+([a-z-]+)`)

// mirrorWrites are the verbs a Skill writes with through `mirror issue|pr`
// (MIROIR-7), never through `mirror gh`.
var mirrorWrites = []string{"create", "edit", "comment", "close", "reopen", "review"}

// violations are the calls of text that do not read and write through the
// Miroir: a `gh issue|pr …` outside `mirror`, or a `mirror gh issue|pr`
// that writes.
func violations(text string) []string {
	var found []string
	for _, match := range ghCall.FindAllStringSubmatchIndex(text, -1) {
		call := text[match[3]:match[1]]
		before := strings.TrimRight(text[:match[3]], " \t")
		verb := text[match[6]:match[7]]
		if !strings.HasSuffix(before, "mirror") {
			found = append(found, call)
			continue
		}
		if slices.Contains(mirrorWrites, verb) {
			found = append(found, "mirror "+call)
		}
	}
	return found
}

func TestTheRuleOfTheMiroirFindsTheCallsOfGhOutsideIt(t *testing.T) {
	for text, want := range map[string]int{
		"Lis le Ticket : `gh issue view 12`.":                         1,
		"Commente : `mirror gh issue comment 12 --body-file note.md`": 1,
		"crewdeck-runner gh pr create --draft":                        1,
		"```sh\ngh pr review 7 --approve\n```":                        1,
		"Lis le Ticket : `mirror issue view 12 --json title`.":        0,
		"`mirror pr view 7 --json body` puis `mirror ready`":          0,
		"`mirror gh issue view 12` lit à travers le Miroir":           0,
		"`mirror issue comment 12 --body-file note.md`":               0,
		"Le gh de la machine n'est jamais appelé.":                    0,
	} {
		if got := violations(text); len(got) != want {
			t.Errorf("violations(%q) = %q, want %d", text, got, want)
		}
	}
}

// markdown is every Markdown file of fsys, by its path.
func markdown(t *testing.T, fsys fs.FS) map[string]string {
	t.Helper()
	files := map[string]string{}
	err := fs.WalkDir(fsys, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || path.Ext(name) != ".md" {
			return err
		}
		data, err := fs.ReadFile(fsys, name)
		files[name] = string(data)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

// The embedded Skills, and the test Skill of the mount's tests, read and
// write through the Miroir only.
func TestNoSkillCallsGhOutsideTheMiroir(t *testing.T) {
	files := markdown(t, FS)
	for name, text := range markdown(t, os.DirFS(filepath.Join("..", "internal", "skills", "testdata"))) {
		files["testdata/"+name] = text
	}
	if _, ok := files["testdata/crewdeck-test/SKILL.md"]; !ok {
		t.Fatal("the test Skill is not read")
	}
	for name, text := range files {
		if found := violations(text); len(found) > 0 {
			t.Errorf("%s calls gh outside the Miroir: %q", name, found)
		}
	}
}

// agentSkill is an agent Étape's `agent('<role>', '<skill>')` in the catalogue.
var agentSkill = regexp.MustCompile(`agent\('[a-z-]+',\s*'([a-z0-9-]+)'\)`)

// Each Skill the catalogue names has its folder; one not written yet is
// listed, not failed (its Étape's ticket writes it).
func TestEveryAgentEtapeOfTheCatalogueHasItsSkillOrIsListed(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "packages", "contracts", "src", "process", "catalogue.ts"))
	if err != nil {
		t.Fatal(err)
	}
	var named []string
	for _, match := range agentSkill.FindAllStringSubmatch(string(data), -1) {
		named = append(named, match[1])
	}
	if len(named) == 0 {
		t.Fatal("the catalogue names no Skill: its agent() calls are not read")
	}
	for _, skill := range named {
		info, err := fs.Stat(FS, path.Join(skill, "SKILL.md"))
		switch {
		case err != nil:
			t.Logf("the Skill %s is not written yet", skill)
		case info.IsDir():
			t.Errorf("%s/SKILL.md is a folder", skill)
		}
	}
	entries, err := fs.ReadDir(FS, ".")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !slices.Contains(named, entry.Name()) {
			t.Errorf("the Skill %s is no Étape's of the catalogue", entry.Name())
		}
	}
}

// FS shows the Skills' folders alone: neither the README nor the Go files.
func TestTheEmbeddedFilesShowOnlyTheSkillsFolders(t *testing.T) {
	for _, name := range []string{"README.md", "embed.go", "skills_test.go"} {
		if _, err := fs.Stat(FS, name); err == nil {
			t.Errorf("%s is shown", name)
		}
	}
	entries, err := fs.ReadDir(FS, ".")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			t.Errorf("%s at the root is no folder", entry.Name())
		}
		if _, err := fs.Stat(FS, path.Join(entry.Name(), "SKILL.md")); err != nil {
			t.Errorf("%s has no SKILL.md", entry.Name())
		}
	}
}
