package keys

import (
	"crypto/ecdh"
	"errors"
)

// itemKeyAADLabel prefixes an item's additional data when its item key is
// sealed under the vault key: an item key never opens as an item.
const itemKeyAADLabel = "crewdeck/v1/item-key"

// Vault is the vault key of one version, opened from the Runner's wrap.
type Vault struct {
	key     []byte
	Version int
}

// SealedItem is an item: its own key sealed under the vault key, and its
// content sealed under that key. On the wire, each base64url.
type SealedItem struct {
	Key        []byte
	Ciphertext []byte
}

var errVaultKeyLength = errors.New("keys: a vault key is 32 bytes")

// Unlock opens the Runner's wrap of the vault key, sealed by the Appareil
// whose devicePublicKey the device proof authenticated, for runnerID at
// version. Any failure is ErrOpen.
func Unlock(runner *ecdh.PrivateKey, devicePublicKey []byte, runnerID string, version int, w Wrap) (*Vault, error) {
	key, err := OpenWrap(runner, devicePublicKey, w, []byte(InfoVaultWrap), VaultWrapAAD(runnerID, version))
	if err != nil {
		return nil, ErrOpen
	}
	if len(key) != nk {
		return nil, errVaultKeyLength
	}
	return &Vault{key: key, Version: version}, nil
}

func itemKeyAAD(aad []byte) []byte {
	return append([]byte(itemKeyAADLabel), aad...)
}

// SealItem seals plaintext under a new item key, the item key under the
// vault key; aad binds the item (its id and field).
func (v *Vault) SealItem(plaintext, aad []byte) (SealedItem, error) {
	if len(aad) == 0 {
		return SealedItem{}, ErrNoAdditionalData
	}
	itemKey, err := GenerateAESKey()
	if err != nil {
		return SealedItem{}, err
	}
	sealedKey, err := AESGCMSeal(v.key, itemKey, itemKeyAAD(aad))
	if err != nil {
		return SealedItem{}, err
	}
	ciphertext, err := AESGCMSeal(itemKey, plaintext, aad)
	if err != nil {
		return SealedItem{}, err
	}
	return SealedItem{Key: sealedKey, Ciphertext: ciphertext}, nil
}

// OpenItem opens what SealItem sealed, on either side. Any failure is ErrOpen.
func (v *Vault) OpenItem(item SealedItem, aad []byte) ([]byte, error) {
	if len(aad) == 0 {
		return nil, ErrNoAdditionalData
	}
	itemKey, err := AESGCMOpen(v.key, item.Key, itemKeyAAD(aad))
	if err != nil {
		return nil, ErrOpen
	}
	return AESGCMOpen(itemKey, item.Ciphertext, aad)
}
