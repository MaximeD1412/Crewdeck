package main

import (
	"bytes"
	"crypto/ecdh"
	"encoding/base64"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
)

// holdersMax is the most Appareils a Session's key is wrapped for (SESSION-1).
const holdersMax = 64

// authenticatedHolders are the Appareils the Runner wraps a Session's key for
// (docs/security/e2e.md, « Sessions »): first, vault.wrap's, then each listed
// one whose holder wrap opens, from a key the Runner already holds (its own,
// for an Appareil it approved, or a holder's), to the listed key under the
// listed id. The server lists them in any order; it can hide one, never add
// one.
func authenticatedHolders(runner *ecdh.PrivateKey, first []byte, listed []contracts.RunnerDeviceHoldersHoldersElem) [][]byte {
	b64 := base64.RawURLEncoding
	own := keys.PublicKeyBytes(runner)
	held := [][]byte{first}
	holds := func(key []byte) bool {
		for _, h := range held {
			if bytes.Equal(h, key) {
				return true
			}
		}
		return false
	}
	pending := listed
	// Each pass takes the ones vouched for by a key held before it.
	for progress := true; progress && len(held) < holdersMax; {
		progress = false
		var rest []contracts.RunnerDeviceHoldersHoldersElem
		for _, c := range pending {
			if len(held) >= holdersMax {
				break
			}
			key, keyErr := b64.DecodeString(c.PublicKey)
			approver, approverErr := b64.DecodeString(c.ApproverPublicKey)
			enc, encErr := b64.DecodeString(c.Wrap.Enc)
			ciphertext, ciphertextErr := b64.DecodeString(c.Wrap.Ciphertext)
			tag, tagErr := b64.DecodeString(c.Wrap.Tag)
			if keyErr != nil || approverErr != nil || encErr != nil || ciphertextErr != nil || tagErr != nil || len(key) != 32 || holds(key) {
				continue
			}
			if !bytes.Equal(approver, own) && !holds(approver) {
				rest = append(rest, c)
				continue
			}
			opened, err := keys.OpenWrap(runner, approver, keys.Wrap{Enc: enc, Ciphertext: ciphertext, Tag: tag}, []byte(keys.InfoDeviceHolder), []byte(c.DeviceId))
			if err != nil || !bytes.Equal(opened, key) {
				continue
			}
			held = append(held, key)
			progress = true
		}
		pending = rest
	}
	return held
}
