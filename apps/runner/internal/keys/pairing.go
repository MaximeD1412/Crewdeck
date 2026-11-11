package keys

import "strconv"

// The labels of the link's pairing proofs, one per direction
// (docs/security/e2e.md, « Pairing proofs »).
const (
	ProofLabelRunner = "crewdeck/v1/link/runner"
	ProofLabelDevice = "crewdeck/v1/link/device"
)

// PairingProof is HMAC-SHA256(secret, label ‖ shortId ‖ own public key ‖
// peer's public key): the Runner's with ProofLabelRunner and its key first,
// the Appareil's with ProofLabelDevice and its key first.
func PairingProof(label string, secret []byte, shortID string, own, peer []byte) []byte {
	message := append([]byte(label), shortID...)
	message = append(message, own...)
	message = append(message, peer...)
	return HMACSHA256(secret, message)
}

// VerifyPairingProof checks proof in constant time.
func VerifyPairingProof(proof []byte, label string, secret []byte, shortID string, own, peer []byte) bool {
	return ConstantTimeEqual(proof, PairingProof(label, secret, shortID, own, peer))
}

// VaultWrapAAD is the additional data of a holder's wrap of the vault key:
// "<holderId>:<vaultKeyVersion>".
func VaultWrapAAD(holderID string, version int) []byte {
	return []byte(holderID + ":" + strconv.Itoa(version))
}
