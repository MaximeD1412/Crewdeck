// Package folders is the Runner's side of a Local Projet's folder (PROJET-6,
// ADR 0012): it checks a path the Pilote types, keeps the folders of the
// Projets in the Runner's state (`projects`, projectId → path), and says
// which of them still exist. A path and a folder's name leave the machine
// only sealed under the vault key; they are never logged.
package folders

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// Result is where a typed path stands: the plaintext of folder.checked.
type Result struct {
	State   contracts.FolderCheckResultState `json:"state"`
	HasCode bool                             `json:"hasCode"`
	// Branch is the git repository's current branch; nil without git or on a detached HEAD.
	Branch *string `json:"branch"`
	// Name is the base name of the folder as typed.
	Name string `json:"name"`
	// Path is the folder's real absolute path, for a folder that may become a
	// Projet's (`ready`, `not-git`); never sent.
	Path string `json:"-"`
}

// Attachable says whether the folder may be a Projet's: a git repository's
// root, or a folder that is not one yet (« git init » is its preparation).
func (r Result) Attachable() bool {
	return r.State == contracts.FolderCheckResultStateReady || r.State == contracts.FolderCheckResultStateNotGit
}

// Checker checks paths on this machine.
type Checker struct {
	// Home is what `~` stands for.
	Home string
	// StateDir is the Runner's state folder (~/.crewdeck): neither it nor a
	// folder inside it is a Projet's.
	StateDir string
	// WSL reads a Windows path (`C:\…`) as its mount, `/mnt/c/…`.
	WSL bool
}

// gitTimeout bounds each git command of a check.
const gitTimeout = 5 * time.Second

var windowsPath = regexp.MustCompile(`^([A-Za-z]):[\\/]`)

// resolve is the absolute path input stands for, false when it is not one.
func (c Checker) resolve(input string) (string, bool) {
	path := strings.TrimSpace(input)
	switch {
	case path == "~":
		path = c.Home
	case strings.HasPrefix(path, "~/"):
		path = filepath.Join(c.Home, path[2:])
	case c.WSL && windowsPath.MatchString(path):
		drive := strings.ToLower(path[:1])
		path = "/mnt/" + drive + "/" + strings.ReplaceAll(path[3:], `\`, "/")
	}
	if path == "" || !filepath.IsAbs(path) {
		return "", false
	}
	return filepath.Clean(path), true
}

// Check says where input stands on this machine; projects are the Projets'
// folders (projectId → path), projectID the Projet the folder is for, whose
// own folder is not taken ("" for none).
func (c Checker) Check(input string, projects map[string]string, projectID string) Result {
	path, ok := c.resolve(input)
	if !ok {
		return Result{State: contracts.FolderCheckResultStateNotAbsolute, Name: filepath.Base(strings.TrimSpace(input))}
	}
	result := Result{Name: filepath.Base(path)}
	info, err := os.Stat(path)
	switch {
	case errors.Is(err, syscall.ENOTDIR):
		result.State = contracts.FolderCheckResultStateNotAFolder
		return result
	case err != nil:
		result.State = contracts.FolderCheckResultStateMissing
		return result
	case !info.IsDir():
		result.State = contracts.FolderCheckResultStateNotAFolder
		return result
	}
	real, err := filepath.EvalSymlinks(path)
	if err != nil {
		result.State = contracts.FolderCheckResultStateMissing
		return result
	}
	if c.StateDir != "" && within(real, realPath(c.StateDir)) {
		result.State = contracts.FolderCheckResultStateNotAFolder
		return result
	}
	for id, other := range projects {
		if id != projectID && realPath(other) == real {
			result.State = contracts.FolderCheckResultStateTaken
			return result
		}
	}
	result.Path = real
	if top, err := gitOutput(real, "rev-parse", "--show-toplevel"); err == nil && realPath(top) == real {
		result.State = contracts.FolderCheckResultStateReady
		count, _ := gitOutput(real, "rev-list", "--count", "HEAD")
		commits, _ := strconv.Atoi(count)
		result.HasCode = commits >= 2
		if branch, err := gitOutput(real, "symbolic-ref", "--short", "-q", "HEAD"); err == nil && branch != "" {
			result.Branch = &branch
		}
		return result
	}
	result.State = contracts.FolderCheckResultStateNotGit
	result.HasCode = hasFiles(real, 2)
	return result
}

// realPath is path with its links resolved, path itself when it does not resolve.
func realPath(path string) string {
	if real, err := filepath.EvalSymlinks(path); err == nil {
		return real
	}
	return filepath.Clean(path)
}

// within says whether path is dir or inside it.
func within(path, dir string) bool {
	return path == dir || strings.HasPrefix(path, strings.TrimSuffix(dir, string(filepath.Separator))+string(filepath.Separator))
}

// hasFiles says whether dir holds, within `levels` levels, a regular file
// other than a README, a LICENSE or a dotfile; dotfolders are skipped.
func hasFiles(dir string, levels int) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		switch {
		case entry.Type().IsRegular():
			upper := strings.ToUpper(name)
			if !strings.HasPrefix(upper, "README") && !strings.HasPrefix(upper, "LICENSE") {
				return true
			}
		case entry.IsDir() && levels > 1:
			if hasFiles(filepath.Join(dir, name), levels-1) {
				return true
			}
		}
	}
	return false
}

// gitEnv is the environment of a check's git: no prompt, and no repository
// of the Runner's own environment in place of the folder's.
func gitEnv() []string {
	env := []string{}
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "GIT_DIR=") || strings.HasPrefix(kv, "GIT_WORK_TREE=") || strings.HasPrefix(kv, "GIT_INDEX_FILE=") || strings.HasPrefix(kv, "GIT_CEILING_DIRECTORIES=") {
			continue
		}
		env = append(env, kv)
	}
	return append(env, "GIT_TERMINAL_PROMPT=0", "LC_ALL=C")
}

func gitOutput(dir string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), gitTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	cmd.Env = gitEnv()
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}
