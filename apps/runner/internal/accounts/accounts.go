// Package accounts keeps the API keys of the Comptes IA on the Pilote's
// machine (ADR 0004): in the OS keychain (service crewdeck-runner, user the
// Moteur's id) when one answers, else in ~/.crewdeck/secrets/<engine>.key,
// mode 600 in a folder of mode 700 (WSL without Secret Service). A key never
// leaves the machine, nor reaches a log. `login` (RUNNER-7) stores them,
// `uninstall` deletes them.
package accounts

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/zalando/go-keyring"
)

// Service is the keychain's service of the keys.
const Service = "crewdeck-runner"

// Engines are the Moteurs a key may be stored for.
var Engines = []contracts.EngineId{contracts.EngineIdClaudeCode, contracts.EngineIdCodex}

// ErrNoKey: no key is stored for this Moteur.
var ErrNoKey = errors.New("accounts: no API key stored")

// Store keeps the keys; Dir is the Runner's folder (~/.crewdeck).
type Store struct {
	Dir string
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
	if key, err := keyring.Get(Service, string(engine)); err == nil {
		return key, nil
	}
	data, err := os.ReadFile(s.file(engine))
	if errors.Is(err, os.ErrNotExist) {
		return "", ErrNoKey
	}
	if err != nil {
		return "", fmt.Errorf("accounts: read the key of %s: %w", engine, err)
	}
	return strings.TrimSpace(string(data)), nil
}

// Set stores the key of a Moteur, in the keychain or, when none answers, in its file.
// The mark comes first: no key reaches the keychain without it.
func (s Store) Set(engine contracts.EngineId, key string) error {
	_, err := os.Stat(s.marker(engine))
	markedBefore := err == nil
	if err := s.mark(engine); err != nil {
		return err
	}
	if err := keyring.Set(Service, string(engine), key); err == nil {
		return nil
	}
	// The keychain kept nothing of this key; one it held before keeps its mark.
	if !markedBefore {
		if err := os.Remove(s.marker(engine)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("accounts: delete the mark of %s: %w", engine, err)
		}
	}
	dir := filepath.Dir(s.file(engine))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("accounts: create %s: %w", dir, err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return fmt.Errorf("accounts: chmod %s: %w", dir, err)
	}
	if err := os.WriteFile(s.file(engine), []byte(key+"\n"), 0o600); err != nil {
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
	err := keyring.Delete(Service, string(engine))
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
