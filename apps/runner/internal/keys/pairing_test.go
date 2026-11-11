package keys

import (
	"bytes"
	"errors"
	"testing"
)

func TestPairingVectorsMatch(t *testing.T) {
	var v pairingVectors
	readVectors(t, "link-pairing.json", &v)
	for _, c := range v.Cases {
		t.Run(c.Name, func(t *testing.T) {
			secret, err := DecodeBase32(c.Code[5:])
			if err != nil || !bytes.Equal(secret, c.Secret) || c.Code[:4] != c.ShortID {
				t.Fatalf("the code %q does not carry the secret", c.Code)
			}
			if !VerifyPairingProof(c.RunnerProof, ProofLabelRunner, c.Secret, c.ShortID, c.RunnerPublicKey, c.DevicePublicKey) {
				t.Error("the runner proof does not verify")
			}
			if !VerifyPairingProof(c.DeviceProof, ProofLabelDevice, c.Secret, c.ShortID, c.DevicePublicKey, c.RunnerPublicKey) {
				t.Error("the device proof does not verify")
			}
		})
	}
}

func TestADeviceProofIsRefusedForAnotherKeyOrSecret(t *testing.T) {
	var v pairingVectors
	readVectors(t, "link-pairing.json", &v)
	c, other := v.Cases[0], v.Cases[1]
	for name, ok := range map[string]bool{
		// The server swapped the device public key it handed to the Runner.
		"another device key": VerifyPairingProof(c.DeviceProof, ProofLabelDevice, c.Secret, c.ShortID, other.DevicePublicKey, c.RunnerPublicKey),
		// It swapped the Runner's public key it handed to the browser.
		"another runner key": VerifyPairingProof(c.DeviceProof, ProofLabelDevice, c.Secret, c.ShortID, c.DevicePublicKey, other.RunnerPublicKey),
		"another secret":     VerifyPairingProof(c.DeviceProof, ProofLabelDevice, other.Secret, c.ShortID, c.DevicePublicKey, c.RunnerPublicKey),
		"another short id":   VerifyPairingProof(c.DeviceProof, ProofLabelDevice, c.Secret, other.ShortID, c.DevicePublicKey, c.RunnerPublicKey),
		"the runner's label": VerifyPairingProof(c.DeviceProof, ProofLabelRunner, c.Secret, c.ShortID, c.DevicePublicKey, c.RunnerPublicKey),
		"a flipped bit":      VerifyPairingProof(flipBit(c.DeviceProof, 3), ProofLabelDevice, c.Secret, c.ShortID, c.DevicePublicKey, c.RunnerPublicKey),
		"a truncated proof":  VerifyPairingProof(c.DeviceProof[:31], ProofLabelDevice, c.Secret, c.ShortID, c.DevicePublicKey, c.RunnerPublicKey),
	} {
		if ok {
			t.Errorf("%s verifies", name)
		}
	}
}

func TestVaultWrapAADIsTheHolderAndTheVersion(t *testing.T) {
	if got := string(VaultWrapAAD("run_01J9ZQ3M", 2)); got != "run_01J9ZQ3M:2" {
		t.Fatalf("got %q", got)
	}
}

// A vault sealed for the Runner by a device, as the first Appareil does.
func sealedVault(t *testing.T) (runner, device []byte, w Wrap, vaultKey []byte, unlock func(devicePub []byte, runnerID string, version int, w Wrap) (*Vault, error)) {
	t.Helper()
	r, d := must(GenerateKeyPair()), must(GenerateKeyPair())
	vaultKey = must(GenerateAESKey())
	w, err := SealWrap(d, PublicKeyBytes(r), vaultKey, []byte(InfoVaultWrap), VaultWrapAAD("run_1", 1))
	if err != nil {
		t.Fatal(err)
	}
	return PublicKeyBytes(r), PublicKeyBytes(d), w, vaultKey, func(devicePub []byte, runnerID string, version int, w Wrap) (*Vault, error) {
		return Unlock(r, devicePub, runnerID, version, w)
	}
}

func TestAVaultSealsAndOpensItems(t *testing.T) {
	_, device, w, _, unlock := sealedVault(t)
	vault, err := unlock(device, "run_1", 1, w)
	if err != nil {
		t.Fatal(err)
	}
	if vault.Version != 1 {
		t.Fatalf("version %d", vault.Version)
	}
	aad := []byte("idea_1:text")
	item, err := vault.SealItem([]byte("une Idée"), aad)
	if err != nil {
		t.Fatal(err)
	}
	again, _ := vault.SealItem([]byte("une Idée"), aad)
	if bytes.Equal(item.Key, again.Key) || bytes.Equal(item.Ciphertext, again.Ciphertext) {
		t.Fatal("two seals share an item key")
	}
	got, err := vault.OpenItem(item, aad)
	if err != nil || string(got) != "une Idée" {
		t.Fatalf("got %q, %v", got, err)
	}
	for name, open := range map[string]func() ([]byte, error){
		"another aad": func() ([]byte, error) { return vault.OpenItem(item, []byte("idea_1:analysis")) },
		"another item's key": func() ([]byte, error) {
			return vault.OpenItem(SealedItem{Key: again.Key, Ciphertext: item.Ciphertext}, aad)
		},
		"a flipped key": func() ([]byte, error) {
			return vault.OpenItem(SealedItem{Key: flipBit(item.Key, 20), Ciphertext: item.Ciphertext}, aad)
		},
		"a flipped content": func() ([]byte, error) {
			return vault.OpenItem(SealedItem{Key: item.Key, Ciphertext: flipBit(item.Ciphertext, 20)}, aad)
		},
		"the key as the item": func() ([]byte, error) { return AESGCMOpen(vault.key, item.Key, aad) },
	} {
		if _, err := open(); !errors.Is(err, ErrOpen) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := vault.SealItem([]byte("x"), nil); !errors.Is(err, ErrNoAdditionalData) {
		t.Errorf("an item without additional data seals: %v", err)
	}
}

// The Runner opens its wrap with the device key the device proof
// authenticated: a wrap the server substituted under untouched proofs, from
// its own key, does not open.
func TestUnlockRefusesASubstitutedWrapOrAnotherHolderOrVersion(t *testing.T) {
	runner, device, w, _, unlock := sealedVault(t)
	server := must(GenerateKeyPair())
	substituted := must(SealWrap(server, runner, must(GenerateAESKey()), []byte(InfoVaultWrap), VaultWrapAAD("run_1", 1)))
	for name, try := range map[string]func() (*Vault, error){
		"a wrap from the server's key": func() (*Vault, error) { return unlock(device, "run_1", 1, substituted) },
		"another runner id":            func() (*Vault, error) { return unlock(device, "run_2", 1, w) },
		"another version":              func() (*Vault, error) { return unlock(device, "run_1", 2, w) },
		"a flipped tag": func() (*Vault, error) {
			return unlock(device, "run_1", 1, Wrap{Enc: w.Enc, Ciphertext: w.Ciphertext, Tag: flipBit(w.Tag, 0)})
		},
	} {
		if v, err := try(); !errors.Is(err, ErrOpen) || v != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestItemVectorsOpen(t *testing.T) {
	var v itemVectors
	readVectors(t, "item.json", &v)
	device := privateKeyOf(v.Vault.DevicePrivateKey)
	key, err := OpenWrap(device, v.Vault.DevicePublicKey, Wrap{Enc: v.Vault.Wrap.Enc, Ciphertext: v.Vault.Wrap.Ciphertext, Tag: v.Vault.Wrap.Tag}, []byte(InfoVaultWrap), VaultWrapAAD(v.Vault.DeviceID, v.Vault.VaultKeyVersion))
	if err != nil || !bytes.Equal(key, v.Vault.VaultKey) {
		t.Fatalf("the device's wrap: %v", err)
	}
	vault := &Vault{key: key, Version: v.Vault.VaultKeyVersion}
	for _, c := range v.Items {
		got, err := vault.OpenItem(SealedItem{Key: c.Key, Ciphertext: c.Ciphertext}, c.AAD)
		if err != nil || !bytes.Equal(got, c.Plaintext) {
			t.Errorf("%s: %q, %v", c.Name, got, err)
		}
	}
}

// web-pairing.json is written by the browser's test run (pairing.spec.ts), from
// the « first-appareil » case: the Runner verifies the page's proof, unlocks the
// vault from its wrap, finds the same key in the Appareil's wrap, and opens the
// item the browser sealed.
func TestWhatTheBrowserPairedOpens(t *testing.T) {
	type wireWrap struct {
		Enc        b64 `json:"enc"`
		Ciphertext b64 `json:"ciphertext"`
		Tag        b64 `json:"tag"`
	}
	var v struct {
		Case     string `json:"case"`
		DeviceID string `json:"deviceId"`
		RunnerID string `json:"runnerId"`
		Confirm  struct {
			Proof           b64      `json:"proof"`
			VaultKeyVersion int      `json:"vaultKeyVersion"`
			RunnerVaultWrap wireWrap `json:"runnerVaultWrap"`
			DeviceVaultWrap wireWrap `json:"deviceVaultWrap"`
		} `json:"confirm"`
		Item itemCase `json:"item"`
	}
	readVectors(t, "web-pairing.json", &v)
	var pairings pairingVectors
	readVectors(t, "link-pairing.json", &pairings)
	var c pairingCase
	for _, p := range pairings.Cases {
		if p.Name == v.Case {
			c = p
		}
	}
	if c.Name == "" {
		t.Fatalf("no case %q", v.Case)
	}

	if !VerifyPairingProof(v.Confirm.Proof, ProofLabelDevice, c.Secret, c.ShortID, c.DevicePublicKey, c.RunnerPublicKey) {
		t.Fatal("the browser's device proof does not verify")
	}
	if v.Confirm.VaultKeyVersion != 1 {
		t.Fatalf("version %d", v.Confirm.VaultKeyVersion)
	}
	rw := v.Confirm.RunnerVaultWrap
	vault, err := Unlock(privateKeyOf(c.RunnerPrivateKey), c.DevicePublicKey, v.RunnerID, 1, Wrap{Enc: rw.Enc, Ciphertext: rw.Ciphertext, Tag: rw.Tag})
	if err != nil {
		t.Fatalf("unlock: %v", err)
	}
	dw := v.Confirm.DeviceVaultWrap
	deviceKey, err := OpenWrap(privateKeyOf(c.DevicePrivateKey), c.DevicePublicKey, Wrap{Enc: dw.Enc, Ciphertext: dw.Ciphertext, Tag: dw.Tag}, []byte(InfoVaultWrap), VaultWrapAAD(v.DeviceID, 1))
	if err != nil || !bytes.Equal(deviceKey, vault.key) {
		t.Fatalf("the Appareil's wrap holds another key: %v", err)
	}
	got, err := vault.OpenItem(SealedItem{Key: v.Item.Key, Ciphertext: v.Item.Ciphertext}, v.Item.AAD)
	if err != nil || !bytes.Equal(got, v.Item.Plaintext) {
		t.Fatalf("the browser's item: %q, %v", got, err)
	}
	// And the Runner seals it again byte for byte from the same seed.
	withDeterministicRandom(t, v.Item.Seed)
	again, err := vault.SealItem(v.Item.Plaintext, v.Item.AAD)
	if err != nil || !bytes.Equal(again.Key, v.Item.Key) || !bytes.Equal(again.Ciphertext, v.Item.Ciphertext) {
		t.Fatalf("resealed differently: %v", err)
	}
}
