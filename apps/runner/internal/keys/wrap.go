package keys

import (
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/binary"
	"errors"
)

// HPKE's base mode does not authenticate who sealed (RFC 9180, 9.1.2): the
// server could swap a wrap for one of a key it chose. A Wrap therefore carries
// a tag only its sender and its recipient can compute, from their static
// X25519 keys, over the whole wrap and its context; OpenWrap checks it before
// opening. docs/security/e2e.md, « Authenticated wraps ».

const wrapAuthLabel = "crewdeck/v1/wrap-auth"

// Wrap is an HPKE wrap with the tag of the key holder that sealed it. On the
// wire: { enc, ciphertext, tag }, each base64url.
type Wrap struct {
	Enc, Ciphertext, Tag []byte
}

var errContextTooLong = errors.New("keys: info and additional data are at most 65535 bytes")

// wrapTag is HMAC-SHA256(authKey, u16(len info) ‖ info ‖ u16(len aad) ‖ aad
// ‖ enc ‖ ciphertext), authKey = HKDF-SHA256(salt "", X25519(skS, pkR),
// "crewdeck/v1/wrap-auth" ‖ pkS ‖ pkR, 32).
func wrapTag(dh, senderPublicKey, recipientPublicKey, enc, ciphertext, info, aad []byte) ([]byte, error) {
	if len(info) > 0xffff || len(aad) > 0xffff {
		return nil, errContextTooLong
	}
	keyInfo := append(append([]byte(wrapAuthLabel), senderPublicKey...), recipientPublicKey...)
	authKey, err := hkdf.Key(sha256.New, dh, nil, string(keyInfo), 32)
	if err != nil {
		return nil, err
	}
	msg := binary.BigEndian.AppendUint16(nil, uint16(len(info)))
	msg = append(msg, info...)
	msg = binary.BigEndian.AppendUint16(msg, uint16(len(aad)))
	msg = append(msg, aad...)
	msg = append(msg, enc...)
	msg = append(msg, ciphertext...)
	return HMACSHA256(authKey, msg), nil
}

// SealWrap wraps plaintext for the holder of recipientPublicKey, as sender
// (a holder may wrap for itself).
func SealWrap(sender *ecdh.PrivateKey, recipientPublicKey, plaintext, info, aad []byte) (Wrap, error) {
	enc, ciphertext, err := HPKESeal(recipientPublicKey, plaintext, info, aad)
	if err != nil {
		return Wrap{}, err
	}
	pkR, err := ecdh.X25519().NewPublicKey(recipientPublicKey)
	if err != nil {
		return Wrap{}, err
	}
	dh, err := sender.ECDH(pkR)
	if err != nil {
		return Wrap{}, err
	}
	tag, err := wrapTag(dh, PublicKeyBytes(sender), recipientPublicKey, enc, ciphertext, info, aad)
	if err != nil {
		return Wrap{}, err
	}
	return Wrap{Enc: enc, Ciphertext: ciphertext, Tag: tag}, nil
}

// OpenWrap opens a wrap only if the holder of senderPublicKey, a key the
// recipient already authenticated, sealed it for this context. Any failure is
// ErrOpen.
func OpenWrap(recipient *ecdh.PrivateKey, senderPublicKey []byte, w Wrap, info, aad []byte) ([]byte, error) {
	if len(aad) == 0 {
		return nil, ErrNoAdditionalData
	}
	pkS, err := ecdh.X25519().NewPublicKey(senderPublicKey)
	if err != nil {
		return nil, ErrOpen
	}
	dh, err := recipient.ECDH(pkS)
	if err != nil {
		return nil, ErrOpen
	}
	tag, err := wrapTag(dh, senderPublicKey, PublicKeyBytes(recipient), w.Enc, w.Ciphertext, info, aad)
	if err != nil || !ConstantTimeEqual(tag, w.Tag) {
		return nil, ErrOpen
	}
	return HPKEOpen(recipient, w.Enc, w.Ciphertext, info, aad)
}
