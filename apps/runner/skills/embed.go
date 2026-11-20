// Package skills embeds the official Skills (ADR 0004, RUNNER-12): one folder
// per Skill, named as the catalogue's `skill` of its Étape
// (packages/contracts/src/process/catalogue.ts), each with its SKILL.md and
// what it reads beside it. The Runner mounts in each Étape's Session its
// Skill alone (internal/skills). README.md says how a Skill is written.
package skills

import (
	"embed"
	"io/fs"
	"path"
	"strings"
)

// Everything of this folder, Go files and README included: a pattern of the
// Skills' files alone (`*/SKILL.md`) would not compile while no Skill is
// written. FS shows the Skills only.
//
//go:embed *
var files embed.FS

// FS is the official Skills: at its root, only the folders that hold a
// SKILL.md.
var FS fs.FS = onlySkills{files}

// onlySkills hides what is not a Skill's folder.
type onlySkills struct{ fs.FS }

func (o onlySkills) Open(name string) (fs.File, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrInvalid}
	}
	if name != "." && !o.isSkill(top(name)) {
		return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
	}
	return o.FS.Open(name)
}

func (o onlySkills) ReadDir(name string) ([]fs.DirEntry, error) {
	if !fs.ValidPath(name) {
		return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrInvalid}
	}
	if name != "." {
		if !o.isSkill(top(name)) {
			return nil, &fs.PathError{Op: "readdir", Path: name, Err: fs.ErrNotExist}
		}
		return fs.ReadDir(o.FS, name)
	}
	entries, err := fs.ReadDir(o.FS, ".")
	if err != nil {
		return nil, err
	}
	kept := entries[:0:0]
	for _, entry := range entries {
		if entry.IsDir() && o.isSkill(entry.Name()) {
			kept = append(kept, entry)
		}
	}
	return kept, nil
}

func (o onlySkills) isSkill(dir string) bool {
	info, err := fs.Stat(o.FS, path.Join(dir, "SKILL.md"))
	return err == nil && !info.IsDir()
}

func top(name string) string {
	first, _, _ := strings.Cut(name, "/")
	return first
}
