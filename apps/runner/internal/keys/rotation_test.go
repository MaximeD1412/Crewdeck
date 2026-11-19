package keys

import (
	"bytes"
	"crypto/ecdh"
	"errors"
	"testing"
)

const (
	rotatorID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01"
	laptopID  = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02"
	phoneID   = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a03"
)

// rotationFixture is a vault of version 1 held by the Runner, a laptop and a
// phone, and two items sealed under it.
type rotationFixture struct {
	runner, laptop, phone *ecdh.PrivateKey
	old                   *Vault
	items                 []RotationItem
	sealed                map[string]SealedItem
}

func newRotationFixture(t *testing.T) *rotationFixture {
	t.Helper()
	f := &rotationFixture{
		runner: must(GenerateKeyPair()),
		laptop: must(GenerateKeyPair()),
		phone:  must(GenerateKeyPair()),
		old:    &Vault{key: must(GenerateAESKey()), Version: 1},
		sealed: map[string]SealedItem{},
	}
	for id, aad := range map[string]string{laptopID: laptopID + ":text", phoneID: "process:" + phoneID} {
		item, err := f.old.SealItem([]byte("le texte de "+id), []byte(aad))
		if err != nil {
			t.Fatal(err)
		}
		f.sealed[id] = item
		f.items = append(f.items, RotationItem{Type: "idea.text", ID: id, AAD: []byte(aad), WrappedKey: item.Key})
	}
	return f
}

func (f *rotationFixture) holders() []Holder {
	return []Holder{
		{Type: HolderRunner, ID: rotatorID, PublicKey: PublicKeyBytes(f.runner)},
		{Type: HolderDevice, ID: laptopID, PublicKey: PublicKeyBytes(f.laptop)},
	}
}

func (f *rotationFixture) input() RotationInput {
	return RotationInput{
		Vault:         f.old,
		Rotator:       f.runner,
		RotatorID:     rotatorID,
		Authenticated: [][]byte{PublicKeyBytes(f.laptop), PublicKeyBytes(f.phone)},
		Holders:       f.holders(),
		Items:         f.items,
	}
}

// The Runner rotates for the holders kept (the phone revoked): each opens the
// new key of version 2 from the Runner's key, under "<id>:2", and every item
// sealed before opens with its rewrapped key and its ciphertext unchanged.
func TestARotationRewrapsEveryItemKeyAndWrapsTheNewKeyForEachHolderKept(t *testing.T) {
	f := newRotationFixture(t)

	rotation, next, err := Rotate(f.input())
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if rotation.FromVersion != 1 || rotation.ToVersion != 2 || next.Version != 2 {
		t.Fatalf("from %d to %d, new vault %d", rotation.FromVersion, rotation.ToVersion, next.Version)
	}
	if bytes.Equal(next.key, f.old.key) {
		t.Fatal("the new vault key is the old one")
	}
	if len(rotation.Wraps) != 2 {
		t.Fatalf("%d wraps, want one per holder", len(rotation.Wraps))
	}
	recipients := map[string]*ecdh.PrivateKey{rotatorID: f.runner, laptopID: f.laptop}
	for _, w := range rotation.Wraps {
		key, err := OpenWrap(recipients[w.Holder.ID], PublicKeyBytes(f.runner), w.Wrap, []byte(InfoVaultWrap), VaultWrapAAD(w.Holder.ID, 2))
		if err != nil || !bytes.Equal(key, next.key) {
			t.Fatalf("the wrap of %s opens %x, %v", w.Holder.ID, key, err)
		}
	}
	if len(rotation.Items) != len(f.items) {
		t.Fatalf("%d items rewrapped, want %d", len(rotation.Items), len(f.items))
	}
	for i, item := range rotation.Items {
		was := f.items[i]
		if item.Type != was.Type || item.ID != was.ID {
			t.Fatalf("item %d is %s %s, want %s %s", i, item.Type, item.ID, was.Type, was.ID)
		}
		got, err := next.OpenItem(SealedItem{Key: item.WrappedKey, Ciphertext: f.sealed[item.ID].Ciphertext}, was.AAD)
		if err != nil || string(got) != "le texte de "+item.ID {
			t.Fatalf("item %s opens %q, %v", item.ID, got, err)
		}
		if _, err := f.old.OpenItem(SealedItem{Key: item.WrappedKey, Ciphertext: f.sealed[item.ID].Ciphertext}, was.AAD); err == nil {
			t.Fatalf("the old vault key opens the rewrapped key of %s", item.ID)
		}
	}
}

// The rotator seals only for the keys it authenticated: a key the server
// slipped into the holders, or a Runner holder that is not the rotator
// itself, stops the rotation before anything is sealed.
func TestARotationRefusesAHolderItDidNotAuthenticate(t *testing.T) {
	f := newRotationFixture(t)
	server := PublicKeyBytes(must(GenerateKeyPair()))
	cases := map[string]func(in *RotationInput){
		"a device key the server chose": func(in *RotationInput) {
			in.Holders = append(in.Holders, Holder{Type: HolderDevice, ID: phoneID, PublicKey: server})
		},
		"the laptop's id under the server's key": func(in *RotationInput) {
			in.Holders[1].PublicKey = server
		},
		"a Runner holder of another key": func(in *RotationInput) {
			in.Holders[0].PublicKey = server
		},
		"a Runner holder of another id": func(in *RotationInput) {
			in.Holders[0].ID = phoneID
		},
		"the rotator's own key as a device": func(in *RotationInput) {
			in.Holders[1].PublicKey = PublicKeyBytes(f.runner)
		},
	}
	for name, alter := range cases {
		t.Run(name, func(t *testing.T) {
			in := f.input()
			in.Holders = f.holders()
			alter(&in)
			_, next, err := Rotate(in)
			var refused *UnauthenticatedHolderError
			if !errors.As(err, &refused) || next != nil {
				t.Fatalf("rotate = %v, %v, want an unauthenticated holder", next, err)
			}
		})
	}
}

// A rotation leaves no holder without the new key: one without the rotator
// among its holders would lose it.
func TestARotationWithoutTheRotatorAmongItsHoldersIsRefused(t *testing.T) {
	f := newRotationFixture(t)
	in := f.input()
	in.Holders = f.holders()[1:]

	if _, _, err := Rotate(in); !errors.Is(err, ErrRotatorNotHolder) {
		t.Fatalf("rotate = %v, want ErrRotatorNotHolder", err)
	}
}

// An item key that does not open under the old vault key (a wrong aad, a
// key of another version) stops the rotation: it would lose the item.
func TestARotationStopsAtAnItemKeyThatDoesNotOpen(t *testing.T) {
	f := newRotationFixture(t)
	in := f.input()
	in.Items = append([]RotationItem(nil), f.items...)
	in.Items[1].AAD = []byte("process:another")

	_, next, err := Rotate(in)
	var stopped *ItemNotOpenedError
	if !errors.As(err, &stopped) || stopped.ID != f.items[1].ID || stopped.Type != "idea.text" || next != nil {
		t.Fatalf("rotate = %v, %v, want the item %s not opened", next, err, f.items[1].ID)
	}
}

// The Runner's wrap of a new version opens from the first of its held keys
// whose tag checks, and says which one: the key it keeps as the sender.
func TestTheWrapOfANewVersionOpensFromTheFirstHeldKeyWhoseTagChecks(t *testing.T) {
	f := newRotationFixture(t)
	next := &Vault{key: must(GenerateAESKey()), Version: 2}
	w, err := next.WrapFor(f.laptop, PublicKeyBytes(f.runner), rotatorID)
	if err != nil {
		t.Fatal(err)
	}
	stranger := PublicKeyBytes(must(GenerateKeyPair()))

	opened, sender, err := OpenVaultWrap(f.runner, rotatorID, 2, w, [][]byte{PublicKeyBytes(f.runner), stranger, PublicKeyBytes(f.laptop)})
	if err != nil || opened.Version != 2 || !bytes.Equal(opened.key, next.key) || !bytes.Equal(sender, PublicKeyBytes(f.laptop)) {
		t.Fatalf("open = %v, sender %x, %v", opened, sender, err)
	}
	for name, open := range map[string]func() (*Vault, []byte, error){
		"from keys it does not hold": func() (*Vault, []byte, error) {
			return OpenVaultWrap(f.runner, rotatorID, 2, w, [][]byte{stranger, PublicKeyBytes(f.phone)})
		},
		"for another holder": func() (*Vault, []byte, error) {
			return OpenVaultWrap(f.runner, phoneID, 2, w, [][]byte{PublicKeyBytes(f.laptop)})
		},
		"for another version": func() (*Vault, []byte, error) {
			return OpenVaultWrap(f.runner, rotatorID, 3, w, [][]byte{PublicKeyBytes(f.laptop)})
		},
	} {
		if got, _, err := open(); !errors.Is(err, ErrOpen) || got != nil {
			t.Errorf("%s: %v, %v, want ErrOpen", name, got, err)
		}
	}
}
