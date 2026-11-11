package state

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// The files of the Runner's keys in the state's folder, mode 600 both.
const (
	RunnerKeyFile = "runner.key"
	VaultWrapFile = "vault.wrap"
)

const runnerKeyLength = 32

// SaveRunnerKey writes the Runner's X25519 private key, base64url, to
// runner.key.
func (s Store) SaveRunnerKey(privateKey []byte) error {
	if len(privateKey) != runnerKeyLength {
		return fmt.Errorf("state: a runner key is %d bytes", runnerKeyLength)
	}
	return s.write(RunnerKeyFile, []byte(base64.RawURLEncoding.EncodeToString(privateKey)+"\n"))
}

// LoadRunnerKey reads runner.key; ErrNotLinked when it does not exist.
func (s Store) LoadRunnerKey() ([]byte, error) {
	data, err := s.read(RunnerKeyFile)
	if err != nil {
		return nil, err
	}
	key, err := base64.RawURLEncoding.Strict().DecodeString(strings.TrimSpace(string(data)))
	if err != nil || len(key) != runnerKeyLength {
		return nil, fmt.Errorf("state: %s is not a runner key", RunnerKeyFile)
	}
	return key, nil
}

// VaultWrap is the content of vault.wrap: the Runner's wrap of the vault key
// at VaultKeyVersion, and the Appareil's public key that sealed it, which the
// link's device proof authenticated. Byte strings are base64 in the file.
type VaultWrap struct {
	RunnerID        string `json:"runnerId"`
	VaultKeyVersion int    `json:"vaultKeyVersion"`
	DevicePublicKey []byte `json:"devicePublicKey"`
	Enc             []byte `json:"enc"`
	Ciphertext      []byte `json:"ciphertext"`
	Tag             []byte `json:"tag"`
}

// SaveVaultWrap writes vault.wrap.
func (s Store) SaveVaultWrap(w VaultWrap) error {
	data, err := json.MarshalIndent(w, "", "  ")
	if err != nil {
		return fmt.Errorf("state: encode %s: %w", VaultWrapFile, err)
	}
	return s.write(VaultWrapFile, append(data, '\n'))
}

// LoadVaultWrap reads vault.wrap; ErrNotLinked when it does not exist.
func (s Store) LoadVaultWrap() (VaultWrap, error) {
	data, err := s.read(VaultWrapFile)
	if err != nil {
		return VaultWrap{}, err
	}
	var w VaultWrap
	if err := json.Unmarshal(data, &w); err != nil {
		return VaultWrap{}, fmt.Errorf("state: decode %s: %w", VaultWrapFile, err)
	}
	return w, nil
}

func (s Store) read(name string) ([]byte, error) {
	data, err := os.ReadFile(filepath.Join(s.Dir, name))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotLinked
	}
	if err != nil {
		return nil, fmt.Errorf("state: read %s: %w", name, err)
	}
	return data, nil
}
