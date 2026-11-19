package folders

import (
	"context"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// FirstCommit is the message of the commit a preparation makes in a folder
// without one (PROJET-3).
const FirstCommit = "chore(crewdeck) : premier commit"

// prepareTimeout bounds the preparation's `git add` and `git commit`: a
// large folder, the Pilote's hooks and signing take longer than a check.
const prepareTimeout = 2 * time.Minute

// Readiness is where a Projet's folder stands for its Process (PROJET-3):
// the figures of project.folder.state, never its path.
type Readiness struct {
	// Present: the folder is still a folder.
	Present bool
	// IsGit: the folder is a git repository's root.
	IsGit bool
	// HasCommits: the repository has a commit, on HEAD or on a local branch.
	HasCommits bool
	// ReleaseBranch and IntegrationBranch: the local branches of those names exist.
	ReleaseBranch     bool
	IntegrationBranch bool
}

// Status says where the folder at path stands, release and integration being
// the names of the Process's branches.
func Status(path, release, integration string) Readiness {
	if !isFolder(path) {
		return Readiness{}
	}
	ready := Readiness{Present: true}
	dir := realPath(path)
	if !isRepositoryRoot(dir) {
		return ready
	}
	ready.IsGit = true
	ready.HasCommits = hasCommits(dir)
	ready.ReleaseBranch = hasBranch(dir, release)
	ready.IntegrationBranch = hasBranch(dir, integration)
	return ready
}

// Prepare makes the folder at path ready for the Process, as far as the
// Runner may without touching the Pilote's work: « git init -b <release> »
// for a folder that is not a repository, a first commit of its files for a
// repository without one (on its current branch, the release branch from it
// when that is another), and the integration branch from the release one
// when it is missing. It never checks out, never moves the working tree's
// branch, never commits in a repository that has commits, and leaves a
// missing release branch of such a repository alone. "" when it went
// through, else why it stopped.
func Prepare(path, release, integration string) contracts.RunnerProjectFolderPreparedError {
	if !isFolder(path) {
		return contracts.RunnerProjectFolderPreparedErrorFolderMissing
	}
	dir := realPath(path)
	if !validBranch(dir, release) || !validBranch(dir, integration) {
		return contracts.RunnerProjectFolderPreparedErrorGitFailed
	}
	if !isRepositoryRoot(dir) {
		if _, err := gitWithin(dir, gitTimeout, "init", "-q", "-b", release); err != nil {
			return contracts.RunnerProjectFolderPreparedErrorGitFailed
		}
	}
	if !hasCommits(dir) {
		if !hasIdentity(dir) {
			return contracts.RunnerProjectFolderPreparedErrorGitIdentityMissing
		}
		if _, err := gitWithin(dir, prepareTimeout, "add", "-A"); err != nil {
			return contracts.RunnerProjectFolderPreparedErrorGitFailed
		}
		// The identity is the Pilote's config, never one git would guess.
		if _, err := gitWithin(dir, prepareTimeout, "-c", "user.useConfigOnly=true", "commit", "-q", "--allow-empty", "-m", FirstCommit); err != nil {
			return contracts.RunnerProjectFolderPreparedErrorGitFailed
		}
		// The first commit lands on the branch HEAD names, which stays the
		// current one: the release branch starts from it when it is another.
		if !hasBranch(dir, release) {
			if _, err := gitOutput(dir, "branch", "--no-track", release, "HEAD"); err != nil {
				return contracts.RunnerProjectFolderPreparedErrorGitFailed
			}
		}
	}
	if hasBranch(dir, release) && !hasBranch(dir, integration) {
		if _, err := gitOutput(dir, "branch", "--no-track", integration, "refs/heads/"+release); err != nil {
			return contracts.RunnerProjectFolderPreparedErrorGitFailed
		}
	}
	return ""
}

func isFolder(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// isRepositoryRoot says whether dir (its links resolved) is a git repository's root.
func isRepositoryRoot(dir string) bool {
	top, err := gitOutput(dir, "rev-parse", "--show-toplevel")
	return err == nil && realPath(top) == dir
}

// hasCommits says whether HEAD is a commit or a local branch exists: a
// repository on an unborn branch beside others has commits.
func hasCommits(dir string) bool {
	if count, err := gitOutput(dir, "rev-list", "--count", "HEAD"); err == nil {
		if n, _ := strconv.Atoi(count); n > 0 {
			return true
		}
	}
	branches, err := gitOutput(dir, "for-each-ref", "--count=1", "--format=%(refname)", "refs/heads/")
	return err == nil && branches != ""
}

// hasBranch says whether the local branch `name` exists; a tag of that name is not it.
func hasBranch(dir, name string) bool {
	if !validBranch(dir, name) {
		return false
	}
	_, err := gitOutput(dir, "show-ref", "--verify", "--quiet", "refs/heads/"+name)
	return err == nil
}

// validBranch says whether name may be a branch's: never one git would read as an option.
func validBranch(dir, name string) bool {
	if name == "" || strings.HasPrefix(name, "-") {
		return false
	}
	_, err := gitOutput(dir, "check-ref-format", "refs/heads/"+name)
	return err == nil
}

// hasIdentity says whether the Pilote's git config, as the repository at dir
// resolves it, names them and their email.
func hasIdentity(dir string) bool {
	name, err := gitOutput(dir, "config", "user.name")
	if err != nil || name == "" {
		return false
	}
	email, err := gitOutput(dir, "config", "user.email")
	return err == nil && email != ""
}

// gitWithin runs git in dir, bounded by timeout; its output trimmed. Its
// output may hold paths: it is never logged.
func gitWithin(dir string, timeout time.Duration, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	cmd.Env = gitEnv()
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}
