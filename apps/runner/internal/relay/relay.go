// Package relay is what the relays of the Runner share (SESSION-1's of a
// Session, RUNNER-18's of a Commande's output, docs/security/e2e.md): a
// 32-byte AES-256-GCM key per Session or run, kept in a file of mode 600,
// wrapped for each Appareil the Runner authenticated, and the frames sealed
// under it with additional data naming their place in the stream. The server
// forwards them and keeps none.
package relay

import (
	"crypto/ecdh"
	"encoding/base64"
	"errors"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
)

// Keys are what a relay seals with.
type Keys struct {
	// Runner is the Runner's X25519 key, the sender of every wrap.
	Runner *ecdh.PrivateKey
	// Holders gives the X25519 public keys of the Appareils the Runner
	// authenticated (vault.wrap's), read at each wrap: an Appareil approved
	// since gets its wrap at its next open.
	Holders func() ([][]byte, error)
}

// Wrap is a key wrapped for one holder, as the protocol's `wraps` carry it
// (each relay's generated type converts from it).
type Wrap struct {
	Enc        string
	HolderId   string
	Tag        string
	WrappedKey string
}

// B64 is the encoding of the frames' bytes: base64url without padding.
var B64 = base64.RawURLEncoding

// ErrNoHolder: no Appareil to wrap the key for.
var ErrNoHolder = errors.New("relay: no holder")

// Wraps wraps key for each holder (HPKE info keys.InfoSessionKey), under the
// additional data aad gives for its holderId, the base64url of its public key.
func (k *Keys) Wraps(key []byte, aad func(holderID string) string) ([]Wrap, error) {
	holders, err := k.Holders()
	if err != nil {
		return nil, err
	}
	var wraps []Wrap
	for _, holder := range holders {
		holderID := B64.EncodeToString(holder)
		w, err := keys.SealWrap(k.Runner, holder, key, []byte(keys.InfoSessionKey), []byte(aad(holderID)))
		if err != nil {
			return nil, err
		}
		wraps = append(wraps, Wrap{HolderId: holderID, Enc: B64.EncodeToString(w.Enc), WrappedKey: B64.EncodeToString(w.Ciphertext), Tag: B64.EncodeToString(w.Tag)})
	}
	if len(wraps) == 0 {
		return nil, ErrNoHolder
	}
	return wraps, nil
}

// Seal seals plain under key and aad: its nonce and its ciphertext (with the
// tag), in base64url.
func Seal(key, plain []byte, aad string) (nonce, ciphertext string, err error) {
	sealed, err := keys.AESGCMSeal(key, plain, []byte(aad))
	if err != nil {
		return "", "", err
	}
	return B64.EncodeToString(sealed[:12]), B64.EncodeToString(sealed[12:]), nil
}

// Open opens what Seal (or a tab) sealed under key and aad.
func Open(key []byte, nonce, ciphertext, aad string) ([]byte, error) {
	n, err := B64.Strict().DecodeString(nonce)
	if err != nil || len(n) != 12 {
		return nil, errors.New("relay: not a nonce")
	}
	c, err := B64.Strict().DecodeString(ciphertext)
	if err != nil {
		return nil, err
	}
	return keys.AESGCMOpen(key, append(n, c...), []byte(aad))
}

// ReadKey reads the key kept at path.
func ReadKey(path string) ([]byte, error) {
	key, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, errors.New("relay: not a key")
	}
	return key, nil
}

// LoadOrCreateKey is the key kept at path, else one drawn and written there
// (mode 600); its folder must exist.
func LoadOrCreateKey(path string) ([]byte, error) {
	key, err := os.ReadFile(path)
	switch {
	case err == nil && len(key) == 32:
		return key, nil
	case err == nil, errors.Is(err, fs.ErrNotExist):
	default:
		return nil, err
	}
	if key, err = keys.GenerateAESKey(); err != nil {
		return nil, err
	}
	return key, WritePrivate(path, key)
}

// WritePrivate writes data to path, mode 600, through a temporary file.
func WritePrivate(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}
