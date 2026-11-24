package checks

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// The Inventaire's check (PROJET-4): the worktree's HEAD is what its origin
// holds on the branch `params.branch`, whether the origin is a GitHub
// repository or a Local folder. The origin is asked (`git ls-remote`), never
// the worktree's remote-tracking ref, which may be stale, and nothing of the
// Runner's clone is written. A folder that is not a repository, or without a
// commit, fails it; so does an origin that cannot be reached or does not
// answer within lsRemoteBound, so that the verdict is incomplete and its
// Étape rerunnable once the origin is back. Only the end of the check's own
// context is an error.
func init() {
	Register("branch-pushed", branchPushed)
}

// lsRemoteBound is how long the origin has to answer: a silent one fails the
// rule well before the verdict's own bound ends the check in an error.
var lsRemoteBound = 30 * time.Second

var branchName = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9._/-]*$`)

func branchPushed(ctx context.Context, t target.Target, params map[string]any) (bool, error) {
	branch, ok := params["branch"].(string)
	if !ok || !branchName.MatchString(branch) || strings.Contains(branch, "..") || strings.Contains(branch, "//") || strings.HasSuffix(branch, "/") || strings.HasSuffix(branch, ".lock") {
		return false, fmt.Errorf("branch-pushed: params.branch must be a branch's name, got %v", params["branch"])
	}
	head, ok, err := t.Head(ctx)
	if err != nil || !ok {
		return false, err
	}
	asked, cancel := context.WithTimeout(ctx, lsRemoteBound)
	defer cancel()
	out, err := t.Git(asked, "ls-remote", "--heads", "origin", "refs/heads/"+branch)
	if err != nil {
		if ctx.Err() != nil {
			return false, fmt.Errorf("branch-pushed: %w", ctx.Err())
		}
		var exit *exec.ExitError
		if errors.As(err, &exit) || asked.Err() != nil {
			// The origin did not answer: the branch is not shown pushed.
			return false, nil
		}
		return false, fmt.Errorf("branch-pushed: git ls-remote: %w", err)
	}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if sha, ref, found := strings.Cut(line, "\t"); found && ref == "refs/heads/"+branch {
			return sha == head, nil
		}
	}
	return false, nil
}
