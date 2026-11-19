package folders

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// pilotGit isolates the git of the code under test from this machine's: a
// temporary home and global config, no system config, no identity from the
// environment; the Pilote's identity in that global config when `identity`.
func pilotGit(t *testing.T, identity bool) {
	t.Helper()
	home := t.TempDir()
	global := filepath.Join(home, "gitconfig")
	config := ""
	if identity {
		config = "[user]\n\tname = Pilote\n\temail = pilote@example.test\n"
	}
	if err := os.WriteFile(global, []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_CONFIG_GLOBAL", global)
	for _, key := range []string{"GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL", "GIT_DIR", "GIT_WORK_TREE"} {
		t.Setenv(key, "")
		os.Unsetenv(key)
	}
}

// folder is a new folder of the test, its links resolved.
func folder(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Join(dir, "recettes")
}

func assertReadiness(t *testing.T, got, want Readiness) {
	t.Helper()
	if got != want {
		t.Fatalf("status %+v, want %+v", got, want)
	}
}

func assertPrepared(t *testing.T, got, want contracts.RunnerProjectFolderPreparedError) {
	t.Helper()
	if got != want {
		t.Fatalf("prepare %q, want %q", got, want)
	}
}

func commits(t *testing.T, dir string) string {
	t.Helper()
	return git(t, dir, "rev-list", "--count", "--all")
}

func TestStatusOfAMissingFolderIsAllFalse(t *testing.T) {
	pilotGit(t, true)
	assertReadiness(t, Status(folder(t), "main", "develop"), Readiness{})
}

func TestStatusOfAFileIsAllFalse(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	touch(t, path)
	assertReadiness(t, Status(path, "main", "develop"), Readiness{})
}

func TestStatusOfAFolderWithoutGitIsOnlyPresent(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	touch(t, filepath.Join(path, "main.go"))
	assertReadiness(t, Status(path, "main", "develop"), Readiness{Present: true})
}

func TestStatusOfARepositoryWithoutCommitsHasNoBranch(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	repository(t, path, 0)
	assertReadiness(t, Status(path, "main", "develop"), Readiness{Present: true, IsGit: true})
}

func TestStatusOfARepositorySaysEachOfItsBranches(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	repository(t, path, 1)
	assertReadiness(t, Status(path, "main", "develop"), Readiness{Present: true, IsGit: true, HasCommits: true, ReleaseBranch: true})
	git(t, path, "branch", "develop")
	assertReadiness(t, Status(path, "main", "develop"), Readiness{Present: true, IsGit: true, HasCommits: true, ReleaseBranch: true, IntegrationBranch: true})
	assertReadiness(t, Status(path, "prod", "develop"), Readiness{Present: true, IsGit: true, HasCommits: true, IntegrationBranch: true})
}

// A tag of the branch's name is not the branch.
func TestStatusDoesNotTakeATagForABranch(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	repository(t, path, 1)
	git(t, path, "tag", "develop")
	assertReadiness(t, Status(path, "main", "develop"), Readiness{Present: true, IsGit: true, HasCommits: true, ReleaseBranch: true})
}

// A subfolder of a repository is not one, as for a check (« git init » is its preparation).
func TestStatusOfASubfolderOfARepositoryIsNotGit(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	repository(t, path, 1)
	sub := filepath.Join(path, "web")
	mkdir(t, sub)
	assertReadiness(t, Status(sub, "main", "develop"), Readiness{Present: true})
}

func TestStatusOfABranchNameThatIsAnOptionIsFalse(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	repository(t, path, 1)
	assertReadiness(t, Status(path, "--all", "-q"), Readiness{Present: true, IsGit: true, HasCommits: true})
}

func TestPrepareMakesAFolderARepositoryWithItsFirstCommitAndItsBranches(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	touch(t, filepath.Join(path, "main.go"))
	touch(t, filepath.Join(path, "web", "index.html"))
	touch(t, filepath.Join(path, "secret.env"))
	if err := os.WriteFile(filepath.Join(path, ".gitignore"), []byte("*.env\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	assertPrepared(t, Prepare(path, "main", "develop"), "")

	assertReadiness(t, Status(path, "main", "develop"), Readiness{Present: true, IsGit: true, HasCommits: true, ReleaseBranch: true, IntegrationBranch: true})
	if got := git(t, path, "symbolic-ref", "--short", "HEAD"); got != "main" {
		t.Fatalf("HEAD on %q, want main", got)
	}
	if got := commits(t, path); got != "1" {
		t.Fatalf("%s commits, want one", got)
	}
	if got := git(t, path, "log", "-1", "--format=%s|%an|%ae"); got != "chore(crewdeck) : premier commit|Pilote|pilote@example.test" {
		t.Fatalf("commit %q", got)
	}
	if got := git(t, path, "ls-tree", "-r", "--name-only", "HEAD"); got != ".gitignore\nmain.go\nweb/index.html" {
		t.Fatalf("committed files %q", got)
	}
	if git(t, path, "rev-parse", "develop") != git(t, path, "rev-parse", "main") {
		t.Fatal("develop is not at main")
	}
	if got := git(t, path, "status", "--porcelain"); got != "" {
		t.Fatalf("working tree %q, want clean", got)
	}
}

func TestPrepareCommitsAnEmptyFolderEmpty(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	mkdir(t, path)

	assertPrepared(t, Prepare(path, "main", "develop"), "")

	assertReadiness(t, Status(path, "main", "develop"), Readiness{Present: true, IsGit: true, HasCommits: true, ReleaseBranch: true, IntegrationBranch: true})
	if got := git(t, path, "ls-tree", "-r", "--name-only", "HEAD"); got != "" {
		t.Fatalf("committed files %q, want none", got)
	}
}

// Without the Pilote's identity, nothing is committed; the « git init » stays.
func TestPrepareWithoutAGitIdentityCommitsNothing(t *testing.T) {
	pilotGit(t, false)
	path := folder(t)
	touch(t, filepath.Join(path, "main.go"))

	assertPrepared(t, Prepare(path, "main", "develop"), contracts.RunnerProjectFolderPreparedErrorGitIdentityMissing)

	assertReadiness(t, Status(path, "main", "develop"), Readiness{Present: true, IsGit: true})
	if got := git(t, path, "status", "--porcelain"); got != "?? main.go" {
		t.Fatalf("working tree %q, want main.go untracked", got)
	}
}

func TestPrepareOfARepositoryWithCommitsOnlyAddsTheIntegrationBranch(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	repository(t, path, 2)
	git(t, path, "checkout", "-q", "-b", "feature")
	touch(t, filepath.Join(path, "draft.go"))
	before := git(t, path, "rev-parse", "HEAD")

	assertPrepared(t, Prepare(path, "main", "develop"), "")

	assertReadiness(t, Status(path, "main", "develop"), Readiness{Present: true, IsGit: true, HasCommits: true, ReleaseBranch: true, IntegrationBranch: true})
	if got := commits(t, path); got != "2" {
		t.Fatalf("%s commits, want the two of before", got)
	}
	if got := git(t, path, "symbolic-ref", "--short", "HEAD"); got != "feature" || git(t, path, "rev-parse", "HEAD") != before {
		t.Fatalf("HEAD on %q, want feature unchanged", got)
	}
	if git(t, path, "rev-parse", "develop") != git(t, path, "rev-parse", "main") {
		t.Fatal("develop is not at main")
	}
	if got := git(t, path, "status", "--porcelain"); got != "?? draft.go" {
		t.Fatalf("working tree %q, want draft.go untracked", got)
	}
}

func TestPrepareOfAReadyRepositoryDoesNothing(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	repository(t, path, 1)
	git(t, path, "branch", "develop")
	git(t, path, "commit", "-q", "--allow-empty", "-m", "on main")

	assertPrepared(t, Prepare(path, "main", "develop"), "")

	if git(t, path, "rev-parse", "develop") == git(t, path, "rev-parse", "main") {
		t.Fatal("develop moved to main")
	}
	if got := commits(t, path); got != "2" {
		t.Fatalf("%s commits, want two", got)
	}
}

// A repository with commits but without the release branch has no fix the
// Runner makes: nothing is done.
func TestPrepareLeavesAnAbsentReleaseBranchAlone(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	repository(t, path, 1)

	assertPrepared(t, Prepare(path, "prod", "develop"), "")

	assertReadiness(t, Status(path, "prod", "develop"), Readiness{Present: true, IsGit: true, HasCommits: true})
	if got := git(t, path, "for-each-ref", "--format=%(refname:short)", "refs/heads/"); got != "main" {
		t.Fatalf("branches %q, want main alone", got)
	}
}

// A repository without commits on another unborn branch gets its first
// commit on that branch, HEAD left where the Pilote put it, and the release
// and integration branches from it.
func TestPrepareGivesAnEmptyRepositoryItsFirstCommitWithoutMovingHead(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	mkdir(t, path)
	git(t, path, "init", "-q", "-b", "master")
	touch(t, filepath.Join(path, "main.go"))

	assertPrepared(t, Prepare(path, "main", "develop"), "")

	assertReadiness(t, Status(path, "main", "develop"), Readiness{Present: true, IsGit: true, HasCommits: true, ReleaseBranch: true, IntegrationBranch: true})
	if got := git(t, path, "for-each-ref", "--format=%(refname:short)", "refs/heads/"); got != "develop\nmain\nmaster" {
		t.Fatalf("branches %q, want develop, main and master", got)
	}
	if got := git(t, path, "symbolic-ref", "--short", "HEAD"); got != "master" {
		t.Fatalf("HEAD on %q, want master", got)
	}
	if got := git(t, path, "status", "--porcelain"); got != "" {
		t.Fatalf("working tree %q, want clean", got)
	}
}

func TestPrepareOfAMissingFolderSaysIt(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	assertPrepared(t, Prepare(path, "main", "develop"), contracts.RunnerProjectFolderPreparedErrorFolderMissing)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("the folder was made: %v", err)
	}
	touch(t, path)
	assertPrepared(t, Prepare(path, "main", "develop"), contracts.RunnerProjectFolderPreparedErrorFolderMissing)
}

func TestPrepareFailsWhenGitFails(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	mkdir(t, path)
	git(t, path, "init", "-q", "-b", "main")
	hook := filepath.Join(path, ".git", "hooks", "pre-commit")
	mkdir(t, filepath.Dir(hook))
	if err := os.WriteFile(hook, []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	assertPrepared(t, Prepare(path, "main", "develop"), contracts.RunnerProjectFolderPreparedErrorGitFailed)

	assertReadiness(t, Status(path, "main", "develop"), Readiness{Present: true, IsGit: true})
}

func TestPrepareRefusesABranchNameThatIsAnOption(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	repository(t, path, 1)
	assertPrepared(t, Prepare(path, "main", "--force"), contracts.RunnerProjectFolderPreparedErrorGitFailed)
	if got := git(t, path, "for-each-ref", "--format=%(refname:short)", "refs/heads/"); got != "main" {
		t.Fatalf("branches %q, want main alone", got)
	}
}

// A repository on an unborn branch beside others has commits: its HEAD is
// the Pilote's, nothing is committed nor moved.
func TestPrepareOfARepositoryOnAnOrphanBranchCommitsNothing(t *testing.T) {
	pilotGit(t, true)
	path := folder(t)
	repository(t, path, 1)
	git(t, path, "checkout", "-q", "--orphan", "fresh")
	touch(t, filepath.Join(path, "draft.go"))

	assertReadiness(t, Status(path, "main", "develop"), Readiness{Present: true, IsGit: true, HasCommits: true, ReleaseBranch: true})
	assertPrepared(t, Prepare(path, "main", "develop"), "")

	if got := commits(t, path); got != "1" {
		t.Fatalf("%s commits, want one", got)
	}
	if got := git(t, path, "symbolic-ref", "--short", "HEAD"); got != "fresh" {
		t.Fatalf("HEAD on %q, want fresh", got)
	}
	assertReadiness(t, Status(path, "main", "develop"), Readiness{Present: true, IsGit: true, HasCommits: true, ReleaseBranch: true, IntegrationBranch: true})
}
