package folders

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

const (
	thisProject  = "019a6f00-0000-7000-8000-0000000000a1"
	otherProject = "019a6f00-0000-7000-8000-0000000000a2"
)

// git runs git in dir, the test failing on an error.
func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@example.test", "GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@example.test", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

// repository makes dir a git repository on main with `commits` commits.
func repository(t *testing.T, dir string, commits int) {
	t.Helper()
	mkdir(t, dir)
	git(t, dir, "init", "-q", "-b", "main")
	for i := 0; i < commits; i++ {
		git(t, dir, "commit", "-q", "--allow-empty", "-m", "commit")
	}
}

func mkdir(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
}

func touch(t *testing.T, path string) {
	t.Helper()
	mkdir(t, filepath.Dir(path))
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
}

// checker is a Checker of a temporary home, the Runner's state in ~/.crewdeck.
func checker(t *testing.T) (Checker, string) {
	t.Helper()
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return Checker{Home: home, StateDir: filepath.Join(home, ".crewdeck")}, home
}

func assertResult(t *testing.T, got Result, state contracts.FolderCheckResultState, hasCode bool, branch string) {
	t.Helper()
	gotBranch := ""
	if got.Branch != nil {
		gotBranch = *got.Branch
	}
	if got.State != state || got.HasCode != hasCode || gotBranch != branch {
		t.Fatalf("check = %s hasCode %v branch %q, want %s hasCode %v branch %q", got.State, got.HasCode, gotBranch, state, hasCode, branch)
	}
}

func TestARelativePathIsNotAbsolute(t *testing.T) {
	c, _ := checker(t)
	for _, input := range []string{"projets/recettes", "./recettes", "recettes", "~pilote/recettes", `C:\Users\pilote\recettes`} {
		assertResult(t, c.Check(input, nil, ""), contracts.FolderCheckResultStateNotAbsolute, false, "")
	}
}

func TestTildeIsTheHomeFolder(t *testing.T) {
	c, home := checker(t)
	repository(t, filepath.Join(home, "projets", "recettes"), 2)

	got := c.Check("~/projets/recettes", nil, "")

	assertResult(t, got, contracts.FolderCheckResultStateReady, true, "main")
	if got.Name != "recettes" || got.Path != filepath.Join(home, "projets", "recettes") {
		t.Fatalf("name %q path %q", got.Name, got.Path)
	}
}

func TestAnAbsentFolderIsMissing(t *testing.T) {
	c, home := checker(t)

	got := c.Check(filepath.Join(home, "projets", "recettes"), nil, "")

	assertResult(t, got, contracts.FolderCheckResultStateMissing, false, "")
	if got.Name != "recettes" || got.Path != "" {
		t.Fatalf("name %q path %q", got.Name, got.Path)
	}
}

func TestAFileIsNotAFolder(t *testing.T) {
	c, home := checker(t)
	touch(t, filepath.Join(home, "notes.txt"))

	assertResult(t, c.Check("~/notes.txt", nil, ""), contracts.FolderCheckResultStateNotAFolder, false, "")
	assertResult(t, c.Check("~/notes.txt/recettes", nil, ""), contracts.FolderCheckResultStateNotAFolder, false, "")
}

func TestTheRunnersStateFolderIsNotAFolderOfAProjet(t *testing.T) {
	c, home := checker(t)
	mkdir(t, filepath.Join(home, ".crewdeck", "repos", "local"))
	if err := os.Symlink(filepath.Join(home, ".crewdeck", "repos"), filepath.Join(home, "lien")); err != nil {
		t.Fatal(err)
	}

	for _, input := range []string{"~/.crewdeck", "~/.crewdeck/repos/local", "~/lien"} {
		assertResult(t, c.Check(input, nil, ""), contracts.FolderCheckResultStateNotAFolder, false, "")
	}
	// A folder beside it, whose name starts the same, is a folder.
	mkdir(t, filepath.Join(home, ".crewdeck-autre"))
	assertResult(t, c.Check("~/.crewdeck-autre", nil, ""), contracts.FolderCheckResultStateNotGit, false, "")
}

func TestAnotherProjetsFolderIsTaken(t *testing.T) {
	c, home := checker(t)
	folder := filepath.Join(home, "recettes")
	repository(t, folder, 2)
	if err := os.Symlink(folder, filepath.Join(home, "lien")); err != nil {
		t.Fatal(err)
	}
	projects := map[string]string{otherProject: folder}

	assertResult(t, c.Check("~/recettes", projects, thisProject), contracts.FolderCheckResultStateTaken, false, "")
	assertResult(t, c.Check("~/lien", projects, thisProject), contracts.FolderCheckResultStateTaken, false, "")
	// Its path stored through a link is the same folder too.
	assertResult(t, c.Check("~/recettes", map[string]string{otherProject: filepath.Join(home, "lien")}, ""), contracts.FolderCheckResultStateTaken, false, "")
}

func TestTheProjetsOwnFolderIsNotTaken(t *testing.T) {
	c, home := checker(t)
	folder := filepath.Join(home, "recettes")
	repository(t, folder, 2)

	assertResult(t, c.Check(folder, map[string]string{thisProject: folder}, thisProject), contracts.FolderCheckResultStateReady, true, "main")
}

func TestAGitRepositoryHasCodeFromItsSecondCommit(t *testing.T) {
	c, home := checker(t)
	for commits, hasCode := range map[int]bool{0: false, 1: false, 2: true, 3: true} {
		folder := filepath.Join(home, strings.Repeat("r", commits+1))
		repository(t, folder, commits)
		touch(t, filepath.Join(folder, "main.go")) // files of a folder without git, never counted in a repository

		assertResult(t, c.Check(folder, nil, ""), contracts.FolderCheckResultStateReady, hasCode, "main")
	}
}

func TestAGitRepositoryOnADetachedHeadHasNoBranch(t *testing.T) {
	c, home := checker(t)
	folder := filepath.Join(home, "recettes")
	repository(t, folder, 2)
	git(t, folder, "checkout", "-q", "--detach", "HEAD")

	assertResult(t, c.Check(folder, nil, ""), contracts.FolderCheckResultStateReady, true, "")
}

func TestAGitRepositoryOnAnotherBranchSaysIt(t *testing.T) {
	c, home := checker(t)
	folder := filepath.Join(home, "recettes")
	repository(t, folder, 2)
	git(t, folder, "checkout", "-q", "-b", "develop")

	assertResult(t, c.Check(folder, nil, ""), contracts.FolderCheckResultStateReady, true, "develop")
}

func TestASubfolderOfARepositoryIsNotGit(t *testing.T) {
	c, home := checker(t)
	repository(t, filepath.Join(home, "recettes"), 2)
	touch(t, filepath.Join(home, "recettes", "apps", "web", "main.ts"))

	assertResult(t, c.Check("~/recettes/apps", nil, ""), contracts.FolderCheckResultStateNotGit, true, "")
}

func TestARepositoryThroughALinkIsReadyAtItsRealPath(t *testing.T) {
	c, home := checker(t)
	repository(t, filepath.Join(home, "recettes"), 2)
	if err := os.Symlink(filepath.Join(home, "recettes"), filepath.Join(home, "lien")); err != nil {
		t.Fatal(err)
	}

	got := c.Check("~/lien/", nil, "")

	assertResult(t, got, contracts.FolderCheckResultStateReady, true, "main")
	if got.Path != filepath.Join(home, "recettes") || got.Name != "lien" {
		t.Fatalf("path %q name %q, want the real path and the typed name", got.Path, got.Name)
	}
}

func TestAFolderWithoutGitHasCodeForAFileWithinTwoLevelsOtherThanReadmeLicenseOrDotfiles(t *testing.T) {
	for name, c := range map[string]struct {
		files   []string
		hasCode bool
	}{
		"empty":                {nil, false},
		"readme and license":   {[]string{"README.md", "readme.txt", "LICENSE", "docs/README"}, false},
		"dotfiles and dotdirs": {[]string{".env", ".gitignore", ".idea/workspace.xml", ".vscode/a/b.json"}, false},
		"three levels deep":    {[]string{"a/b/c.go"}, false},
		"a file at the root":   {[]string{"main.go"}, true},
		"a file in a folder":   {[]string{"README.md", "src/main.go"}, true},
	} {
		t.Run(name, func(t *testing.T) {
			ch, home := checker(t)
			folder := filepath.Join(home, "recettes")
			mkdir(t, folder)
			for _, file := range c.files {
				touch(t, filepath.Join(folder, file))
			}

			assertResult(t, ch.Check(folder, nil, ""), contracts.FolderCheckResultStateNotGit, c.hasCode, "")
		})
	}
}

func TestUnderWSLAWindowsPathIsReadUnderMnt(t *testing.T) {
	wsl := Checker{Home: "/home/pilote", WSL: true}
	for input, want := range map[string]string{
		`C:\Users\pilote\recettes`: "/mnt/c/Users/pilote/recettes",
		`d:/projets/recettes`:      "/mnt/d/projets/recettes",
		`C:\`:                      "/mnt/c",
		"~":                        "/home/pilote",
		"~/projets/recettes/":      "/home/pilote/projets/recettes",
		"  /srv/recettes  ":        "/srv/recettes",
	} {
		if got, ok := wsl.resolve(input); !ok || got != want {
			t.Errorf("resolve(%q) = %q, %v; want %q", input, got, ok, want)
		}
	}
	if got, ok := (Checker{Home: "/home/pilote"}).resolve(`C:\Users\pilote`); ok {
		t.Errorf("resolve outside WSL = %q, want not absolute", got)
	}
}

// The result is the plaintext of folder.checked: a FolderCheckResult, its
// branch null without one, its real path never in it.
func TestTheResultIsAFolderCheckResult(t *testing.T) {
	c, home := checker(t)
	mkdir(t, filepath.Join(home, "recettes"))

	data, err := json.Marshal(c.Check("~/recettes", nil, ""))
	if err != nil {
		t.Fatal(err)
	}

	var back contracts.FolderCheckResult
	if err := json.Unmarshal(data, &back); err != nil {
		t.Fatalf("decode %s: %v", data, err)
	}
	if string(data) != `{"state":"not-git","hasCode":false,"branch":null,"name":"recettes"}` {
		t.Fatalf("result %s", data)
	}
}
