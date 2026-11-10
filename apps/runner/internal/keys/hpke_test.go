package keys

import (
	"bytes"
	"crypto/hpke"
	"errors"
	"testing"
)

var (
	wrapInfo = []byte(InfoVaultWrap)
	wrapAAD  = []byte("device_01J9:1")
)

func TestHPKERoundTrip(t *testing.T) {
	recipient, err := GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	enc, ct, err := HPKESeal(PublicKeyBytes(recipient), []byte("vault key"), wrapInfo, wrapAAD)
	if err != nil {
		t.Fatal(err)
	}
	if len(enc) != 32 || len(ct) != len("vault key")+16 {
		t.Fatalf("enc %d bytes, ciphertext %d bytes", len(enc), len(ct))
	}
	pt, err := HPKEOpen(recipient, enc, ct, wrapInfo, wrapAAD)
	if err != nil || string(pt) != "vault key" {
		t.Fatalf("open: %q, %v", pt, err)
	}
}

func TestHPKEDrawsANewEphemeralKeyPerSeal(t *testing.T) {
	recipient, _ := GenerateKeyPair()
	enc1, ct1, _ := HPKESeal(PublicKeyBytes(recipient), []byte("same"), wrapInfo, wrapAAD)
	enc2, ct2, _ := HPKESeal(PublicKeyBytes(recipient), []byte("same"), wrapInfo, wrapAAD)
	if bytes.Equal(enc1, enc2) || bytes.Equal(ct1, ct2) {
		t.Fatal("two seals share their ephemeral key")
	}
}

// The standard library's crypto/hpke is an independent implementation of the
// same suite: each side opens what the other seals.
func TestHPKEAgreesWithTheStandardLibrary(t *testing.T) {
	recipient, _ := GenerateKeyPair()
	pub, err := hpke.NewDHKEMPublicKey(recipient.PublicKey())
	if err != nil {
		t.Fatal(err)
	}
	priv, err := hpke.NewDHKEMPrivateKey(recipient)
	if err != nil {
		t.Fatal(err)
	}

	enc, sender, err := hpke.NewSender(pub, hpke.HKDFSHA256(), hpke.AES256GCM(), wrapInfo)
	if err != nil {
		t.Fatal(err)
	}
	ct, _ := sender.Seal(wrapAAD, []byte("from crypto/hpke"))
	pt, err := HPKEOpen(recipient, enc, ct, wrapInfo, wrapAAD)
	if err != nil || string(pt) != "from crypto/hpke" {
		t.Fatalf("open what crypto/hpke sealed: %q, %v", pt, err)
	}

	enc, ct, _ = HPKESeal(PublicKeyBytes(recipient), []byte("from keys"), wrapInfo, wrapAAD)
	r, err := hpke.NewRecipient(enc, priv, hpke.HKDFSHA256(), hpke.AES256GCM(), wrapInfo)
	if err != nil {
		t.Fatal(err)
	}
	pt, err = r.Open(wrapAAD, ct)
	if err != nil || string(pt) != "from keys" {
		t.Fatalf("crypto/hpke opens our seal: %q, %v", pt, err)
	}
}

func TestHPKEOpenFailsOnTampering(t *testing.T) {
	recipient, _ := GenerateKeyPair()
	other, _ := GenerateKeyPair()
	enc, ct, _ := HPKESeal(PublicKeyBytes(recipient), []byte("vault key"), wrapInfo, wrapAAD)

	cases := map[string]func() ([]byte, error){
		"a flipped bit of the ciphertext": func() ([]byte, error) {
			return HPKEOpen(recipient, enc, flipBit(ct, 3), wrapInfo, wrapAAD)
		},
		"a flipped bit of the tag": func() ([]byte, error) {
			return HPKEOpen(recipient, enc, flipBit(ct, len(ct)-1), wrapInfo, wrapAAD)
		},
		"a flipped bit of enc": func() ([]byte, error) {
			return HPKEOpen(recipient, flipBit(enc, 0), ct, wrapInfo, wrapAAD)
		},
		"another additional data": func() ([]byte, error) {
			return HPKEOpen(recipient, enc, ct, wrapInfo, []byte("device_01J9:2"))
		},
		"another info": func() ([]byte, error) {
			return HPKEOpen(recipient, enc, ct, []byte(InfoSessionKey), wrapAAD)
		},
		"another recipient": func() ([]byte, error) {
			return HPKEOpen(other, enc, ct, wrapInfo, wrapAAD)
		},
	}
	for name, open := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := open(); !errors.Is(err, ErrOpen) {
				t.Fatalf("got %v, want ErrOpen", err)
			}
		})
	}
}

func TestHPKERefusesAnEmptyAdditionalData(t *testing.T) {
	recipient, _ := GenerateKeyPair()
	if _, _, err := HPKESeal(PublicKeyBytes(recipient), []byte("x"), wrapInfo, nil); !errors.Is(err, ErrNoAdditionalData) {
		t.Fatalf("seal: %v", err)
	}
	if _, err := HPKEOpen(recipient, make([]byte, 32), make([]byte, 17), wrapInfo, nil); !errors.Is(err, ErrNoAdditionalData) {
		t.Fatalf("open: %v", err)
	}
}

func TestHPKERefusesALowOrderPublicKey(t *testing.T) {
	// The all-zero point makes the X25519 output all zero (RFC 9180, 7.1.4).
	if _, _, err := HPKESeal(make([]byte, 32), []byte("x"), wrapInfo, wrapAAD); err == nil {
		t.Fatal("sealed for a low-order key")
	}
}

func flipBit(b []byte, at int) []byte {
	c := append([]byte(nil), b...)
	c[at] ^= 0x01
	return c
}
