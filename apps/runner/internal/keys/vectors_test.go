package keys

import (
	"bytes"
	"crypto/ecdh"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The vectors are shared with the browser (apps/web/src/keys/crypto.spec.ts).
var vectorsDir = filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "crypto")

func readVectors(t *testing.T, name string, into any) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(vectorsDir, name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	if err := json.Unmarshal(data, into); err != nil {
		t.Fatalf("decode %s: %v", name, err)
	}
}

type rfcVector struct {
	Mode   int    `json:"mode"`
	KemID  int    `json:"kem_id"`
	KdfID  int    `json:"kdf_id"`
	AeadID int    `json:"aead_id"`
	Info   hexB   `json:"info"`
	SkRm   hexB   `json:"skRm"`
	PkRm   hexB   `json:"pkRm"`
	SkEm   hexB   `json:"skEm"`
	Enc    hexB   `json:"enc"`
	Aad    hexB   `json:"aad"`
	Pt     hexB   `json:"pt"`
	Ct     hexB   `json:"ct"`
	Source string `json:"source"`
}

type hexB []byte

func (h *hexB) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	b, err := hex.DecodeString(s)
	*h = b
	return err
}

func rfc9180(t *testing.T) rfcVector {
	t.Helper()
	var v rfcVector
	readVectors(t, "hpke-rfc9180.json", &v)
	if v.Mode != 0 || v.KemID != 0x20 || v.KdfID != 1 || v.AeadID != 2 {
		t.Fatalf("hpke-rfc9180.json is not the suite Crewdeck uses: %+v", v)
	}
	return v
}

func privateKey(t *testing.T, raw []byte) *ecdh.PrivateKey {
	t.Helper()
	k, err := ecdh.X25519().NewPrivateKey(raw)
	if err != nil {
		t.Fatalf("private key: %v", err)
	}
	return k
}

func TestRFC9180VectorOpens(t *testing.T) {
	v := rfc9180(t)
	pt, err := HPKEOpen(privateKey(t, v.SkRm), v.Enc, v.Ct, v.Info, v.Aad)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if !bytes.Equal(pt, v.Pt) {
		t.Fatalf("plaintext %x, want %x", pt, v.Pt)
	}
}

func TestRFC9180VectorResealsIdenticallyWithItsEphemeralKey(t *testing.T) {
	v := rfc9180(t)
	withFixedRandom(t, v.SkEm)
	enc, ct, err := HPKESeal(v.PkRm, v.Pt, v.Info, v.Aad)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if !bytes.Equal(enc, v.Enc) || !bytes.Equal(ct, v.Ct) {
		t.Fatalf("sealed enc %x ct %x, want enc %x ct %x", enc, ct, v.Enc, v.Ct)
	}
}

func openWrapCase(t *testing.T, c wrapCase) {
	t.Helper()
	k := privateKey(t, c.RecipientPrivateKey)
	if !bytes.Equal(PublicKeyBytes(k), c.RecipientPublicKey) {
		t.Fatalf("%s: the public key does not match the private key", c.Name)
	}
	pt, err := HPKEOpen(k, c.Enc, c.Ciphertext, []byte(c.Info), c.AAD)
	if err != nil || !bytes.Equal(pt, c.Plaintext) {
		t.Fatalf("%s: open gives %x, %v; want %x", c.Name, pt, err, c.Plaintext)
	}
	if _, err := HPKEOpen(k, c.Enc, flipBit(c.Ciphertext, len(c.Ciphertext)/2), []byte(c.Info), c.AAD); err == nil {
		t.Fatalf("%s: a flipped bit opens", c.Name)
	}
	if _, err := HPKEOpen(k, c.Enc, c.Ciphertext, []byte(c.Info), append(append([]byte(nil), c.AAD...), '!')); err == nil {
		t.Fatalf("%s: another additional data opens", c.Name)
	}
}

func openAESGCMCase(t *testing.T, c aesGCMCase) {
	t.Helper()
	pt, err := AESGCMOpen(c.Key, c.Sealed, c.AAD)
	if err != nil || !bytes.Equal(pt, c.Plaintext) {
		t.Fatalf("%s: open gives %x, %v; want %x", c.Name, pt, err, c.Plaintext)
	}
	if _, err := AESGCMOpen(c.Key, flipBit(c.Sealed, len(c.Sealed)/2), c.AAD); err == nil {
		t.Fatalf("%s: a flipped bit opens", c.Name)
	}
	if _, err := AESGCMOpen(c.Key, c.Sealed, append(append([]byte(nil), c.AAD...), '!')); err == nil {
		t.Fatalf("%s: another additional data opens", c.Name)
	}
}

func TestCrewdeckWrapVectorsOpen(t *testing.T) {
	var v wrapVectors
	readVectors(t, "crewdeck-wrap.json", &v)
	for _, c := range v.Cases {
		openWrapCase(t, c)
	}
}

func TestAESGCMVectorsOpen(t *testing.T) {
	var v aesGCMVectors
	readVectors(t, "aes-gcm.json", &v)
	for _, c := range v.Cases {
		openAESGCMCase(t, c)
	}
}

func TestHMACVectorsMatch(t *testing.T) {
	var v hmacVectors
	readVectors(t, "hmac.json", &v)
	for _, c := range v.HMAC {
		if mac := HMACSHA256(c.Secret, c.Message); !bytes.Equal(mac, c.MAC) {
			t.Fatalf("%s: mac %x, want %x", c.Name, mac, c.MAC)
		}
	}
	for i, c := range v.ConstantTimeEqual {
		if ConstantTimeEqual(c.A, c.B) != c.Equal {
			t.Fatalf("case %d: ConstantTimeEqual(%x, %x) != %v", i, c.A, c.B, c.Equal)
		}
	}
}

func TestBase32VectorsMatch(t *testing.T) {
	var v base32Vectors
	readVectors(t, "base32.json", &v)
	for _, c := range v.Encode {
		if s := EncodeBase32(c.Bytes); s != c.Text {
			t.Fatalf("%x encodes to %q, want %q", c.Bytes, s, c.Text)
		}
	}
	for _, c := range append(v.Encode, v.Decode...) {
		if b, err := DecodeBase32(c.Text); err != nil || !bytes.Equal(b, c.Bytes) {
			t.Fatalf("%q decodes to %x, %v; want %x", c.Text, b, err, c.Bytes)
		}
	}
	for _, s := range v.Invalid {
		if _, err := DecodeBase32(s); err == nil {
			t.Fatalf("%q decodes", s)
		}
	}
}

// web-seal.json is written by the browser's test run (crypto.spec.ts): what
// WebCrypto sealed opens here.
func TestWhatTheBrowserSealedOpens(t *testing.T) {
	var v struct {
		Wrap   wrapCase   `json:"wrap"`
		AESGCM aesGCMCase `json:"aesGcm"`
	}
	readVectors(t, "web-seal.json", &v)
	openWrapCase(t, v.Wrap)
	openAESGCMCase(t, v.AESGCM)
}
