package state

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestTheRunnerKeyIsReadableByThePiloteOnly(t *testing.T) {
	store := Store{Dir: filepath.Join(t.TempDir(), ".crewdeck")}
	key := bytes.Repeat([]byte{7}, 32)

	if err := store.SaveRunnerKey(key); err != nil {
		t.Fatalf("save: %v", err)
	}

	assertMode(t, store.Dir, 0o700)
	assertMode(t, filepath.Join(store.Dir, RunnerKeyFile), 0o600)
	got, err := store.LoadRunnerKey()
	if err != nil || !bytes.Equal(got, key) {
		t.Fatalf("loaded %x, %v", got, err)
	}
}

func TestTheVaultWrapHoldsTheWrapReadableByThePiloteOnly(t *testing.T) {
	store := Store{Dir: t.TempDir()}
	want := VaultWrap{
		RunnerID:        "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6aff",
		VaultKeyVersion: 1,
		DevicePublicKey: bytes.Repeat([]byte{1}, 32),
		Enc:             bytes.Repeat([]byte{2}, 32),
		Ciphertext:      bytes.Repeat([]byte{3}, 48),
		Tag:             bytes.Repeat([]byte{4}, 32),
	}

	if err := store.SaveVaultWrap(want); err != nil {
		t.Fatalf("save: %v", err)
	}

	assertMode(t, filepath.Join(store.Dir, VaultWrapFile), 0o600)
	got, err := store.LoadVaultWrap()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got.RunnerID != want.RunnerID || got.VaultKeyVersion != 1 || !bytes.Equal(got.DevicePublicKey, want.DevicePublicKey) ||
		!bytes.Equal(got.Enc, want.Enc) || !bytes.Equal(got.Ciphertext, want.Ciphertext) || !bytes.Equal(got.Tag, want.Tag) {
		t.Fatalf("loaded %+v, want %+v", got, want)
	}
}

func TestTheKeysOfARunnerNeverLinkedAreMissing(t *testing.T) {
	store := Store{Dir: t.TempDir()}
	if _, err := store.LoadRunnerKey(); !errors.Is(err, ErrNotLinked) {
		t.Errorf("runner key: %v", err)
	}
	if _, err := store.LoadVaultWrap(); !errors.Is(err, ErrNotLinked) {
		t.Errorf("vault wrap: %v", err)
	}
	if err := os.WriteFile(filepath.Join(store.Dir, RunnerKeyFile), []byte("short\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.LoadRunnerKey(); err == nil || errors.Is(err, ErrNotLinked) {
		t.Errorf("a runner key of the wrong length loads: %v", err)
	}
}
