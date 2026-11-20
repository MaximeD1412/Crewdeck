// Package skills mounts in an Étape's Session its official Skill, and it
// alone (RUNNER-12, ADR 0004): copied from the embedded Skills
// (apps/runner/skills) into the Session's folder, where its Moteur finds
// it. Claude Code reads a plugin given with `--plugin-dir`, its Skills named
// `crewdeck:<skill>`; Codex reads the Skills of its CODEX_HOME.
//
//	sessions/<id>/plugin/.claude-plugin/plugin.json   Claude Code's plugin `crewdeck`
//	sessions/<id>/plugin/skills/<skill>/…
//	sessions/<id>/codex-home/config.toml              Codex's home, its Skill alone
//	sessions/<id>/codex-home/skills/<skill>/…
package skills

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// PluginName is the name of Claude Code's plugin of the official Skills.
const PluginName = "crewdeck"

// The folders of the Session's folder the mount writes.
const (
	PluginDir    = "plugin"
	CodexHomeDir = "codex-home"
)

// CodexHomeEnv is the variable that gives Codex its home.
const CodexHomeEnv = "CODEX_HOME"

// ErrUnknownSkill is the error of a Skill the Runner does not embed.
var ErrUnknownSkill = errors.New("skills: unknown Skill")

// ErrUnsupportedEngine is the error of a Moteur the mount does not know.
var ErrUnsupportedEngine = errors.New("skills: no mount for this Moteur")

var skillID = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// Mounted is what the Moteur's StartOptions add: its SkillsDir (Claude
// Code's plugin), its environment (Codex's home).
type Mounted struct {
	SkillsDir string
	Env       []string
}

// Mount writes the Skill `skill` of src for the Moteur in sessionDir, what
// a previous run wrote replaced: the Session sees its Skill alone.
func Mount(src fs.FS, skill string, moteur contracts.EngineId, sessionDir, runnerVersion string) (Mounted, error) {
	if !skillID.MatchString(skill) {
		return Mounted{}, fmt.Errorf("%w: %q", ErrUnknownSkill, skill)
	}
	if info, err := fs.Stat(src, path.Join(skill, "SKILL.md")); err != nil || info.IsDir() {
		return Mounted{}, fmt.Errorf("%w: %s", ErrUnknownSkill, skill)
	}
	switch moteur {
	case contracts.EngineIdClaudeCode:
		dir := filepath.Join(sessionDir, PluginDir)
		if err := fresh(dir); err != nil {
			return Mounted{}, err
		}
		manifest, err := json.Marshal(struct {
			Name    string `json:"name"`
			Version string `json:"version"`
		}{PluginName, runnerVersion})
		if err != nil {
			return Mounted{}, err
		}
		if err := write(filepath.Join(dir, ".claude-plugin", "plugin.json"), append(manifest, '\n')); err != nil {
			return Mounted{}, err
		}
		if err := copySkill(src, skill, filepath.Join(dir, "skills", skill)); err != nil {
			return Mounted{}, err
		}
		return Mounted{SkillsDir: dir}, nil
	case contracts.EngineIdCodex:
		dir := filepath.Join(sessionDir, CodexHomeDir)
		if err := fresh(dir); err != nil {
			return Mounted{}, err
		}
		if err := write(filepath.Join(dir, "config.toml"), []byte(codexConfig)); err != nil {
			return Mounted{}, err
		}
		if err := copySkill(src, skill, filepath.Join(dir, "skills", skill)); err != nil {
			return Mounted{}, err
		}
		return Mounted{Env: []string{CodexHomeEnv + "=" + dir}}, nil
	}
	return Mounted{}, fmt.Errorf("%w: %s", ErrUnsupportedEngine, moteur)
}

// codexConfig is the Session's Codex home's config: nothing of its own, the
// Moteur's options coming from its adapter's flags (RUNNER-6).
const codexConfig = `# The Codex home of one Crewdeck Session, written by the Runner at each run
# (RUNNER-12): its official Skill alone, under skills/. Nothing is set here;
# the adapter gives the Moteur its options on its command line.
`

// fresh makes dir empty, mode 700.
func fresh(dir string) error {
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	return os.MkdirAll(dir, 0o700)
}

// write writes a file of the mount, mode 600, its folders 700.
func write(name string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(name), 0o700); err != nil {
		return err
	}
	return os.WriteFile(name, data, 0o600)
}

// copySkill copies the folder skill of src into dir.
func copySkill(src fs.FS, skill, dir string) error {
	return fs.WalkDir(src, skill, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(filepath.FromSlash(skill), filepath.FromSlash(name))
		if err != nil {
			return err
		}
		target := filepath.Join(dir, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		if !entry.Type().IsRegular() {
			return nil // a link or a device is no part of a Skill
		}
		data, err := fs.ReadFile(src, name)
		if err != nil {
			return err
		}
		return write(target, data)
	})
}
