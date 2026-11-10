package keys

import (
	"crypto/hmac"
	"crypto/sha256"
	"errors"
)

// AESGCMSeal encrypts with AES-256-GCM under a random 96-bit nonce and returns
// nonce ‖ ciphertext ‖ tag.
func AESGCMSeal(key, plaintext, aad []byte) ([]byte, error) {
	if len(key) != nk {
		return nil, errors.New("keys: an AES-256 key is 32 bytes")
	}
	if len(aad) == 0 {
		return nil, ErrNoAdditionalData
	}
	nonce, err := randomBytes(nn)
	if err != nil {
		return nil, err
	}
	return newGCM(key).Seal(nonce, nonce, plaintext, aad), nil
}

// AESGCMOpen opens what AESGCMSeal sealed.
func AESGCMOpen(key, sealed, aad []byte) ([]byte, error) {
	if len(key) != nk {
		return nil, errors.New("keys: an AES-256 key is 32 bytes")
	}
	if len(aad) == 0 {
		return nil, ErrNoAdditionalData
	}
	if len(sealed) < nn+16 {
		return nil, ErrOpen
	}
	plaintext, err := newGCM(key).Open(nil, sealed[:nn], sealed[nn:], aad)
	if err != nil {
		return nil, ErrOpen
	}
	return plaintext, nil
}

// HMACSHA256 is the pairing proofs' MAC.
func HMACSHA256(secret, message []byte) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write(message)
	return mac.Sum(nil)
}
