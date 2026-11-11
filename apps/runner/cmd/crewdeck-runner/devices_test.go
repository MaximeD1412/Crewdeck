package main

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

const (
	approverRunnerID = "01933b6e-8f3a-7c4d-9e2f-0a1b2c3d4e50"
	newDeviceID      = "01933b6e-8f3a-7c4d-9e2f-0a1b2c3d4e5f"
	deviceToken      = "crd_runner_token"
)

// approvalSetUp is a linked Runner (runner.json, runner.key, vault.wrap) and
// a new Appareil's code: its key pair and its secret.
type approvalSetUp struct {
	home     string
	vaultKey []byte
	runner   *ecdh.PrivateKey
	phone    *ecdh.PrivateKey
	secret   []byte
	code     string
}

func newApprovalSetUp(t *testing.T) *approvalSetUp {
	t.Helper()
	home := t.TempDir()
	store := state.Store{Dir: home}
	runner, device, phone := mustKey(t), mustKey(t), mustKey(t)
	vaultKey, err := keys.GenerateAESKey()
	if err != nil {
		t.Fatal(err)
	}
	w, err := keys.SealWrap(device, keys.PublicKeyBytes(runner), vaultKey, []byte(keys.InfoVaultWrap), keys.VaultWrapAAD(approverRunnerID, 1))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(state.State{Server: "http://unused.invalid", RunnerID: approverRunnerID, Token: deviceToken}); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveRunnerKey(runner.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveVaultWrap(state.VaultWrap{RunnerID: approverRunnerID, VaultKeyVersion: 1, DevicePublicKey: keys.PublicKeyBytes(device), Enc: w.Enc, Ciphertext: w.Ciphertext, Tag: w.Tag}); err != nil {
		t.Fatal(err)
	}
	secret := []byte("0123456789abcdef")
	return &approvalSetUp{home: home, vaultKey: vaultKey, runner: runner, phone: phone, secret: secret, code: "7K2Q-" + keys.EncodeBase32(secret)}
}

func mustKey(t *testing.T) *ecdh.PrivateKey {
	t.Helper()
	k, err := keys.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	return k
}

// fakeApprovals is the server's two Runner routes for one pending Appareil;
// swap replaces the public key it relays.
type fakeApprovals struct {
	mu       sync.Mutex
	pending  contracts.RunnerPendingDevice
	approved *contracts.RunnerApproveDevice
	status   int
	envelope contracts.ErrorEnvelope
	tokens   []string
}

func newFakeApprovals(s *approvalSetUp) *fakeApprovals {
	pk := keys.PublicKeyBytes(s.phone)
	return &fakeApprovals{pending: contracts.RunnerPendingDevice{
		Id:        newDeviceID,
		ShortId:   "7K2Q",
		Name:      "Safari sur iOS",
		PublicKey: base64.RawURLEncoding.EncodeToString(pk),
		Proof:     base64.RawURLEncoding.EncodeToString(keys.NewDeviceProof(s.secret, pk)),
		ExpiresAt: time.Date(2026, 11, 11, 10, 10, 0, 0, time.UTC),
	}}
}

func (f *fakeApprovals) handler(t *testing.T) http.Handler {
	mux := http.NewServeMux()
	reply := func(w http.ResponseWriter, r *http.Request, ok func()) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.tokens = append(f.tokens, r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		if f.status != 0 {
			w.WriteHeader(f.status)
			_ = json.NewEncoder(w).Encode(f.envelope)
			return
		}
		ok()
		_ = json.NewEncoder(w).Encode(f.pending)
	}
	mux.HandleFunc("GET /api/runner/devices/pending/7K2Q", func(w http.ResponseWriter, r *http.Request) { reply(w, r, func() {}) })
	mux.HandleFunc("POST /api/runner/devices/"+newDeviceID+"/approve", func(w http.ResponseWriter, r *http.Request) {
		var body contracts.RunnerApproveDevice
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("approve body: %v", err)
		}
		reply(w, r, func() { f.approved = &body })
	})
	return mux
}

func (s *approvalSetUp) approver(server, answer string) (*approver, *bytes.Buffer) {
	out := &bytes.Buffer{}
	return &approver{server: server, http: http.DefaultClient, store: state.Store{Dir: s.home}, in: strings.NewReader(answer), out: out}, out
}

// The Runner approves the code's Appareil: the wrap it sends opens on the
// new Appareil from the Runner's key, for its id; proof_A binds both keys.
func TestTheRunnerApprovesANewAppareilByItsCode(t *testing.T) {
	s := newApprovalSetUp(t)
	fake := newFakeApprovals(s)
	srv := httptest.NewServer(fake.handler(t))
	t.Cleanup(srv.Close)

	a, out := s.approver(srv.URL, "o\n")
	if err := a.approve(context.Background(), "  crewdeck:appareil:"+strings.ToLower(s.code)+"\n"); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if !strings.Contains(out.String(), "Approuver « Safari sur iOS » ? (o/N)") || !strings.Contains(out.String(), "est approuvé") {
		t.Fatalf("output %q", out.String())
	}
	body := fake.approved
	if body == nil {
		t.Fatal("nothing approved")
	}
	if body.Approver.Type != contracts.RunnerApproveDeviceApproverTypeRunner || body.Approver.Id != approverRunnerID || body.VaultKeyVersion != 1 {
		t.Fatalf("approver %+v, version %d", body.Approver, body.VaultKeyVersion)
	}
	b64 := base64.RawURLEncoding
	w := keys.Wrap{Enc: mustDecode(t, body.Wrap.Enc), Ciphertext: mustDecode(t, body.Wrap.Ciphertext), Tag: mustDecode(t, body.Wrap.Tag)}
	got, err := keys.OpenWrap(s.phone, keys.PublicKeyBytes(s.runner), w, []byte(keys.InfoVaultWrap), keys.VaultWrapAAD(newDeviceID, 1))
	if err != nil || !bytes.Equal(got, s.vaultKey) {
		t.Fatalf("the new Appareil opens %x (%v)", got, err)
	}
	if want := b64.EncodeToString(keys.ApproveDeviceProof(s.secret, keys.PublicKeyBytes(s.phone), keys.PublicKeyBytes(s.runner))); body.Proof != want {
		t.Fatalf("proof_A %s, want %s", body.Proof, want)
	}
	for _, token := range fake.tokens {
		if token != "Bearer "+deviceToken {
			t.Fatalf("authorization %q", token)
		}
	}
}

// A server that relays another public key than the code's cannot forge its
// proof: the Runner says so and approves nothing.
func TestTheRunnerApprovesNothingWhenTheServerSwapsTheKey(t *testing.T) {
	s := newApprovalSetUp(t)
	fake := newFakeApprovals(s)
	fake.pending.PublicKey = base64.RawURLEncoding.EncodeToString(keys.PublicKeyBytes(mustKey(t)))
	srv := httptest.NewServer(fake.handler(t))
	t.Cleanup(srv.Close)

	a, out := s.approver(srv.URL, "o\n")
	err := a.approve(context.Background(), s.code)
	if err == nil || !strings.Contains(err.Error(), "ne correspond pas") {
		t.Fatalf("err %v", err)
	}
	if fake.approved != nil || strings.Contains(out.String(), "Approuver") {
		t.Fatalf("approved %+v, output %q", fake.approved, out.String())
	}
}

func TestTheRunnerApprovesNothingWithoutAYes(t *testing.T) {
	s := newApprovalSetUp(t)
	fake := newFakeApprovals(s)
	srv := httptest.NewServer(fake.handler(t))
	t.Cleanup(srv.Close)

	a, out := s.approver(srv.URL, "\n")
	if err := a.approve(context.Background(), s.code); err != nil {
		t.Fatal(err)
	}
	if fake.approved != nil || !strings.Contains(out.String(), "Rien n’a été approuvé") {
		t.Fatalf("approved %+v, output %q", fake.approved, out.String())
	}
}

// An expired or used code: the server's message, as it says it.
func TestTheRunnerSaysWhyTheServerRefusesTheCode(t *testing.T) {
	s := newApprovalSetUp(t)
	fake := newFakeApprovals(s)
	fake.status = http.StatusNotFound
	fake.envelope = contracts.ErrorEnvelope{Code: "devices.code-unknown", Message: "Ce code est inconnu ou a expiré : affiche un nouveau code sur le nouvel Appareil."}
	srv := httptest.NewServer(fake.handler(t))
	t.Cleanup(srv.Close)

	a, _ := s.approver(srv.URL, "o\n")
	err := a.approve(context.Background(), s.code)
	if err == nil || err.Error() != fake.envelope.Message {
		t.Fatalf("err %v", err)
	}
}

func TestTheRunnerRefusesWhatIsNotADeviceCode(t *testing.T) {
	s := newApprovalSetUp(t)
	for _, code := range []string{"", "7K2Q", s.code[:20], "7KUQ-" + s.code[5:], s.code[:30] + "1"} {
		a, _ := s.approver("http://unused.invalid", "o\n")
		if err := a.approve(context.Background(), code); err != errDeviceCode {
			t.Errorf("%q: %v", code, err)
		}
	}
}

func TestTheRunnerMustBeLinkedToApprove(t *testing.T) {
	a := &approver{http: http.DefaultClient, store: state.Store{Dir: t.TempDir()}, in: strings.NewReader("o\n"), out: &bytes.Buffer{}}
	if err := a.approve(context.Background(), "7K2Q-"+keys.EncodeBase32([]byte("0123456789abcdef"))); err != errNotLinked {
		t.Fatalf("err %v", err)
	}
}

func TestAServerRelayedNameCannotDriveTheTerminal(t *testing.T) {
	if got := printable("Safari\x1b[2J sur\n iOS"); got != "Safari[2J sur iOS" {
		t.Fatalf("got %q", got)
	}
}

func mustDecode(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
