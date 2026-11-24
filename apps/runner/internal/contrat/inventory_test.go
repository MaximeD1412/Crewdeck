package contrat

import (
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

func gitIn(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "init.defaultBranch=main", "-c", "commit.gpgsign=false"}, args...)...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.test", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.test", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

// inventoryOrigins are the origins of a Runner's clone: a GitHub repository
// (a bare one) and a Local folder (a plain repository, its own checkout).
func inventoryOrigins(t *testing.T) map[string]string {
	t.Helper()
	bare, folder, seed := filepath.Join(t.TempDir(), "repo.git"), t.TempDir(), t.TempDir()
	gitIn(t, filepath.Dir(bare), "init", "--quiet", "--bare", bare)
	for _, dir := range []string{seed, folder} {
		gitIn(t, dir, "init", "--quiet")
		if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("code\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		gitIn(t, dir, "add", "README.md")
		gitIn(t, dir, "commit", "--quiet", "-m", "code")
	}
	gitIn(t, seed, "push", "--quiet", bare, "main")
	return map[string]string{"bare": bare, "folder": folder}
}

// inventoryWorktree is a clone of origin on crewdeck/inventaire with the
// fixture folder's files committed, pushed unless push is false.
func inventoryWorktree(t *testing.T, origin, folder string, push bool) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "clone")
	gitIn(t, filepath.Dir(dir), "clone", "--quiet", origin, dir)
	gitIn(t, dir, "checkout", "--quiet", "-b", "crewdeck/inventaire")
	src := filepath.Join(fixturesDir, "inventory", folder)
	err := filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(src, path)
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Join(dir, filepath.Dir(rel)), 0o755); err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(dir, rel), data, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
	gitIn(t, dir, "add", "-A")
	gitIn(t, dir, "commit", "--quiet", "-m", "docs(crewdeck) : inventaire")
	if push {
		gitIn(t, dir, "push", "--quiet", "origin", "crewdeck/inventaire")
	}
	return dir
}

func inventory(t *testing.T) Contrat {
	t.Helper()
	c, err := Get("inventory")
	if err != nil {
		t.Fatalf("Get(inventory): %v", err)
	}
	return c
}

// The Étape opens no PR: the verdict's head is the worktree's HEAD, the
// commit pushed on crewdeck/inventaire.
func TestInventoryPassingFolderPassesOnBothOriginsWithItsHead(t *testing.T) {
	c := inventory(t)
	for name, origin := range inventoryOrigins(t) {
		dir := inventoryWorktree(t, origin, "pass", true)
		verdict := check(t, c, Target{Dir: dir})
		head := gitIn(t, dir, "rev-parse", "HEAD")
		if verdict.Status != contracts.ContratVerdictStatusPassed || len(verdict.FailedRuleIds) != 0 || len(verdict.WarningRuleIds) != 0 {
			t.Errorf("%s: verdict %+v, want passed", name, verdict)
		}
		if verdict.HeadSha == nil || *verdict.HeadSha != head {
			t.Errorf("%s: headSha %v, want the worktree's HEAD %s", name, verdict.HeadSha, head)
		}
	}
}

// Each rule has its folder, a copy of `pass` that fails it (the branch's,
// the same files never pushed); a missing glossary has no term either.
func TestInventoryEachFailingFolderFailsItsRule(t *testing.T) {
	c := inventory(t)
	for _, rule := range c.Rules {
		if rule.Severity != "bloquant" {
			t.Errorf("%s is %s, want bloquant", rule.ID, rule.Severity)
		}
		want := []string{rule.ID}
		if rule.ID == "inventory.glossary.file" {
			want = []string{"inventory.glossary.file", "inventory.glossary.terms"}
		}
		t.Run(rule.ID, func(t *testing.T) {
			for name, origin := range inventoryOrigins(t) {
				dir := inventoryWorktree(t, origin, "fail-"+rule.ID, rule.ID != "inventory.branch.pushed")
				verdict := check(t, c, Target{Dir: dir})
				if verdict.Status != contracts.ContratVerdictStatusIncomplete || !slices.Equal(verdict.FailedRuleIds, want) {
					t.Errorf("%s: verdict %+v, want incomplete with %v", name, verdict, want)
				}
			}
		})
	}
	folders, err := filepath.Glob(filepath.Join(fixturesDir, "inventory", "fail-*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(folders) != len(c.Rules) {
		t.Errorf("%d failing folders for %d rules", len(folders), len(c.Rules))
	}
}

// An origin unreachable at the end of the Session (a network down, a Local
// folder moved) is a verdict, incomplete on the branch only: its Décision
// « Contrat incomplet » is rerunnable, and the rerun passes once it is back.
func TestInventoryUnreachableOriginIsIncompleteOnTheBranchThenPasses(t *testing.T) {
	c := inventory(t)
	for name, origin := range inventoryOrigins(t) {
		dir := inventoryWorktree(t, origin, "pass", true)
		moved := origin + ".away"
		if err := os.Rename(origin, moved); err != nil {
			t.Fatal(err)
		}
		verdict := check(t, c, Target{Dir: dir})
		if verdict.Status != contracts.ContratVerdictStatusIncomplete || !slices.Equal(verdict.FailedRuleIds, []string{"inventory.branch.pushed"}) {
			t.Errorf("%s, origin unreachable: verdict %+v, want incomplete on the branch only", name, verdict)
		}
		if err := os.Rename(moved, origin); err != nil {
			t.Fatal(err)
		}
		if verdict := check(t, c, Target{Dir: dir}); verdict.Status != contracts.ContratVerdictStatusPassed {
			t.Errorf("%s, origin back: verdict %+v, want passed", name, verdict)
		}
	}
}

// A folder that is not a repository of its own (a fixture inside this one)
// has no head: never the HEAD of the repository around it.
func TestInventoryVerdictHasNoHeadOutsideARepository(t *testing.T) {
	verdict := check(t, inventory(t), Target{Dir: filepath.Join(fixturesDir, "inventory", "pass")})
	if verdict.HeadSha != nil || !slices.Equal(verdict.FailedRuleIds, []string{"inventory.branch.pushed"}) {
		t.Fatalf("verdict %+v, want no head and only the branch failed", verdict)
	}
}
