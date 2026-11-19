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

// ghWord is `gh` as a command's word: at a line's start, or after a space,
// a backtick, a path's `/` or a shell's `(`, `|`, `;`, `&`.
var ghWord = regexp.MustCompile("(^|[\\s`(|;&/])gh([\\s`]|$)")

// commandEnd ends the words of a command: a line, a backtick, a shell's
// `;`, `|`, `&`, `)`.
var commandEnd = regexp.MustCompile("[\\n`;|&)]")

// ghCommands are gh's commands: a `gh` followed by none of them is prose.
var ghCommands = []string{
	"alias", "api", "attestation", "auth", "browse", "cache", "co", "codespace", "completion", "config",
	"extension", "gist", "gpg-key", "issue", "label", "org", "pr", "project", "release", "repo",
	"ruleset", "run", "search", "secret", "ssh-key", "status", "variable", "workflow",
}

// ghValueOptions are gh's options whose value is the next word.
var ghValueOptions = []string{"-R", "--repo", "--hostname"}

// mirrorWrites are the verbs a Skill writes with through `mirror issue|pr`
// (MIROIR-7), never through `mirror gh`.
var mirrorWrites = []string{"create", "edit", "comment", "close", "reopen", "review"}

// ghWords are the words of a gh call but its options and their values:
// its command, its verb, its arguments.
func ghWords(call string) []string {
	var words []string
	fields := strings.Fields(call)
	for i := 0; i < len(fields); i++ {
		field := fields[i]
		switch {
		case slices.Contains(ghValueOptions, field):
			i++
		case strings.HasPrefix(field, "-"):
		default:
			words = append(words, field)
		}
	}
	return words
}

// violations are the calls of text that do not read and write through the
// Miroir: any gh call outside `mirror`, whatever its options before or
// after its command; through `mirror gh`, one of `issue|pr` that writes,
// or any other command (`api` among them).
func violations(text string) []string {
	text = strings.ReplaceAll(text, "\\\n", " ")
	var found []string
	for _, match := range ghWord.FindAllStringSubmatchIndex(text, -1) {
		at := match[3]
		rest := text[at+len("gh"):]
		if end := commandEnd.FindStringIndex(rest); end != nil {
			rest = rest[:end[0]]
		}
		words := ghWords(rest)
		if len(words) == 0 || !slices.Contains(ghCommands, words[0]) {
			continue
		}
		call := "gh" + strings.TrimRight(rest, " \t")
		before := strings.Fields(text[:at])
		if len(before) == 0 || before[len(before)-1] != "mirror" && !strings.HasSuffix(before[len(before)-1], "`mirror") {
			found = append(found, call)
			continue
		}
		read := (words[0] == "issue" || words[0] == "pr") && (len(words) < 2 || !slices.Contains(mirrorWrites, words[1]))
		if !read {
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
		"`gh api repos/acme/shop/issues/12`":                          1,
		"`gh api -X PATCH repos/acme/shop/issues/12 -f state=closed`": 1,
		"`gh -R acme/shop issue view 12`":                             1,
		"`gh --repo=acme/shop pr view 7`":                             1,
		"`gh --repo acme/shop pr diff 7`":                             1,
		"`gh repo view acme/shop`":                                    1,
		"`/usr/bin/gh issue list`":                                    1,
		"`echo ok | gh pr comment 7 --body-file -`":                   1,
		"`n=$(gh pr view 7 --json number)`":                           1,
		"```sh\ngh \\\n  issue view 12\n```":                          1,
		"`mirror gh -R acme/shop issue comment 12 --body x`":          1,
		"`mirror gh issue -R acme/shop comment 12`":                   1,
		"`mirror gh --repo=acme/shop pr review 7 --approve`":          1,
		"`mirror gh api repos/acme/shop/issues/12 -X PATCH`":          1,
		"`mirror gh repo view`":                                       1,
		"Lis le Ticket : `mirror issue view 12 --json title`.":        0,
		"`mirror pr view 7 --json body` puis `mirror ready`":          0,
		"`mirror gh issue view 12` lit à travers le Miroir":           0,
		"`mirror gh -R acme/shop issue view 12 --json title`":         0,
		"`mirror issue comment 12 --body-file note.md`":               0,
		"Le gh de la machine n'est jamais appelé.":                    0,
		"Jamais `gh` : le Miroir.":                                    0,
		"high, ghost, crewdeck-gh issue":                              0,
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
