package local

import (
	"context"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// History is the change's branch now: its head in the Runner's clone (a
// Session's branch, committed there before it pushes), else in the folder
// (once pushed), else the head local.db recorded; and its commits from its
// base (`git log <base>..<head>`), oldest first. A branch no repository has
// gives the recorded head and no commit.
func (p *Project) History(ctx context.Context, number int) (source.History, error) {
	c, err := p.Change(ctx, number)
	if err != nil {
		return source.History{}, err
	}
	p.mu.Lock()
	clone := p.clone
	p.mu.Unlock()
	h := source.History{HeadOid: c.HeadOid, Commits: []source.Commit{}}
	var dirs []string
	if clone != "" {
		dirs = append(dirs, clone)
	}
	dirs = append(dirs, p.folder)
	for _, dir := range dirs {
		head, ok := resolve(ctx, dir, c.HeadRef)
		if !ok {
			continue
		}
		h.HeadOid = head
		base, ok := resolve(ctx, dir, c.BaseRef)
		if !ok {
			break
		}
		h.Commits = commits(ctx, dir, base, head)
		break
	}
	return h, nil
}

// resolve is a branch's commit in dir: its own branch, else origin's.
func resolve(ctx context.Context, dir, branch string) (string, bool) {
	if branch == "" || strings.HasPrefix(branch, "-") {
		return "", false
	}
	for _, ref := range []string{"refs/heads/" + branch, "refs/remotes/origin/" + branch} {
		if oid, err := gitOutput(ctx, dir, "rev-parse", "--verify", "--quiet", ref+"^{commit}"); err == nil && oid != "" {
			return oid, true
		}
	}
	return "", false
}

// commits are base..head's, oldest first, each with its whole message.
func commits(ctx context.Context, dir, base, head string) []source.Commit {
	out, err := gitOutput(ctx, dir, "log", "--reverse", "--format=%H%x00%B%x1e", base+".."+head)
	if err != nil {
		return []source.Commit{}
	}
	list := []source.Commit{}
	for _, record := range strings.Split(out, "\x1e") {
		record = strings.TrimLeft(record, "\n")
		oid, message, ok := strings.Cut(record, "\x00")
		if !ok || oid == "" {
			continue
		}
		list = append(list, source.Commit{Oid: oid, Message: strings.TrimRight(message, "\n")})
	}
	return list
}

// fileURL is a path's file:// URL.
func fileURL(path string) string {
	return (&url.URL{Scheme: "file", Path: filepath.ToSlash(path)}).String()
}
