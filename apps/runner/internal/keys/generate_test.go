package keys

import (
	"bytes"
	"crypto/ecdh"
	"encoding/base64"
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
)

// go test ./internal/keys -run TestGenerateVectors -update rewrites Crewdeck's
// own vectors; without -update the test fails if regenerating them would
// change a byte. The browser opens and reseals them (crypto.spec.ts).
var update = flag.Bool("update", false, "rewrite packages/contracts/fixtures/crypto/")

// b64 is a byte string as it travels in JSON: base64url without padding.
type b64 []byte

func (b b64) MarshalJSON() ([]byte, error) {
	return json.Marshal(base64.RawURLEncoding.EncodeToString(b))
}

func (b *b64) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	d, err := base64.RawURLEncoding.Strict().DecodeString(s)
	*b = d
	return err
}

type wrapCase struct {
	Name                string `json:"name"`
	Seed                b64    `json:"seed"`
	RecipientPrivateKey b64    `json:"recipientPrivateKey"`
	RecipientPublicKey  b64    `json:"recipientPublicKey"`
	SenderPrivateKey    b64    `json:"senderPrivateKey"`
	SenderPublicKey     b64    `json:"senderPublicKey"`
	Info                string `json:"info"`
	AAD                 b64    `json:"aad"`
	Plaintext           b64    `json:"plaintext"`
	Enc                 b64    `json:"enc"`
	Ciphertext          b64    `json:"ciphertext"`
	Tag                 b64    `json:"tag"`
}

type aesGCMCase struct {
	Name      string `json:"name"`
	Seed      b64    `json:"seed"`
	Key       b64    `json:"key"`
	AAD       b64    `json:"aad"`
	Plaintext b64    `json:"plaintext"`
	Sealed    b64    `json:"sealed"`
}

type hmacCase struct {
	Name    string `json:"name"`
	Secret  b64    `json:"secret"`
	Message b64    `json:"message"`
	MAC     b64    `json:"mac"`
}

type equalCase struct {
	A     b64  `json:"a"`
	B     b64  `json:"b"`
	Equal bool `json:"equal"`
}

type base32Case struct {
	Bytes b64    `json:"bytes"`
	Text  string `json:"text"`
}

// A link's pairing: both proofs from the secret of the link code.
type pairingCase struct {
	Name             string `json:"name"`
	Seed             b64    `json:"seed"`
	Code             string `json:"code"`
	ShortID          string `json:"shortId"`
	Secret           b64    `json:"secret"`
	RunnerPrivateKey b64    `json:"runnerPrivateKey"`
	RunnerPublicKey  b64    `json:"runnerPublicKey"`
	DevicePublicKey  b64    `json:"devicePublicKey"`
	RunnerProof      b64    `json:"runnerProof"`
	DeviceProof      b64    `json:"deviceProof"`
}

// A vault key as an Appareil holds it (its wrap for itself), and items under it.
type vaultCase struct {
	Seed             b64    `json:"seed"`
	DeviceID         string `json:"deviceId"`
	VaultKeyVersion  int    `json:"vaultKeyVersion"`
	DevicePrivateKey b64    `json:"devicePrivateKey"`
	DevicePublicKey  b64    `json:"devicePublicKey"`
	VaultKey         b64    `json:"vaultKey"`
	Wrap             struct {
		Enc        b64 `json:"enc"`
		Ciphertext b64 `json:"ciphertext"`
		Tag        b64 `json:"tag"`
	} `json:"wrap"`
}

type itemCase struct {
	Name       string `json:"name"`
	Seed       b64    `json:"seed"`
	AAD        b64    `json:"aad"`
	Plaintext  b64    `json:"plaintext"`
	Key        b64    `json:"key"`
	Ciphertext b64    `json:"ciphertext"`
}

type (
	pairingVectors struct {
		Description string        `json:"description"`
		Cases       []pairingCase `json:"cases"`
	}
	itemVectors struct {
		Description string     `json:"description"`
		Vault       vaultCase  `json:"vault"`
		Items       []itemCase `json:"items"`
	}
	wrapVectors struct {
		Description string     `json:"description"`
		Cases       []wrapCase `json:"cases"`
	}
	aesGCMVectors struct {
		Description string       `json:"description"`
		Cases       []aesGCMCase `json:"cases"`
	}
	hmacVectors struct {
		Description       string      `json:"description"`
		HMAC              []hmacCase  `json:"hmac"`
		ConstantTimeEqual []equalCase `json:"constantTimeEqual"`
	}
	base32Vectors struct {
		Description string       `json:"description"`
		Encode      []base32Case `json:"encode"`
		Decode      []base32Case `json:"decode"`
		Invalid     []string     `json:"invalid"`
	}
)

const seededBy = " Byte strings are base64url without padding. Every random byte (keys, ephemeral keys, nonces) comes from the deterministic stream of the case's seed, see docs/security/e2e.md « Test vectors »."

// drawFrom runs fn with every random byte drawn from the seed's stream.
func drawFrom(seed string, fn func()) {
	previous := random
	random = &deterministicStream{seed: []byte(seed)}
	defer func() { random = previous }()
	fn()
}

func must[T any](v T, err error) T {
	if err != nil {
		panic(err)
	}
	return v
}

func privateKeyOf(raw []byte) *ecdh.PrivateKey {
	return must(ecdh.X25519().NewPrivateKey(raw))
}

func generateWrapVectors() wrapVectors {
	v := wrapVectors{Description: "Crewdeck's HPKE wraps (base mode, DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-256-GCM) with the tag of their sender (docs/security/e2e.md « Authenticated wraps »), generated by the Runner." + seededBy}
	// A wrap's plaintext is an AES-256 key; two cases test the edges.
	const aKey = "<a random AES-256 key>"
	for _, c := range []struct{ name, info, aad, plaintext string }{
		{"vault-wrap", InfoVaultWrap, "dev_01J9ZQ3M:1", aKey},
		{"item-key", InfoItemKey, "idea_01J9ZQ4C:text", aKey},
		{"session-key", InfoSessionKey, "ses_01J9ZQ5X:dev_01J9ZQ3M", aKey},
		{"empty-plaintext", InfoItemKey, "idea_01J9ZQ4C:analysis", ""},
		{"long-plaintext", InfoSessionKey, "ses_01J9ZQ5X:runner", "Une Idée confidentielle : le client, la stratégie et le produit pas encore annoncé."},
		{"self-wrap", InfoVaultWrap, "dev_01J9ZQ3M:2", aKey},
	} {
		w := wrapCase{Name: c.name, Seed: b64("crewdeck-wrap/" + c.name), Info: c.info, AAD: b64(c.aad), Plaintext: b64(c.plaintext)}
		drawFrom(string(w.Seed)+"/recipient", func() {
			k := must(GenerateKeyPair())
			w.RecipientPrivateKey, w.RecipientPublicKey = k.Bytes(), PublicKeyBytes(k)
			if c.plaintext == aKey {
				w.Plaintext = must(GenerateAESKey())
			}
		})
		sender := privateKeyOf(w.RecipientPrivateKey)
		if c.name != "self-wrap" {
			drawFrom(string(w.Seed)+"/sender", func() { sender = must(GenerateKeyPair()) })
		}
		w.SenderPrivateKey, w.SenderPublicKey = sender.Bytes(), PublicKeyBytes(sender)
		drawFrom(string(w.Seed), func() {
			sealed := must(SealWrap(sender, w.RecipientPublicKey, w.Plaintext, []byte(w.Info), w.AAD))
			w.Enc, w.Ciphertext, w.Tag = sealed.Enc, sealed.Ciphertext, sealed.Tag
		})
		v.Cases = append(v.Cases, w)
	}
	return v
}

func generateAESGCMVectors() aesGCMVectors {
	v := aesGCMVectors{Description: "Crewdeck's AES-256-GCM seals, nonce ‖ ciphertext ‖ tag, generated by the Runner." + seededBy}
	for _, c := range []struct{ name, aad, plaintext string }{
		{"session-message", "ses_01J9ZQ5X:7", `{"type":"message","text":"Corrige le test de connexion"}`},
		{"session-input", "ses_01J9ZQ5X:input:in_01J9ZQ6A", `{"type":"message","text":"oui"}`},
		{"item", "idea_01J9ZQ4C:text", "Une Idée : noter à la voix depuis le téléphone."},
		{"empty-plaintext", "idea_01J9ZQ4C:reason", ""},
	} {
		a := aesGCMCase{Name: c.name, Seed: b64("crewdeck-aes-gcm/" + c.name), AAD: b64(c.aad), Plaintext: b64(c.plaintext)}
		drawFrom(string(a.Seed), func() {
			a.Key = must(GenerateAESKey())
			a.Sealed = must(AESGCMSeal(a.Key, a.Plaintext, a.AAD))
		})
		v.Cases = append(v.Cases, a)
	}
	return v
}

func generateHMACVectors() hmacVectors {
	v := hmacVectors{Description: "HMAC-SHA256 (the pairing proofs) and the constant-time comparison." + seededBy}
	v.HMAC = append(v.HMAC, hmacCase{Name: "rfc4231-case-2", Secret: b64("Jefe"), Message: b64("what do ya want for nothing?")})
	drawFrom("crewdeck-hmac/link-proof", func() {
		secret := must(randomBytes(16))
		runner, device := must(randomBytes(32)), must(randomBytes(32))
		msg := append(append(append([]byte("crewdeck/v1/link/runner"), "7KQ4"...), runner...), device...)
		v.HMAC = append(v.HMAC, hmacCase{Name: "link-proof-shaped", Secret: secret, Message: msg})
	})
	v.HMAC = append(v.HMAC, hmacCase{Name: "empty-message", Secret: b64("crewdeck-secret-16"), Message: b64("")})
	for i := range v.HMAC {
		v.HMAC[i].MAC = HMACSHA256(v.HMAC[i].Secret, v.HMAC[i].Message)
	}
	mac := v.HMAC[1].MAC
	flipped := flipBit(mac, len(mac)-1)
	for _, c := range []equalCase{
		{A: mac, B: append([]byte(nil), mac...)},
		{A: mac, B: flipped},
		{A: mac, B: mac[:31]},
		{A: b64{}, B: b64{}},
		{A: b64{}, B: b64{0}},
	} {
		c.Equal = ConstantTimeEqual(c.A, c.B)
		v.ConstantTimeEqual = append(v.ConstantTimeEqual, c)
	}
	return v
}

func generateBase32Vectors() base32Vectors {
	v := base32Vectors{Description: "Crockford base32: no padding, upper case out; either case, I and L as 1, O as 0 in. Bytes are base64url without padding."}
	inputs := []b64{{}, {0x00}, {0xff}, {0x01, 0x02}, b64("crewdeck"), bytes.Repeat([]byte{0xff}, 16)}
	drawFrom("crewdeck-base32/secret", func() { inputs = append(inputs, must(randomBytes(16)), must(randomBytes(5))) })
	for _, b := range inputs {
		v.Encode = append(v.Encode, base32Case{Bytes: b, Text: EncodeBase32(b)})
	}
	for _, text := range []string{"o1ag", "OIAG", "0lag", "0LAG", "0iAg", "zzzzzzzzzzzzzzzzzzzzzzzzzw"} {
		v.Decode = append(v.Decode, base32Case{Bytes: must(DecodeBase32(text)), Text: text})
	}
	v.Invalid = []string{"U0", "0u", "AB-CD", "AB=", "A", "ABC", "ABCDEF", "01", "0Z", " 0G", "é0", "ß0", "ﬀ0"}
	for _, s := range v.Invalid {
		if _, err := DecodeBase32(s); err == nil {
			panic("invalid base32 decodes: " + s)
		}
	}
	return v
}

func generatePairingVectors() pairingVectors {
	v := pairingVectors{Description: "The link's pairing proofs (docs/security/e2e.md « First Appareil (E2E-2) »): HMAC-SHA256(secret, label ‖ shortId ‖ own public key ‖ peer's public key), generated by the Runner." + seededBy}
	for _, name := range []string{"first-appareil", "relink"} {
		c := pairingCase{Name: name, Seed: b64("crewdeck-pairing/" + name)}
		drawFrom(string(c.Seed), func() {
			c.Secret = must(randomBytes(16))
			runner := must(GenerateKeyPair())
			c.RunnerPrivateKey, c.RunnerPublicKey = runner.Bytes(), PublicKeyBytes(runner)
			c.DevicePublicKey = PublicKeyBytes(must(GenerateKeyPair()))
			c.ShortID = EncodeBase32(must(randomBytes(3)))[:4]
		})
		c.Code = c.ShortID + "-" + EncodeBase32(c.Secret)
		c.RunnerProof = PairingProof(ProofLabelRunner, c.Secret, c.ShortID, c.RunnerPublicKey, c.DevicePublicKey)
		c.DeviceProof = PairingProof(ProofLabelDevice, c.Secret, c.ShortID, c.DevicePublicKey, c.RunnerPublicKey)
		v.Cases = append(v.Cases, c)
	}
	return v
}

func generateItemVectors() itemVectors {
	v := itemVectors{Description: "Items under the vault key (docs/security/e2e.md « First Appareil (E2E-2) »): the vault key as an Appareil holds it, its wrap for itself, and items sealed by the Runner's Vault.SealItem." + seededBy}
	vault := vaultCase{Seed: b64("crewdeck-item/vault"), DeviceID: "dev_01J9ZQ3M", VaultKeyVersion: 1}
	drawFrom(string(vault.Seed), func() {
		device := must(GenerateKeyPair())
		vault.DevicePrivateKey, vault.DevicePublicKey = device.Bytes(), PublicKeyBytes(device)
		vault.VaultKey = must(GenerateAESKey())
		w := must(SealWrap(device, vault.DevicePublicKey, vault.VaultKey, []byte(InfoVaultWrap), VaultWrapAAD(vault.DeviceID, vault.VaultKeyVersion)))
		vault.Wrap.Enc, vault.Wrap.Ciphertext, vault.Wrap.Tag = w.Enc, w.Ciphertext, w.Tag
	})
	v.Vault = vault
	opened := &Vault{key: vault.VaultKey, Version: vault.VaultKeyVersion}
	for _, c := range []struct{ name, aad, plaintext string }{
		{"idea-text", "idea_01J9ZQ4C:text", "Une Idée : noter à la voix depuis le téléphone."},
		{"empty-plaintext", "idea_01J9ZQ4C:reason", ""},
	} {
		item := itemCase{Name: c.name, Seed: b64("crewdeck-item/" + c.name), AAD: b64(c.aad), Plaintext: b64(c.plaintext)}
		drawFrom(string(item.Seed), func() {
			sealed := must(opened.SealItem(item.Plaintext, item.AAD))
			item.Key, item.Ciphertext = sealed.Key, sealed.Ciphertext
		})
		v.Items = append(v.Items, item)
	}
	return v
}

func TestGenerateVectors(t *testing.T) {
	for name, v := range map[string]any{
		"crewdeck-wrap.json": generateWrapVectors(),
		"aes-gcm.json":       generateAESGCMVectors(),
		"hmac.json":          generateHMACVectors(),
		"base32.json":        generateBase32Vectors(),
		"link-pairing.json":  generatePairingVectors(),
		"item.json":          generateItemVectors(),
	} {
		data, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		data = append(data, '\n')
		path := filepath.Join(vectorsDir, name)
		if *update {
			if err := os.WriteFile(path, data, 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		committed, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if !bytes.Equal(committed, data) {
			t.Errorf("%s differs from what the Runner generates: go test ./internal/keys -run TestGenerateVectors -update", name)
		}
	}
}
