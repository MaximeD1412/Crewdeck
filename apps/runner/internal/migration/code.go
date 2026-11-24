package migration

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	ghsource "github.com/maximed1412/crewdeck/apps/runner/internal/source/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

// The code group (SOURCE-9): every branch and each open change of code,
// with its comments and reviews, moved between a Local Projet's folder and
// its repository on GitHub.
//
// To GitHub, the branches are pushed from the Runner's clone of the folder
// (`<home>/repos/local/<projectId>`), the release branch first (GitHub's
// default), never forced; each open local change becomes a pull request
// whose body ends with `<!-- crewdeck:from local#<n> -->`, its comments and
// reviews one comment each. To Local, the repository is fetched into the
// folder (the Projet's, else the one picked, held pending), a local branch
// per remote one, the integration branch checked out; each open pull
// request becomes a local change in local.db, its origin `github#<n>`
// recorded. Both ways, a resumed copy finds what an earlier attempt wrote
// (a branch at its commit, an item by its marker) and writes it no more.
// The token reaches git through its environment only (AuthEnv): never in
// an argument, a log, `.git/config` nor an error.

// Remote is the repository's git remote: its URL (no credential in it) and
// the environment that authenticates git to it.
type Remote struct {
	URL string
	Env func(ctx context.Context) ([]string, error)
}

// AuthEnv is the environment by which git sends token to url's host as an
// Authorization header (`http.<url>.extraHeader`, through GIT_CONFIG_COUNT).
func AuthEnv(url, token string) []string {
	basic := base64.StdEncoding.EncodeToString([]byte("x-access-token:" + token))
	return []string{"GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=http." + url + ".extraheader", "GIT_CONFIG_VALUE_0=Authorization: Basic " + basic}
}

var errDiverged = errors.New("migration: a branch moved on both places")

// pullRequests are the repository's pull requests (ghsource.Tickets).
type pullRequests interface {
	Pulls(ctx context.Context) ([]ghsource.Pull, error)
	CreatePull(ctx context.Context, c source.Change, from string) (int, error)
	EditPull(ctx context.Context, number int, c source.Change, from string) error
	PullComments(ctx context.Context, number int) ([]source.CopiedComment, error)
	PullReviews(ctx context.Context, number int) ([]source.Review, error)
	AddComment(ctx context.Context, number int, c source.Comment, from string) error
}

// migrationRefs is where a migration fetches the other place's branches,
// out of the branches' namespace.
const migrationRefs = "refs/crewdeck/migration/heads/"

const zeroOid = "0000000000000000000000000000000000000000"

// codePass is what one pass saw of the old place, and how many writes it made.
type codePass struct {
	branches map[string]string // name → commit
	changes  []oldChange
	writes   int
}

// oldChange is an open change of the old place as the switch fingerprints it.
type oldChange struct {
	kind   string
	number int
	change source.Change
	notes  []note
}

// note is a comment, a review or a review's remark, as one comment of the
// other place: its marker's origin, its author, date and text.
type note struct {
	from   string
	author string
	at     time.Time
	body   string
}

func (h *Handler) copyCode(ctx context.Context, m contracts.RunnerMigrationCopy) error {
	p, found, err := loadProgress(h.cfg.Home, m.MigrationId)
	if err != nil {
		return err
	}
	if !found {
		p = &progress{MigrationID: m.MigrationId, Tickets: map[int]int{}, Milestones: map[int]int{}, Changes: map[int]int{}}
	}
	p.ProjectID, p.From, p.To, p.Stage, p.Group = m.ProjectId, string(m.From), string(m.To), stageCopying, string(m.Group)
	if m.Repository != nil {
		p.Owner, p.Name = m.Repository.Owner, m.Repository.Name
	}
	if m.Branches != nil {
		p.Release, p.Integration = m.Branches.Release, m.Branches.Integration
	}
	if p.Owner == "" || p.Release == "" || p.Integration == "" || p.From == p.To {
		return errors.New("migration: the code's copy needs its repository and branches")
	}
	if err := p.save(h.cfg.Home); err != nil {
		return err
	}
	h.cfg.Logger.Info("migration.copy", "migrationId", p.MigrationID, "group", p.Group, "from", p.From, "to", p.To)
	first, err := h.codePass(ctx, p, nil)
	if err != nil {
		return err
	}
	total := len(first.branches) + len(first.changes)
	h.send(ctx, protocol.NewMigrationProgress(p.MigrationID, contracts.RunnerMigrationProgressStateCopying, total, total))
	p.Stage = stageVerifying
	if err := p.save(h.cfg.Home); err != nil {
		return err
	}
	for i := range h.cfg.Passes {
		checked, err := h.codePass(ctx, p, nil)
		if err != nil {
			return err
		}
		total := len(checked.branches) + len(checked.changes)
		h.send(ctx, protocol.NewMigrationProgress(p.MigrationID, contracts.RunnerMigrationProgressStateVerifying, total-min(checked.writes, total), total))
		if checked.writes > 0 {
			h.cfg.Logger.Info("migration.verify.changed", "migrationId", p.MigrationID, "pass", i+1, "writes", checked.writes)
			continue
		}
		return h.switchCode(ctx, p, checked)
	}
	return errUnstable
}

// codePass copies what the new place lacks; late, when set, limits the
// branches to those moved since the switch (their commit then) and copies
// no change.
func (h *Handler) codePass(ctx context.Context, p *progress, late map[string]string) (codePass, error) {
	remote := h.cfg.Remote(p.MigrationID, p.Owner, p.Name)
	env, err := remote.Env(ctx)
	if err != nil {
		return codePass{}, fmt.Errorf("%w: the migration's token: %v", ghsource.ErrUnavailable, err)
	}
	if p.From == string(contracts.RunnerMigrationCopyFromLocal) {
		return h.toGitHub(ctx, p, remote.URL, env, late)
	}
	return h.toLocal(ctx, p, remote.URL, env, late)
}

// origin is the Runner's clone of the Projet's folder.
func (h *Handler) origin(projectID, folder string) *local.Origin {
	return &local.Origin{Home: h.cfg.Home, ProjectID: projectID, Folder: func(string) (string, bool) { return folder, folder != "" }}
}

// toGitHub pushes the folder's branches, then makes each open local change a pull request.
func (h *Handler) toGitHub(ctx context.Context, p *progress, url string, env []string, late map[string]string) (codePass, error) {
	folder, ok := h.folder(p.ProjectID)
	if !ok {
		return codePass{}, ErrNoFolder
	}
	pass := codePass{}
	origin := h.origin(p.ProjectID, folder)
	unlock := session.LockClone(origin.Dir())
	err := func() error {
		defer unlock()
		clone, _, err := origin.Clone(ctx)
		if err != nil {
			return fmt.Errorf("%w: the folder's clone: %v", source.ErrUnreadable, err)
		}
		if _, err := git(ctx, clone, env, "fetch", "--quiet", "--no-tags", "--prune", url, "+refs/heads/*:"+migrationRefs+"*"); err != nil {
			return fmt.Errorf("%w: %v", ghsource.ErrUnavailable, err)
		}
		if pass.branches, err = refs(ctx, clone, "refs/remotes/origin/"); err != nil {
			return err
		}
		delete(pass.branches, "HEAD")
		theirs, err := refs(ctx, clone, migrationRefs)
		if err != nil {
			return err
		}
		for _, b := range ordered(pass.branches, p.Release, p.Integration) {
			ours := pass.branches[b]
			if late != nil && late[b] == ours {
				continue
			}
			push, err := moves(ctx, clone, theirs[b], ours)
			if err != nil {
				return err
			}
			if !push {
				// Already there (an earlier attempt pushed it): the next branches still go.
				continue
			}
			if _, err := git(ctx, clone, env, "push", "--quiet", "--no-verify", url, ours+":refs/heads/"+b); err != nil {
				return fmt.Errorf("%w: %v", ghsource.ErrUnavailable, err)
			}
			pass.writes++
		}
		return nil
	}()
	if err != nil || late != nil {
		return pass, err
	}
	gh, ok := h.cfg.GitHub(p.MigrationID, p.Owner, p.Name).(pullRequests)
	if !ok {
		return pass, errors.New("migration: no pull requests on the GitHub side")
	}
	changes, err := h.cfg.Open(p.ProjectID, folder).CopiedChanges(ctx)
	if err != nil {
		return pass, err
	}
	pulls, err := gh.Pulls(ctx)
	if err != nil {
		return pass, err
	}
	byFrom := map[string]ghsource.Pull{}
	for _, pr := range pulls {
		if pr.From != "" {
			byFrom[pr.From] = pr
		}
	}
	for _, c := range changes {
		if c.State != source.ChangeOpen {
			continue
		}
		if pass.branches[c.HeadRef] == "" || pass.branches[c.BaseRef] == "" {
			h.cfg.Logger.Warn("migration.change.branchless", "migrationId", p.MigrationID, "number", c.Number)
			continue
		}
		from := keyOf("local", c.Number)
		notes := localNotes(c)
		pass.changes = append(pass.changes, oldChange{kind: "local", number: c.Number, change: c.Change, notes: notes})
		want := source.Change{Title: c.Title, Body: c.Body, HeadRef: c.HeadRef, BaseRef: c.BaseRef, IsDraft: c.IsDraft}
		pr, found := byFrom[from]
		number := pr.Number
		have := map[string]bool{}
		if !found {
			if number, err = gh.CreatePull(ctx, want, from); err != nil {
				return pass, err
			}
			pass.writes++
		} else {
			if strings.TrimSpace(pr.Title) != strings.TrimSpace(want.Title) || text(pr.Body) != text(want.Body) || pr.BaseRef != want.BaseRef {
				if err := gh.EditPull(ctx, number, want, from); err != nil {
					return pass, err
				}
				pass.writes++
			}
			comments, err := gh.PullComments(ctx, number)
			if err != nil {
				return pass, err
			}
			for _, cm := range comments {
				have[cm.From] = true
			}
		}
		if p.Changes[c.Number] != number {
			p.Changes[c.Number] = number
			if err := p.save(h.cfg.Home); err != nil {
				return pass, err
			}
		}
		for _, n := range notes {
			if have[n.from] {
				continue
			}
			if err := gh.AddComment(ctx, number, source.Comment{Author: n.author, Body: n.body, CreatedAt: n.at}, n.from); err != nil {
				return pass, err
			}
			pass.writes++
		}
	}
	return pass, nil
}

// localNotes are a local change's comments, reviews and their remarks as
// the pull request's comments, oldest first.
func localNotes(c local.CopiedChange) []note {
	from := keyOf("local", c.Number)
	var notes []note
	for _, cm := range c.Comments {
		notes = append(notes, note{from: from + "/comment/" + cm.ID, author: cm.Author, at: cm.CreatedAt, body: cm.Body})
	}
	for _, r := range c.Reviews {
		body := reviewHead(r.State)
		if strings.TrimSpace(r.Body) != "" {
			body += "\n\n" + r.Body
		}
		notes = append(notes, note{from: from + "/review/" + r.ID, author: r.Author, at: r.SubmittedAt, body: body})
		for _, rc := range r.Comments {
			notes = append(notes, note{from: from + "/review/" + r.ID + "/remark/" + rc.ID, author: r.Author, at: rc.CreatedAt, body: remarkHead(rc) + "\n\n" + rc.Body})
		}
	}
	slices.SortStableFunc(notes, func(a, b note) int { return a.at.Compare(b.at) })
	return notes
}

// reviewHead and remarkHead begin the comment a review, a remark, is on
// GitHub; their text follows.
func reviewHead(state source.ReviewState) string { return "Revue : " + verdict(state) }

func remarkHead(rc source.ReviewComment) string {
	where := "`" + rc.Path + "`"
	if rc.Line > 0 {
		where += ", ligne " + strconv.Itoa(rc.Line)
	}
	return where + " :"
}

// afterHead is the text of a note whose comment began with head; the whole
// comment when its head was edited away.
func afterHead(body, head string) string {
	rest, ok := strings.CutPrefix(strings.TrimLeft(body, " \r\n"), head)
	if !ok {
		return body
	}
	return strings.TrimLeft(rest, "\r\n")
}

func verdict(state source.ReviewState) string {
	switch state {
	case source.ReviewApproved:
		return "approuvée"
	case source.ReviewChangesRequested:
		return "changements demandés"
	default:
		return "commentée"
	}
}

// toLocal fetches the repository's branches into the folder, then makes
// each open pull request a local change.
func (h *Handler) toLocal(ctx context.Context, p *progress, url string, env []string, late map[string]string) (codePass, error) {
	folder, err := h.codeFolder(ctx, p)
	if err != nil {
		return codePass{}, err
	}
	pass := codePass{}
	if _, err := git(ctx, folder, env, "fetch", "--quiet", "--no-tags", "--prune", url, "+refs/heads/*:"+migrationRefs+"*"); err != nil {
		return pass, fmt.Errorf("%w: %v", ghsource.ErrUnavailable, err)
	}
	if pass.branches, err = refs(ctx, folder, migrationRefs); err != nil {
		return pass, err
	}
	current, _ := git(ctx, folder, nil, "symbolic-ref", "--quiet", "--short", "HEAD")
	for _, b := range ordered(pass.branches, p.Release, p.Integration) {
		theirs := pass.branches[b]
		if late != nil && late[b] == theirs {
			continue
		}
		wrote, err := carry(ctx, folder, b, theirs, p.CheckedOut && b == current)
		if err != nil {
			return pass, err
		}
		if wrote {
			pass.writes++
		}
	}
	if !p.CheckedOut && pass.branches[p.Integration] != "" {
		if _, err := git(ctx, folder, nil, "symbolic-ref", "HEAD", "refs/heads/"+p.Integration); err != nil {
			return pass, err
		}
		if _, err := git(ctx, folder, nil, "reset", "--quiet", "--hard"); err != nil {
			return pass, err
		}
		p.CheckedOut = true
		if err := p.save(h.cfg.Home); err != nil {
			return pass, err
		}
	}
	if late != nil {
		return pass, nil
	}
	gh, ok := h.cfg.GitHub(p.MigrationID, p.Owner, p.Name).(pullRequests)
	if !ok {
		return pass, errors.New("migration: no pull requests on the GitHub side")
	}
	project := h.cfg.Open(p.ProjectID, folder)
	copied, err := project.CopiedChanges(ctx)
	if err != nil {
		return pass, err
	}
	byFrom, byNumber := map[string]local.CopiedChange{}, map[int]local.CopiedChange{}
	for _, c := range copied {
		byNumber[c.Number] = c
		if c.From != "" {
			byFrom[c.From] = c
		}
	}
	pulls, err := gh.Pulls(ctx)
	if err != nil {
		return pass, err
	}
	for _, pr := range pulls {
		from := keyOf("github", pr.Number)
		c, found := byFrom[from]
		if !found {
			// A change of this folder that went to GitHub and comes back: the same one, never a second.
			if n, ok := localNumber(pr.From); ok {
				c, found = byNumber[n]
			}
		}
		if pr.State != source.ChangeOpen {
			if found && c.State == source.ChangeOpen {
				if err := project.SetCopiedState(ctx, c.Number, pr.State, time.Now()); err != nil {
					return pass, err
				}
				pass.writes++
			}
			continue
		}
		comments, err := gh.PullComments(ctx, pr.Number)
		if err != nil {
			return pass, err
		}
		reviews, err := gh.PullReviews(ctx, pr.Number)
		if err != nil {
			return pass, err
		}
		pass.changes = append(pass.changes, oldChange{kind: "github", number: pr.Number, change: pr.Change, notes: githubNotes(from, comments, reviews)})
		want := pr.Change
		want.Number = 0
		number := c.Number
		switch {
		case !found:
			if number, err = project.PutChange(ctx, 0, want, from); err != nil {
				return pass, err
			}
			pass.writes++
		case c.From != from || c.State != source.ChangeOpen || strings.TrimSpace(c.Title) != strings.TrimSpace(want.Title) || text(c.Body) != text(want.Body) || c.HeadRef != want.HeadRef ||
			c.HeadOid != want.HeadOid || c.BaseRef != want.BaseRef || c.IsDraft != want.IsDraft:
			if _, err := project.PutChange(ctx, number, want, from); err != nil {
				return pass, err
			}
			pass.writes++
		}
		if p.Changes[pr.Number] != number {
			p.Changes[pr.Number] = number
			if err := p.save(h.cfg.Home); err != nil {
				return pass, err
			}
		}
		haveComments := map[string]source.CopiedComment{}
		for _, cm := range c.Comments {
			haveComments[cm.From] = cm
		}
		haveReviews := map[string]local.CopiedReview{}
		for _, r := range c.Reviews {
			haveReviews[r.From] = r
		}
		// What Crewdeck copied there from this very change is here already:
		// only its text edited on GitHub since comes back.
		own := keyOf("local", number) + "/"
		for _, cm := range comments {
			if key, ok := strings.CutPrefix(cm.From, own); ok {
				wrote, err := ownNote(ctx, project, c, key, cm.Body)
				if err != nil {
					return pass, err
				}
				if wrote {
					pass.writes++
				}
				continue
			}
			f := from + "/comment/" + cm.ID
			had, ok := haveComments[f]
			switch {
			case !ok:
				if err := project.AddChangeComment(ctx, number, cm.Comment, f); err != nil {
					return pass, err
				}
			case text(had.Body) != text(cm.Body):
				if err := project.PutChangeComment(ctx, number, cm.Body, f); err != nil {
					return pass, err
				}
			default:
				continue
			}
			pass.writes++
		}
		for _, r := range reviews {
			f := from + "/review/" + r.ID
			had, ok := haveReviews[f]
			switch {
			case !ok:
				if err := project.AddChangeReview(ctx, number, r, f); err != nil {
					return pass, err
				}
			case !sameReview(had.Review, r):
				if err := project.PutChangeReview(ctx, number, r, f); err != nil {
					return pass, err
				}
			default:
				continue
			}
			pass.writes++
		}
	}
	return pass, nil
}

// ownNote writes back the text of a note Crewdeck copied to GitHub from the
// local change c, its heading and its head left out (key: `comment/<id>`, `review/<id>`,
// `review/<id>/remark/<id>`) when it was edited there since; whether it wrote.
func ownNote(ctx context.Context, project *local.Project, c local.CopiedChange, key, body string) (bool, error) {
	parts := strings.Split(key, "/")
	switch {
	case len(parts) == 2 && parts[0] == "comment":
		for _, cm := range c.Comments {
			if now := afterHead(body, ghsource.CommentHeading(cm.Author, cm.CreatedAt)); cm.ID == parts[1] && text(cm.Body) != text(now) {
				return true, project.PutComment(ctx, c.Number, cm.ID, now)
			}
		}
	case len(parts) == 2 && parts[0] == "review":
		for _, r := range c.Reviews {
			if now := afterHead(afterHead(body, ghsource.CommentHeading(r.Author, r.SubmittedAt)), reviewHead(r.State)); r.ID == parts[1] && text(r.Body) != text(now) {
				return true, project.PutReviewBody(ctx, c.Number, r.ID, now)
			}
		}
	case len(parts) == 4 && parts[0] == "review" && parts[2] == "remark":
		for _, r := range c.Reviews {
			if r.ID != parts[1] {
				continue
			}
			for _, rc := range r.Comments {
				if now := afterHead(afterHead(body, ghsource.CommentHeading(r.Author, rc.CreatedAt)), remarkHead(rc)); rc.ID == parts[3] && text(rc.Body) != text(now) {
					return true, project.PutRemarkBody(ctx, c.Number, r.ID, rc.ID, now)
				}
			}
		}
	}
	return false, nil
}

// localNumber is the number of the local change a pull request's marker
// (`local#<n>`) says it was copied from.
func localNumber(from string) (int, bool) {
	rest, ok := strings.CutPrefix(from, "local#")
	if !ok {
		return 0, false
	}
	n, err := strconv.Atoi(rest)
	return n, err == nil && n > 0
}

// sameReview is whether the review copied holds what GitHub's holds now:
// its verdict, text and remarks, in order.
func sameReview(had, now source.Review) bool {
	if had.State != now.State || text(had.Body) != text(now.Body) || len(had.Comments) != len(now.Comments) {
		return false
	}
	for i, rc := range now.Comments {
		h := had.Comments[i]
		if h.Path != rc.Path || h.Line != rc.Line || text(h.Body) != text(rc.Body) {
			return false
		}
	}
	return true
}

// githubNotes are a pull request's comments and reviews, as fingerprinted.
func githubNotes(from string, comments []source.CopiedComment, reviews []source.Review) []note {
	var notes []note
	for _, cm := range comments {
		notes = append(notes, note{from: from + "/comment/" + cm.ID, author: cm.Author, at: cm.CreatedAt, body: cm.Body})
	}
	for _, r := range reviews {
		body := string(r.State) + "\x00" + r.Body
		for _, rc := range r.Comments {
			body += "\x00" + rc.ID + "\x01" + rc.Path + "\x01" + strconv.Itoa(rc.Line) + "\x01" + rc.Body
		}
		notes = append(notes, note{from: from + "/review/" + r.ID, author: r.Author, at: r.SubmittedAt, body: body})
	}
	return notes
}

// codeFolder is the folder the code goes into on its way to Local, a git
// repository: the one the progress recorded, else the Projet's, else the
// one picked (empty), recorded before anything is written in it.
func (h *Handler) codeFolder(ctx context.Context, p *progress) (string, error) {
	if p.Folder == "" {
		folder, ok := h.folder(p.ProjectID)
		if ok {
			_, err := git(ctx, folder, nil, "rev-parse", "--verify", "--quiet", "HEAD")
			p.CheckedOut = err == nil
		} else if h.cfg.Pending != nil {
			if folder, ok = h.cfg.Pending(p.ProjectID); ok {
				entries, err := os.ReadDir(folder)
				if err != nil || len(entries) > 0 {
					return "", errors.New("migration: the folder picked is not empty")
				}
			}
		}
		if !ok {
			return "", ErrNoFolder
		}
		p.Folder = folder
		if err := p.save(h.cfg.Home); err != nil {
			return "", err
		}
	}
	if _, own := h.folder(p.ProjectID); !own {
		if err := h.free(p.ProjectID, p.Folder); err != nil {
			return "", err
		}
	}
	if info, err := os.Stat(p.Folder); err != nil || !info.IsDir() {
		return "", errors.New("migration: the folder is gone")
	}
	if _, err := os.Stat(filepath.Join(p.Folder, ".git")); errors.Is(err, os.ErrNotExist) {
		if _, err := git(ctx, p.Folder, nil, "init", "--quiet"); err != nil {
			return "", err
		}
		if _, err := git(ctx, p.Folder, nil, "symbolic-ref", "HEAD", "refs/heads/"+p.Integration); err != nil {
			return "", err
		}
	}
	return p.Folder, nil
}

// carry moves the folder's branch to theirs when it is new or behind
// (fast-forward only; the checked-out one by a merge, its work tree with
// it); a branch ahead is kept; one diverged is errDiverged.
func carry(ctx context.Context, dir, branch, theirs string, checkedOut bool) (bool, error) {
	ref := "refs/heads/" + branch
	ours, err := git(ctx, dir, nil, "rev-parse", "--verify", "--quiet", ref)
	if err != nil {
		_, err := git(ctx, dir, nil, "update-ref", ref, theirs, zeroOid)
		return err == nil, err
	}
	move, err := moves(ctx, dir, ours, theirs)
	if err != nil || !move {
		return false, err
	}
	if checkedOut {
		_, err = git(ctx, dir, nil, "merge", "--quiet", "--ff-only", theirs)
	} else {
		_, err = git(ctx, dir, nil, "update-ref", ref, theirs, ours)
	}
	return err == nil, err
}

// moves is whether a branch at from (none: "") is to be set to to: new, or
// a fast-forward; not when it holds to already; errDiverged otherwise.
func moves(ctx context.Context, dir, from, to string) (bool, error) {
	switch {
	case from == "":
		return true, nil
	case from == to:
		return false, nil
	}
	if ok, err := ancestor(ctx, dir, to, from); err != nil || ok {
		return false, err
	}
	ok, err := ancestor(ctx, dir, from, to)
	if err != nil {
		return false, err
	}
	if !ok {
		return false, errDiverged
	}
	return true, nil
}

// ancestor is whether a is an ancestor of b.
func ancestor(ctx context.Context, dir, a, b string) (bool, error) {
	_, err := git(ctx, dir, nil, "merge-base", "--is-ancestor", a, b)
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == 1 {
		return false, nil
	}
	return err == nil, err
}

// ordered are the branches' names, the release one first, the integration one next.
func ordered(branches map[string]string, release, integration string) []string {
	names := make([]string, 0, len(branches))
	for b := range branches {
		if b != release && b != integration {
			names = append(names, b)
		}
	}
	slices.Sort(names)
	for _, b := range []string{integration, release} {
		if _, ok := branches[b]; ok && !slices.Contains(names, b) {
			names = append([]string{b}, names...)
		}
	}
	return names
}

// refs are the refs under prefix, by their name past it, to their commit.
func refs(ctx context.Context, dir, prefix string) (map[string]string, error) {
	out, err := git(ctx, dir, nil, "for-each-ref", "--format=%(objectname) %(refname)", prefix)
	if err != nil {
		return nil, err
	}
	found := map[string]string{}
	for line := range strings.Lines(out) {
		sha, name, ok := strings.Cut(strings.TrimSpace(line), " ")
		if ok {
			found[strings.TrimPrefix(name, prefix)] = sha
		}
	}
	return found, nil
}

// gitError is a git command that failed: its subcommand and exit, never
// its output nor its arguments (a path, a URL).
type gitError struct {
	command string
	err     error
}

func (e *gitError) Error() string { return fmt.Sprintf("migration: git %s: %v", e.command, e.err) }
func (e *gitError) Unwrap() error { return e.err }

// git runs git in dir with env added; its output, trimmed.
func git(ctx context.Context, dir string, env []string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "LC_ALL=C"), env...)
	out, err := cmd.Output()
	if err != nil {
		return "", &gitError{command: args[0], err: err}
	}
	return strings.TrimSpace(string(out)), nil
}

// switchCode sends `migration.switch`: each branch and open change of the
// old place fingerprinted, each change renumbered; no milestone.
func (h *Handler) switchCode(ctx context.Context, p *progress, stable codePass) error {
	vault := h.cfg.Vault()
	var fingerprints []contracts.RunnerMigrationSwitchFingerprintsElem
	for _, b := range ordered(stable.branches, p.Release, p.Integration) {
		key, state, hash := branchFingerprint(vault, b, stable.branches[b])
		fingerprints = append(fingerprints, contracts.RunnerMigrationSwitchFingerprintsElem{Key: key, State: state, ContentHash: hash})
	}
	renumbering := []contracts.RunnerMigrationSwitchRenumberingElem{}
	for _, c := range stable.changes {
		key, state, hash := changeFingerprint(vault, c)
		fingerprints = append(fingerprints, contracts.RunnerMigrationSwitchFingerprintsElem{Key: key, State: state, ContentHash: hash})
		if to := p.Changes[c.number]; to > 0 {
			renumbering = append(renumbering, contracts.RunnerMigrationSwitchRenumberingElem{From: c.number, To: to})
		}
	}
	if fingerprints == nil {
		fingerprints = []contracts.RunnerMigrationSwitchFingerprintsElem{}
	}
	p.Stage = stageSwitched
	if err := p.save(h.cfg.Home); err != nil {
		return err
	}
	h.cfg.Logger.Info("migration.switch", "migrationId", p.MigrationID, "branches", len(stable.branches), "changes", len(renumbering))
	return h.cfg.Send(ctx, protocol.NewMigrationSwitch(p.MigrationID, fingerprints, renumbering, nil))
}

// branchFingerprint is a branch as the switch saw it: `branch:<name>`, its
// commit, an HMAC of both.
func branchFingerprint(vault *keys.Vault, name, sha string) (key, state, hash string) {
	mac := hmac.New(sha256.New, vault.DeriveKey(fingerprintLabel))
	mac.Write([]byte("branch\x00" + name + "\x00" + sha))
	return "branch:" + name, sha, hex.EncodeToString(mac.Sum(nil))
}

// changeFingerprint is an open change as the switch saw it:
// `change:<kind>#<n>`, open or draft, an HMAC of its head, base, title,
// text and comments.
func changeFingerprint(vault *keys.Vault, c oldChange) (key, state, hash string) {
	var b strings.Builder
	b.WriteString(c.change.HeadRef + "\x00" + c.change.BaseRef + "\x00" + strings.TrimSpace(c.change.Title) + "\x00" + text(c.change.Body) + "\x00" + strconv.FormatBool(c.change.IsDraft))
	for _, n := range c.notes {
		b.WriteString("\x00" + n.from + "\x01" + text(n.body))
	}
	mac := hmac.New(sha256.New, vault.DeriveKey(fingerprintLabel))
	mac.Write([]byte("change\x00" + b.String()))
	state = "open"
	if c.change.IsDraft {
		state = "draft"
	}
	return "change:" + keyOf(c.kind, c.number), state, hex.EncodeToString(mac.Sum(nil))
}

// finishCode carries the branches moved on the old place since the switch
// (a fast-forward; errDiverged else), leaves the old place as it is, then
// the Runner's clone follows the new place: to Local, the folder becomes
// the Projet's, cloned again from it; to GitHub, the folder's clone goes.
func (h *Handler) finishCode(ctx context.Context, p *progress, m contracts.RunnerMigrationFinish) error {
	switched := map[string]string{}
	for _, f := range m.Fingerprints {
		if name, ok := strings.CutPrefix(f.Key, "branch:"); ok {
			switched[name] = f.State
		}
	}
	pass, err := h.codePass(ctx, p, switched)
	if err != nil {
		return err
	}
	if pass.writes > 0 {
		h.cfg.Logger.Info("migration.finish.late", "migrationId", p.MigrationID, "branches", pass.writes)
	}
	if p.To == string(contracts.RunnerMigrationCopyToLocal) {
		if err := dropMigrationRefs(ctx, p.Folder); err != nil {
			return err
		}
		origin := session.LockedOrigin(h.origin(p.ProjectID, p.Folder))
		if _, _, err := origin.Clone(ctx); err != nil {
			return err
		}
	} else {
		dir := h.origin(p.ProjectID, "").Dir()
		unlock := session.LockClone(dir)
		err := os.RemoveAll(dir)
		unlock()
		if err != nil {
			return err
		}
	}
	return h.finished(ctx, p)
}

// dropMigrationRefs deletes the refs a migration fetched into dir.
func dropMigrationRefs(ctx context.Context, dir string) error {
	fetched, err := refs(ctx, dir, migrationRefs)
	if err != nil {
		return err
	}
	for name := range fetched {
		if _, err := git(ctx, dir, nil, "update-ref", "-d", migrationRefs+name); err != nil {
			return err
		}
	}
	return nil
}
