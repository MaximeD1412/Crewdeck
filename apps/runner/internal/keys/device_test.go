package keys

import (
	"bytes"
	"encoding/base64"
	"testing"
)

// The proofs' exact bytes, as docs/security/e2e.md « New Appareil » gives
// them and the page computes them (apps/web/src/keys/approval.spec.ts): secret
// 0x00‥0x0f, new public key 32 × 0x11, approver public key 32 × 0x22.
func TestNewDeviceProofsMatchTheirVectors(t *testing.T) {
	secret := make([]byte, 16)
	for i := range secret {
		secret[i] = byte(i)
	}
	newKey, approverKey := bytes.Repeat([]byte{0x11}, 32), bytes.Repeat([]byte{0x22}, 32)
	b64 := base64.RawURLEncoding.EncodeToString
	if got := b64(NewDeviceProof(secret, newKey)); got != "NULG3lc4ksC0AGvvSApBzn65aDVMCw9mpjhkRngplZE" {
		t.Errorf("proof_N %s", got)
	}
	if got := b64(ApproveDeviceProof(secret, newKey, approverKey)); got != "txJX8MrtUMCD9-qgPpWAKf61I4PBvdBhEq27LOMt5mE" {
		t.Errorf("proof_A %s", got)
	}
	if !VerifyNewDeviceProof(NewDeviceProof(secret, newKey), secret, newKey) {
		t.Error("proof_N does not verify")
	}
	// The server swapped the new public key, or does not know the secret.
	if VerifyNewDeviceProof(NewDeviceProof(secret, newKey), secret, approverKey) {
		t.Error("proof_N verifies for another key")
	}
	if VerifyNewDeviceProof(NewDeviceProof(secret, newKey), make([]byte, 16), newKey) {
		t.Error("proof_N verifies for another secret")
	}
}

// The Runner wraps its vault key for a new Appareil, which opens it from the
// Runner's public key only, for its own id and the vault's version.
func TestAVaultWrapsItsKeyForANewHolder(t *testing.T) {
	_, device, w, vaultKey, unlock := sealedVault(t)
	vault, err := unlock(device, "run_1", 1, w)
	if err != nil {
		t.Fatal(err)
	}
	runner := must(GenerateKeyPair())
	phone := must(GenerateKeyPair())
	wrap, err := vault.WrapFor(runner, PublicKeyBytes(phone), "dev_2")
	if err != nil {
		t.Fatal(err)
	}
	got, err := OpenWrap(phone, PublicKeyBytes(runner), wrap, []byte(InfoVaultWrap), VaultWrapAAD("dev_2", 1))
	if err != nil || !bytes.Equal(got, vaultKey) {
		t.Fatalf("the new holder opens %x (%v)", got, err)
	}
	if _, err := OpenWrap(phone, PublicKeyBytes(runner), wrap, []byte(InfoVaultWrap), VaultWrapAAD("dev_3", 1)); err == nil {
		t.Error("the wrap opens for another holder")
	}
	if _, err := OpenWrap(phone, device, wrap, []byte(InfoVaultWrap), VaultWrapAAD("dev_2", 1)); err == nil {
		t.Error("the wrap opens from another sender")
	}
}
