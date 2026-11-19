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
// holder whose holder wrap opens, from a key the Runner already authenticated
// (its own, for an Appareil it approved, a holder's, or a voucher's), to the
// listed key under the listed id. A voucher, a revoked Appareil an approval
// had vouched for (E2E-4), is authenticated the same way to verify the next
// links but is never returned. The server lists them in any order; it can
// hide one, never add one.
func authenticatedHolders(runner *ecdh.PrivateKey, first []byte, listed contracts.RunnerDeviceHolders) [][]byte {
	b64 := base64.RawURLEncoding
	type candidate struct {
		elem    contracts.RunnerDeviceHoldersHoldersElem
		voucher bool
	}
	pending := make([]candidate, 0, len(listed.Holders)+len(listed.Vouchers))
	for _, h := range listed.Holders {
		pending = append(pending, candidate{elem: h})
	}
	for _, v := range listed.Vouchers {
		pending = append(pending, candidate{voucher: true, elem: contracts.RunnerDeviceHoldersHoldersElem{
			DeviceId: v.DeviceId, PublicKey: v.PublicKey, ApproverPublicKey: v.ApproverPublicKey,
			Wrap: contracts.RunnerDeviceHoldersHoldersElemWrap{Enc: v.Wrap.Enc, Ciphertext: v.Wrap.Ciphertext, Tag: v.Wrap.Tag},
		}})
	}
	held := [][]byte{first}
	// known: the keys an approval may come from, the Runner's own and the
	// vouchers authenticated included.
	known := [][]byte{keys.PublicKeyBytes(runner), first}
	contains := func(list [][]byte, key []byte) bool {
		for _, k := range list {
			if bytes.Equal(k, key) {
				return true
			}
		}
		return false
	}
	// Each pass takes the ones vouched for by a key authenticated before it.
	for progress := true; progress && len(held) < holdersMax; {
		progress = false
		var rest []candidate
		for _, c := range pending {
			if len(held) >= holdersMax {
				break
			}
			key, keyErr := b64.DecodeString(c.elem.PublicKey)
			approver, approverErr := b64.DecodeString(c.elem.ApproverPublicKey)
			enc, encErr := b64.DecodeString(c.elem.Wrap.Enc)
			ciphertext, ciphertextErr := b64.DecodeString(c.elem.Wrap.Ciphertext)
			tag, tagErr := b64.DecodeString(c.elem.Wrap.Tag)
			if keyErr != nil || approverErr != nil || encErr != nil || ciphertextErr != nil || tagErr != nil || len(key) != 32 || contains(held, key) {
				continue
			}
			if !contains(known, approver) {
				rest = append(rest, c)
				continue
			}
			opened, err := keys.OpenWrap(runner, approver, keys.Wrap{Enc: enc, Ciphertext: ciphertext, Tag: tag}, []byte(keys.InfoDeviceHolder), []byte(c.elem.DeviceId))
			if err != nil || !bytes.Equal(opened, key) {
				continue
			}
			if !contains(known, key) {
				known = append(known, key)
				progress = true
			}
			if !c.voucher {
				held = append(held, key)
				progress = true
			}
		}
		pending = rest
	}
	return held
}
