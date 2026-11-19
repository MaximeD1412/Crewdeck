package main

import (
	"context"
	"crypto/ecdh"
	"errors"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
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

// holdersTimeout bounds the read of the holders at a wrap.
const holdersTimeout = 10 * time.Second

// listHolders reads the Appareils an approval vouched for, from the server.
type listHolders func(ctx context.Context) ([]contracts.RunnerDeviceHoldersHoldersElem, error)

// relayKeys are what the relay of the Sessions seals with (SESSION-1): the
// Runner's key, and as holders, read again at each wrap, the Appareil of
// vault.wrap, the one the link authenticated, then each Appareil an approval
// vouched for (E2E-3, authenticatedHolders). A server that does not answer
// leaves the first Appareil, said through warn.
func relayKeys(store state.Store, list listHolders, warn func(error)) (*session.RelayKeys, error) {
	raw, err := store.LoadRunnerKey()
	if err != nil {
		return nil, err
	}
	runner, err := ecdh.X25519().NewPrivateKey(raw)
	if err != nil {
		return nil, errVaultClosed
	}
	return &session.RelayKeys{Runner: runner, Holders: func() ([][]byte, error) {
		w, err := store.LoadVaultWrap()
		if err != nil {
			return nil, err
		}
		if list == nil {
			return [][]byte{w.DevicePublicKey}, nil
		}
		ctx, cancel := context.WithTimeout(context.Background(), holdersTimeout)
		defer cancel()
		listed, err := list(ctx)
		if err != nil {
			if warn != nil {
				warn(err)
			}
			return [][]byte{w.DevicePublicKey}, nil
		}
		return authenticatedHolders(runner, w.DevicePublicKey, listed), nil
	}}, nil
}
