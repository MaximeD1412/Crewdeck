package session_test

import (
	"bytes"
	"crypto/ecdh"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
)

const (
	tabID   = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d01"
	inputID = "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d02"
)

var b64 = base64.RawURLEncoding

// relayed is a setup whose Sessions are relayed: the Runner's key, and the
// Appareils it wraps each Session's key for.
type relayed struct {
	*setup
	runner  *ecdh.PrivateKey
	mu      sync.Mutex
	holders []*ecdh.PrivateKey
}

func newRelayed(t *testing.T, events ...contracts.EngineEvent) *relayed {
	t.Helper()
	r := &relayed{setup: newSetup(t, events...), runner: generate(t)}
	r.holders = []*ecdh.PrivateKey{generate(t)}
	r.keys = &session.RelayKeys{Runner: r.runner, Holders: func() ([][]byte, error) {
		r.mu.Lock()
		defer r.mu.Unlock()
		var public [][]byte
		for _, h := range r.holders {
			public = append(public, keys.PublicKeyBytes(h))
		}
		return public, nil
	}}
	return r
}

func generate(t *testing.T) *ecdh.PrivateKey {
	t.Helper()
	k, err := keys.GenerateKeyPair()
	if err != nil {
		t.Fatal(err)
	}
	return k
}

// frame is the next frame the manager relays.
func (r *relayed) frame(t *testing.T) any {
	t.Helper()
	select {
	case f := <-r.reports.frames:
		return f
	case <-time.After(10 * time.Second):
		t.Fatal("no frame relayed")
		return nil
	}
}

// quiet: no frame is relayed for a while.
func (r *relayed) quiet(t *testing.T) {
	t.Helper()
	select {
	case f := <-r.reports.frames:
		t.Fatalf("relayed %+v", f)
	case <-time.After(200 * time.Millisecond):
	}
}

// openKeys opens the wrap of holder in a session.keys, as an Appareil does:
// the wrap whose holderId is its public key, authenticated by the Runner's.
func (r *relayed) openKeys(t *testing.T, message contracts.RunnerSessionKeys, holder *ecdh.PrivateKey) []byte {
	t.Helper()
	holderID := b64.EncodeToString(keys.PublicKeyBytes(holder))
	for _, w := range message.Wraps {
		if w.HolderId != holderID {
			continue
		}
		key, err := keys.OpenWrap(holder, keys.PublicKeyBytes(r.runner), keys.Wrap{Enc: decode(t, w.Enc), Ciphertext: decode(t, w.WrappedKey), Tag: decode(t, w.Tag)},
			[]byte(keys.InfoSessionKey), []byte(message.SessionId+":"+holderID))
		if err != nil {
			t.Fatalf("open the wrap: %v", err)
		}
		return key
	}
	t.Fatalf("no wrap for %s in %+v", holderID, message.Wraps)
	return nil
}

func decode(t *testing.T, s string) []byte {
	t.Helper()
	b, err := b64.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// openFrame decrypts a relayed event with the Session's key, under its
// additional data "<sessionId>:<seq>".
func openFrame(t *testing.T, key []byte, frame contracts.RunnerRelay) map[string]any {
	t.Helper()
	plain, err := keys.AESGCMOpen(key, append(decode(t, frame.Nonce), decode(t, frame.Ciphertext)...), []byte(frame.SessionId+":"+strconv.Itoa(frame.Seq)))
	if err != nil {
		t.Fatalf("open the frame %d: %v", frame.Seq, err)
	}
	var event map[string]any
	if err := json.Unmarshal(plain, &event); err != nil {
		t.Fatal(err)
	}
	return event
}

// sealInput is the Pilote's input as a tab seals it, under "<sessionId>:input:<inputId>".
func sealInput(t *testing.T, key []byte, sessionID, id string, payload any) contracts.RunnerSessionInput {
	t.Helper()
	plain, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := keys.AESGCMSeal(key, plain, []byte(sessionID+":input:"+id))
	if err != nil {
		t.Fatal(err)
	}
	return contracts.RunnerSessionInput{
		Type: "session.input", Id: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d03", At: time.Now().UTC(),
		SessionId: sessionID, TabId: tabID, InputId: id, Nonce: b64.EncodeToString(sealed[:12]), Ciphertext: b64.EncodeToString(sealed[12:]),
	}
}

func replay(sessionID string, fromSeq int) contracts.RunnerSessionReplay {
	return contracts.RunnerSessionReplay{Type: "session.replay", Id: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d04", At: time.Now().UTC(), SessionId: sessionID, TabId: tabID, FromSeq: fromSeq}
}

func withRaw(event contracts.EngineEvent) contracts.EngineEvent {
	event.Message.Raw = json.RawMessage(`{"provider":"secret"}`)
	return event
}

func TestRelaySendsTheKeysThenEachLoggedEventSealedLiveToEveryTab(t *testing.T) {
	r := newRelayed(t, withRaw(message("je lis le panier")), question("q1"))
	m := r.manager(t)

	m.Start(start(firstID, "feat/12-panier"))
	keysMessage, ok := r.frame(t).(contracts.RunnerSessionKeys)
	if !ok || keysMessage.SessionId != firstID || keysMessage.TabId != nil {
		t.Fatalf("first frame %+v, want the Session's keys for every tab", keysMessage)
	}
	key := r.openKeys(t, keysMessage, r.holders[0])
	for seq, kind := range []string{"message", "question"} {
		frame, ok := r.frame(t).(contracts.RunnerRelay)
		if !ok || frame.Seq != seq+1 || frame.TabId != nil || frame.SessionId != firstID {
			t.Fatalf("frame %+v, want the live event %d", frame, seq+1)
		}
		event := openFrame(t, key, frame)
		if event["kind"] != kind || event["seq"] != float64(seq+1) {
			t.Fatalf("event %v, want the %s of seq %d", event, kind, seq+1)
		}
		if _, raw := event["raw"]; raw {
			t.Fatalf("event %v: its raw left the Runner", event)
		}
		if strings.Contains(frame.Ciphertext, b64.EncodeToString([]byte("je lis"))) {
			t.Fatal("the frame holds the plaintext")
		}
	}
	// The log keeps the raw event; only the relay drops it.
	logData, err := os.ReadFile(filepath.Join(r.home, "sessions", firstID, "log.jsonl"))
	if err != nil || !bytes.Contains(logData, []byte(`"provider":"secret"`)) {
		t.Fatalf("log %s, %v", logData, err)
	}
}

func TestRelayAFrameUnderTheAdditionalDataOfAnotherSeqDoesNotOpen(t *testing.T) {
	r := newRelayed(t, message("un"), question("q1"))
	m := r.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	key := r.openKeys(t, r.frame(t).(contracts.RunnerSessionKeys), r.holders[0])
	frame := r.frame(t).(contracts.RunnerRelay)
	if _, err := keys.AESGCMOpen(key, append(decode(t, frame.Nonce), decode(t, frame.Ciphertext)...), []byte(firstID+":2")); err == nil {
		t.Fatal("the frame of seq 1 opened as seq 2")
	}
}

func TestRelayKeepsOneKeyPerSessionInItsFolderForThePiloteOnly(t *testing.T) {
	r := newRelayed(t, message("un"), question("q1"))
	m := r.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	key := r.openKeys(t, r.frame(t).(contracts.RunnerSessionKeys), r.holders[0])

	path := filepath.Join(r.home, "sessions", firstID, "key")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("key file mode %o, want 600", info.Mode().Perm())
	}
	stored, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(stored, key) || len(key) != 32 {
		t.Fatalf("stored %x (%v), want the 32-byte key %x", stored, err, key)
	}

	// A Runner started again wraps the same key.
	m.Close()
	again := r.manager(t)
	again.ReplayTo(replay(firstID, 1))
	for {
		if k, ok := r.frame(t).(contracts.RunnerSessionKeys); ok && k.TabId != nil {
			if !bytes.Equal(r.openKeys(t, k, r.holders[0]), key) {
				t.Fatal("another key after a restart")
			}
			return
		}
	}
}

func TestRelayReplaySendsTheKeysThenTheEventsFromFromSeqToTheTabAndWrapsForAHolderApprovedSince(t *testing.T) {
	r := newRelayed(t, message("un"), message("deux"), message("trois"), result("eng-1"))
	m := r.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	r.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)
	for range 5 { // the live keys and the four events
		r.frame(t)
	}
	later := generate(t)
	r.mu.Lock()
	r.holders = append(r.holders, later)
	r.mu.Unlock()

	m.ReplayTo(replay(firstID, 2))
	keysMessage, ok := r.frame(t).(contracts.RunnerSessionKeys)
	if !ok || keysMessage.TabId == nil || *keysMessage.TabId != tabID || len(keysMessage.Wraps) != 2 {
		t.Fatalf("first frame %+v, want the keys for the tab, wrapped for both holders", keysMessage)
	}
	key := r.openKeys(t, keysMessage, later)
	if !bytes.Equal(key, r.openKeys(t, keysMessage, r.holders[0])) {
		t.Fatal("two holders, two keys")
	}
	for _, want := range []struct {
		seq  int
		text string
	}{{2, "deux"}, {3, "trois"}} {
		frame, ok := r.frame(t).(contracts.RunnerRelay)
		if !ok || frame.Seq != want.seq || frame.TabId == nil || *frame.TabId != tabID {
			t.Fatalf("frame %+v, want seq %d for the tab", frame, want.seq)
		}
		if event := openFrame(t, key, frame); event["text"] != want.text {
			t.Fatalf("event %v, want %q", event, want.text)
		}
	}
	if frame := r.frame(t).(contracts.RunnerRelay); frame.Seq != 4 {
		t.Fatalf("frame %d, want the result's 4", frame.Seq)
	}
	r.quiet(t)
}

func TestRelayReplayOfASessionTheRunnerDoesNotKnowSendsNothing(t *testing.T) {
	r := newRelayed(t)
	m := r.manager(t)
	m.ReplayTo(replay(secondID, 1))
	r.quiet(t)
	if exists(filepath.Join(r.home, "sessions", secondID)) {
		t.Fatal("a folder for a Session the Runner does not know")
	}
}

func TestRelayHandsAMessageToTheMoteurDecryptedOnceForItsInputID(t *testing.T) {
	r := newRelayed(t, message("une question ?"), question("q1"))
	m := r.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	key := r.openKeys(t, r.frame(t).(contracts.RunnerSessionKeys), r.holders[0])
	r.reports.await(t, firstID, contracts.RunnerSessionStateStateWaiting)

	input := sealInput(t, key, firstID, inputID, map[string]any{"kind": "message", "text": "Continue avec le bleu"})
	m.Input(input)
	m.Input(input) // sent twice by the tab: handled once
	run := r.engine.Runs()[0]
	if sent := run.Sent(); len(sent) != 1 || sent[0] != "Continue avec le bleu" {
		t.Fatalf("sent %q, want the message once", sent)
	}
}

func TestRelayTakesAnInputOnceAcrossARestartAndAResume(t *testing.T) {
	r := newRelayed(t, message("une question ?"), question("q1"))
	m := r.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	key := r.openKeys(t, r.frame(t).(contracts.RunnerSessionKeys), r.holders[0])
	r.reports.await(t, firstID, contracts.RunnerSessionStateStateWaiting)
	input := sealInput(t, key, firstID, inputID, map[string]any{"kind": "message", "text": "Continue avec le bleu"})
	m.Input(input)
	if sent := r.engine.Runs()[0].Sent(); len(sent) != 1 {
		t.Fatalf("sent %q before the restart, want the message once", sent)
	}
	m.Close()

	restarted := r.manager(t)
	restarted.Resume(firstID)
	r.reports.await(t, firstID, contracts.RunnerSessionStateStateWaiting)
	runs := r.engine.Runs()
	if len(runs) != 2 {
		t.Fatalf("%d runs, want the resumed one", len(runs))
	}
	restarted.Input(input) // the tab sends it again after the restart
	fresh := sealInput(t, key, firstID, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d04", map[string]any{"kind": "message", "text": "Et le rouge"})
	restarted.Input(fresh)
	if sent := runs[1].Sent(); len(sent) != 1 || sent[0] != "Et le rouge" {
		t.Fatalf("sent %q after the restart, want only the new message", sent)
	}
	if info, err := os.Stat(filepath.Join(r.home, "sessions", firstID, "inputs")); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("inputs file %v (%v), want mode 600", info, err)
	}
}

// web-relay.json is written by the browser's test run
// (apps/web/src/sessions/relay.spec.ts): an input the page sealed under the
// Session key of relay.json, which the Runner hands to its Moteur.
func TestRelayHandsTheMoteurAnInputTheBrowserSealed(t *testing.T) {
	var v struct {
		SessionID  string `json:"sessionId"`
		SessionKey string `json:"sessionKey"`
		Payload    struct {
			Text string `json:"text"`
		} `json:"payload"`
		Frame struct {
			InputID    string `json:"inputId"`
			Nonce      string `json:"nonce"`
			Ciphertext string `json:"ciphertext"`
		} `json:"frame"`
	}
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "crypto", "web-relay.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &v); err != nil {
		t.Fatal(err)
	}
	r := newRelayed(t, message("une question ?"), question("q1"))
	// The Session's key is the one the browser sealed under.
	dir := filepath.Join(r.home, "sessions", v.SessionID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "key"), decode(t, v.SessionKey), 0o600); err != nil {
		t.Fatal(err)
	}
	m := r.manager(t)
	m.Start(start(v.SessionID, "feat/12-panier"))
	if key := r.openKeys(t, r.frame(t).(contracts.RunnerSessionKeys), r.holders[0]); !bytes.Equal(key, decode(t, v.SessionKey)) {
		t.Fatal("the Session is not under the browser's key")
	}
	r.reports.await(t, v.SessionID, contracts.RunnerSessionStateStateWaiting)

	m.Input(contracts.RunnerSessionInput{
		Type: "session.input", Id: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d03", At: time.Now().UTC(),
		SessionId: v.SessionID, TabId: tabID, InputId: v.Frame.InputID, Nonce: v.Frame.Nonce, Ciphertext: v.Frame.Ciphertext,
	})
	if sent := r.engine.Runs()[0].Sent(); len(sent) != 1 || sent[0] != v.Payload.Text {
		t.Fatalf("sent %q, want %q", sent, v.Payload.Text)
	}
}

func TestRelayDropsAnInputSealedForAnotherInputIDOrOutsideItsSchema(t *testing.T) {
	r := newRelayed(t, message("une question ?"), question("q1"))
	m := r.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	key := r.openKeys(t, r.frame(t).(contracts.RunnerSessionKeys), r.holders[0])
	r.reports.await(t, firstID, contracts.RunnerSessionStateStateWaiting)

	swapped := sealInput(t, key, firstID, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d09", map[string]any{"kind": "message", "text": "rejouée"})
	swapped.InputId = inputID
	m.Input(swapped)
	m.Input(sealInput(t, key, firstID, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d0a", map[string]any{"kind": "message", "text": ""}))
	m.Input(sealInput(t, key, firstID, "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d0b", map[string]any{"kind": "shell", "command": "rm -rf"}))
	m.Input(sealInput(t, key, secondID, inputID, map[string]any{"kind": "message", "text": "ailleurs"}))
	if sent := r.engine.Runs()[0].Sent(); len(sent) != 0 {
		t.Fatalf("sent %q, want nothing", sent)
	}

	// The real input of that inputId still goes through: a bad one did not use it up.
	m.Input(sealInput(t, key, firstID, inputID, map[string]any{"kind": "message", "text": "la vraie"}))
	if sent := r.engine.Runs()[0].Sent(); len(sent) != 1 || sent[0] != "la vraie" {
		t.Fatalf("sent %q, want the real input", sent)
	}
}

func TestRelayWithoutKeysRelaysNothing(t *testing.T) {
	s := newSetup(t, message("un"), result("eng-1"))
	m := s.manager(t)
	m.Start(start(firstID, "feat/12-panier"))
	s.reports.await(t, firstID, contracts.RunnerSessionStateStateEnded)
	select {
	case f := <-s.reports.frames:
		t.Fatalf("relayed %+v without keys", f)
	default:
	}
}
