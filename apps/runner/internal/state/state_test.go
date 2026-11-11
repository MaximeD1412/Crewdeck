package state

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSaveWritesRunnerJsonReadableByThePiloteOnly(t *testing.T) {
	store := Store{Dir: filepath.Join(t.TempDir(), ".crewdeck")}
	want := State{Server: "https://crewdeck.example", RunnerID: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6aff", Token: "token-1"}

	if err := store.Save(want); err != nil {
		t.Fatalf("save: %v", err)
	}

	assertMode(t, store.Dir, 0o700)
	assertMode(t, store.Path(), 0o600)
	got, err := store.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got != want {
		t.Fatalf("loaded %+v, want %+v", got, want)
	}
}

func TestSaveTightensAFolderThatAlreadyExists(t *testing.T) {
	dir := filepath.Join(t.TempDir(), ".crewdeck")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	if err := (Store{Dir: dir}).Save(State{Server: "https://crewdeck.example", Token: "t"}); err != nil {
		t.Fatalf("save: %v", err)
	}

	assertMode(t, dir, 0o700)
}

func TestSaveReplacesTheStateBefore(t *testing.T) {
	store := Store{Dir: t.TempDir()}
	if err := store.Save(State{Server: "https://a.example", Token: "old"}); err != nil {
		t.Fatal(err)
	}

	if err := store.Save(State{Server: "https://b.example", Token: "new"}); err != nil {
		t.Fatal(err)
	}

	got, err := store.Load()
	if err != nil || got.Token != "new" || got.Server != "https://b.example" {
		t.Fatalf("loaded %+v, %v; want the new state", got, err)
	}
	entries, _ := os.ReadDir(store.Dir)
	if len(entries) != 1 {
		t.Fatalf("the folder holds %d files, want runner.json alone", len(entries))
	}
}

func TestLoadSaysWhenTheRunnerIsNotLinked(t *testing.T) {
	_, err := Store{Dir: t.TempDir()}.Load()

	if !errors.Is(err, ErrNotLinked) {
		t.Fatalf("load: %v, want ErrNotLinked", err)
	}
}

func TestLoadRefusesAStateWithoutItsToken(t *testing.T) {
	store := Store{Dir: t.TempDir()}
	if err := os.WriteFile(store.Path(), []byte(`{"server":"https://crewdeck.example"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := store.Load(); err == nil || errors.Is(err, ErrNotLinked) {
		t.Fatalf("load: %v, want an invalid state", err)
	}
}

func TestDefaultIsCrewdeckHomeWhenSet(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(HomeEnv, dir)

	store, err := Default()

	if err != nil || store.Dir != dir {
		t.Fatalf("default: %+v, %v; want %s", store, err, dir)
	}
}

func TestDefaultIsDotCrewdeckInTheHomeFolder(t *testing.T) {
	home := t.TempDir()
	t.Setenv(HomeEnv, "")
	t.Setenv("HOME", home)

	store, err := Default()

	if err != nil || store.Dir != filepath.Join(home, ".crewdeck") {
		t.Fatalf("default: %+v, %v; want %s", store, err, filepath.Join(home, ".crewdeck"))
	}
}

func assertMode(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	if got := info.Mode().Perm(); got != want {
		t.Fatalf("%s has mode %o, want %o", path, got, want)
	}
}
