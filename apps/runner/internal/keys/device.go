package keys

import "crypto/ecdh"

// The labels of a new Appareil's proofs (docs/security/e2e.md, « New
// Appareil »): the new page's over its public key, the approver's over both.
const (
	ProofLabelNewDevice     = "crewdeck/v1/device/new"
	ProofLabelApproveDevice = "crewdeck/v1/device/approve"
)

// NewDeviceProof is HMAC-SHA256(secret, "crewdeck/v1/device/new" ‖
// newPublicKey): the new page's, which tells the approver the key the server
// relayed is the page's.
func NewDeviceProof(secret, newPublicKey []byte) []byte {
	return HMACSHA256(secret, append([]byte(ProofLabelNewDevice), newPublicKey...))
}

// VerifyNewDeviceProof checks proof in constant time.
func VerifyNewDeviceProof(proof, secret, newPublicKey []byte) bool {
	return ConstantTimeEqual(proof, NewDeviceProof(secret, newPublicKey))
}

// ApproveDeviceProof is HMAC-SHA256(secret, "crewdeck/v1/device/approve" ‖
// newPublicKey ‖ approverPublicKey): the approver's, which tells the new page
// the key its wrap was sealed with is the approver's.
func ApproveDeviceProof(secret, newPublicKey, approverPublicKey []byte) []byte {
	message := append([]byte(ProofLabelApproveDevice), newPublicKey...)
	return HMACSHA256(secret, append(message, approverPublicKey...))
}

// WrapFor wraps the vault key for the holder holderID of recipientPublicKey,
// as sender, with the additional data "<holderID>:<version>".
func (v *Vault) WrapFor(sender *ecdh.PrivateKey, recipientPublicKey []byte, holderID string) (Wrap, error) {
	return SealWrap(sender, recipientPublicKey, v.key, []byte(InfoVaultWrap), VaultWrapAAD(holderID, v.Version))
}
