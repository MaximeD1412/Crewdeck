package main

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// The vault key's rotation on the Runner's side (E2E-4, docs/security/e2e.md,
// « Revocation and rotation »): the Runner rotates when it is the first
// trusted holder online, and takes the new key a holder that rotated wrapped
// for it.

// vaultTimeout bounds each request of a rotation; its body may reach 10 MB.
const vaultTimeout = time.Minute

// vaultItemsMax is VAULT_ROTATION_ITEMS_MAX: more item keys than a rotation
// may post, and the Runner does not rotate.
const vaultItemsMax = 30_000

// heldVault is the vault the Runner holds, swapped once it rotated or took a
// new version: the Commandes open with the vault held at each open.
type heldVault struct {
	current atomic.Pointer[keys.Vault]
}

func newHeldVault(v *keys.Vault) *heldVault {
	h := &heldVault{}
	h.current.Store(v)
	return h
}

func (h *heldVault) Load() *keys.Vault { return h.current.Load() }

// OpenItem opens with the vault held (command.Vault).
func (h *heldVault) OpenItem(item keys.SealedItem, aad []byte) ([]byte, error) {
	return h.Load().OpenItem(item, aad)
}

// vaultAPI is the server's vault for the Runner, with its token.
type vaultAPI struct {
	http          *http.Client
	server, token string
}

func (a vaultAPI) call(ctx context.Context, method, path string, body, into any) error {
	return callServer(ctx, a.http, strings.TrimRight(a.server, "/"), a.token, method, path, body, into)
}

func (a vaultAPI) vault(ctx context.Context) (contracts.RunnerVault, error) {
	var v contracts.RunnerVault
	return v, a.call(ctx, http.MethodGet, "/api/runner/vault", nil, &v)
}

func (a vaultAPI) items(ctx context.Context, cursor string) (contracts.RunnerVaultItems, error) {
	path := "/api/runner/vault/items"
	if cursor != "" {
		path += "?cursor=" + url.QueryEscape(cursor)
	}
	var page contracts.RunnerVaultItems
	return page, a.call(ctx, http.MethodGet, path, nil, &page)
}

func (a vaultAPI) rotate(ctx context.Context, rotation contracts.RunnerVaultRotation) error {
	return a.call(ctx, http.MethodPost, "/api/runner/vault/rotations", rotation, nil)
}

func (a vaultAPI) holders(ctx context.Context) (contracts.RunnerDeviceHolders, error) {
	return serverHolders(a.http, a.server, a.token)(ctx)
}

// rotationOutcome is what a rotation did.
type rotationOutcome int

const (
	// rotationNone: none was pending for the vault held, or it failed.
	rotationNone rotationOutcome = iota
	// rotationDone: the Runner rotated; it holds the new version.
	rotationDone
	// rotationLeft: a holder's key is not one the Runner holds; another
	// holder rotates.
	rotationLeft
)

func (o rotationOutcome) String() string {
	return [...]string{"none", "done", "left"}[o]
}

// rotator rotates the vault, or takes its new version, one at a time.
type rotator struct {
	store  state.Store
	held   *heldVault
	api    vaultAPI
	logger *slog.Logger

	mu sync.Mutex
}

// retried are the refusals after which a rotation is tried once more, from
// the vault read again: a race (409), an item sealed again since it was read
// (409) or a list that changed under it (422).
func retried(err error) bool {
	var refused *serverError
	if !errors.As(err, &refused) {
		return false
	}
	switch refused.Code {
	case "vault.version-changed", "realtime.stale", "vault.items-changed":
		return refused.Status == http.StatusConflict
	case "vault.holders-missing", "vault.items-missing":
		return refused.Status == http.StatusUnprocessableEntity
	}
	return false
}

// rotate rotates the vault when the server says a rotation waits for the
// version the Runner holds.
func (r *rotator) rotate(ctx context.Context) (rotationOutcome, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	outcome, err := r.rotateOnce(ctx)
	if retried(err) {
		outcome, err = r.rotateOnce(ctx)
	}
	return outcome, err
}

func (r *rotator) keys() (*ecdh.PrivateKey, state.VaultWrap, error) {
	raw, err := r.store.LoadRunnerKey()
	if err != nil {
		return nil, state.VaultWrap{}, err
	}
	runner, err := ecdh.X25519().NewPrivateKey(raw)
	if err != nil {
		return nil, state.VaultWrap{}, errVaultClosed
	}
	w, err := r.store.LoadVaultWrap()
	return runner, w, err
}

func (r *rotator) rotateOnce(ctx context.Context) (rotationOutcome, error) {
	held := r.held.Load()
	current, err := r.api.vault(ctx)
	if err != nil {
		return rotationNone, err
	}
	// A vault past the one held: its new wrap comes with vault.rotated or the next hello.
	if !current.RotationPending || current.Version != held.Version {
		return rotationNone, nil
	}
	runner, w, err := r.keys()
	if err != nil {
		return rotationNone, err
	}
	listed, err := r.api.holders(ctx)
	if err != nil {
		return rotationNone, err
	}
	holders := make([]keys.Holder, 0, len(current.Holders))
	for _, h := range current.Holders {
		key, err := base64.RawURLEncoding.DecodeString(h.PublicKey)
		if err != nil {
			return rotationNone, fmt.Errorf("vault: the key of the holder %s: %w", h.Id, err)
		}
		holders = append(holders, keys.Holder{Type: string(h.Type), ID: h.Id, PublicKey: key})
	}
	items, err := r.items(ctx)
	if err != nil {
		return rotationNone, err
	}
	rotation, next, err := keys.Rotate(keys.RotationInput{
		Vault:         held,
		Rotator:       runner,
		RotatorID:     w.RunnerID,
		Authenticated: authenticatedHolders(runner, w.DevicePublicKey, listed),
		Holders:       holders,
		Items:         items,
	})
	var unauthenticated *keys.UnauthenticatedHolderError
	if errors.As(err, &unauthenticated) || errors.Is(err, keys.ErrRotatorNotHolder) {
		r.logger.Warn("vault.rotation.left", "reason", err.Error())
		return rotationLeft, nil
	}
	if err != nil {
		return rotationNone, err
	}
	if err := r.api.rotate(ctx, rotationBody(rotation, current.Seq)); err != nil {
		return rotationNone, err
	}
	own, _ := rotation.WrapOf(w.RunnerID)
	// The server holds the new version: the vault held moves even if the file fails, the next hello hands the wrap again.
	r.held.current.Store(next)
	if err := r.store.SaveVaultWrap(state.VaultWrap{
		RunnerID: w.RunnerID, VaultKeyVersion: next.Version, DevicePublicKey: w.DevicePublicKey, SenderPublicKey: keys.PublicKeyBytes(runner),
		Enc: own.Enc, Ciphertext: own.Ciphertext, Tag: own.Tag,
	}); err != nil {
		return rotationDone, err
	}
	return rotationDone, nil
}

// items reads every item key, page by page.
func (r *rotator) items(ctx context.Context) ([]keys.RotationItem, error) {
	var items []keys.RotationItem
	cursor := ""
	for {
		page, err := r.api.items(ctx, cursor)
		if err != nil {
			return nil, err
		}
		for _, item := range page.Items {
			key, err := base64.RawURLEncoding.DecodeString(item.WrappedKey)
			if err != nil {
				return nil, fmt.Errorf("vault: the key of the item %s %s: %w", item.ItemType, item.ItemId, err)
			}
			items = append(items, keys.RotationItem{Type: item.ItemType, ID: item.ItemId, AAD: []byte(item.Aad), WrappedKey: key})
		}
		if len(items) > vaultItemsMax {
			return nil, fmt.Errorf("vault: more than %d item keys to rewrap", vaultItemsMax)
		}
		next, _ := page.NextCursor.(string)
		if next == "" {
			return items, nil
		}
		if next == cursor {
			return nil, errors.New("vault: the items' cursor does not move")
		}
		cursor = next
	}
}

func rotationBody(rotation keys.Rotation, seq int) contracts.RunnerVaultRotation {
	b64 := base64.RawURLEncoding
	body := contracts.RunnerVaultRotation{
		FromVersion: rotation.FromVersion,
		ToVersion:   rotation.ToVersion,
		Seq:         seq,
		Wraps:       make([]contracts.RunnerVaultRotationWrapsElem, 0, len(rotation.Wraps)),
		Items:       make([]contracts.RunnerVaultRotationItemsElem, 0, len(rotation.Items)),
	}
	for _, w := range rotation.Wraps {
		body.Wraps = append(body.Wraps, contracts.RunnerVaultRotationWrapsElem{
			HolderType: contracts.RunnerVaultRotationWrapsElemHolderType(w.Holder.Type), HolderId: w.Holder.ID,
			Enc: b64.EncodeToString(w.Wrap.Enc), Ciphertext: b64.EncodeToString(w.Wrap.Ciphertext), Tag: b64.EncodeToString(w.Wrap.Tag),
		})
	}
	for _, item := range rotation.Items {
		body.Items = append(body.Items, contracts.RunnerVaultRotationItemsElem{
			ItemType: item.Type, ItemId: item.ID, PreviousKey: b64.EncodeToString(item.PreviousKey), WrappedKey: b64.EncodeToString(item.WrappedKey),
		})
	}
	return body
}

// vaultKeyWrap is the Runner's wrap of a version, as vault.rotated and
// hello.accepted carry it.
type vaultKeyWrap struct {
	Version              int
	Enc, Ciphertext, Tag string
}

// adopt takes the wrap of a version past the one held: it opens from the
// first key the Runner holds whose tag checks (its own, the first
// Appareil's, then each Appareil an approval vouched for), is kept in
// vault.wrap with that sender, and the vault held is swapped. A version not
// past the one held changes nothing.
func (r *rotator) adopt(ctx context.Context, wrap vaultKeyWrap) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if wrap.Version <= r.held.Load().Version {
		return false, nil
	}
	runner, w, err := r.keys()
	if err != nil {
		return false, err
	}
	b64 := base64.RawURLEncoding
	enc, encErr := b64.DecodeString(wrap.Enc)
	ciphertext, ciphertextErr := b64.DecodeString(wrap.Ciphertext)
	tag, tagErr := b64.DecodeString(wrap.Tag)
	if encErr != nil || ciphertextErr != nil || tagErr != nil {
		return false, errors.New("vault: the wrap of the new version is not base64url")
	}
	opened := keys.Wrap{Enc: enc, Ciphertext: ciphertext, Tag: tag}
	own := keys.PublicKeyBytes(runner)
	next, sender, err := keys.OpenVaultWrap(runner, w.RunnerID, wrap.Version, opened, [][]byte{own, w.DevicePublicKey})
	if err != nil {
		// The holder that rotated may be an Appareil approved later: the server lists them.
		listed, listErr := r.api.holders(ctx)
		if listErr != nil {
			return false, listErr
		}
		var later [][]byte
		for _, key := range authenticatedHolders(runner, w.DevicePublicKey, listed) {
			if !bytes.Equal(key, w.DevicePublicKey) {
				later = append(later, key)
			}
		}
		if next, sender, err = keys.OpenVaultWrap(runner, w.RunnerID, wrap.Version, opened, later); err != nil {
			return false, fmt.Errorf("vault: the wrap of version %d opens from no key the Runner holds", wrap.Version)
		}
	}
	r.held.current.Store(next)
	if err := r.store.SaveVaultWrap(state.VaultWrap{
		RunnerID: w.RunnerID, VaultKeyVersion: wrap.Version, DevicePublicKey: w.DevicePublicKey, SenderPublicKey: sender,
		Enc: enc, Ciphertext: ciphertext, Tag: tag,
	}); err != nil {
		return true, err
	}
	return true, nil
}

// rotateNow rotates and says what it did in the log: versions only, never a
// key nor an item.
func (r *rotator) rotateNow(ctx context.Context) {
	outcome, err := r.rotate(ctx)
	switch {
	case err != nil && ctx.Err() == nil:
		r.logger.Warn("vault.rotation.failed", "error", err.Error())
	case outcome == rotationDone:
		r.logger.Info("vault.rotated", "vaultKeyVersion", r.held.Load().Version)
	}
}

// adoptNow takes a wrap of a new version and says it in the log.
func (r *rotator) adoptNow(ctx context.Context, wrap vaultKeyWrap) {
	adopted, err := r.adopt(ctx, wrap)
	if err != nil && ctx.Err() == nil {
		r.logger.Warn("vault.adopt.failed", "vaultKeyVersion", wrap.Version, "error", err.Error())
	}
	if adopted {
		r.logger.Info("vault.adopted", "vaultKeyVersion", wrap.Version)
	}
}

// accepted, on each accepted hello: the wrap of a version past the one held
// is taken, then a rotation pending is done, off the connection's loop.
func (r *rotator) accepted(ctx context.Context) func(contracts.RunnerHelloAccepted) {
	return func(accepted contracts.RunnerHelloAccepted) {
		go func() {
			if w := accepted.VaultKeyWrap; w != nil {
				r.adoptNow(ctx, vaultKeyWrap{Version: w.VaultKeyVersion, Enc: w.Enc, Ciphertext: w.Ciphertext, Tag: w.Tag})
			}
			if accepted.RotationPending != nil && *accepted.RotationPending {
				r.rotateNow(ctx)
			}
		}()
	}
}

// register handles vault.rotation-pending and vault.rotated, off the
// connection's loop.
func (r *rotator) register(ctx context.Context, client *protocol.Client) {
	protocol.On(client, protocol.TypeVaultRotationPending, func(context.Context, contracts.RunnerVaultRotationPending) error {
		go r.rotateNow(ctx)
		return nil
	})
	protocol.On(client, protocol.TypeVaultRotated, func(_ context.Context, m contracts.RunnerVaultRotated) error {
		w := m.VaultKeyWrap
		go r.adoptNow(ctx, vaultKeyWrap{Version: w.VaultKeyVersion, Enc: w.Enc, Ciphertext: w.Ciphertext, Tag: w.Tag})
		return nil
	})
}
