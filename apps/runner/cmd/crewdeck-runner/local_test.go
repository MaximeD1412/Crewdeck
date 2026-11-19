package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// localWarning is what uninstall says before removing a local.db that holds
// the work's writes on the Local Projets (SOURCE-2, risk OPS-10), as the
// ticket words it.
const localWarning = "local.db contient ce que le travail a écrit sur tes Projets Locaux (commentaires, remarques, changements de code) : il sera supprimé avec le Runner."

// holdingAComment writes local.db in the machine's ~/.crewdeck with one comment.
func holdingAComment(t *testing.T, f *machineFixture) {
	t.Helper()
	db, err := local.OpenDB(local.DefaultPath(f.state))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.SQL().Exec(`INSERT INTO comments (id, project_id, number, author, body, created_at) VALUES ('c1', 'p1', 3, 'agent', 'Revu.', '2026-11-19T09:00:00Z')`); err != nil {
		t.Fatal(err)
	}
}

func TestUninstallWarnsBeforeTheQuestionWhenLocalDBHoldsAComment(t *testing.T) {
	f, _ := uninstallable(t)
	holdingAComment(t, f)

	out, err := f.execute(t, "n\n", "uninstall")
	if err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	warning, question := strings.Index(out, localWarning), strings.Index(out, "(o/N)")
	if warning < 0 || question < warning {
		t.Fatalf("uninstall printed %q, want the warning before the question", out)
	}
	if _, err := os.Stat(local.DefaultPath(f.state)); err != nil {
		t.Fatalf("local.db: %v, want it kept on a no", err)
	}
}

func TestUninstallYesWarnsWhenLocalDBHoldsAComment(t *testing.T) {
	f, _ := uninstallable(t)
	holdingAComment(t, f)

	out, err := f.execute(t, "", "uninstall", "--yes")
	if err != nil {
		t.Fatalf("uninstall --yes: %v", err)
	}
	if !strings.Contains(out, localWarning) {
		t.Fatalf("uninstall --yes printed %q, want the warning", out)
	}
	if _, err := os.Stat(f.state); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("%s: %v, want it removed", f.state, err)
	}
}

func TestUninstallSaysNothingOfAnEmptyLocalDB(t *testing.T) {
	f, _ := uninstallable(t)
	db, err := local.OpenDB(local.DefaultPath(f.state))
	if err != nil {
		t.Fatal(err)
	}
	db.Close()

	out, err := f.execute(t, "n\n", "uninstall")
	if err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	if strings.Contains(out, "local.db") {
		t.Fatalf("uninstall printed %q, want no warning", out)
	}
}

func TestLocalSourcesOpenLocalDBAndOneProjectPerFolderOfRunnerJSON(t *testing.T) {
	dir := filepath.Join(t.TempDir(), ".crewdeck")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	store := state.Store{Dir: dir}
	folder := t.TempDir()
	if err := store.Save(state.State{Server: "https://crewdeck.example", Token: "rt_test", Projects: map[string]string{"p1": folder}}); err != nil {
		t.Fatal(err)
	}
	locals, err := openLocal(store, func() *keys.Vault { return nil })
	if err != nil {
		t.Fatal(err)
	}
	defer locals.Close()
	if _, err := os.Stat(local.DefaultPath(dir)); err != nil {
		t.Fatalf("local.db: %v", err)
	}
	if p, ok := locals.Project("p1"); !ok || p.Folder() != folder {
		t.Fatalf("Project(p1) %v, %v, want its folder", p, ok)
	}
	if _, ok := locals.Project("p2"); ok {
		t.Fatal("a Projet runner.json does not name opened")
	}
	if got := locals.Origin("p1").Dir(); got != filepath.Join(dir, "repos", "local", "p1") {
		t.Fatalf("origin of p1 at %s", got)
	}
}

func TestWatchFollowsEachLocalFolderOfRunnerJSONWithAFullReport(t *testing.T) {
	home := t.TempDir()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "tickets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "tickets", "12-x.md"), []byte("---\nnumber: 12\ntitle: Un\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	store := state.Store{Dir: home}
	const id = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a92"
	if err := store.Save(state.State{Server: "http://localhost:3000", Token: "runner-token", Projects: map[string]string{id: dir}}); err != nil {
		t.Fatal(err)
	}
	vault := miroirVault(t)
	locals, err := openLocal(store, func() *keys.Vault { return vault })
	if err != nil {
		t.Fatal(err)
	}
	defer locals.Close()
	got := make(chan contracts.RunnerLocalChanged, 10)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		locals.watch(ctx, local.WatchConfig{Send: func(_ context.Context, m contracts.RunnerLocalChanged) error { got <- m; return nil }})
	}()
	defer func() { cancel(); <-done }()
	select {
	case m := <-got:
		if m.ProjectId != id || !m.Full || len(m.Items) != 1 || m.Items[0].Ticket == nil {
			t.Fatalf("first report %+v", m)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no report of the folder")
	}
	locals.full() // a connection accepted
	select {
	case m := <-got:
		if !m.Full {
			t.Fatalf("report %+v", m)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no full report on a connection")
	}
}
