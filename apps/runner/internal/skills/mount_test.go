package skills

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// testSkills are the test Skill and another, which a Session of the test
// Skill must not see.
func testSkills(t *testing.T) fs.FS {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "crewdeck-test", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	return fstest.MapFS{
		"crewdeck-test/SKILL.md":        {Data: data},
		"crewdeck-test/references/a.md": {Data: []byte("une référence\n")},
		"code/SKILL.md":                 {Data: []byte("---\nname: code\n---\n")},
		"README.md":                     {Data: []byte("pas une Skill\n")},
	}
}

// files are the files under dir, by their path relative to it.
func files(t *testing.T, dir string) []string {
	t.Helper()
	var found []string
	err := filepath.WalkDir(dir, func(name string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(dir, name)
		found = append(found, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return found
}

func TestClaudeCodeGetsAPluginWithTheSessionsSkillAlone(t *testing.T) {
	session := t.TempDir()

	mounted, err := Mount(testSkills(t), "crewdeck-test", contracts.EngineIdClaudeCode, session, "1.4.0")
	if err != nil {
		t.Fatal(err)
	}

	if mounted.SkillsDir != filepath.Join(session, PluginDir) || len(mounted.Env) != 0 {
		t.Fatalf("mounted %+v", mounted)
	}
	got := strings.Join(files(t, mounted.SkillsDir), " ")
	if got != ".claude-plugin/plugin.json skills/crewdeck-test/SKILL.md skills/crewdeck-test/references/a.md" {
		t.Fatalf("the plugin holds %s", got)
	}
	var manifest map[string]string
	data, _ := os.ReadFile(filepath.Join(mounted.SkillsDir, ".claude-plugin", "plugin.json"))
	if err := json.Unmarshal(data, &manifest); err != nil || len(manifest) != 2 || manifest["name"] != "crewdeck" || manifest["version"] != "1.4.0" {
		t.Fatalf("plugin.json %s", data)
	}
	if skill, _ := os.ReadFile(filepath.Join(mounted.SkillsDir, "skills", "crewdeck-test", "SKILL.md")); !strings.Contains(string(skill), "mirror issue view <n> --json title,body,labels") {
		t.Fatalf("SKILL.md %q", skill)
	}
}

func TestCodexGetsAHomeWithTheSessionsSkillAloneAndItsConfigPrivate(t *testing.T) {
	session := t.TempDir()

	mounted, err := Mount(testSkills(t), "crewdeck-test", contracts.EngineIdCodex, session, "1.4.0")
	if err != nil {
		t.Fatal(err)
	}

	home := filepath.Join(session, CodexHomeDir)
	if mounted.SkillsDir != "" || len(mounted.Env) != 1 || mounted.Env[0] != "CODEX_HOME="+home {
		t.Fatalf("mounted %+v", mounted)
	}
	if got := strings.Join(files(t, home), " "); got != "config.toml skills/crewdeck-test/SKILL.md skills/crewdeck-test/references/a.md" {
		t.Fatalf("the home holds %s", got)
	}
	info, err := os.Stat(filepath.Join(home, "config.toml"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("config.toml %v, %v", info, err)
	}
}

// A resume mounts again: what the previous run had is replaced.
func TestAMountReplacesThePreviousRunsOne(t *testing.T) {
	session := t.TempDir()
	stale := filepath.Join(session, PluginDir, "skills", "code", "SKILL.md")
	if err := write(stale, []byte("old\n")); err != nil {
		t.Fatal(err)
	}

	if _, err := Mount(testSkills(t), "crewdeck-test", contracts.EngineIdClaudeCode, session, "dev"); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(stale); err == nil {
		t.Fatal("the previous run's Skill is still mounted")
	}
}

func TestASkillTheRunnerDoesNotEmbedIsRefused(t *testing.T) {
	for _, skill := range []string{"product-design", "README.md", "../crewdeck-test", "", "Code"} {
		session := t.TempDir()
		if _, err := Mount(testSkills(t), skill, contracts.EngineIdClaudeCode, session, "dev"); !errors.Is(err, ErrUnknownSkill) {
			t.Errorf("Mount(%q): %v, want ErrUnknownSkill", skill, err)
		}
		if entries, _ := os.ReadDir(session); len(entries) != 0 {
			t.Errorf("Mount(%q) wrote %v", skill, entries)
		}
	}
	if _, err := Mount(testSkills(t), "crewdeck-test", contracts.EngineId("gemini"), t.TempDir(), "dev"); !errors.Is(err, ErrUnsupportedEngine) {
		t.Errorf("an unknown Moteur: %v", err)
	}
}
