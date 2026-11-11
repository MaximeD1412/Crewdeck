// Package accounts keeps the Comptes IA's API keys on the Pilote's machine
// (US-38, ADR 0003): in the OS keychain, service `crewdeck-runner`, user the
// Moteur's id; in `~/.crewdeck/secrets/<engine>.key` (mode 600, folder 700)
// when no keychain answers (WSL without Secret Service). A key never leaves
// the machine: the adapters give it to their Moteur in its environment only.
package accounts

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
	"github.com/zalando/go-keyring"
)

// Service is the keychain's service of the Runner's keys.
const Service = "crewdeck-runner"

const (
	dirMode  os.FileMode = 0o700
	fileMode os.FileMode = 0o600
)

var (
	// ErrNotFound: no key is stored for the Moteur.
	ErrNotFound = errors.New("accounts: no API key stored")
	// ErrEmptyKey: the key given is empty.
	ErrEmptyKey = errors.New("accounts: empty API key")
	// ErrKeyringNotFound is the keychain's « no such secret ».
	ErrKeyringNotFound = keyring.ErrNotFound
)

// Keyring is the OS keychain, as go-keyring reaches it.
type Keyring interface {
	Get(service, user string) (string, error)
	Set(service, user, secret string) error
	Delete(service, user string) error
}

// osKeyring is the machine's keychain.
type osKeyring struct{}

func (osKeyring) Get(service, user string) (string, error) { return keyring.Get(service, user) }
func (osKeyring) Set(service, user, secret string) error   { return keyring.Set(service, user, secret) }
func (osKeyring) Delete(service, user string) error        { return keyring.Delete(service, user) }

// Store reads and writes the keys, in Keyring, else in files of Dir.
type Store struct {
	// Keyring is the keychain; nil, the OS's.
	Keyring Keyring
	// Dir is the folder of the files used without a keychain.
	Dir string
}

// Default is the store of the OS keychain, its files in the Runner's state
// folder (`$CREWDECK_HOME`, else `~/.crewdeck`), under `secrets/`.
func Default() (Store, error) {
	home, err := state.Default()
	if err != nil {
		return Store{}, err
	}
	return Store{Dir: filepath.Join(home.Dir, "secrets")}, nil
}

func (s Store) keyring() Keyring {
	if s.Keyring == nil {
		return osKeyring{}
	}
	return s.Keyring
}

func (s Store) file(engine contracts.EngineId) string {
	return filepath.Join(s.Dir, string(engine)+".key")
}

// Get gives the Moteur's key; ErrNotFound when none is stored.
func (s Store) Get(engine contracts.EngineId) (string, error) {
	key, err := s.keyring().Get(Service, string(engine))
	if err == nil && key != "" {
		return key, nil
	}
	data, ferr := os.ReadFile(s.file(engine))
	if errors.Is(ferr, os.ErrNotExist) {
		return "", ErrNotFound
	}
	if ferr != nil {
		return "", fmt.Errorf("accounts: read the key of %s: %w", engine, ferr)
	}
	if key := strings.TrimSpace(string(data)); key != "" {
		return key, nil
	}
	return "", ErrNotFound
}

// Set stores the Moteur's key, in the keychain when one answers, else in its
// file; the other place is cleared, so that Get finds this key.
func (s Store) Set(engine contracts.EngineId, key string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return ErrEmptyKey
	}
	if err := s.keyring().Set(Service, string(engine), key); err == nil {
		if err := os.Remove(s.file(engine)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("accounts: remove the old key file of %s: %w", engine, err)
		}
		return nil
	}
	return s.writeFile(engine, key)
}

// writeFile writes the key (mode 600) in Dir (mode 700), at once: a crash
// never leaves half a key.
func (s Store) writeFile(engine contracts.EngineId, key string) error {
	if err := os.MkdirAll(s.Dir, dirMode); err != nil {
		return fmt.Errorf("accounts: create %s: %w", s.Dir, err)
	}
	if err := os.Chmod(s.Dir, dirMode); err != nil {
		return fmt.Errorf("accounts: chmod %s: %w", s.Dir, err)
	}
	tmp, err := os.CreateTemp(s.Dir, string(engine)+".key.*")
	if err != nil {
		return fmt.Errorf("accounts: write the key of %s: %w", engine, err)
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(fileMode); err != nil {
		tmp.Close()
		return fmt.Errorf("accounts: chmod the key of %s: %w", engine, err)
	}
	if _, err := tmp.WriteString(key + "\n"); err != nil {
		tmp.Close()
		return fmt.Errorf("accounts: write the key of %s: %w", engine, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("accounts: write the key of %s: %w", engine, err)
	}
	if err := os.Rename(tmp.Name(), s.file(engine)); err != nil {
		return fmt.Errorf("accounts: write the key of %s: %w", engine, err)
	}
	return nil
}

// Delete removes the Moteur's key from the keychain and from its file;
// ErrNotFound when neither held one.
func (s Store) Delete(engine contracts.EngineId) error {
	found := s.keyring().Delete(Service, string(engine)) == nil
	err := os.Remove(s.file(engine))
	switch {
	case err == nil:
		found = true
	case !errors.Is(err, os.ErrNotExist):
		return fmt.Errorf("accounts: remove the key of %s: %w", engine, err)
	}
	if !found {
		return ErrNotFound
	}
	return nil
}

// Provider gives the Moteur's key to its adapter: "" when none is stored.
func (s Store) Provider(engine contracts.EngineId) func(context.Context) (string, error) {
	return func(context.Context) (string, error) {
		key, err := s.Get(engine)
		if errors.Is(err, ErrNotFound) {
			return "", nil
		}
		return key, err
	}
}
