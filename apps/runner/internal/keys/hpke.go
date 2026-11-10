package keys

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/binary"
)

// HPKE base mode (RFC 9180), single shot: DHKEM(X25519, HKDF-SHA256),
// HKDF-SHA256, AES-256-GCM, one ephemeral key per seal, sequence number 0.

const (
	kemID  = 0x0020
	kdfID  = 0x0001
	aeadID = 0x0002
	nk     = 32 // AES-256 key
	nn     = 12 // nonce
	nh     = 32 // SHA-256 output, also Nsecret
)

var (
	kemSuiteID  = binary.BigEndian.AppendUint16([]byte("KEM"), kemID)
	hpkeSuiteID = binary.BigEndian.AppendUint16(binary.BigEndian.AppendUint16(binary.BigEndian.AppendUint16([]byte("HPKE"), kemID), kdfID), aeadID)
)

func labeledIKM(suiteID []byte, label string, ikm []byte) []byte {
	b := append([]byte("HPKE-v1"), suiteID...)
	b = append(b, label...)
	return append(b, ikm...)
}

func labeledExtract(suiteID, salt []byte, label string, ikm []byte) []byte {
	prk, err := hkdf.Extract(sha256.New, labeledIKM(suiteID, label, ikm), salt)
	if err != nil {
		panic(err) // HKDF-Extract cannot fail
	}
	return prk
}

func labeledExpand(suiteID, prk []byte, label string, info []byte, length int) []byte {
	labeled := binary.BigEndian.AppendUint16(nil, uint16(length))
	labeled = append(labeled, labeledIKM(suiteID, label, info)...)
	out, err := hkdf.Expand(sha256.New, prk, string(labeled), length)
	if err != nil {
		panic(err) // the lengths used here are far below HKDF's limit
	}
	return out
}

// sharedSecret is DHKEM's ExtractAndExpand.
func sharedSecret(dh, enc, pkR []byte) []byte {
	kemContext := append(append([]byte(nil), enc...), pkR...)
	eaePRK := labeledExtract(kemSuiteID, nil, "eae_prk", dh)
	return labeledExpand(kemSuiteID, eaePRK, "shared_secret", kemContext, nh)
}

// keySchedule derives the AEAD for the base mode (no PSK), with its nonce for
// sequence number 0.
func keySchedule(shared, info []byte) (cipher.AEAD, []byte) {
	pskIDHash := labeledExtract(hpkeSuiteID, nil, "psk_id_hash", nil)
	infoHash := labeledExtract(hpkeSuiteID, nil, "info_hash", info)
	context := append(append([]byte{0x00}, pskIDHash...), infoHash...)
	secret := labeledExtract(hpkeSuiteID, shared, "secret", nil)
	key := labeledExpand(hpkeSuiteID, secret, "key", context, nk)
	nonce := labeledExpand(hpkeSuiteID, secret, "base_nonce", context, nn)
	return newGCM(key), nonce
}

func newGCM(key []byte) cipher.AEAD {
	block, err := aes.NewCipher(key)
	if err != nil {
		panic(err) // the key is always 32 bytes here
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		panic(err)
	}
	return gcm
}

// HPKESeal wraps plaintext for the holder of recipientPublicKey (32 raw
// bytes). It returns enc, the ephemeral public key (32 bytes), and the
// ciphertext with its 16-byte tag.
func HPKESeal(recipientPublicKey, plaintext, info, aad []byte) (enc, ciphertext []byte, err error) {
	if len(aad) == 0 {
		return nil, nil, ErrNoAdditionalData
	}
	pkR, err := ecdh.X25519().NewPublicKey(recipientPublicKey)
	if err != nil {
		return nil, nil, err
	}
	skE, err := GenerateKeyPair()
	if err != nil {
		return nil, nil, err
	}
	dh, err := skE.ECDH(pkR)
	if err != nil {
		return nil, nil, err
	}
	enc = skE.PublicKey().Bytes()
	aead, nonce := keySchedule(sharedSecret(dh, enc, recipientPublicKey), info)
	return enc, aead.Seal(nil, nonce, plaintext, aad), nil
}

// HPKEOpen unwraps what HPKESeal sealed for recipientPrivateKey.
func HPKEOpen(recipientPrivateKey *ecdh.PrivateKey, enc, ciphertext, info, aad []byte) ([]byte, error) {
	if len(aad) == 0 {
		return nil, ErrNoAdditionalData
	}
	pkE, err := ecdh.X25519().NewPublicKey(enc)
	if err != nil {
		return nil, ErrOpen
	}
	dh, err := recipientPrivateKey.ECDH(pkE)
	if err != nil {
		return nil, ErrOpen
	}
	aead, nonce := keySchedule(sharedSecret(dh, enc, PublicKeyBytes(recipientPrivateKey)), info)
	plaintext, err := aead.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		return nil, ErrOpen
	}
	return plaintext, nil
}
