// Package target is what a Contrat is checked on: the Étape's worktree and
// its PR. Its own package, so that the rules and the named checks share it
// with the interpreter (ADR 0005).
package target

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"syscall"

	"github.com/bmatcuk/doublestar/v4"
)

// Target is an Étape's output: its worktree, its PR when it opened one, and
// the Projet's integration branch, which a `pr` rule's `base: integration`
// names.
type Target struct {
	Dir               string
	PR                *PullRequest
	IntegrationBranch string
}

// PullRequest holds the facts of the Étape's PR a `pr` rule reads, from GitHub.
type PullRequest struct {
	Base    string   `json:"base"`
	Head    string   `json:"head"`
	Body    string   `json:"body"`
	Labels  []string `json:"labels"`
	HeadSHA string   `json:"headSha"`
}

// MaxFileSize is the largest file a rule reads: a bigger one fails it.
const MaxFileSize = 8 << 20

// The worktree is read only through these methods, confined to `Dir` by an
// os.Root: a link that leads out of it, directly or through a folder above
// the file, is as good as missing, so a deliverable is always the
// worktree's own. What makes a file unusable (missing, out of the worktree,
// a folder where a file is due, a device, too big) is `ok == false` with no
// error: it fails the rule. An error is only what is not the output's fault
// (a permission, a read that failed).

// Stat is the file or folder at `path`, links inside the worktree followed
// (relative ones: os.Root takes an absolute link as leading out).
func (t Target) Stat(path string) (info fs.FileInfo, ok bool, err error) {
	root, err := os.OpenRoot(t.Dir)
	if err != nil {
		return nil, false, err
	}
	defer root.Close()
	info, err = root.Stat(filepath.FromSlash(path))
	if unusable(err) {
		return nil, false, nil
	}
	return info, err == nil, err
}

// ReadFile is the content of the regular file at `path`.
func (t Target) ReadFile(path string) (data []byte, ok bool, err error) {
	root, err := os.OpenRoot(t.Dir)
	if err != nil {
		return nil, false, err
	}
	defer root.Close()
	info, err := root.Stat(filepath.FromSlash(path))
	if unusable(err) || err == nil && (!info.Mode().IsRegular() || info.Size() > MaxFileSize) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	file, err := root.Open(filepath.FromSlash(path))
	if unusable(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	defer file.Close()
	// The file may have grown since its Stat: never read more than the limit.
	data, err = io.ReadAll(io.LimitReader(file, MaxFileSize+1))
	if err != nil {
		return nil, false, err
	}
	if len(data) > MaxFileSize {
		return nil, false, nil
	}
	return data, true, nil
}

// ReadDir is the entries of the folder at `path`.
func (t Target) ReadDir(path string) (entries []fs.DirEntry, ok bool, err error) {
	root, err := os.OpenRoot(t.Dir)
	if err != nil {
		return nil, false, err
	}
	defer root.Close()
	entries, err = fs.ReadDir(root.FS(), path)
	if unusable(err) {
		return nil, false, nil
	}
	return entries, err == nil, err
}

// Glob is what matches `glob` (doublestar's syntax) in the worktree but its
// folders, sorted, relative to it. A link out of the worktree is listed when
// its own name matches, so that reading it fails the rule, but never walked
// into; a link inside it is followed.
func (t Target) Glob(glob string) ([]string, error) {
	root, err := os.OpenRoot(t.Dir)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	matches, err := doublestar.Glob(root.FS(), glob)
	if err != nil {
		return nil, err
	}
	files := matches[:0]
	for _, match := range matches {
		if info, err := root.Stat(filepath.FromSlash(match)); err != nil || !info.IsDir() {
			files = append(files, match)
		}
	}
	sort.Strings(files)
	return files, nil
}

// unusable says whether `err` comes from the output itself: a missing file,
// a file where a folder is due or the reverse, a loop of links, or a link out
// of the worktree (which os.Root reports with an error it does not export).
func unusable(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, fs.ErrNotExist) || errors.Is(err, syscall.ENOTDIR) || errors.Is(err, syscall.EISDIR) || errors.Is(err, syscall.ELOOP) {
		return true
	}
	var pathErr *fs.PathError
	return errors.As(err, &pathErr) && pathErr.Err.Error() == "path escapes from parent"
}
