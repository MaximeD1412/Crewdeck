package local_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

func TestLocalOriginClonesTheFolderOnceWithItAsOrigin(t *testing.T) {
	dir := folder(t, map[string]string{"README.md": "Bonjour\n"})
	home := t.TempDir()
	o := &local.Origin{Home: home, ProjectID: projectID, Folder: func(id string) (string, bool) { return dir, id == projectID }}
	clone, auth, err := o.Clone(context.Background())
	if err != nil || auth != nil || clone != filepath.Join(home, "repos", "local", projectID) || clone != o.Dir() {
		t.Fatalf("Clone: %q %v %v", clone, auth, err)
	}
	if got := git(t, clone, "remote", "get-url", "origin"); got != dir {
		t.Errorf("origin %q, want the folder %q", got, dir)
	}
	if id, ok := local.ProjectOfRemote(map[string]string{"other": t.TempDir(), projectID: dir}, git(t, clone, "remote", "get-url", "origin")); !ok || id != projectID {
		t.Errorf("ProjectOfRemote: %q %v", id, ok)
	}
	if _, ok := local.ProjectOfRemote(map[string]string{projectID: dir}, "https://github.com/acme/shop.git"); ok {
		t.Error("ProjectOfRemote found a Projet for a GitHub remote")
	}

	write(t, dir, "NEW.md", "x\n")
	git(t, dir, "add", "NEW.md")
	git(t, dir, "commit", "--quiet", "-m", "Nouveau")
	if _, _, err := o.Clone(context.Background()); err != nil {
		t.Fatal(err)
	}
	if git(t, clone, "rev-parse", "origin/main") != git(t, dir, "rev-parse", "main") {
		t.Error("the clone was not fetched")
	}
}

func TestLocalOriginWithoutItsFolderFails(t *testing.T) {
	for name, find := range map[string]func(string) (string, bool){
		"absent from the state": func(string) (string, bool) { return "", false },
		"gone":                  func(string) (string, bool) { return filepath.Join(t.TempDir(), "gone"), true },
		"not a git repository":  func(string) (string, bool) { return t.TempDir(), true },
	} {
		o := &local.Origin{Home: t.TempDir(), ProjectID: projectID, Folder: find}
		if _, _, err := o.Clone(context.Background()); !errors.Is(err, local.ErrNoFolder) {
			t.Errorf("%s: %v", name, err)
		}
	}
}
