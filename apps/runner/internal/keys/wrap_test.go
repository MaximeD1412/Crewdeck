package keys

import (
	"bytes"
	"errors"
	"testing"
)

var (
	vaultAAD  = []byte("dev_01J9ZQ3M:1")
	vaultInfo = []byte(InfoVaultWrap)
)

func TestOpenWrapOpensWhatTheSenderSealed(t *testing.T) {
	device, runner := must(GenerateKeyPair()), must(GenerateKeyPair())
	vaultKey := must(GenerateAESKey())
	w, err := SealWrap(device, PublicKeyBytes(runner), vaultKey, vaultInfo, vaultAAD)
	if err != nil {
		t.Fatal(err)
	}
	if len(w.Enc) != 32 || len(w.Ciphertext) != 48 || len(w.Tag) != 32 {
		t.Fatalf("wrap of %d, %d, %d bytes", len(w.Enc), len(w.Ciphertext), len(w.Tag))
	}
	got, err := OpenWrap(runner, PublicKeyBytes(device), w, vaultInfo, vaultAAD)
	if err != nil || !bytes.Equal(got, vaultKey) {
		t.Fatalf("open: %x, %v", got, err)
	}
}

func TestOpenWrapOpensAWrapAHolderMadeForItself(t *testing.T) {
	device := must(GenerateKeyPair())
	w := must(SealWrap(device, PublicKeyBytes(device), []byte("la clé du coffre"), vaultInfo, vaultAAD))
	if _, err := OpenWrap(device, PublicKeyBytes(device), w, vaultInfo, vaultAAD); err != nil {
		t.Fatal(err)
	}
}

// The server relays the pairing proofs untouched but swaps the wrap for one
// of a key it chose: HPKE base mode alone would open it.
func TestOpenWrapRefusesAWrapTheServerSubstituted(t *testing.T) {
	device, runner, server := must(GenerateKeyPair()), must(GenerateKeyPair()), must(GenerateKeyPair())
	genuine := must(SealWrap(device, PublicKeyBytes(runner), must(GenerateAESKey()), vaultInfo, vaultAAD))
	serverKey := must(GenerateAESKey())

	enc, ct, err := HPKESeal(PublicKeyBytes(runner), serverKey, vaultInfo, vaultAAD)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := HPKEOpen(runner, enc, ct, vaultInfo, vaultAAD); err != nil {
		t.Fatalf("the substitution premise: HPKE base opens the server's wrap: %v", err)
	}
	for name, w := range map[string]Wrap{
		"the genuine tag":            {Enc: enc, Ciphertext: ct, Tag: genuine.Tag},
		"no tag":                     {Enc: enc, Ciphertext: ct},
		"a tag of the server's key":  must(SealWrap(server, PublicKeyBytes(runner), serverKey, vaultInfo, vaultAAD)),
		"the genuine enc, other ct":  {Enc: genuine.Enc, Ciphertext: ct, Tag: genuine.Tag},
		"the genuine ct, other enc":  {Enc: enc, Ciphertext: genuine.Ciphertext, Tag: genuine.Tag},
		"a tag forged by the runner": {Enc: enc, Ciphertext: ct, Tag: make([]byte, 32)},
	} {
		if got, err := OpenWrap(runner, PublicKeyBytes(device), w, vaultInfo, vaultAAD); !errors.Is(err, ErrOpen) {
			t.Errorf("%s: opens %x, %v", name, got, err)
		}
	}
}

func TestOpenWrapRefusesAnotherContext(t *testing.T) {
	device, runner, other := must(GenerateKeyPair()), must(GenerateKeyPair()), must(GenerateKeyPair())
	w := must(SealWrap(device, PublicKeyBytes(runner), must(GenerateAESKey()), vaultInfo, vaultAAD))
	for name, open := range map[string]func() ([]byte, error){
		"another sender": func() ([]byte, error) { return OpenWrap(runner, PublicKeyBytes(other), w, vaultInfo, vaultAAD) },
		"another additional data": func() ([]byte, error) {
			return OpenWrap(runner, PublicKeyBytes(device), w, vaultInfo, []byte("dev_01J9ZQ3M:2"))
		},
		"another info": func() ([]byte, error) {
			return OpenWrap(runner, PublicKeyBytes(device), w, []byte(InfoSessionKey), vaultAAD)
		},
		"a flipped bit of the tag": func() ([]byte, error) {
			return OpenWrap(runner, PublicKeyBytes(device), Wrap{w.Enc, w.Ciphertext, flipBit(w.Tag, 0)}, vaultInfo, vaultAAD)
		},
		"a low-order sender": func() ([]byte, error) { return OpenWrap(runner, make([]byte, 32), w, vaultInfo, vaultAAD) },
	} {
		if got, err := open(); !errors.Is(err, ErrOpen) {
			t.Errorf("%s: opens %x, %v", name, got, err)
		}
	}
	if _, err := SealWrap(device, PublicKeyBytes(runner), []byte("x"), vaultInfo, nil); !errors.Is(err, ErrNoAdditionalData) {
		t.Fatalf("an empty additional data seals: %v", err)
	}
}
