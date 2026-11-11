package accounts

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/zalando/go-keyring"
)

func TestAKeyGoesToTheKeychainAndComesBack(t *testing.T) {
	keyring.MockInit()
	store := Store{Dir: t.TempDir()}

	if err := store.Set(contracts.EngineIdCodex, "sk-test-codex"); err != nil {
		t.Fatal(err)
	}
	if got, err := keyring.Get(Service, "codex"); err != nil || got != "sk-test-codex" {
		t.Fatalf("keychain holds %q, %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(store.Dir, "secrets")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("a file was written beside the keychain: %v", err)
	}
	if got, err := store.Get(contracts.EngineIdCodex); err != nil || got != "sk-test-codex" {
		t.Fatalf("get = %q, %v", got, err)
	}
}

func TestWithoutAKeychainTheKeyGoesToAFileOnlyThePiloteReads(t *testing.T) {
	keyring.MockInitWithError(errors.New("no Secret Service"))
	store := Store{Dir: t.TempDir()}

	if err := store.Set(contracts.EngineIdClaudeCode, "sk-ant-test"); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(store.Dir, "secrets", "claude-code.key")
	info, err := os.Stat(file)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("file %v, %v", info, err)
	}
	if dir, _ := os.Stat(filepath.Dir(file)); dir.Mode().Perm() != 0o700 {
		t.Fatalf("folder mode %v", dir.Mode())
	}
	if got, err := store.Get(contracts.EngineIdClaudeCode); err != nil || got != "sk-ant-test" {
		t.Fatalf("get = %q, %v", got, err)
	}
}

func TestDeleteRemovesTheKeyWhereverItIs(t *testing.T) {
	keyring.MockInit()
	store := Store{Dir: t.TempDir()}
	if err := store.Set(contracts.EngineIdCodex, "sk-in-keychain"); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(store.Dir, "secrets"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(store.Dir, "secrets", "codex.key"), []byte("sk-in-file"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := store.Delete(contracts.EngineIdCodex); err != nil {
		t.Fatal(err)
	}
	if _, err := keyring.Get(Service, "codex"); !errors.Is(err, keyring.ErrNotFound) {
		t.Fatalf("the keychain still holds it: %v", err)
	}
	if _, err := store.Get(contracts.EngineIdCodex); !errors.Is(err, ErrNoKey) {
		t.Fatalf("get after delete = %v", err)
	}
	// Nothing stored is not an error.
	if err := store.Delete(contracts.EngineIdClaudeCode); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteSaysWhenTheKeychainHoldingAKeyRefusesIt(t *testing.T) {
	keyring.MockInit()
	store := Store{Dir: t.TempDir()}
	if err := store.Set(contracts.EngineIdCodex, "sk-in-keychain"); err != nil {
		t.Fatal(err)
	}
	keyring.MockInitWithError(errors.New("the keychain is locked"))

	if err := store.Delete(contracts.EngineIdCodex); err == nil || !strings.Contains(err.Error(), "locked") {
		t.Fatalf("delete = %v, want the keychain's refusal", err)
	}
}

func TestDeleteWithoutAKeychainOfAKeyThatWentToTheFileIsNotAnError(t *testing.T) {
	keyring.MockInitWithError(errors.New("no Secret Service"))
	store := Store{Dir: t.TempDir()}
	if err := store.Set(contracts.EngineIdClaudeCode, "sk-ant-test"); err != nil {
		t.Fatal(err)
	}

	if err := store.Delete(contracts.EngineIdClaudeCode); err != nil {
		t.Fatalf("delete = %v", err)
	}
	if _, err := os.Stat(filepath.Join(store.Dir, "secrets", "claude-code.key")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("the file is still there: %v", err)
	}
	// Nothing ever stored, with no keychain either.
	if err := store.Delete(contracts.EngineIdCodex); err != nil {
		t.Fatalf("delete of nothing = %v", err)
	}
}

func TestAKeyNeverReachesTheKeychainWithoutItsMark(t *testing.T) {
	keyring.MockInit()
	store := Store{Dir: t.TempDir()}
	// keychain is a file: no mark can be written in it.
	if err := os.WriteFile(filepath.Join(store.Dir, "keychain"), []byte("not a folder"), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := store.Set(contracts.EngineIdCodex, "sk-unmarked"); err == nil {
		t.Fatal("set without its mark succeeded")
	}
	if _, err := keyring.Get(Service, "codex"); !errors.Is(err, keyring.ErrNotFound) {
		t.Fatalf("the keychain holds a key without its mark: %v", err)
	}
}

func TestAKeychainThatRefusesAKeyLeavesTheMarkOfAKeyItHeldBefore(t *testing.T) {
	keyring.MockInit()
	store := Store{Dir: t.TempDir()}
	if err := store.Set(contracts.EngineIdCodex, "sk-first"); err != nil {
		t.Fatal(err)
	}
	keyring.MockInitWithError(errors.New("the keychain is locked"))

	if err := store.Set(contracts.EngineIdCodex, "sk-second"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(store.marker(contracts.EngineIdCodex)); err != nil {
		t.Fatalf("the mark of the key still in the keychain is gone: %v", err)
	}
}

func TestAKeyThatGoesToTheFileLeavesNoMark(t *testing.T) {
	keyring.MockInitWithError(errors.New("no Secret Service"))
	store := Store{Dir: t.TempDir()}

	if err := store.Set(contracts.EngineIdCodex, "sk-file"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(store.marker(contracts.EngineIdCodex)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("a mark without a key in the keychain: %v", err)
	}
}
