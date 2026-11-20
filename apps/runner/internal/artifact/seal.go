package artifact

import (
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/relay"
)

// contentAAD is the additional data of an answer's content.
func contentAAD(requestID string) string { return "artifact:" + requestID }

// wrapAAD is the additional data of an answer's key wrapped for holderID.
func wrapAAD(requestID, holderID string) string { return "artifact:" + requestID + ":" + holderID }

// seal seals plain for the one holder holderID, which must be among the
// authenticated holders (E2E-2, never the server's word: relay.ErrUntrusted
// otherwise, nothing sealed): a random key wrapped for it as a Session key
// is, the content under it with AES-256-GCM.
func seal(k *relay.Keys, requestID, holderID string, plain []byte) (contracts.RunnerArtifactContentWrap, string, string, error) {
	if _, err := k.Trusted(holderID); err != nil {
		return contracts.RunnerArtifactContentWrap{}, "", "", err
	}
	key, err := keys.GenerateAESKey()
	if err != nil {
		return contracts.RunnerArtifactContentWrap{}, "", "", err
	}
	defer clear(key)
	w, err := k.WrapFor(key, holderID, wrapAAD(requestID, holderID))
	if err != nil {
		return contracts.RunnerArtifactContentWrap{}, "", "", err
	}
	nonce, ciphertext, err := relay.Seal(key, plain, contentAAD(requestID))
	if err != nil {
		return contracts.RunnerArtifactContentWrap{}, "", "", err
	}
	return contracts.RunnerArtifactContentWrap{HolderId: w.HolderId, Enc: w.Enc, WrappedKey: w.WrappedKey, Tag: w.Tag}, nonce, ciphertext, nil
}
