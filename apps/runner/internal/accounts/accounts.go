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
func (s Store) Set(engine contracts.EngineId, key string) error {
	if err := keyring.Set(Service, string(engine), key); err == nil {
		return nil
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

// Delete removes the key of a Moteur from the keychain and from its file;
// nothing stored is not an error, nor a keychain that does not answer (Set
// then used the file).
func (s Store) Delete(engine contracts.EngineId) error {
	_ = keyring.Delete(Service, string(engine))
	if err := os.Remove(s.file(engine)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("accounts: delete the key of %s: %w", engine, err)
	}
	return nil
}
