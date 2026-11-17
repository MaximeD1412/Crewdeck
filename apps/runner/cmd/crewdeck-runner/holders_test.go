package main

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"errors"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// vouch is what an approver sends the Runner for a new Appareil: its public
// key in a wrap from the approver to the Runner, under the Appareil's id.
func vouch(t *testing.T, approver *ecdh.PrivateKey, runner []byte, id string, device []byte) contracts.RunnerDeviceHoldersHoldersElem {
	t.Helper()
	w, err := keys.SealWrap(approver, runner, device, []byte(keys.InfoDeviceHolder), []byte(id))
	if err != nil {
		t.Fatal(err)
	}
	b64 := base64.RawURLEncoding
	return contracts.RunnerDeviceHoldersHoldersElem{
		DeviceId:          id,
		PublicKey:         b64.EncodeToString(device),
		ApproverPublicKey: b64.EncodeToString(keys.PublicKeyBytes(approver)),
		Wrap:              contracts.RunnerDeviceHoldersHoldersElemWrap{Enc: b64.EncodeToString(w.Enc), Ciphertext: b64.EncodeToString(w.Ciphertext), Tag: b64.EncodeToString(w.Tag)},
	}
}

// The Runner holds the first Appareil, then each one an approval vouches for
// from a key it already holds, its own included, in any order the server
// lists them; the server can add none.
func TestTheRunnerHoldsTheAppareilsAnApprovalVouchesFor(t *testing.T) {
	runner, first, laptop, phone, tablet, intruder, other := mustKey(t), mustKey(t), mustKey(t), mustKey(t), mustKey(t), mustKey(t), mustKey(t)
	own := keys.PublicKeyBytes(runner)
	pub := keys.PublicKeyBytes
	const laptopID, phoneID, tabletID = "01933b6e-8f3a-7c4d-9e2f-0a1b2c3d4e61", "01933b6e-8f3a-7c4d-9e2f-0a1b2c3d4e62", "01933b6e-8f3a-7c4d-9e2f-0a1b2c3d4e63"

	listed := []contracts.RunnerDeviceHoldersHoldersElem{
		// The phone, approved by the laptop, listed before it.
		vouch(t, laptop, own, phoneID, pub(phone)),
		// The laptop, approved by the first Appareil.
		vouch(t, first, own, laptopID, pub(laptop)),
		// The tablet, approved by the Runner itself.
		vouch(t, runner, own, tabletID, pub(tablet)),
		// A key the server made up, "approved" by a key the Runner does not hold.
		vouch(t, intruder, own, "01933b6e-8f3a-7c4d-9e2f-0a1b2c3d4e64", pub(intruder)),
		// The laptop's wrap, under another key than the one it holds.
		func() contracts.RunnerDeviceHoldersHoldersElem {
			e := vouch(t, first, own, "01933b6e-8f3a-7c4d-9e2f-0a1b2c3d4e65", pub(laptop))
			e.PublicKey = base64.RawURLEncoding.EncodeToString(pub(other))
			return e
		}(),
		// A wrap moved to another Appareil's id.
		func() contracts.RunnerDeviceHoldersHoldersElem {
			e := vouch(t, first, own, "01933b6e-8f3a-7c4d-9e2f-0a1b2c3d4e66", pub(other))
			e.DeviceId = "01933b6e-8f3a-7c4d-9e2f-0a1b2c3d4e67"
			return e
		}(),
	}

	got := authenticatedHolders(runner, pub(first), listed)
	want := [][]byte{pub(first), pub(laptop), pub(phone), pub(tablet)}
	if len(got) != len(want) {
		t.Fatalf("holders %d, want %d", len(got), len(want))
	}
	for _, key := range want {
		if !containsKey(got, key) {
			t.Fatalf("holders lack %x", key)
		}
	}
	if !bytes.Equal(got[0], pub(first)) {
		t.Fatal("the first Appareil is not the first holder")
	}
}

// The relay reads the holders again at each wrap, from the server; a server
// that does not answer leaves the first Appareil, said in the log.
func TestTheRelaysHoldersAreReadAgainAtEachWrap(t *testing.T) {
	s := newApprovalSetUp(t)
	store := state.Store{Dir: s.home}
	w, err := store.LoadVaultWrap()
	if err != nil {
		t.Fatal(err)
	}
	var listed []contracts.RunnerDeviceHoldersHoldersElem
	var fail error
	var warned []error
	relay, err := relayKeys(store, func(context.Context) ([]contracts.RunnerDeviceHoldersHoldersElem, error) { return listed, fail }, func(err error) { warned = append(warned, err) })
	if err != nil {
		t.Fatal(err)
	}

	holders, err := relay.Holders()
	if err != nil || len(holders) != 1 || !bytes.Equal(holders[0], w.DevicePublicKey) {
		t.Fatalf("holders %x (%v), want the linked Appareil's only", holders, err)
	}
	listed = []contracts.RunnerDeviceHoldersHoldersElem{vouch(t, s.runner, keys.PublicKeyBytes(s.runner), newDeviceID, keys.PublicKeyBytes(s.phone))}
	holders, err = relay.Holders()
	if err != nil || len(holders) != 2 || !bytes.Equal(holders[1], keys.PublicKeyBytes(s.phone)) {
		t.Fatalf("holders %x (%v), want the approved Appareil too", holders, err)
	}
	fail = errors.New("down")
	holders, err = relay.Holders()
	if err != nil || len(holders) != 1 || len(warned) != 1 {
		t.Fatalf("holders %x (%v), warned %v", holders, err, warned)
	}
}

func containsKey(list [][]byte, key []byte) bool {
	for _, k := range list {
		if bytes.Equal(k, key) {
			return true
		}
	}
	return false
}
