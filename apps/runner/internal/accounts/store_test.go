package accounts

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// memoryKeyring is a keychain that answers, held in memory.
type memoryKeyring map[string]string

func (k memoryKeyring) Get(service, user string) (string, error) {
	if v, ok := k[service+"/"+user]; ok {
		return v, nil
	}
	return "", ErrKeyringNotFound
}

func (k memoryKeyring) Set(service, user, secret string) error {
	k[service+"/"+user] = secret
	return nil
}

func (k memoryKeyring) Delete(service, user string) error {
	if _, ok := k[service+"/"+user]; !ok {
		return ErrKeyringNotFound
	}
	delete(k, service+"/"+user)
	return nil
}

// absentKeyring is a machine without a keychain (WSL without Secret Service).
type absentKeyring struct{}

var errNoKeychain = errors.New("org.freedesktop.secrets was not provided by any .service files")

func (absentKeyring) Get(string, string) (string, error) { return "", errNoKeychain }
func (absentKeyring) Set(string, string, string) error   { return errNoKeychain }
func (absentKeyring) Delete(string, string) error        { return errNoKeychain }

func TestAKeyIsKeptInTheKeychainUnderTheRunnersService(t *testing.T) {
	keychain := memoryKeyring{}
	store := Store{Keyring: keychain, Dir: t.TempDir()}

	if err := store.Set(contracts.EngineIdCodex, "sk-test-codex"); err != nil {
		t.Fatal(err)
	}
	if keychain["crewdeck-runner/codex"] != "sk-test-codex" {
		t.Fatalf("keychain %v, want the key under crewdeck-runner/codex", keychain)
	}
	if _, err := os.Stat(filepath.Join(store.Dir, "codex.key")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("a file was written beside the keychain: %v", err)
	}
	got, err := store.Get(contracts.EngineIdCodex)
	if err != nil || got != "sk-test-codex" {
		t.Fatalf("Get = %q, %v", got, err)
	}
}

func TestWithoutAKeychainTheKeyIsAFileOnlyThePiloteReads(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "secrets")
	store := Store{Keyring: absentKeyring{}, Dir: dir}

	if err := store.Set(contracts.EngineIdClaudeCode, "sk-ant-test\n"); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "claude-code.key")
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("file mode %v, want 600", info.Mode().Perm())
	}
	folder, _ := os.Stat(dir)
	if folder.Mode().Perm() != 0o700 {
		t.Fatalf("folder mode %v, want 700", folder.Mode().Perm())
	}
	got, err := store.Get(contracts.EngineIdClaudeCode)
	if err != nil || got != "sk-ant-test" {
		t.Fatalf("Get = %q, %v", got, err)
	}
}

func TestNoKeyStoredIsErrNotFound(t *testing.T) {
	for name, keychain := range map[string]Keyring{"keychain": memoryKeyring{}, "no keychain": absentKeyring{}} {
		store := Store{Keyring: keychain, Dir: t.TempDir()}
		if _, err := store.Get(contracts.EngineIdCodex); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: Get = %v, want ErrNotFound", name, err)
		}
		if err := store.Delete(contracts.EngineIdCodex); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: Delete = %v, want ErrNotFound", name, err)
		}
	}
}

func TestDeleteRemovesTheKeyWhereverItIs(t *testing.T) {
	keychain := memoryKeyring{}
	dir := t.TempDir()
	if err := (Store{Keyring: absentKeyring{}, Dir: dir}).Set(contracts.EngineIdCodex, "sk-old"); err != nil {
		t.Fatal(err)
	}
	keychain["crewdeck-runner/codex"] = "sk-new"
	store := Store{Keyring: keychain, Dir: dir}

	if err := store.Delete(contracts.EngineIdCodex); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(contracts.EngineIdCodex); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get after Delete = %v, want ErrNotFound", err)
	}
}

func TestAnEmptyKeyIsRefused(t *testing.T) {
	store := Store{Keyring: memoryKeyring{}, Dir: t.TempDir()}
	if err := store.Set(contracts.EngineIdCodex, "  \n"); !errors.Is(err, ErrEmptyKey) {
		t.Fatalf("Set = %v, want ErrEmptyKey", err)
	}
}
