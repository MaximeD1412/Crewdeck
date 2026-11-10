package keys

import (
	"bytes"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
)

var itemAAD = []byte("idea_01J9:text")

func TestAESGCMRoundTripWithItsNonceInFront(t *testing.T) {
	key, err := GenerateAESKey()
	if err != nil || len(key) != 32 {
		t.Fatalf("key %d bytes, %v", len(key), err)
	}
	sealed, err := AESGCMSeal(key, []byte("une idée"), itemAAD)
	if err != nil {
		t.Fatal(err)
	}
	if len(sealed) != 12+len("une idée")+16 {
		t.Fatalf("sealed is %d bytes", len(sealed))
	}
	pt, err := AESGCMOpen(key, sealed, itemAAD)
	if err != nil || string(pt) != "une idée" {
		t.Fatalf("open: %q, %v", pt, err)
	}
	again, _ := AESGCMSeal(key, []byte("une idée"), itemAAD)
	if bytes.Equal(sealed[:12], again[:12]) {
		t.Fatal("two seals share their nonce")
	}
}

func TestAESGCMOpenFailsOnTampering(t *testing.T) {
	key, _ := GenerateAESKey()
	otherKey, _ := GenerateAESKey()
	sealed, _ := AESGCMSeal(key, []byte("une idée"), itemAAD)
	cases := map[string]func() ([]byte, error){
		"a flipped bit of the nonce":      func() ([]byte, error) { return AESGCMOpen(key, flipBit(sealed, 0), itemAAD) },
		"a flipped bit of the ciphertext": func() ([]byte, error) { return AESGCMOpen(key, flipBit(sealed, 14), itemAAD) },
		"a flipped bit of the tag":        func() ([]byte, error) { return AESGCMOpen(key, flipBit(sealed, len(sealed)-1), itemAAD) },
		"another additional data":         func() ([]byte, error) { return AESGCMOpen(key, sealed, []byte("idea_01J9:analysis")) },
		"another key":                     func() ([]byte, error) { return AESGCMOpen(otherKey, sealed, itemAAD) },
		"a truncated input":               func() ([]byte, error) { return AESGCMOpen(key, sealed[:27], itemAAD) },
	}
	for name, open := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := open(); !errors.Is(err, ErrOpen) {
				t.Fatalf("got %v, want ErrOpen", err)
			}
		})
	}
}

func TestAESGCMRefusesAnEmptyAdditionalDataAndAShortKey(t *testing.T) {
	key, _ := GenerateAESKey()
	if _, err := AESGCMSeal(key, []byte("x"), nil); !errors.Is(err, ErrNoAdditionalData) {
		t.Fatalf("seal without aad: %v", err)
	}
	if _, err := AESGCMOpen(key, make([]byte, 40), nil); !errors.Is(err, ErrNoAdditionalData) {
		t.Fatalf("open without aad: %v", err)
	}
	if _, err := AESGCMSeal(key[:16], []byte("x"), itemAAD); err == nil {
		t.Fatal("sealed with an AES-128 key")
	}
}

func TestHMACSHA256MatchesRFC4231(t *testing.T) {
	// RFC 4231, test case 2.
	mac := HMACSHA256([]byte("Jefe"), []byte("what do ya want for nothing?"))
	if hex.EncodeToString(mac) != "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843" {
		t.Fatalf("mac %x", mac)
	}
}

func TestConstantTimeEqual(t *testing.T) {
	if !ConstantTimeEqual([]byte("abc"), []byte("abc")) {
		t.Fatal("equal strings differ")
	}
	for _, b := range []string{"abd", "ab", "abcd", ""} {
		if ConstantTimeEqual([]byte("abc"), []byte(b)) {
			t.Fatalf("abc equals %q", b)
		}
	}
}

func TestBase32RoundTrips(t *testing.T) {
	for n := 0; n <= 40; n++ {
		b := make([]byte, n)
		for i := range b {
			b[i] = byte(i*37 + n)
		}
		s := EncodeBase32(b)
		if len(s) != (n*8+4)/5 || strings.ContainsAny(s, "ILOU=") {
			t.Fatalf("%d bytes encode to %q", n, s)
		}
		back, err := DecodeBase32(s)
		if err != nil || !bytes.Equal(back, b) {
			t.Fatalf("%q decodes to %x, %v", s, back, err)
		}
	}
}

func TestBase32EncodesA128BitSecretIn26Characters(t *testing.T) {
	if s := EncodeBase32(bytes.Repeat([]byte{0xff}, 16)); s != "ZZZZZZZZZZZZZZZZZZZZZZZZZW" {
		t.Fatalf("got %q", s)
	}
}

func TestBase32DecodesLowercaseAndTheCrockfordAliases(t *testing.T) {
	want, _ := DecodeBase32("01AG")
	for _, s := range []string{"o1ag", "OIag", "0lAG", "0LAG", "0iag"} {
		got, err := DecodeBase32(s)
		if err != nil || !bytes.Equal(got, want) {
			t.Fatalf("%q decodes to %x, %v; want %x", s, got, err, want)
		}
	}
}

func TestBase32RefusesWhatNoEncodingGives(t *testing.T) {
	for _, s := range []string{"U0", "0U", "AB-CD", "AB=", "A", "ABC", "ABCDEF", "01", "é0"} {
		if b, err := DecodeBase32(s); err == nil {
			t.Fatalf("%q decodes to %x", s, b)
		}
	}
}
