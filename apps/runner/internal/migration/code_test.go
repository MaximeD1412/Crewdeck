package migration_test

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/migration"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// The code group (SOURCE-9): GitHub is a bare repository over file://, its
// post-receive hook logging each ref pushed in order, and the fake REST API
// for its pull requests.

const codeMigrationID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a98"

func codeMessage(from, to contracts.RunnerMigrationCopyFrom) contracts.RunnerMigrationCopy {
	m := copyMessage(from, to)
	m.MigrationId, m.Group = codeMigrationID, contracts.RunnerMigrationCopyGroupCode
	m.Branches = &contracts.RunnerMigrationCopyBranches{Release: "main", Integration: "develop"}
	return m
}

// bare makes the env's GitHub repository: a bare one, its pushes logged.
func (e *env) bare() (dir, log string) {
	e.t.Helper()
	root := e.t.TempDir()
	dir, log = filepath.Join(root, "r.git"), filepath.Join(root, "pushed.log")
	gitIn(e.t, root, "init", "--quiet", "--bare", dir)
	hook := "#!/bin/sh\nwhile read old new ref; do echo \"$ref\" >> '" + log + "'; done\n"
	if err := os.WriteFile(filepath.Join(dir, "hooks", "post-receive"), []byte(hook), 0o755); err != nil {
		e.t.Fatal(err)
	}
	e.remote, e.gh.bare = "file://"+dir, dir
	return dir, log
}

func pushedRefs(t *testing.T, log string) []string {
	t.Helper()
	data, err := os.ReadFile(log)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	return strings.Fields(string(data))
}

// commitOn commits a file on branch in dir (made from the current branch when new).
func commitOn(t *testing.T, dir, branch, name, content string) string {
	t.Helper()
	if exec := gitIn(t, dir, "branch", "--list", branch); exec == "" {
		gitIn(t, dir, "checkout", "--quiet", "-b", branch)
	} else {
		gitIn(t, dir, "checkout", "--quiet", branch)
	}
	path := filepath.Join(dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	gitIn(t, dir, "add", "-A")
	gitIn(t, dir, "commit", "--quiet", "-m", "Sur "+branch)
	return gitIn(t, dir, "rev-parse", "HEAD")
}

func branchesOf(t *testing.T, dir string) map[string]string {
	t.Helper()
	out := gitIn(t, dir, "for-each-ref", "--format=%(refname:strip=2) %(objectname)", "refs/heads/")
	branches := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		if name, sha, ok := strings.Cut(line, " "); ok {
			branches[name] = sha
		}
	}
	return branches
}

// localCode is the env's folder with main (release), develop and two
// feature branches, two open local changes with comments and a review, and
// one closed.
func localCode(t *testing.T) (e *env, panier, export int) {
	e = newEnv(t, map[string]string{"README.md": "Le Projet.\n", "docs/product/prd.md": "# Le PRD\n\nLocal.\n"})
	commitOn(t, e.dir, "develop", "src/app.go", "package app\n")
	commitOn(t, e.dir, "feat/2-panier", "src/panier.go", "package app\n")
	gitIn(t, e.dir, "checkout", "--quiet", "develop")
	commitOn(t, e.dir, "feat/3-export", "src/export.go", "package app\n")
	gitIn(t, e.dir, "checkout", "--quiet", "develop")
	commitOn(t, e.dir, "feat/4-vieux", "src/vieux.go", "package app\n")
	gitIn(t, e.dir, "checkout", "--quiet", "develop")
	ctx := context.Background()
	created := func(c source.NewChange) int {
		t.Helper()
		got, err := e.project.CreateChange(ctx, c)
		if err != nil {
			t.Fatal(err)
		}
		return got.Number
	}
	panier = created(source.NewChange{Title: "Le panier", Body: "Ajoute le panier.", Head: "feat/2-panier", Base: "develop", Author: "Développeur"})
	export = created(source.NewChange{Title: "L’export", Body: "Exporte.", Head: "feat/3-export", Base: "develop", Draft: true, Author: "Développeur"})
	vieux := created(source.NewChange{Title: "Le vieux", Head: "feat/4-vieux", Base: "develop", Author: "Développeur"})
	if _, err := e.project.SetChangeState(ctx, vieux, source.ChangeClosed, false); err != nil {
		t.Fatal(err)
	}
	if _, err := e.project.CommentChange(ctx, panier, "Pilote", "Penser aux taxes.", ""); err != nil {
		t.Fatal(err)
	}
	review := source.Review{Author: "Relecteur", State: source.ReviewChangesRequested, Body: "À revoir.", SubmittedAt: time.Now().UTC(),
		Comments: []source.ReviewComment{{Path: "src/panier.go", Line: 1, Body: "Ce paquet.", CreatedAt: time.Now().UTC()}}}
	if err := e.project.AddChangeReview(ctx, panier, review, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := e.project.CommentChange(ctx, export, "Pilote", "Le format CSV.", ""); err != nil {
		t.Fatal(err)
	}
	return e, panier, export
}

func pullFrom(t *testing.T, e *env, from string) fakeIssue {
	t.Helper()
	for _, pr := range e.gh.Pulls() {
		if strings.HasSuffix(pr.Body, "<!-- crewdeck:from "+from+" -->") {
			return pr
		}
	}
	t.Fatalf("no pull request of %s", from)
	return fakeIssue{}
}

func switchOf(t *testing.T, e *env) contracts.RunnerMigrationSwitch {
	t.Helper()
	switched := sentOf[contracts.RunnerMigrationSwitch](e)
	if len(switched) != 1 {
		t.Fatalf("switches %d, failed %+v\n%s", len(switched), sentOf[contracts.RunnerMigrationFailed](e), e.logs.String())
	}
	return switched[0]
}

func fingerprintsOf(s contracts.RunnerMigrationSwitch) map[string]contracts.RunnerMigrationSwitchFingerprintsElem {
	out := map[string]contracts.RunnerMigrationSwitchFingerprintsElem{}
	for _, f := range s.Fingerprints {
		out[f.Key] = f
	}
	return out
}

// noToken fails when the migration's token is in a file under one of dirs.
func noToken(t *testing.T, token string, dirs ...string) {
	t.Helper()
	for _, dir := range dirs {
		_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			if data, _ := os.ReadFile(path); strings.Contains(string(data), token) {
				t.Errorf("the token is in %s", strings.TrimPrefix(path, dir))
			}
			return nil
		})
	}
}

func TestCodeToGitHubPushesTheBranchesReleaseFirstAndEachOpenChangeAsAPullRequest(t *testing.T) {
	e, panier, export := localCode(t)
	bare, log := e.bare()
	e.handler().Copy(context.Background(), codeMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))
	s := switchOf(t, e)

	pushed := pushedRefs(t, log)
	if len(pushed) != 5 || pushed[0] != "refs/heads/main" || pushed[1] != "refs/heads/develop" {
		t.Fatalf("pushed %v, want main first, then develop, each once", pushed)
	}
	local := branchesOf(t, e.dir)
	if remote := branchesOf(t, bare); !mapsEqual(remote, local) {
		t.Errorf("GitHub's branches %v, the folder's %v", remote, local)
	}
	if tags := gitIn(t, bare, "tag"); tags != "" {
		t.Errorf("tags pushed %q", tags)
	}

	pulls := e.gh.Pulls()
	if len(pulls) != 2 {
		t.Fatalf("%d pull requests, want the two open changes", len(pulls))
	}
	p := pullFrom(t, e, "local#"+itoa(panier))
	if p.Title != "Le panier" || !strings.HasPrefix(p.Body, "Ajoute le panier.") || p.Head != "feat/2-panier" || p.Base != "develop" || p.Draft {
		t.Errorf("panier's pull request %+v", p)
	}
	if len(p.Comments) != 3 {
		t.Fatalf("panier's comments %+v, want its comment, its review and its remark", p.Comments)
	}
	for _, c := range p.Comments {
		if !regexp.MustCompile(`^\*\*(Pilote|Relecteur)\*\*, le `).MatchString(c.Body) || !strings.Contains(c.Body, "<!-- crewdeck:from local#"+itoa(panier)+"/") {
			t.Errorf("comment %q", c.Body)
		}
	}
	bodies := p.Comments[0].Body + p.Comments[1].Body + p.Comments[2].Body
	for _, want := range []string{"Penser aux taxes.", "Revue : changements demandés", "À revoir.", "`src/panier.go`, ligne 1 :", "Ce paquet."} {
		if !strings.Contains(bodies, want) {
			t.Errorf("no %q in the comments", want)
		}
	}
	x := pullFrom(t, e, "local#"+itoa(export))
	if !x.Draft || len(x.Comments) != 1 {
		t.Errorf("export's pull request draft %v, comments %d", x.Draft, len(x.Comments))
	}

	got := map[int]int{}
	for _, r := range s.Renumbering {
		got[r.From] = r.To
	}
	if len(got) != 2 || got[panier] != p.Number || got[export] != x.Number || len(s.Milestones) != 0 {
		t.Errorf("renumbering %+v milestones %+v", s.Renumbering, s.Milestones)
	}
	fps := fingerprintsOf(s)
	if f := fps["branch:main"]; f.State != local["main"] || !hex64.MatchString(f.ContentHash) {
		t.Errorf("main's fingerprint %+v", f)
	}
	if f := fps["change:local#"+itoa(panier)]; f.State != "open" || !hex64.MatchString(f.ContentHash) {
		t.Errorf("panier's fingerprint %+v", f)
	}
	if f := fps["change:local#"+itoa(export)]; f.State != "draft" {
		t.Errorf("export's fingerprint %+v", f)
	}
	if len(fps) != 5+2 {
		t.Errorf("fingerprints %v", s.Fingerprints)
	}
	if strings.Contains(e.logs.String(), e.token) || strings.Contains(e.logs.String(), e.dir) {
		t.Errorf("the logs name the token or the folder\n%s", e.logs.String())
	}
	noToken(t, e.token, e.home, e.dir)
}

func TestCodeToGitHubRetriedAfterAFailureMidCopyPushesNothingTwice(t *testing.T) {
	e, panier, _ := localCode(t)
	_, log := e.bare()
	refused := 0
	e.gh.fail = func(call string) int {
		if strings.HasPrefix(call, "POST /issues/") && refused == 0 {
			refused++
			return 403
		}
		return 0
	}
	h := e.handler()
	h.Copy(context.Background(), codeMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))
	failed := sentOf[contracts.RunnerMigrationFailed](e)
	if len(failed) != 1 || failed[0].Code != migration.CodeGitHubRefused || len(sentOf[contracts.RunnerMigrationSwitch](e)) != 0 {
		t.Fatalf("failed %+v\n%s", failed, e.logs.String())
	}
	if pushed := pushedRefs(t, log); len(pushed) != 5 {
		t.Fatalf("pushed %v before the failure", pushed)
	}

	h.Copy(context.Background(), codeMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))
	switchOf(t, e)
	if pushed := pushedRefs(t, log); len(pushed) != 5 {
		t.Errorf("pushed %v, the retry pushed again", pushed)
	}
	if len(e.gh.Pulls()) != 2 || e.gh.count("POST /pulls") != 2 {
		t.Errorf("%d pull requests, %d created", len(e.gh.Pulls()), e.gh.count("POST /pulls"))
	}
	if p := pullFrom(t, e, "local#"+itoa(panier)); len(p.Comments) != 3 {
		t.Errorf("panier's comments %d, want 3", len(p.Comments))
	}
}

// githubCode is the env's repository on GitHub: main, develop and two
// feature branches, two open pull requests (one draft) with comments and
// reviews, one merged; the Projet has no folder, one is picked, empty.
func githubCode(t *testing.T) (e *env, work string, recherche, filtres int) {
	e = newEnv(t, nil)
	bare, _ := e.bare()
	work = t.TempDir()
	gitIn(t, work, "init", "--quiet")
	commitOn(t, work, "main", "README.md", "Le Projet.\n")
	commitOn(t, work, "develop", "docs/product/prd.md", "# Le PRD\n\nGitHub.\n")
	head := commitOn(t, work, "feat/7-recherche", "src/recherche.go", "package app\n")
	gitIn(t, work, "checkout", "--quiet", "develop")
	filtresHead := commitOn(t, work, "feat/8-filtres", "src/filtres.go", "package app\n")
	gitIn(t, work, "checkout", "--quiet", "develop")
	gitIn(t, work, "push", "--quiet", bare, "main", "develop", "feat/7-recherche", "feat/8-filtres")
	e.gh.add(fakeIssue{Title: "Un ticket"})
	recherche = e.gh.add(fakeIssue{PR: true, Title: "La recherche", Body: "Cherche.", Head: "feat/7-recherche", HeadSha: head, Base: "develop", Author: "octocat",
		Comments: []fakeComment{{ID: 401, Author: "octocat", Body: "Prêt.", At: "2026-11-19T08:00:00Z"}},
		Reviews: []fakeReview{{ID: 501, Author: "relecteur", State: "CHANGES_REQUESTED", Body: "Presque.",
			Remarks: []fakeRemark{{ID: 601, Path: "src/recherche.go", Line: 1, Body: "Le nom."}}}}}).Number
	e.gh.add(fakeIssue{PR: true, Title: "Fusionnée", Head: "feat/6-x", Base: "develop", State: "closed", Merged: true})
	filtres = e.gh.add(fakeIssue{PR: true, Title: "Les filtres", Head: "feat/8-filtres", HeadSha: filtresHead, Base: "develop", Draft: true}).Number
	e.folder, e.pending = "", filepath.Join(t.TempDir(), "choisi")
	if err := os.Mkdir(e.pending, 0o755); err != nil {
		t.Fatal(err)
	}
	return e, work, recherche, filtres
}

func TestCodeToLocalClonesIntoThePickedFolderEachOpenPullRequestALocalChange(t *testing.T) {
	e, work, recherche, filtres := githubCode(t)
	picked := e.pending
	e.handler().Copy(context.Background(), codeMessage(contracts.RunnerMigrationCopyFromGithub, contracts.RunnerMigrationCopyFromLocal))
	s := switchOf(t, e)

	if got, want := branchesOf(t, picked), branchesOf(t, work); !mapsEqual(got, want) {
		t.Errorf("the folder's branches %v, want GitHub's %v", got, want)
	}
	if head := gitIn(t, picked, "symbolic-ref", "HEAD"); head != "refs/heads/develop" {
		t.Errorf("HEAD %s, want the integration branch", head)
	}
	if status := gitIn(t, picked, "status", "--porcelain"); status != "" {
		t.Errorf("the work tree is not develop's: %q", status)
	}
	if prd, err := os.ReadFile(filepath.Join(picked, "docs", "product", "prd.md")); err != nil || !strings.Contains(string(prd), "GitHub.") {
		t.Errorf("prd.md %q, %v", prd, err)
	}
	if e.folder != "" || len(e.promoted) != 0 {
		t.Errorf("the folder was promoted before the finish")
	}

	changes, err := e.open(projectID, picked).CopiedChanges(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 2 {
		t.Fatalf("local changes %+v, want the two open pull requests", changes)
	}
	r, f := changes[0], changes[1]
	if r.From != "github#"+itoa(recherche) || r.Title != "La recherche" || r.Body != "Cherche." || r.HeadRef != "feat/7-recherche" || r.BaseRef != "develop" ||
		r.IsDraft || r.State != source.ChangeOpen || r.Author != "octocat" {
		t.Errorf("recherche's change %+v", r.Change)
	}
	if len(r.Comments) != 1 || r.Comments[0].Body != "Prêt." || r.Comments[0].Author != "octocat" {
		t.Errorf("recherche's comments %+v", r.Comments)
	}
	if len(r.Reviews) != 1 || r.Reviews[0].State != source.ReviewChangesRequested || len(r.Reviews[0].Comments) != 1 || r.Reviews[0].Comments[0].Path != "src/recherche.go" {
		t.Errorf("recherche's reviews %+v", r.Reviews)
	}
	if f.From != "github#"+itoa(filtres) || !f.IsDraft {
		t.Errorf("filtres's change %+v", f.Change)
	}
	got := map[int]int{}
	for _, n := range s.Renumbering {
		got[n.From] = n.To
	}
	if len(got) != 2 || got[recherche] != r.Number || got[filtres] != f.Number {
		t.Errorf("renumbering %+v", s.Renumbering)
	}
	fps := fingerprintsOf(s)
	if fp := fps["branch:develop"]; fp.State != branchesOf(t, work)["develop"] {
		t.Errorf("develop's fingerprint %+v", fp)
	}
	if fp := fps["change:github#"+itoa(filtres)]; fp.State != "draft" || !hex64.MatchString(fp.ContentHash) {
		t.Errorf("filtres's fingerprint %+v", fp)
	}
	if len(fps) != 4+2 {
		t.Errorf("fingerprints %v", s.Fingerprints)
	}
	if strings.Contains(e.logs.String(), e.token) || strings.Contains(e.logs.String(), picked) {
		t.Errorf("the logs name the token or the folder\n%s", e.logs.String())
	}
	noToken(t, e.token, e.home, picked)

	// A retry writes nothing more.
	e.handler().Copy(context.Background(), codeMessage(contracts.RunnerMigrationCopyFromGithub, contracts.RunnerMigrationCopyFromLocal))
	if again, _ := e.open(projectID, picked).CopiedChanges(context.Background()); len(again) != 2 || len(again[0].Comments) != 1 || len(again[0].Reviews) != 1 {
		t.Errorf("a retry copied again: %+v", again)
	}
}

func TestCodeToLocalResumesInThePartlyClonedFolderOnceItIsNoLongerPending(t *testing.T) {
	e, work, _, _ := githubCode(t)
	picked := e.pending
	refused := 0
	e.gh.fail = func(call string) int {
		if call == "GET /pulls" && refused == 0 {
			refused++
			return 403
		}
		return 0
	}
	h := e.handler()
	h.Copy(context.Background(), codeMessage(contracts.RunnerMigrationCopyFromGithub, contracts.RunnerMigrationCopyFromLocal))
	if failed := sentOf[contracts.RunnerMigrationFailed](e); len(failed) != 1 {
		t.Fatalf("failed %+v", failed)
	}
	// The pick dropped meanwhile; the folder holds the branches already.
	e.pending = ""
	h.Copy(context.Background(), codeMessage(contracts.RunnerMigrationCopyFromGithub, contracts.RunnerMigrationCopyFromLocal))
	switchOf(t, e)
	if got, want := branchesOf(t, picked), branchesOf(t, work); !mapsEqual(got, want) {
		t.Errorf("the folder's branches %v, want %v", got, want)
	}
	if changes, _ := e.open(projectID, picked).CopiedChanges(context.Background()); len(changes) != 2 {
		t.Errorf("%d local changes", len(changes))
	}
}

func TestCodeToLocalFinishCarriesALateCommitPromotesTheFolderAndReportsTheChanges(t *testing.T) {
	e, work, _, _ := githubCode(t)
	picked := e.pending
	h := e.handler()
	h.Copy(context.Background(), codeMessage(contracts.RunnerMigrationCopyFromGithub, contracts.RunnerMigrationCopyFromLocal))
	s := switchOf(t, e)
	changes, _ := e.open(projectID, picked).CopiedChanges(context.Background())

	// Once switched, develop and a feature branch move on GitHub; a branch is made there.
	late := commitOn(t, work, "develop", "src/tard.go", "package app\n")
	feature := commitOn(t, work, "feat/7-recherche", "src/encore.go", "package app\n")
	fresh := commitOn(t, work, "feat/9-nouveau", "src/nouveau.go", "package app\n")
	gitIn(t, work, "push", "--quiet", e.gh.bare, "develop", "feat/7-recherche", "feat/9-nouveau")
	pullsBefore := e.gh.count("GET /pulls")
	h.Finish(context.Background(), finishMessage(s))
	if failed := sentOf[contracts.RunnerMigrationFailed](e); len(failed) > 0 || len(sentOf[contracts.RunnerMigrationFinished](e)) != 1 {
		t.Fatalf("failed %+v\n%s", failed, e.logs.String())
	}
	branches := branchesOf(t, picked)
	if branches["develop"] != late || branches["feat/7-recherche"] != feature || branches["feat/9-nouveau"] != fresh {
		t.Errorf("the folder's branches %v after the finish", branches)
	}
	if _, err := os.Stat(filepath.Join(picked, "src", "tard.go")); err != nil {
		t.Errorf("the checked-out develop was not fast-forwarded: %v", err)
	}
	if refs := gitIn(t, picked, "for-each-ref", "refs/crewdeck/"); refs != "" {
		t.Errorf("the migration's refs are left: %s", refs)
	}
	if e.folder != picked || !slices.Equal(e.promoted, []string{projectID}) || e.pending != "" {
		t.Errorf("folder promoted %v, the Projet's %q", e.promoted, e.folder)
	}
	clone := filepath.Join(e.home, "repos", "local", projectID)
	if origin := gitIn(t, clone, "remote", "get-url", "origin"); origin != picked {
		t.Errorf("the Runner's clone's origin %q, want the folder", origin)
	}
	if e.gh.count("POST .*|PATCH .*") != 0 || e.gh.count("GET /pulls") != pullsBefore {
		t.Errorf("the finish wrote to GitHub or read its pull requests again")
	}

	// The full report holds the changes at their new numbers, their titles sealed.
	reports := sentOf[contracts.RunnerLocalChanged](e)
	if len(reports) != 1 || !reports[0].Full || reports[0].ProjectId != projectID {
		t.Fatalf("reports %+v", reports)
	}
	reported := map[int]contracts.LocalItemChange{}
	for _, item := range reports[0].Items {
		if item.Change != nil {
			reported[item.Change.Number] = *item.Change
		}
	}
	for _, c := range changes {
		got, ok := reported[c.Number]
		if !ok || got.TitleSealed.Ciphertext == "" || got.HeadSha != c.HeadOid ||
			(got.State != contracts.LocalItemChangeStateOpen && got.State != contracts.LocalItemChangeStateDraft) {
			t.Errorf("change %d reported %+v", c.Number, got)
		}
	}
	if len(reported) != 2 {
		t.Errorf("%d changes reported", len(reported))
	}
	if raw := e.logs.String(); strings.Contains(raw, "La recherche") {
		t.Errorf("a title in the logs")
	}
	if strings.Join(e.finished, ";") != projectID+" local" {
		t.Errorf("finished %v", e.finished)
	}
}

func TestCodeToGitHubFinishPushesALateCommitAndRemovesTheFoldersClone(t *testing.T) {
	e, _, _ := localCode(t)
	bare, log := e.bare()
	h := e.handler()
	h.Copy(context.Background(), codeMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))
	s := switchOf(t, e)
	clone := filepath.Join(e.home, "repos", "local", projectID)
	if _, err := os.Stat(clone); err != nil {
		t.Fatalf("no clone of the folder: %v", err)
	}

	// Once switched, the Pilote commits on develop and makes a branch.
	late := commitOn(t, e.dir, "develop", "src/tard.go", "package app\n")
	fresh := commitOn(t, e.dir, "feat/9-nouveau", "src/nouveau.go", "package app\n")
	before := len(pushedRefs(t, log))
	h.Finish(context.Background(), finishMessage(s))
	if failed := sentOf[contracts.RunnerMigrationFailed](e); len(failed) > 0 || len(sentOf[contracts.RunnerMigrationFinished](e)) != 1 {
		t.Fatalf("failed %+v\n%s", failed, e.logs.String())
	}
	remote := branchesOf(t, bare)
	if remote["develop"] != late || remote["feat/9-nouveau"] != fresh {
		t.Errorf("GitHub's branches %v after the finish", remote)
	}
	if pushed := pushedRefs(t, log)[before:]; len(pushed) != 2 {
		t.Errorf("the finish pushed %v, want the two moved", pushed)
	}
	if _, err := os.Stat(clone); !os.IsNotExist(err) {
		t.Errorf("the folder's clone is left: %v", err)
	}
	if e.folder != e.dir || len(e.promoted) != 0 || len(sentOf[contracts.RunnerLocalChanged](e)) != 0 {
		t.Errorf("the folder changed hands: %q, promoted %v", e.folder, e.promoted)
	}
	if b := branchesOf(t, e.dir); b["develop"] != late {
		t.Errorf("the folder was touched: %v", b)
	}
}

func TestCodeFinishFailsBranchDivergedWhenABranchMovedOnBothPlaces(t *testing.T) {
	e, _, _ := localCode(t)
	bare, _ := e.bare()
	h := e.handler()
	h.Copy(context.Background(), codeMessage(contracts.RunnerMigrationCopyFromLocal, contracts.RunnerMigrationCopyFromGithub))
	s := switchOf(t, e)

	// develop moves on GitHub, and in the folder otherwise.
	other := t.TempDir()
	gitIn(t, other, "clone", "--quiet", bare, ".")
	gitIn(t, other, "checkout", "--quiet", "develop")
	commitOn(t, other, "develop", "src/github.go", "package app\n")
	gitIn(t, other, "push", "--quiet", "origin", "develop")
	commitOn(t, e.dir, "develop", "src/local.go", "package app\n")
	h.Finish(context.Background(), finishMessage(s))
	failed := sentOf[contracts.RunnerMigrationFailed](e)
	if len(failed) != 1 || failed[0].Stage != contracts.RunnerMigrationFailedStageFinish || failed[0].Code != migration.CodeBranchDiverged {
		t.Fatalf("failed %+v\n%s", failed, e.logs.String())
	}
	if len(sentOf[contracts.RunnerMigrationFinished](e)) != 0 {
		t.Error("finished although diverged")
	}
}

func TestCodeTokenReachesGitThroughItsEnvironmentOnly(t *testing.T) {
	env := migration.AuthEnv("https://github.com/", "ghs_secret")
	want := []string{"GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=http.https://github.com/.extraheader",
		"GIT_CONFIG_VALUE_0=Authorization: Basic eC1hY2Nlc3MtdG9rZW46Z2hzX3NlY3JldA=="}
	if !slices.Equal(env, want) {
		t.Errorf("env %v", env)
	}
}

func mapsEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func itoa(n int) string { return strconv.Itoa(n) }
