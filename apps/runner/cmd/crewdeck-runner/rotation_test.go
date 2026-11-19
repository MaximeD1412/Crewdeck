package main

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

const (
	laptopID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b01"
	phoneID  = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b02"
	ideaOne  = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01"
	ideaTwo  = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c02"
)

var b64url = base64.RawURLEncoding

// fakeVaultServer is the server's side of the rotation for the Runner: its
// vault, its item keys page by page, the Appareils an approval vouched for,
// and the rotations posted, refused first by the answers queued.
type fakeVaultServer struct {
	t        *testing.T
	mu       sync.Mutex
	vault    contracts.RunnerVault
	items    []contracts.RunnerVaultItemsItemsElem
	holders  []contracts.RunnerDeviceHoldersHoldersElem
	vouchers []contracts.RunnerDeviceHoldersVouchersElem
	refusals []contracts.ErrorEnvelope
	posted   []contracts.RunnerVaultRotation
	pageSize int
	tokens   []string
	// onPost runs at each rotation posted, before it is checked: what
	// another holder writes meanwhile.
	onPost func(f *fakeVaultServer)
}

func (f *fakeVaultServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.tokens = append(f.tokens, r.Header.Get("Authorization"))
	answer := func(v any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(v)
	}
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/runner/vault":
		answer(f.vault)
	case r.Method == http.MethodGet && r.URL.Path == "/api/runner/vault/items":
		from := 0
		if cursor := r.URL.Query().Get("cursor"); cursor != "" {
			from, _ = strconv.Atoi(cursor)
		}
		to := min(from+f.pageSize, len(f.items))
		page := contracts.RunnerVaultItems{Items: append([]contracts.RunnerVaultItemsItemsElem{}, f.items[from:to]...)}
		if to < len(f.items) {
			page.NextCursor = strconv.Itoa(to)
		}
		answer(page)
	case r.Method == http.MethodGet && r.URL.Path == "/api/runner/devices/holders":
		answer(contracts.RunnerDeviceHolders{Holders: f.holders, Vouchers: f.vouchers})
	case r.Method == http.MethodPost && r.URL.Path == "/api/runner/vault/rotations":
		var rotation contracts.RunnerVaultRotation
		if err := json.NewDecoder(r.Body).Decode(&rotation); err != nil {
			f.t.Errorf("rotation body: %v", err)
		}
		f.posted = append(f.posted, rotation)
		if f.onPost != nil {
			f.onPost(f)
		}
		for _, rotated := range rotation.Items {
			for _, item := range f.items {
				if item.ItemId == rotated.ItemId && item.WrappedKey != rotated.PreviousKey && len(f.refusals) == 0 {
					f.refusals = []contracts.ErrorEnvelope{{Status: http.StatusConflict, Code: "vault.items-changed", Message: "Un élément du coffre a été réécrit pendant la rotation."}}
				}
			}
		}
		if len(f.refusals) > 0 {
			refusal := f.refusals[0]
			f.refusals = f.refusals[1:]
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(refusal.Status)
			_ = json.NewEncoder(w).Encode(refusal)
			return
		}
		f.vault.Version, f.vault.RotationPending = rotation.ToVersion, false
		for _, rotated := range rotation.Items {
			for i := range f.items {
				if f.items[i].ItemId == rotated.ItemId {
					f.items[i].WrappedKey = rotated.WrappedKey
				}
			}
		}
		answer(contracts.RunnerVaultState{Version: f.vault.Version, RotationPending: false})
	default:
		http.NotFound(w, r)
	}
}

func (f *fakeVaultServer) rotations() []contracts.RunnerVaultRotation {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]contracts.RunnerVaultRotation(nil), f.posted...)
}

// rotationWorld is a Runner linked by its laptop, the first Appareil, of a
// vault of version 1: a phone the laptop approved is kept, a tablet revoked,
// and two Idées sealed under the vault.
type rotationWorld struct {
	store                         state.Store
	runner, laptop, phone, tablet *ecdh.PrivateKey
	held                          *heldVault
	sealed                        map[string]keys.SealedItem
	server                        *fakeVaultServer
	url                           string
}

func newRotationWorld(t *testing.T) *rotationWorld {
	t.Helper()
	w := &rotationWorld{store: state.Store{Dir: t.TempDir()}, sealed: map[string]keys.SealedItem{}}
	w.runner, _ = keys.GenerateKeyPair()
	w.laptop, _ = keys.GenerateKeyPair()
	w.phone, _ = keys.GenerateKeyPair()
	w.tablet, _ = keys.GenerateKeyPair()
	vaultKey, _ := keys.GenerateAESKey()
	wrap, err := keys.SealWrap(w.laptop, keys.PublicKeyBytes(w.runner), vaultKey, []byte(keys.InfoVaultWrap), keys.VaultWrapAAD(runnerID, 1))
	if err != nil {
		t.Fatal(err)
	}
	if err := w.store.Save(state.State{Server: "http://127.0.0.1:1", RunnerID: runnerID, Token: "rnr_linked"}); err != nil {
		t.Fatal(err)
	}
	if err := w.store.SaveRunnerKey(w.runner.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err := w.store.SaveVaultWrap(state.VaultWrap{RunnerID: runnerID, VaultKeyVersion: 1, DevicePublicKey: keys.PublicKeyBytes(w.laptop), Enc: wrap.Enc, Ciphertext: wrap.Ciphertext, Tag: wrap.Tag}); err != nil {
		t.Fatal(err)
	}
	vault, err := openVault(w.store)
	if err != nil {
		t.Fatal(err)
	}
	w.held = newHeldVault(vault)
	w.server = &fakeVaultServer{t: t, pageSize: 1, vault: contracts.RunnerVault{
		Version: 1, RotationPending: true, Seq: 41,
		Holders: []contracts.RunnerVaultHoldersElem{
			{Type: contracts.RunnerVaultHoldersElemTypeRunner, Id: runnerID, PublicKey: b64url.EncodeToString(keys.PublicKeyBytes(w.runner))},
			{Type: contracts.RunnerVaultHoldersElemTypeDevice, Id: laptopID, PublicKey: b64url.EncodeToString(keys.PublicKeyBytes(w.laptop))},
			{Type: contracts.RunnerVaultHoldersElemTypeDevice, Id: phoneID, PublicKey: b64url.EncodeToString(keys.PublicKeyBytes(w.phone))},
		},
	}}
	// The phone, approved by the laptop: its holder wrap vouches for its key.
	vouch, err := keys.SealWrap(w.laptop, keys.PublicKeyBytes(w.runner), keys.PublicKeyBytes(w.phone), []byte(keys.InfoDeviceHolder), []byte(phoneID))
	if err != nil {
		t.Fatal(err)
	}
	w.server.holders = []contracts.RunnerDeviceHoldersHoldersElem{{
		DeviceId: phoneID, PublicKey: b64url.EncodeToString(keys.PublicKeyBytes(w.phone)), ApproverPublicKey: b64url.EncodeToString(keys.PublicKeyBytes(w.laptop)),
		Wrap: contracts.RunnerDeviceHoldersHoldersElemWrap{Enc: b64url.EncodeToString(vouch.Enc), Ciphertext: b64url.EncodeToString(vouch.Ciphertext), Tag: b64url.EncodeToString(vouch.Tag)},
	}}
	for id, aad := range map[string]string{ideaOne: ideaOne + ":text", ideaTwo: ideaTwo + ":analysis"} {
		item, err := vault.SealItem([]byte("le texte de "+id), []byte(aad))
		if err != nil {
			t.Fatal(err)
		}
		w.sealed[id] = item
		w.server.items = append(w.server.items, contracts.RunnerVaultItemsItemsElem{ItemType: "idea.text", ItemId: id, Aad: aad, WrappedKey: b64url.EncodeToString(item.Key)})
	}
	srv := httptest.NewServer(w.server)
	t.Cleanup(srv.Close)
	w.url = srv.URL
	return w
}

func (w *rotationWorld) rotator() *rotator {
	return &rotator{store: w.store, held: w.held, api: vaultAPI{http: http.DefaultClient, server: w.url, token: "rnr_linked"}, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
}

func (w *rotationWorld) opensEveryItem(t *testing.T, vault *keys.Vault) {
	t.Helper()
	for _, item := range w.server.items {
		key, _ := b64url.DecodeString(item.WrappedKey)
		got, err := vault.OpenItem(keys.SealedItem{Key: key, Ciphertext: w.sealed[item.ItemId].Ciphertext}, []byte(item.Aad))
		if err != nil || string(got) != "le texte de "+item.ItemId {
			t.Fatalf("item %s opens %q, %v", item.ItemId, got, err)
		}
	}
}

func decodeWrap(t *testing.T, enc, ciphertext, tag string) keys.Wrap {
	t.Helper()
	var w keys.Wrap
	var err error
	if w.Enc, err = b64url.DecodeString(enc); err != nil {
		t.Fatal(err)
	}
	if w.Ciphertext, err = b64url.DecodeString(ciphertext); err != nil {
		t.Fatal(err)
	}
	if w.Tag, err = b64url.DecodeString(tag); err != nil {
		t.Fatal(err)
	}
	return w
}

// The Runner, first holder online, rotates: a new key of version 2 for the
// runner, the laptop and the phone (the tablet revoked), every item key read
// page by page and rewrapped, its own wrap kept in vault.wrap, and its vault
// swapped for the new one.
func TestTheRunnerRotatesForTheHoldersItAuthenticatedAndKeepsItsNewWrap(t *testing.T) {
	w := newRotationWorld(t)

	r := w.rotator()
	moved := 0
	r.moved = func() { moved++ }
	outcome, err := r.rotate(context.Background())
	if err != nil || outcome != rotationDone || moved != 1 {
		t.Fatalf("rotate = %v, %v, told %d times", outcome, err, moved)
	}
	posted := w.server.rotations()
	if len(posted) != 1 {
		t.Fatalf("%d rotations posted", len(posted))
	}
	rotation := posted[0]
	if rotation.FromVersion != 1 || rotation.ToVersion != 2 || rotation.Seq != 41 || len(rotation.Items) != 2 {
		t.Fatalf("rotation from %d to %d, seq %d, %d items", rotation.FromVersion, rotation.ToVersion, rotation.Seq, len(rotation.Items))
	}
	recipients := map[string]*ecdh.PrivateKey{runnerID: w.runner, laptopID: w.laptop, phoneID: w.phone}
	var newKey []byte
	for _, wrap := range rotation.Wraps {
		recipient := recipients[wrap.HolderId]
		if recipient == nil {
			t.Fatalf("a wrap for %s", wrap.HolderId)
		}
		delete(recipients, wrap.HolderId)
		key, err := keys.OpenWrap(recipient, keys.PublicKeyBytes(w.runner), decodeWrap(t, wrap.Enc, wrap.Ciphertext, wrap.Tag), []byte(keys.InfoVaultWrap), keys.VaultWrapAAD(wrap.HolderId, 2))
		if err != nil || (newKey != nil && !bytes.Equal(key, newKey)) {
			t.Fatalf("the wrap of %s: %v", wrap.HolderId, err)
		}
		newKey = key
	}
	if len(recipients) != 0 {
		t.Fatalf("no wrap for %v", recipients)
	}
	for _, token := range w.server.tokens {
		if token != "Bearer rnr_linked" {
			t.Fatalf("a request with %q", token)
		}
	}

	// The vault held, and the one opened again at the next start, are of version 2.
	if w.held.Load().Version != 2 {
		t.Fatalf("held version %d", w.held.Load().Version)
	}
	w.opensEveryItem(t, w.held.Load())
	saved, err := w.store.LoadVaultWrap()
	if err != nil || saved.VaultKeyVersion != 2 || !bytes.Equal(saved.SenderPublicKey, keys.PublicKeyBytes(w.runner)) || !bytes.Equal(saved.DevicePublicKey, keys.PublicKeyBytes(w.laptop)) {
		t.Fatalf("vault.wrap %+v, %v", saved, err)
	}
	reopened, err := openVault(w.store)
	if err != nil || reopened.Version != 2 {
		t.Fatalf("openVault = %v, %v", reopened, err)
	}
	w.opensEveryItem(t, reopened)
}

// A holder whose key the Runner does not hold (the server slipped its own
// in, or an Appareil approved by one now revoked): the Runner posts nothing
// and leaves the rotation to another holder.
func TestTheRunnerLeavesTheRotationToAnotherHolderWhenAKeyIsNotOneItHolds(t *testing.T) {
	w := newRotationWorld(t)
	w.server.vault.Holders = append(w.server.vault.Holders, contracts.RunnerVaultHoldersElem{
		Type: contracts.RunnerVaultHoldersElemTypeDevice, Id: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b03", PublicKey: b64url.EncodeToString(keys.PublicKeyBytes(w.tablet)),
	})

	r := w.rotator()
	moved := 0
	r.moved = func() { moved++ }
	outcome, err := r.rotate(context.Background())
	if err != nil || outcome != rotationLeft {
		t.Fatalf("rotate = %v, %v, want it left to another holder", outcome, err)
	}
	if posted := w.server.rotations(); len(posted) != 0 {
		t.Fatalf("%d rotations posted", len(posted))
	}
	if w.held.Load().Version != 1 || moved != 0 {
		t.Fatalf("the vault moved (told %d times)", moved)
	}
}

// The phone, approved by the laptop, approved the tablet, then the phone was
// revoked (E2E-4): the server lists it as a voucher, and the Runner still
// rotates for the tablet, never for the phone.
func TestTheRunnerRotatesForAnAppareilARevokedApproverVouchedFor(t *testing.T) {
	w := newRotationWorld(t)
	const tabletID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b03"
	tablet, err := keys.SealWrap(w.phone, keys.PublicKeyBytes(w.runner), keys.PublicKeyBytes(w.tablet), []byte(keys.InfoDeviceHolder), []byte(tabletID))
	if err != nil {
		t.Fatal(err)
	}
	phone := w.server.holders[0]
	w.server.vouchers = []contracts.RunnerDeviceHoldersVouchersElem{{
		DeviceId: phone.DeviceId, PublicKey: phone.PublicKey, ApproverPublicKey: phone.ApproverPublicKey,
		Wrap: contracts.RunnerDeviceHoldersVouchersElemWrap{Enc: phone.Wrap.Enc, Ciphertext: phone.Wrap.Ciphertext, Tag: phone.Wrap.Tag},
	}}
	w.server.holders = []contracts.RunnerDeviceHoldersHoldersElem{{
		DeviceId: tabletID, PublicKey: b64url.EncodeToString(keys.PublicKeyBytes(w.tablet)), ApproverPublicKey: b64url.EncodeToString(keys.PublicKeyBytes(w.phone)),
		Wrap: contracts.RunnerDeviceHoldersHoldersElemWrap{Enc: b64url.EncodeToString(tablet.Enc), Ciphertext: b64url.EncodeToString(tablet.Ciphertext), Tag: b64url.EncodeToString(tablet.Tag)},
	}}
	w.server.vault.Holders[2] = contracts.RunnerVaultHoldersElem{Type: contracts.RunnerVaultHoldersElemTypeDevice, Id: tabletID, PublicKey: b64url.EncodeToString(keys.PublicKeyBytes(w.tablet))}

	outcome, err := w.rotator().rotate(context.Background())
	if err != nil || outcome != rotationDone {
		t.Fatalf("rotate = %v, %v, want the Runner to rotate", outcome, err)
	}
	posted := w.server.rotations()
	if len(posted) != 1 {
		t.Fatalf("%d rotations posted", len(posted))
	}
	got := map[string]bool{}
	for _, wrap := range posted[0].Wraps {
		got[wrap.HolderId] = true
	}
	if len(got) != 3 || !got[runnerID] || !got[laptopID] || !got[tabletID] {
		t.Fatalf("wraps for %v, want the Runner, the laptop and the tablet", got)
	}

	// The server slipping the phone back among the vault's holders: as a
	// voucher only, the Runner wraps nothing for it and leaves the rotation.
	w = newRotationWorld(t)
	w.server.vouchers = []contracts.RunnerDeviceHoldersVouchersElem{{
		DeviceId: phone.DeviceId, PublicKey: phone.PublicKey, ApproverPublicKey: phone.ApproverPublicKey,
		Wrap: contracts.RunnerDeviceHoldersVouchersElemWrap{Enc: phone.Wrap.Enc, Ciphertext: phone.Wrap.Ciphertext, Tag: phone.Wrap.Tag},
	}}
	w.server.holders = nil
	if outcome, err := w.rotator().rotate(context.Background()); err != nil || outcome != rotationLeft {
		t.Fatalf("rotate = %v, %v, want it left to another holder", outcome, err)
	}
	if posted := w.server.rotations(); len(posted) != 0 {
		t.Fatalf("%d rotations posted", len(posted))
	}
}

func TestTheRunnerRotatesOnlyARotationPendingOfItsVersion(t *testing.T) {
	for name, alter := range map[string]func(v *contracts.RunnerVault){
		"none pending":       func(v *contracts.RunnerVault) { v.RotationPending = false },
		"a version past its": func(v *contracts.RunnerVault) { v.Version = 2 },
	} {
		t.Run(name, func(t *testing.T) {
			w := newRotationWorld(t)
			alter(&w.server.vault)
			outcome, err := w.rotator().rotate(context.Background())
			if err != nil || outcome != rotationNone || len(w.server.rotations()) != 0 {
				t.Fatalf("rotate = %v, %v, %d posted", outcome, err, len(w.server.rotations()))
			}
		})
	}
}

// A rotation the server refuses for a race (409) or a list that changed
// (422) is tried once more from the vault read again; twice refused, or
// refused for another reason, the vault stays as it was.
func TestTheRunnerTriesOnceMoreAfterARotationRefusedForARaceOrAMissingHolderOrItem(t *testing.T) {
	refusal := func(status int, code string) contracts.ErrorEnvelope {
		return contracts.ErrorEnvelope{Status: status, Code: code, Message: "Refusé : " + code + "."}
	}
	for _, retried := range []contracts.ErrorEnvelope{
		refusal(409, "vault.version-changed"), refusal(409, "realtime.stale"),
		refusal(422, "vault.holders-missing"), refusal(422, "vault.items-missing"),
		refusal(409, "vault.items-changed"),
	} {
		t.Run(retried.Code, func(t *testing.T) {
			w := newRotationWorld(t)
			w.server.refusals = []contracts.ErrorEnvelope{retried}
			outcome, err := w.rotator().rotate(context.Background())
			if err != nil || outcome != rotationDone || len(w.server.rotations()) != 2 || w.held.Load().Version != 2 {
				t.Fatalf("rotate = %v, %v, %d posted", outcome, err, len(w.server.rotations()))
			}
		})
	}
	for name, refusals := range map[string][]contracts.ErrorEnvelope{
		"refused twice":              {refusal(422, "vault.items-missing"), refusal(422, "vault.items-missing")},
		"refused for another reason": {refusal(400, "validation.failed")},
	} {
		t.Run(name, func(t *testing.T) {
			w := newRotationWorld(t)
			w.server.refusals = refusals
			outcome, err := w.rotator().rotate(context.Background())
			if err == nil || outcome != rotationNone || len(w.server.rotations()) != len(refusals) {
				t.Fatalf("rotate = %v, %v, %d posted", outcome, err, len(w.server.rotations()))
			}
			saved, _ := w.store.LoadVaultWrap()
			if w.held.Load().Version != 1 || saved.VaultKeyVersion != 1 {
				t.Fatal("the vault moved")
			}
		})
	}
}

// Each item goes back with the key the Runner read as its previousKey; an
// Idée sealed again between the read and the post (409 vault.items-changed)
// makes it read the items again and try once more, the new key rewrapped.
func TestTheRunnerSendsTheKeysItReadAndTriesOnceMoreWhenAnItemWasSealedAgain(t *testing.T) {
	w := newRotationWorld(t)
	read := map[string]string{}
	for _, item := range w.server.items {
		read[item.ItemId] = item.WrappedKey
	}
	once := true
	w.server.onPost = func(f *fakeVaultServer) {
		if !once {
			return
		}
		once = false
		item, err := w.held.Load().SealItem([]byte("le texte de "+ideaOne), []byte(ideaOne+":text"))
		if err != nil {
			t.Fatal(err)
		}
		w.sealed[ideaOne] = item
		for i := range f.items {
			if f.items[i].ItemId == ideaOne {
				f.items[i].WrappedKey = b64url.EncodeToString(item.Key)
			}
		}
	}
	outcome, err := w.rotator().rotate(context.Background())
	posted := w.server.rotations()
	if err != nil || outcome != rotationDone || len(posted) != 2 {
		t.Fatalf("rotate = %v, %v, %d posted", outcome, err, len(posted))
	}
	for _, item := range posted[0].Items {
		if item.PreviousKey != read[item.ItemId] {
			t.Fatalf("the item %s went back with %q, not the key read %q", item.ItemId, item.PreviousKey, read[item.ItemId])
		}
	}
	w.opensEveryItem(t, w.held.Load())

	// Sealed again at each post: refused twice, the vault stays as it was.
	busy := newRotationWorld(t)
	busy.server.onPost = func(f *fakeVaultServer) {
		item, err := busy.held.Load().SealItem([]byte("le texte de "+f.items[0].ItemId), []byte(f.items[0].Aad))
		if err != nil {
			t.Fatal(err)
		}
		f.items[0].WrappedKey = b64url.EncodeToString(item.Key)
	}
	outcome, err = busy.rotator().rotate(context.Background())
	if err == nil || outcome != rotationNone || len(busy.server.rotations()) != 2 || busy.held.Load().Version != 1 {
		t.Fatalf("rotate = %v, %v, %d posted", outcome, err, len(busy.server.rotations()))
	}
}

// An item key that does not open under the vault held stops the rotation
// before anything is posted: the item would be lost.
func TestTheRunnerStopsARotationAtAnItemKeyThatDoesNotOpen(t *testing.T) {
	w := newRotationWorld(t)
	w.server.items[1].Aad = ideaOne + ":reason"

	outcome, err := w.rotator().rotate(context.Background())
	if err == nil || outcome != rotationNone || len(w.server.rotations()) != 0 {
		t.Fatalf("rotate = %v, %v, %d posted", outcome, err, len(w.server.rotations()))
	}
}

// A holder that rotated hands the Runner its wrap of version 2 (vault.rotated,
// or the next hello.accepted): it opens from that holder's key, one it holds
// (the phone, vouched for by the laptop), is kept with that sender, and the
// vault is swapped. A wrap of a key it does not hold, or of a version not
// past its own, changes nothing.
func TestTheRunnerAdoptsTheWrapOfANewVersionFromTheHolderThatRotated(t *testing.T) {
	w := newRotationWorld(t)
	newKey, _ := keys.GenerateAESKey()
	sealFor := func(sender *ecdh.PrivateKey, version int) vaultKeyWrap {
		wrap, err := keys.SealWrap(sender, keys.PublicKeyBytes(w.runner), newKey, []byte(keys.InfoVaultWrap), keys.VaultWrapAAD(runnerID, version))
		if err != nil {
			t.Fatal(err)
		}
		return vaultKeyWrap{Version: version, Enc: b64url.EncodeToString(wrap.Enc), Ciphertext: b64url.EncodeToString(wrap.Ciphertext), Tag: b64url.EncodeToString(wrap.Tag)}
	}
	r := w.rotator()
	moved := 0
	r.moved = func() { moved++ }

	if adopted, err := r.adopt(context.Background(), sealFor(w.tablet, 2)); adopted || err == nil {
		t.Fatalf("a wrap of the revoked tablet: %v, %v", adopted, err)
	}
	if adopted, err := r.adopt(context.Background(), sealFor(w.phone, 1)); adopted || err != nil {
		t.Fatalf("a wrap of the version held: %v, %v", adopted, err)
	}
	if w.held.Load().Version != 1 || moved != 0 {
		t.Fatalf("the vault moved (told %d times)", moved)
	}

	adopted, err := r.adopt(context.Background(), sealFor(w.phone, 2))
	if !adopted || err != nil {
		t.Fatalf("adopt = %v, %v", adopted, err)
	}
	// What the Runner sealed under version 1 goes again under 2 (the Local Projets' full reports).
	if w.held.Load().Version != 2 || moved != 1 {
		t.Fatalf("held version %d, told %d times", w.held.Load().Version, moved)
	}
	saved, err := w.store.LoadVaultWrap()
	if err != nil || saved.VaultKeyVersion != 2 || !bytes.Equal(saved.SenderPublicKey, keys.PublicKeyBytes(w.phone)) || !bytes.Equal(saved.DevicePublicKey, keys.PublicKeyBytes(w.laptop)) {
		t.Fatalf("vault.wrap %+v, %v", saved, err)
	}
	if reopened, err := openVault(w.store); err != nil || reopened.Version != 2 {
		t.Fatalf("openVault = %v, %v", reopened, err)
	}
}

// The Commandes open their sealed parts with the vault held at the time:
// the new one once swapped.
func TestTheHeldVaultOpensWithTheVaultSwappedIn(t *testing.T) {
	w := newRotationWorld(t)
	if _, err := w.rotator().rotate(context.Background()); err != nil {
		t.Fatal(err)
	}
	sealed, err := w.held.Load().SealItem([]byte("npm test"), []byte("settings:project"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := w.held.OpenItem(sealed, []byte("settings:project"))
	if err != nil || string(got) != "npm test" {
		t.Fatalf("OpenItem = %q, %v", got, err)
	}
}

// runAgainst runs `crewdeck-runner run` in w's home against a server that
// answers the vault's routes and, on its socket, accepts the hello with
// accepted then sends each of then.
func (w *rotationWorld) runAgainst(t *testing.T, accepted string, then ...string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Upgrade") == "" {
			w.server.ServeHTTP(rw, r)
			return
		}
		conn, err := websocket.Accept(rw, r, nil)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		ctx := r.Context()
		if _, _, err := conn.Read(ctx); err != nil { // hello
			return
		}
		for _, message := range append([]string{accepted}, then...) {
			if err := conn.Write(ctx, websocket.MessageText, []byte(message)); err != nil {
				return
			}
		}
		for {
			if _, _, err := conn.Read(ctx); err != nil {
				return
			}
		}
	}))
	t.Cleanup(srv.Close)
	t.Setenv(state.HomeEnv, w.store.Dir)
	ctx, cancel := context.WithCancel(context.Background())
	root := newRootCommand()
	root.SetErr(io.Discard)
	root.SetArgs([]string{"run", "--server", srv.URL})
	done := make(chan error, 1)
	go func() { done <- root.ExecuteContext(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("run did not stop")
		}
	})
}

// waitFor polls cond for 5 s.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if cond() {
			return
		}
	}
	t.Fatalf("never: %s", what)
}

func (w *rotationWorld) savedVersion() int {
	saved, err := w.store.LoadVaultWrap()
	if err != nil {
		return -1
	}
	return saved.VaultKeyVersion
}

const acceptedAt = `"id":"019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a00","at":"2026-11-19T08:00:00.000Z"`

// The hello says a rotation waits, or the server says so while connected:
// `run` rotates, and keeps its wrap of the new version.
func TestRunRotatesWhenTheServerSaysARotationWaits(t *testing.T) {
	for name, messages := range map[string][]string{
		"in hello.accepted": {`{"type":"hello.accepted",` + acceptedAt + `,"runnerId":"` + runnerID + `","protocolVersion":1,"rotationPending":true}`},
		"in vault.rotation-pending": {
			`{"type":"hello.accepted",` + acceptedAt + `,"runnerId":"` + runnerID + `","protocolVersion":1}`,
			`{"type":"vault.rotation-pending",` + acceptedAt + `}`,
		},
	} {
		t.Run(name, func(t *testing.T) {
			w := newRotationWorld(t)
			w.runAgainst(t, messages[0], messages[1:]...)
			waitFor(t, "a rotation posted and vault.wrap at version 2", func() bool { return len(w.server.rotations()) == 1 && w.savedVersion() == 2 })
			reopened, err := openVault(w.store)
			if err != nil || reopened.Version != 2 {
				t.Fatalf("openVault = %v, %v", reopened, err)
			}
		})
	}
}

// The phone rotated: its wrap for the Runner comes in vault.rotated while
// connected, or in the next hello.accepted; `run` keeps it, from the phone.
func TestRunTakesTheWrapOfTheVersionAHolderRotatedTo(t *testing.T) {
	for _, via := range []string{"vault.rotated", "hello.accepted"} {
		t.Run(via, func(t *testing.T) {
			w := newRotationWorld(t)
			newKey, _ := keys.GenerateAESKey()
			wrap, err := keys.SealWrap(w.phone, keys.PublicKeyBytes(w.runner), newKey, []byte(keys.InfoVaultWrap), keys.VaultWrapAAD(runnerID, 2))
			if err != nil {
				t.Fatal(err)
			}
			wrapJSON := `{"vaultKeyVersion":2,"enc":"` + b64url.EncodeToString(wrap.Enc) + `","ciphertext":"` + b64url.EncodeToString(wrap.Ciphertext) + `","tag":"` + b64url.EncodeToString(wrap.Tag) + `"}`
			hello := `{"type":"hello.accepted",` + acceptedAt + `,"runnerId":"` + runnerID + `","protocolVersion":1}`
			if via == "vault.rotated" {
				w.runAgainst(t, hello, `{"type":"vault.rotated",`+acceptedAt+`,"vaultKeyWrap":`+wrapJSON+`}`)
			} else {
				w.runAgainst(t, `{"type":"hello.accepted",`+acceptedAt+`,"runnerId":"`+runnerID+`","protocolVersion":1,"vaultKeyWrap":`+wrapJSON+`}`)
			}
			waitFor(t, "vault.wrap at version 2", func() bool { return w.savedVersion() == 2 })
			saved, _ := w.store.LoadVaultWrap()
			if !bytes.Equal(saved.SenderPublicKey, keys.PublicKeyBytes(w.phone)) {
				t.Fatal("vault.wrap does not keep the phone as its sender")
			}
			if len(w.server.rotations()) != 0 {
				t.Fatal("the Runner rotated too")
			}
		})
	}
}
