// Package accounts keeps the API keys of the Comptes IA on the Pilote's
// machine (US-38, ADR 0004): in the OS keychain (service crewdeck-runner, user
// the Moteur's id) when one answers, else in ~/.crewdeck/secrets/<engine>.key,
// mode 600 in a folder of mode 700 (WSL without Secret Service). A key never
// leaves the machine, nor reaches a log: the adapters give it to their Moteur
// in its environment only. `login` stores them, `logout` and `uninstall`
// delete them.
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

// Service is the keychain's service of the keys.
const Service = "crewdeck-runner"

// Engines are the Moteurs a key may be stored for.
var Engines = []contracts.EngineId{contracts.EngineIdClaudeCode, contracts.EngineIdCodex}

var (
	// ErrNoKey: no key is stored for this Moteur.
	ErrNoKey = errors.New("accounts: no API key stored")
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

// OSKeyring is the machine's keychain.
type OSKeyring struct{}

func (OSKeyring) Get(service, user string) (string, error) { return keyring.Get(service, user) }
func (OSKeyring) Set(service, user, secret string) error   { return keyring.Set(service, user, secret) }
func (OSKeyring) Delete(service, user string) error        { return keyring.Delete(service, user) }

// Store keeps the keys; Dir is the Runner's folder (~/.crewdeck).
type Store struct {
	// Keyring is the keychain; nil, the OS's.
	Keyring Keyring
	Dir     string
}

// Default is the store of the OS keychain, in the Runner's folder
// (`$CREWDECK_HOME`, else `~/.crewdeck`).
func Default() (Store, error) {
	home, err := state.Default()
	if err != nil {
		return Store{}, err
	}
	return Store{Dir: home.Dir}, nil
}

func (s Store) keyring() Keyring {
	if s.Keyring == nil {
		return OSKeyring{}
	}
	return s.Keyring
}

func (s Store) file(engine contracts.EngineId) string {
	return filepath.Join(s.Dir, "secrets", string(engine)+".key")
}

// marker, empty, says the key of the Moteur went to the keychain: a
// keychain that does not answer then may still hold it.
func (s Store) marker(engine contracts.EngineId) string {
	return filepath.Join(s.Dir, "keychain", string(engine))
}

// Get gives the key of a Moteur; ErrNoKey when none is stored.
func (s Store) Get(engine contracts.EngineId) (string, error) {
	if key, err := s.keyring().Get(Service, string(engine)); err == nil && key != "" {
		return key, nil
	}
	data, err := os.ReadFile(s.file(engine))
	if errors.Is(err, os.ErrNotExist) {
		return "", ErrNoKey
	}
	if err != nil {
		return "", fmt.Errorf("accounts: read the key of %s: %w", engine, err)
	}
	if key := strings.TrimSpace(string(data)); key != "" {
		return key, nil
	}
	return "", ErrNoKey
}

// Set stores the key of a Moteur, in the keychain or, when none answers, in its file.
// The mark comes first: no key reaches the keychain without it. An empty key is ErrEmptyKey.
func (s Store) Set(engine contracts.EngineId, key string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return ErrEmptyKey
	}
	_, err := os.Stat(s.marker(engine))
	markedBefore := err == nil
	if err := s.mark(engine); err != nil {
		return err
	}
	if err := s.keyring().Set(Service, string(engine), key); err == nil {
		// An older key in the file would come back once the keychain stops answering.
		if err := os.Remove(s.file(engine)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("accounts: delete the old key file of %s: %w", engine, err)
		}
		return nil
	}
	// The keychain kept nothing of this key; one it held before keeps its mark.
	if !markedBefore {
		if err := os.Remove(s.marker(engine)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("accounts: delete the mark of %s: %w", engine, err)
		}
	}
	return s.writeFile(engine, key)
}

// writeFile writes the key (mode 600) in secrets/ (mode 700), at once: a
// crash never leaves half a key.
func (s Store) writeFile(engine contracts.EngineId, key string) error {
	dir := filepath.Dir(s.file(engine))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("accounts: create %s: %w", dir, err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return fmt.Errorf("accounts: chmod %s: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, string(engine)+".key.*")
	if err != nil {
		return fmt.Errorf("accounts: write the key of %s: %w", engine, err)
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
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

// mark records that the key of the Moteur is in the keychain.
func (s Store) mark(engine contracts.EngineId) error {
	dir := filepath.Dir(s.marker(engine))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("accounts: create %s: %w", dir, err)
	}
	if err := os.WriteFile(s.marker(engine), nil, 0o600); err != nil {
		return fmt.Errorf("accounts: mark the key of %s: %w", engine, err)
	}
	return nil
}

// Delete removes the key of a Moteur from the keychain and from its file.
// Nothing stored is not an error, nor a keychain that does not answer when
// the key never went to it (Set then used the file); a keychain that holds
// it and refuses is.
func (s Store) Delete(engine contracts.EngineId) error {
	err := s.keyring().Delete(Service, string(engine))
	if err != nil && !errors.Is(err, keyring.ErrNotFound) {
		if _, marked := os.Stat(s.marker(engine)); marked == nil {
			return fmt.Errorf("accounts: delete the key of %s from the keychain: %w", engine, err)
		}
	}
	if err := os.Remove(s.file(engine)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("accounts: delete the key of %s: %w", engine, err)
	}
	if err := os.Remove(s.marker(engine)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("accounts: delete the mark of %s: %w", engine, err)
	}
	return nil
}

// Provider gives the Moteur's key to its adapter: "" when none is stored.
func (s Store) Provider(engine contracts.EngineId) func(context.Context) (string, error) {
	return func(context.Context) (string, error) {
		key, err := s.Get(engine)
		if errors.Is(err, ErrNoKey) {
			return "", nil
		}
		return key, err
	}
}
