package keys

import (
	"bytes"
	"crypto/ecdh"
	"errors"
	"fmt"
)

// The kinds of key holder a rotation wraps the new vault key for.
const (
	HolderDevice = "device"
	HolderRunner = "runner"
)

// Holder is a key holder the server lists: an Appareil or the Runner.
type Holder struct {
	Type      string
	ID        string
	PublicKey []byte
}

// RotationItem is an item key to rewrap: its kind, its row, the item's
// additional data, and its key under the current vault key.
type RotationItem struct {
	Type       string
	ID         string
	AAD        []byte
	WrappedKey []byte
}

// RotatedItem is an item key rewrapped under the new vault key, with the
// wrapped key it was read with: the server replaces only that one.
type RotatedItem struct {
	Type        string
	ID          string
	PreviousKey []byte
	WrappedKey  []byte
}

// HolderWrap is the new vault key wrapped for one holder.
type HolderWrap struct {
	Holder Holder
	Wrap   Wrap
}

// Rotation is what a rotation posts: the wraps of the new version and every
// item key rewrapped under it.
type Rotation struct {
	FromVersion int
	ToVersion   int
	Wraps       []HolderWrap
	Items       []RotatedItem
}

// WrapOf is the wrap of the holder holderID.
func (r Rotation) WrapOf(holderID string) (Wrap, bool) {
	for _, w := range r.Wraps {
		if w.Holder.ID == holderID {
			return w.Wrap, true
		}
	}
	return Wrap{}, false
}

// RotationInput is what the rotator rotates from: the vault it holds, its own
// key and id, the public keys it authenticated itself, and what the server
// lists (the holders kept, every item key).
type RotationInput struct {
	Vault         *Vault
	Rotator       *ecdh.PrivateKey
	RotatorID     string
	Authenticated [][]byte
	Holders       []Holder
	Items         []RotationItem
}

// ErrRotatorNotHolder refuses a rotation whose holders leave out the rotator:
// it would rotate to a key it no longer holds.
var ErrRotatorNotHolder = errors.New("keys: the rotator is not among the holders")

// UnauthenticatedHolderError refuses a holder whose key the rotator did not
// authenticate: the rotator then leaves the rotation to another holder.
type UnauthenticatedHolderError struct {
	Type string
	ID   string
}

func (e *UnauthenticatedHolderError) Error() string {
	return fmt.Sprintf("keys: the key of the %s holder %s is not one the rotator authenticated", e.Type, e.ID)
}

// ItemNotOpenedError stops a rotation at an item key that does not open
// under the old vault key: posted without it, the item would be lost.
type ItemNotOpenedError struct {
	Type string
	ID   string
}

func (e *ItemNotOpenedError) Error() string {
	return fmt.Sprintf("keys: the key of the item %s %s does not open", e.Type, e.ID)
}

// Rotate draws the vault key of the next version, wraps it as the rotator for
// each holder, and rewraps each item key under it, its additional data
// unchanged (docs/security/e2e.md, « The rotation »). Every holder is checked
// before anything is sealed: the rotator itself as the one Runner holder, each
// Appareil by a key it authenticated, never the server's list as such.
func Rotate(in RotationInput) (Rotation, *Vault, error) {
	own := PublicKeyBytes(in.Rotator)
	authenticated := func(key []byte) bool {
		if bytes.Equal(key, own) {
			return false
		}
		for _, k := range in.Authenticated {
			if bytes.Equal(k, key) {
				return true
			}
		}
		return false
	}
	self := false
	for _, h := range in.Holders {
		switch {
		case h.Type == HolderRunner && h.ID == in.RotatorID && bytes.Equal(h.PublicKey, own):
			self = true
		case h.Type == HolderDevice && authenticated(h.PublicKey):
		default:
			return Rotation{}, nil, &UnauthenticatedHolderError{Type: h.Type, ID: h.ID}
		}
	}
	if !self {
		return Rotation{}, nil, ErrRotatorNotHolder
	}
	key, err := GenerateAESKey()
	if err != nil {
		return Rotation{}, nil, err
	}
	next := &Vault{key: key, Version: in.Vault.Version + 1}
	rotation := Rotation{FromVersion: in.Vault.Version, ToVersion: next.Version}
	for _, item := range in.Items {
		rewrapped, err := rewrap(in.Vault, next, item)
		if err != nil {
			return Rotation{}, nil, err
		}
		rotation.Items = append(rotation.Items, RotatedItem{Type: item.Type, ID: item.ID, PreviousKey: item.WrappedKey, WrappedKey: rewrapped})
	}
	for _, h := range in.Holders {
		w, err := next.WrapFor(in.Rotator, h.PublicKey, h.ID)
		if err != nil {
			return Rotation{}, nil, err
		}
		rotation.Wraps = append(rotation.Wraps, HolderWrap{Holder: h, Wrap: w})
	}
	return rotation, next, nil
}

// rewrap opens an item key under the old vault key and seals it under the
// new one, for the same additional data.
func rewrap(old, next *Vault, item RotationItem) ([]byte, error) {
	if len(item.AAD) == 0 {
		return nil, &ItemNotOpenedError{Type: item.Type, ID: item.ID}
	}
	itemKey, err := AESGCMOpen(old.key, item.WrappedKey, itemKeyAAD(item.AAD))
	if err != nil || len(itemKey) != nk {
		return nil, &ItemNotOpenedError{Type: item.Type, ID: item.ID}
	}
	defer clear(itemKey)
	return AESGCMSeal(next.key, itemKey, itemKeyAAD(item.AAD))
}

// OpenVaultWrap opens a holder's wrap of the vault key at version from the
// first of the candidates, keys the recipient already holds, whose tag
// checks; it returns that sender's key, to open the wrap again from. Any
// failure is ErrOpen.
func OpenVaultWrap(recipient *ecdh.PrivateKey, holderID string, version int, w Wrap, candidates [][]byte) (*Vault, []byte, error) {
	for _, sender := range candidates {
		v, err := Unlock(recipient, sender, holderID, version, w)
		if err == nil {
			return v, sender, nil
		}
	}
	return nil, nil, ErrOpen
}
