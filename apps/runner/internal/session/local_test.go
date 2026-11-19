package session_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/fake"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

// pushing is the fake Moteur whose runs commit a file in their worktree and
// push the branch to origin, as an agent ends its work.
type pushing struct {
	*fake.Engine
	t      *testing.T
	branch string
}

func (e *pushing) Start(ctx context.Context, opts engine.StartOptions) (engine.Run, error) {
	if err := os.WriteFile(filepath.Join(opts.Dir, "panier.go"), []byte("package panier\n"), 0o644); err != nil {
		return nil, err
	}
	git(e.t, opts.Dir, "add", "panier.go")
	git(e.t, opts.Dir, "commit", "-m", "panier")
	git(e.t, opts.Dir, "push", "origin", e.branch)
	return e.Engine.Start(ctx, opts)
}

// localStart is the session.start of a Local Projet: no repository, no title.
func localStart(id, branch string) contracts.RunnerSessionStart {
	message := start(id, branch)
	message.Origin = contracts.Origin{Local: &contracts.OriginLocal{}}
	message.Base = "main"
	message.Title = nil
	return message
}

func TestALocalSessionClonesTheFolderAndPushesItsBranchToItLeavingItsCheckoutUntouched(t *testing.T) {
	folder := filepath.Join(t.TempDir(), "panier")
	if err := os.MkdirAll(folder, 0o755); err != nil {
		t.Fatal(err)
	}
	git(t, folder, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(folder, "README"), []byte("main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, folder, "add", "README")
	git(t, folder, "commit", "-m", "README")
	git(t, folder, "checkout", "-b", "wip")
	// The Pilote's work in progress, never committed.
	if err := os.WriteFile(filepath.Join(folder, "README"), []byte("main, edited\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, "notes.txt"), []byte("à faire\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	statusBefore := git(t, folder, "status", "--porcelain")

	s := newSetup(t, message("fait"), result("eng-1"))
	s.adapter = &pushing{Engine: s.engine, t: t, branch: "feat/3-x"}
	var engines engine.Registry
	engines.Register(s.adapter)
	folders := map[string]string{projectID: folder}
	m, err := session.New(session.Config{
		Home: s.home, Engines: &engines, Send: s.reports.send,
		LocalOrigin: func(id string) session.Origin {
			return &local.Origin{Home: s.home, ProjectID: id, Folder: func(id string) (string, bool) {
				path, ok := folders[id]
				return path, ok
			}}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)

	m.Start(localStart(firstID, "feat/3-x"))
	ended := s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)
	if ended.Outcome == nil || *ended.Outcome != contracts.RunnerSessionStateOutcomeOk {
		t.Fatalf("ended %+v, want ok", ended)
	}
	if runs := s.engine.Runs(); len(runs) != 1 || runs[0].Options().Dir != s.worktree("feat/3-x") {
		t.Fatalf("runs %+v, want one in the Ticket's worktree", runs)
	}
	clone := filepath.Join(s.home, "repos", "local", projectID)
	if got := git(t, clone, "remote", "get-url", "origin"); got != folder {
		t.Fatalf("the clone's origin is %q, want the folder", got)
	}
	if got := git(t, folder, "log", "-1", "--format=%s", "feat/3-x"); got != "panier" {
		t.Fatalf("the folder's feat/3-x is at %q, want the agent's commit", got)
	}
	if got := git(t, folder, "branch", "--show-current"); got != "wip" {
		t.Fatalf("the folder's checked-out branch is %q, want wip", got)
	}
	if got := git(t, folder, "status", "--porcelain"); got != statusBefore {
		t.Fatalf("the folder's status is %q, want %q", got, statusBefore)
	}
	if exists(filepath.Join(folder, "panier.go")) {
		t.Fatal("the agent's file reached the folder's checkout")
	}

	// A Local Projet whose folder is gone ends clone-failed.
	delete(folders, projectID)
	m.Start(localStart(secondID, "feat/4-y"))
	failed := s.reports.await(t, secondID, contracts.RunnerSessionStateStateEnded)
	if failed.Error == nil || *failed.Error != contracts.RunnerSessionStateErrorCloneFailed {
		t.Fatalf("ended %+v, want clone-failed", failed)
	}
}

func TestALocalSessionWithoutALocalOriginEndsCloneFailed(t *testing.T) {
	s := newSetup(t, result("eng-1"))
	m := s.manager(t)
	m.Start(localStart(firstID, "feat/3-x"))
	ended := s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)
	if ended.Error == nil || *ended.Error != contracts.RunnerSessionStateErrorCloneFailed {
		t.Fatalf("ended %+v, want clone-failed", ended)
	}
}
