package relay_test

import (
	"bytes"
	cryptoecdh "crypto/ecdh"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/relay"
)

func TestAKeyIsWrappedForEachHolderUnderItsOwnAdditionalData(t *testing.T) {
	runner, _ := keys.GenerateKeyPair()
	first, _ := keys.GenerateKeyPair()
	second, _ := keys.GenerateKeyPair()
	k := &relay.Keys{Runner: runner, Holders: func() ([][]byte, error) {
		return [][]byte{keys.PublicKeyBytes(first), keys.PublicKeyBytes(second)}, nil
	}}
	key, _ := keys.GenerateAESKey()
	wraps, err := k.Wraps(key, func(holderID string) string { return "command:run:" + holderID })
	if err != nil || len(wraps) != 2 {
		t.Fatalf("wraps %v, %v", wraps, err)
	}
	for i, holder := range []*cryptoecdh.PrivateKey{first, second} {
		w := wraps[i]
		if w.HolderId != relay.B64.EncodeToString(keys.PublicKeyBytes(holder)) {
			t.Fatalf("holder %d named %s", i, w.HolderId)
		}
		wrap := keys.Wrap{Enc: decode(t, w.Enc), Ciphertext: decode(t, w.WrappedKey), Tag: decode(t, w.Tag)}
		opened, err := keys.OpenWrap(holder, keys.PublicKeyBytes(runner), wrap, []byte(keys.InfoSessionKey), []byte("command:run:"+w.HolderId))
		if err != nil || !bytes.Equal(opened, key) {
			t.Fatalf("holder %d opens %x, %v", i, opened, err)
		}
		if _, err := keys.OpenWrap(holder, keys.PublicKeyBytes(runner), wrap, []byte(keys.InfoSessionKey), []byte("session:run:"+w.HolderId)); err == nil {
			t.Fatal("a wrap opens under another additional data")
		}
	}
	none := &relay.Keys{Runner: runner, Holders: func() ([][]byte, error) { return nil, nil }}
	if _, err := none.Wraps(key, func(string) string { return "x" }); !errors.Is(err, relay.ErrNoHolder) {
		t.Fatalf("no holder: %v", err)
	}
}

func decode(t *testing.T, s string) []byte {
	t.Helper()
	b, err := relay.B64.Strict().DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestAFrameOpensOnlyUnderItsKeyAndAdditionalData(t *testing.T) {
	key, _ := keys.GenerateAESKey()
	nonce, ciphertext, err := relay.Seal(key, []byte(`{"text":"ok"}`), "command:run:1")
	if err != nil {
		t.Fatal(err)
	}
	if plain, err := relay.Open(key, nonce, ciphertext, "command:run:1"); err != nil || string(plain) != `{"text":"ok"}` {
		t.Fatalf("opened %q, %v", plain, err)
	}
	if _, err := relay.Open(key, nonce, ciphertext, "command:run:2"); err == nil {
		t.Fatal("a frame opens under another seq")
	}
	other, _ := keys.GenerateAESKey()
	if _, err := relay.Open(other, nonce, ciphertext, "command:run:1"); err == nil {
		t.Fatal("a frame opens under another key")
	}
	if _, err := relay.Open(key, "short", ciphertext, "command:run:1"); err == nil {
		t.Fatal("a frame opens with a bad nonce")
	}
}

func TestAKeyIsDrawnOnceAndKeptInAFileOfMode600(t *testing.T) {
	path := filepath.Join(t.TempDir(), "run.key")
	if _, err := relay.ReadKey(path); err == nil {
		t.Fatal("a key read before it was drawn")
	}
	key, err := relay.LoadOrCreateKey(path)
	if err != nil || len(key) != 32 {
		t.Fatalf("key %x, %v", key, err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("mode %v, %v", info.Mode(), err)
	}
	again, err := relay.LoadOrCreateKey(path)
	if err != nil || !bytes.Equal(again, key) {
		t.Fatal("the key was drawn again")
	}
	if read, err := relay.ReadKey(path); err != nil || !bytes.Equal(read, key) {
		t.Fatal("the key read is another")
	}
}
