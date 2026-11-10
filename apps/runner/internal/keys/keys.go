// Package keys holds the end-to-end primitives the Runner shares with the
// Appareils (ADR 0003): X25519 key pairs, the HPKE wrap, AES-256-GCM, HMAC
// proofs and Crockford base32. Go's standard library only; the browser side is
// apps/web/src/keys/, and docs/security/e2e.md gives the exact bytes.
package keys

import (
	"crypto/ecdh"
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"io"
)

// The info strings of the HPKE wraps, one per use.
const (
	InfoVaultWrap  = "crewdeck/v1/vault-wrap"
	InfoItemKey    = "crewdeck/v1/item-key"
	InfoSessionKey = "crewdeck/v1/session-key"
)

// ErrOpen is the only error a failed open returns: a wrong key, a tampered
// ciphertext and a wrong additional data are not told apart.
var ErrOpen = errors.New("keys: cannot open the ciphertext")

// ErrNoAdditionalData refuses a seal or an open without additional data: it
// always binds the ids the ciphertext belongs to.
var ErrNoAdditionalData = errors.New("keys: the additional data is empty")

// random is where every random byte comes from; the tests swap it
// (random_test.go) to replay the shared vectors.
var random io.Reader = rand.Reader

func randomBytes(n int) ([]byte, error) {
	b := make([]byte, n)
	if _, err := io.ReadFull(random, b); err != nil {
		return nil, err
	}
	return b, nil
}

// GenerateKeyPair draws a key holder's X25519 key pair.
func GenerateKeyPair() (*ecdh.PrivateKey, error) {
	raw, err := randomBytes(32)
	if err != nil {
		return nil, err
	}
	return ecdh.X25519().NewPrivateKey(raw)
}

// PublicKeyBytes is the 32-byte raw public key of a key holder.
func PublicKeyBytes(k *ecdh.PrivateKey) []byte {
	return k.PublicKey().Bytes()
}

// GenerateAESKey draws a 32-byte AES-256 key (a vault, item or Session key).
func GenerateAESKey() ([]byte, error) {
	return randomBytes(32)
}

// ConstantTimeEqual compares two byte strings in a time that depends only on
// their lengths.
func ConstantTimeEqual(a, b []byte) bool {
	return subtle.ConstantTimeCompare(a, b) == 1
}
