package accounts

import (
	"context"
	"errors"
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

func TestNoKeyStoredIsErrNoKeyAndTheAdapterGetsNone(t *testing.T) {
	for name, keychain := range map[string]Keyring{"keychain": memoryKeyring{}, "no keychain": absentKeyring{}} {
		store := Store{Keyring: keychain, Dir: t.TempDir()}
		if _, err := store.Get(contracts.EngineIdCodex); !errors.Is(err, ErrNoKey) {
			t.Errorf("%s: Get = %v, want ErrNoKey", name, err)
		}
		if key, err := store.Provider(contracts.EngineIdCodex)(context.Background()); key != "" || err != nil {
			t.Errorf("%s: Provider = %q, %v, want none", name, key, err)
		}
	}
}

func TestAKeyStoredInTheKeychainReplacesTheOneOfTheFile(t *testing.T) {
	dir := t.TempDir()
	if err := (Store{Keyring: absentKeyring{}, Dir: dir}).Set(contracts.EngineIdCodex, "sk-old"); err != nil {
		t.Fatal(err)
	}
	keychain := memoryKeyring{}
	if err := (Store{Keyring: keychain, Dir: dir}).Set(contracts.EngineIdCodex, "sk-new"); err != nil {
		t.Fatal(err)
	}
	if got, err := (Store{Keyring: absentKeyring{}, Dir: dir}).Get(contracts.EngineIdCodex); !errors.Is(err, ErrNoKey) {
		t.Fatalf("the old file still gives %q, %v", got, err)
	}
}

func TestAnEmptyKeyIsRefused(t *testing.T) {
	store := Store{Keyring: memoryKeyring{}, Dir: t.TempDir()}
	if err := store.Set(contracts.EngineIdCodex, "  \n"); !errors.Is(err, ErrEmptyKey) {
		t.Fatalf("Set = %v, want ErrEmptyKey", err)
	}
}
