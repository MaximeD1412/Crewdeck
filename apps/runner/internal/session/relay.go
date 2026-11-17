package session

import (
	"context"
	"crypto/ecdh"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
)

// The relay of a Session (SESSION-1, docs/security/e2e.md « Sessions »):
// what the agent and the Pilote say travels between the Runner and the tabs
// sealed under the Session's key, a 32-byte AES-256-GCM key the Runner draws
// when the Session first runs, keeps in memory and in `sessions/<id>/key`
// (mode 600), and wraps for each Appareil the Runner authenticated. The
// server forwards the frames and keeps none of them.
//
//   - live: each event of the log, the moment it is written, sealed under
//     "<sessionId>:<seq>", for every tab of the Session (the keys first);
//   - replay: for one tab, the keys, then the log's events from its fromSeq;
//   - input: the Pilote's, sealed by the tab under
//     "<sessionId>:input:<inputId>", opened, checked against its schema, and
//     handed to the Moteur once per inputId, recorded in `sessions/<id>/inputs`
//     so that a Runner started again does not hand it twice.

// RelayKeys are what the relay seals with.
type RelayKeys struct {
	// Runner is the Runner's X25519 key, the sender of every wrap.
	Runner *ecdh.PrivateKey
	// Holders gives the X25519 public keys of the Appareils the Runner
	// authenticated (vault.wrap's), read at each wrap: an Appareil approved
	// since gets its wrap at its next open.
	Holders func() ([][]byte, error)
}

const keyFile = "key"

// inputsKept is how many inputIds a Session remembers, to take each once.
const inputsKept = 10_000

// inputsFile holds the inputIds a Session took, one per line, appended
// before each input reaches the Moteur: a Runner started again takes none of
// them a second time.
const inputsFile = "inputs"

var b64 = base64.RawURLEncoding

// relayState is the relay's memory: the Sessions' keys, the inputIds taken.
type relayState struct {
	keys   map[string][]byte
	inputs map[string]*seenInputs
}

type seenInputs struct {
	ids   map[string]struct{}
	order []string
}

// add records id, false when it was already taken.
func (s *seenInputs) add(id string) bool {
	if _, seen := s.ids[id]; seen {
		return false
	}
	s.ids[id] = struct{}{}
	s.order = append(s.order, id)
	if len(s.order) > inputsKept {
		delete(s.ids, s.order[0])
		s.order = s.order[1:]
	}
	return true
}

// forget drops the last id added, which could not be recorded on disk.
func (s *seenInputs) forget(id string) {
	if n := len(s.order); n > 0 && s.order[n-1] == id {
		s.order = s.order[:n-1]
		delete(s.ids, id)
	}
}

// loadInputs reads the inputIds a Session took from its folder, the last
// inputsKept of them; a file grown past twice that is rewritten with those.
func loadInputs(path string) (*seenInputs, error) {
	seen := &seenInputs{ids: map[string]struct{}{}}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return seen, nil
	}
	if err != nil {
		return nil, err
	}
	lines := strings.Fields(string(data))
	for _, id := range lines {
		seen.add(id)
	}
	if len(lines) > 2*inputsKept {
		if err := writePrivate(path, []byte(strings.Join(seen.order, "\n")+"\n")); err != nil {
			return nil, err
		}
	}
	return seen, nil
}

// takeInput records the input's id, in memory and in the Session's folder,
// false when the Session took it already. An id that cannot be written is
// not taken: the tab's next send of it tries again.
func (m *Manager) takeInput(sessionID, inputID string) (bool, error) {
	m.relayMu.Lock()
	defer m.relayMu.Unlock()
	path := filepath.Join(sessionDir(m.cfg.Home, sessionID), inputsFile)
	seen, ok := m.relay.inputs[sessionID]
	if !ok {
		loaded, err := loadInputs(path)
		if err != nil {
			return false, err
		}
		seen = loaded
		m.relay.inputs[sessionID] = seen
	}
	if !seen.add(inputID) {
		return false, nil
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err == nil {
		_, err = f.WriteString(inputID + "\n")
		if closeErr := f.Close(); err == nil {
			err = closeErr
		}
	}
	if err != nil {
		seen.forget(inputID)
		return false, err
	}
	return true, nil
}

// sessionKey is the Session's key: from memory, else from its file, else
// drawn and written. Its folder must exist (the Session's record made it).
func (m *Manager) sessionKey(sessionID string) ([]byte, error) {
	m.relayMu.Lock()
	defer m.relayMu.Unlock()
	if key, ok := m.relay.keys[sessionID]; ok {
		return key, nil
	}
	path := filepath.Join(sessionDir(m.cfg.Home, sessionID), keyFile)
	key, err := os.ReadFile(path)
	switch {
	case err == nil && len(key) == 32:
	case err == nil, errors.Is(err, fs.ErrNotExist):
		if key, err = keys.GenerateAESKey(); err != nil {
			return nil, err
		}
		if err := writePrivate(path, key); err != nil {
			return nil, err
		}
	default:
		return nil, err
	}
	m.relay.keys[sessionID] = key
	return key, nil
}

// writePrivate writes data to path, mode 600, through a temporary file.
func writePrivate(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// sendKeys sends the Session's key wrapped for each holder, to tabID (every
// tab when empty).
func (m *Manager) sendKeys(ctx context.Context, sessionID, tabID string) ([]byte, error) {
	key, err := m.sessionKey(sessionID)
	if err != nil {
		return nil, err
	}
	holders, err := m.cfg.Keys.Holders()
	if err != nil {
		return nil, err
	}
	var wraps []contracts.RunnerSessionKeysWrapsElem
	for _, holder := range holders {
		holderID := b64.EncodeToString(holder)
		w, err := keys.SealWrap(m.cfg.Keys.Runner, holder, key, []byte(keys.InfoSessionKey), []byte(sessionID+":"+holderID))
		if err != nil {
			return nil, err
		}
		wraps = append(wraps, contracts.RunnerSessionKeysWrapsElem{HolderId: holderID, Enc: b64.EncodeToString(w.Enc), WrappedKey: b64.EncodeToString(w.Ciphertext), Tag: b64.EncodeToString(w.Tag)})
	}
	if len(wraps) == 0 {
		return nil, errors.New("no holder")
	}
	return key, m.cfg.Send(ctx, protocol.NewSessionKeys(sessionID, tabID, wraps))
}

// sendEvent seals the event under "<sessionId>:<seq>" and sends it, to tabID
// (every tab when empty). Its raw event stays on the Runner.
func (m *Manager) sendEvent(ctx context.Context, key []byte, sessionID, tabID string, event contracts.EngineEvent) error {
	plain, err := json.Marshal(withoutRaw(event))
	if err != nil {
		return err
	}
	seq := seqOf(event)
	sealed, err := keys.AESGCMSeal(key, plain, []byte(sessionID+":"+strconv.Itoa(seq)))
	if err != nil {
		return err
	}
	return m.cfg.Send(ctx, protocol.NewRelay(sessionID, tabID, seq, b64.EncodeToString(sealed[:12]), b64.EncodeToString(sealed[12:])))
}

// withoutRaw is the event without the provider's raw event.
func withoutRaw(event contracts.EngineEvent) contracts.EngineEvent {
	value := reflect.ValueOf(event.Value())
	if !value.IsValid() || value.IsNil() {
		return event
	}
	copied := reflect.New(value.Elem().Type())
	copied.Elem().Set(value.Elem())
	if raw := copied.Elem().FieldByName("Raw"); raw.IsValid() {
		raw.Set(reflect.Zero(raw.Type()))
	}
	var out contracts.EngineEvent
	union := reflect.ValueOf(&out).Elem()
	for i := range union.NumField() {
		if union.Field(i).Type() == copied.Type() {
			union.Field(i).Set(copied)
		}
	}
	return out
}

// relayContext is the context of one send of the relay.
func (m *Manager) relayContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(m.ctx, 10*time.Second)
}

// warnRelay logs a failed send of the relay, but offline: the frame is lost,
// the tab's open replays it once the Runner is back.
func (m *Manager) warnRelay(step, sessionID string, err error) {
	if err == nil || errors.Is(err, protocol.ErrNotConnected) || m.ctx.Err() != nil {
		return
	}
	m.cfg.Logger.Warn("session.relay", "sessionId", sessionID, "step", step, "error", errorKind(err))
}

// liveKeys sends the Session's key to its tabs as its run starts; the key
// it gives seals the run's live events, nil when the relay is off or failed.
func (m *Manager) liveKeys(sessionID string) []byte {
	if m.cfg.Keys == nil {
		return nil
	}
	ctx, cancel := m.relayContext()
	defer cancel()
	key, err := m.sendKeys(ctx, sessionID, "")
	m.warnRelay("keys", sessionID, err)
	return key
}

// relayLive sends a logged event to every tab of the Session.
func (m *Manager) relayLive(key []byte, sessionID string, event contracts.EngineEvent) {
	if key == nil {
		return
	}
	ctx, cancel := m.relayContext()
	defer cancel()
	m.warnRelay("event", sessionID, m.sendEvent(ctx, key, sessionID, "", event))
}

// ReplayTo sends the tab of the replay the Session's key, then its logged
// events from fromSeq, in the background. A Session the Runner does not know
// sends nothing.
func (m *Manager) ReplayTo(message contracts.RunnerSessionReplay) {
	if m.cfg.Keys == nil || message.FromSeq < 1 {
		return
	}
	m.mu.Lock()
	_, known := m.sessions[message.SessionId]
	closed := m.closed
	if known && !closed {
		m.wg.Add(1)
	}
	m.mu.Unlock()
	if !known || closed {
		return
	}
	go func() {
		defer m.wg.Done()
		ctx, cancel := context.WithCancel(m.ctx)
		defer cancel()
		key, err := m.sendKeys(ctx, message.SessionId, message.TabId)
		if err != nil {
			m.warnRelay("keys", message.SessionId, err)
			return
		}
		for event, err := range Replay(m.cfg.Home, message.SessionId, message.FromSeq-1) {
			if err == nil {
				err = m.sendEvent(ctx, key, message.SessionId, message.TabId, event)
			}
			if err != nil {
				m.warnRelay("replay", message.SessionId, err)
				return
			}
		}
	}()
}

// Input opens the Pilote's input and hands it to the Session's Moteur, once
// per inputId. One that does not open, or is outside its schema, is dropped
// without using up its inputId.
func (m *Manager) Input(message contracts.RunnerSessionInput) {
	if m.cfg.Keys == nil {
		return
	}
	m.mu.Lock()
	s, known := m.sessions[message.SessionId]
	m.mu.Unlock()
	if !known {
		return
	}
	payload, err := m.openInput(message)
	if err != nil {
		m.cfg.Logger.Warn("session.input", "sessionId", message.SessionId, "inputId", message.InputId, "error", "dropped")
		return
	}
	fresh, err := m.takeInput(message.SessionId, message.InputId)
	if err != nil {
		m.cfg.Logger.Warn("session.input", "sessionId", message.SessionId, "inputId", message.InputId, "error", "not recorded")
		return
	}
	if !fresh {
		return
	}
	s.mu.Lock()
	run := s.run
	s.mu.Unlock()
	if run == nil {
		m.cfg.Logger.Warn("session.input", "sessionId", message.SessionId, "inputId", message.InputId, "error", "not running")
		return
	}
	ctx, cancel := m.relayContext()
	defer cancel()
	if payload.Message != nil {
		if err := run.Send(ctx, payload.Message.Text); err != nil {
			m.cfg.Logger.Warn("session.input", "sessionId", message.SessionId, "inputId", message.InputId, "error", errorKind(err))
		}
	}
}

func (m *Manager) openInput(message contracts.RunnerSessionInput) (contracts.SessionInput, error) {
	nonce, err := b64.Strict().DecodeString(message.Nonce)
	if err != nil || len(nonce) != 12 {
		return contracts.SessionInput{}, errors.New("nonce")
	}
	ciphertext, err := b64.Strict().DecodeString(message.Ciphertext)
	if err != nil {
		return contracts.SessionInput{}, err
	}
	// The Session's key is read, never drawn, for an input: a Session never
	// run has no key a tab could have sealed with.
	m.relayMu.Lock()
	key, ok := m.relay.keys[message.SessionId]
	m.relayMu.Unlock()
	if !ok {
		stored, err := os.ReadFile(filepath.Join(sessionDir(m.cfg.Home, message.SessionId), keyFile))
		if err != nil || len(stored) != 32 {
			return contracts.SessionInput{}, errors.New("no key")
		}
		key = stored
	}
	plain, err := keys.AESGCMOpen(key, append(nonce, ciphertext...), []byte(message.SessionId+":input:"+message.InputId))
	if err != nil {
		return contracts.SessionInput{}, err
	}
	var payload contracts.SessionInput
	if err := json.Unmarshal(plain, &payload); err != nil {
		return contracts.SessionInput{}, err
	}
	return payload, nil
}
