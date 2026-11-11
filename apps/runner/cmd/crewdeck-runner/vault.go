package main

import (
	"crypto/ecdh"
	"errors"

	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

var (
	errNoVault     = errors.New("Ce Runner n’a pas de clé du coffre : relie-le à nouveau avec la commande que donne Crewdeck, crewdeck-runner link <code>.")
	errVaultClosed = errors.New("Le coffre de ce Runner ne s’ouvre pas avec sa clé : relie-le à nouveau avec la commande que donne Crewdeck, crewdeck-runner link <code>.")
)

// openVault opens the vault the link saved: vault.wrap, opened with
// runner.key from the Appareil whose public key the link's device proof
// authenticated (docs/security/e2e.md, « First Appareil »).
func openVault(store state.Store) (*keys.Vault, error) {
	raw, err := store.LoadRunnerKey()
	if errors.Is(err, state.ErrNotLinked) {
		return nil, errNoVault
	}
	if err != nil {
		return nil, err
	}
	w, err := store.LoadVaultWrap()
	if errors.Is(err, state.ErrNotLinked) {
		return nil, errNoVault
	}
	if err != nil {
		return nil, err
	}
	runner, err := ecdh.X25519().NewPrivateKey(raw)
	if err != nil {
		return nil, errVaultClosed
	}
	vault, err := keys.Unlock(runner, w.DevicePublicKey, w.RunnerID, w.VaultKeyVersion, keys.Wrap{Enc: w.Enc, Ciphertext: w.Ciphertext, Tag: w.Tag})
	if err != nil {
		return nil, errVaultClosed
	}
	return vault, nil
}
