package main

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
)

// The scenario's Projet, as the real scenario names it (apps/server/src/testing/scenarios/smoke.ts).
const (
	projectOwner = "smoke"
	projectName  = "depot"
	baseBranch   = "main"
	cookieName   = "crewdeck_session"
	// The PR the scenario opens on the Projet, read by the Contrat check.
	pullNumber = "1"
	pullHead   = "feat/1-smoke"
)

// server is the fake: one scenario at a time, as the real server's scenarios.
type server struct {
	fixtures string
	logger   *slog.Logger

	mu       sync.Mutex
	scenario *scenario
}

// scenario is what POST /api/testing/scenarios/smoke drew: the page's side
// of the link (its secret, its Appareil's key), the Runner it links, its
// Sessions.
type scenario struct {
	shortID, secret, confirmToken, cookie string
	device                                *ecdh.PrivateKey
	linkID, runnerID, token               string
	runnerPublicKey                       []byte
	linked                                map[string]any // the link's status once confirmed
	conn                                  *websocket.Conn
	pending                               []map[string]any // session.start waiting for the Runner
	sessions                              map[string]*session
}

type session struct {
	ID      string  `json:"id"`
	State   string  `json:"state"`
	Outcome *string `json:"outcome"`
	Error   *string `json:"error"`
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/testing/scenarios/{name}", s.runScenario)
	mux.HandleFunc("POST /api/testing/smoke/confirm", s.confirm)
	mux.HandleFunc("POST /api/testing/smoke/sessions", s.startSession)
	mux.HandleFunc("GET /api/sessions/{id}", s.getSession)
	mux.HandleFunc("POST /api/runner/link", s.link)
	mux.HandleFunc("POST /api/runner/link/{id}/pairing", s.pairing)
	mux.HandleFunc("GET /api/runner/link/{id}", s.linkStatus)
	mux.HandleFunc("GET /api/ws", s.socket)
	mux.HandleFunc("GET /fake-github/repos/{owner}/{repo}/pulls/{number}", s.pullRequest)
	return mux
}

func (s *server) runScenario(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("name") != "smoke" {
		fail(w, http.StatusNotFound, "testing.unknown-scenario", "Scénario de test inconnu.")
		return
	}
	device, err := keys.GenerateKeyPair()
	if err != nil {
		fail(w, http.StatusInternalServerError, "server.internal", err.Error())
		return
	}
	secret := random(16)
	sc := &scenario{
		shortID:      keys.EncodeBase32(random(3))[:4],
		secret:       keys.EncodeBase32(secret),
		confirmToken: base64.RawURLEncoding.EncodeToString(random(24)),
		cookie:       base64.RawURLEncoding.EncodeToString(random(24)),
		device:       device,
		linkID:       newID(),
		runnerID:     newID(),
		token:        "crd_" + base64.RawURLEncoding.EncodeToString(random(32)),
		sessions:     map[string]*session{},
	}
	s.mu.Lock()
	if s.scenario != nil && s.scenario.conn != nil {
		s.scenario.conn.Close(websocket.StatusNormalClosure, "scenario")
	}
	s.scenario = sc
	s.mu.Unlock()
	reply(w, http.StatusOK, map[string]any{
		"name":          "smoke",
		"path":          "/",
		"sessionCookie": cookieName + "=" + sc.cookie,
		"runnerLink":    map[string]string{"code": sc.shortID + "-" + sc.secret, "confirmToken": sc.confirmToken},
	})
}

// current is the scenario a request names with its confirm token, nil and
// answered 404 otherwise.
func (s *server) current(w http.ResponseWriter, r *http.Request) *scenario {
	var body struct {
		ConfirmToken string `json:"confirmToken"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if s.scenario == nil || body.ConfirmToken != s.scenario.confirmToken {
		fail(w, http.StatusNotFound, "testing.smoke-unknown", "Aucun scénario smoke avec ce jeton.")
		return nil
	}
	return s.scenario
}

// confirm is the page's confirmation: it checks the Runner's proof, then
// answers with its own and the vault key wrapped for the Runner.
func (s *server) confirm(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sc := s.current(w, r)
	if sc == nil {
		return
	}
	if sc.runnerPublicKey == nil {
		fail(w, http.StatusConflict, "testing.smoke-not-pending", "Le Runner n’a pas encore envoyé sa preuve de liaison.")
		return
	}
	secret, _ := keys.DecodeBase32(sc.secret)
	devicePublicKey := keys.PublicKeyBytes(sc.device)
	vaultKey, err := keys.GenerateAESKey()
	if err == nil {
		var wrap keys.Wrap
		wrap, err = keys.SealWrap(sc.device, sc.runnerPublicKey, vaultKey, []byte(keys.InfoVaultWrap), keys.VaultWrapAAD(sc.runnerID, 1))
		b := base64.RawURLEncoding.EncodeToString
		sc.linked = map[string]any{
			"state":    "linked",
			"runnerId": sc.runnerID,
			"token":    sc.token,
			"pairing": map[string]any{
				"proof":           b(keys.PairingProof(keys.ProofLabelDevice, secret, sc.shortID, devicePublicKey, sc.runnerPublicKey)),
				"vaultKeyVersion": 1,
				"runnerVaultWrap": map[string]string{"enc": b(wrap.Enc), "ciphertext": b(wrap.Ciphertext), "tag": b(wrap.Tag)},
			},
		}
	}
	if err != nil {
		fail(w, http.StatusInternalServerError, "server.internal", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) link(w http.ResponseWriter, r *http.Request) {
	var request struct {
		ShortID string   `json:"shortId"`
		Engines []string `json:"engines"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		fail(w, http.StatusBadRequest, "validation.invalid", "Requête invalide.")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.scenario == nil || request.ShortID != s.scenario.shortID {
		fail(w, http.StatusNotFound, "runner.link-code-unknown", "Ce code de liaison n’existe pas.")
		return
	}
	if len(request.Engines) == 0 {
		fail(w, http.StatusUnprocessableEntity, "runner.no-engine", "Aucun Moteur.")
		return
	}
	reply(w, http.StatusAccepted, map[string]any{
		"linkId":         s.scenario.linkID,
		"browserPairing": map[string]string{"devicePublicKey": base64.RawURLEncoding.EncodeToString(keys.PublicKeyBytes(s.scenario.device)), "deviceName": "Smoke sur Go"},
	})
}

func (s *server) pairing(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Pairing struct {
			RunnerPublicKey string `json:"runnerPublicKey"`
			Proof           string `json:"proof"`
		} `json:"pairing"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	s.mu.Lock()
	defer s.mu.Unlock()
	sc := s.scenario
	if sc == nil || r.PathValue("id") != sc.linkID {
		fail(w, http.StatusNotFound, "runner.link-code-unknown", "Ce code de liaison n’existe pas.")
		return
	}
	runnerPublicKey, err1 := base64.RawURLEncoding.DecodeString(body.Pairing.RunnerPublicKey)
	proof, err2 := base64.RawURLEncoding.DecodeString(body.Pairing.Proof)
	secret, _ := keys.DecodeBase32(sc.secret)
	// The page checks the Runner's proof before it confirms (US-2).
	if err1 != nil || err2 != nil || !keys.VerifyPairingProof(proof, keys.ProofLabelRunner, secret, sc.shortID, runnerPublicKey, keys.PublicKeyBytes(sc.device)) {
		fail(w, http.StatusUnprocessableEntity, "runner.link-pairing-invalid", "La preuve du Runner ne correspond pas.")
		return
	}
	sc.runnerPublicKey = runnerPublicKey
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) linkStatus(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sc := s.scenario
	if sc == nil || r.PathValue("id") != sc.linkID {
		fail(w, http.StatusNotFound, "runner.link-code-unknown", "Ce code de liaison n’existe pas.")
		return
	}
	if sc.linked == nil {
		reply(w, http.StatusOK, map[string]any{"state": "pending"})
		return
	}
	reply(w, http.StatusOK, sc.linked)
}

// pullRequest is the scenario's PR, in GitHub's shape, as the real server's
// fake GitHub serves it at /fake-github (fake-github.controller.ts).
func (s *server) pullRequest(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	sc := s.scenario
	s.mu.Unlock()
	if sc == nil || r.PathValue("owner") != projectOwner || r.PathValue("repo") != projectName || r.PathValue("number") != pullNumber {
		fail(w, http.StatusNotFound, "fake-github.not-found", "Introuvable sur le faux GitHub.")
		return
	}
	reply(w, http.StatusOK, map[string]any{
		"number": 1,
		"title":  "Smoke test",
		"state":  "open",
		"draft":  false,
		"merged": false,
		"body":   "Le smoke test du Runner compilé.\n\nCloses #1\n",
		"head":   map[string]string{"ref": pullHead, "sha": "4b825dc642cb6eb9a060e54bf8d69288fbee4904"},
		"base":   map[string]string{"ref": baseBranch},
		"labels": []map[string]string{{"name": "conception"}},
	})
}

// startSession sends session.start for the scenario's Projet, at once when
// the Runner is connected, else at its hello, as the server does.
func (s *server) startSession(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sc := s.current(w, r)
	if sc == nil {
		return
	}
	start, err := s.fixture("session.start.json")
	if err != nil {
		fail(w, http.StatusInternalServerError, "server.internal", err.Error())
		return
	}
	id := newID()
	delete(start, "step")
	start["id"], start["at"], start["sessionId"], start["projectId"] = newID(), now(), id, newID()
	start["origin"] = map[string]string{"kind": "github", "owner": projectOwner, "name": projectName}
	start["branch"], start["base"], start["permissionMode"], start["title"] = "smoke/session", baseBranch, "auto", "Smoke test"
	// A Projet without « Préparer le worktree » nor « Nettoyer le worktree »:
	// the fixture's are bytes the Runner's vault does not open.
	start["worktreeCommands"] = nil
	sc.sessions[id] = &session{ID: id, State: "starting"}
	sc.pending = append(sc.pending, start)
	s.flush(r.Context(), sc)
	reply(w, http.StatusCreated, sc.sessions[id])
}

func (s *server) getSession(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sc := s.scenario
	cookie, err := r.Cookie(cookieName)
	if sc == nil || err != nil || cookie.Value != sc.cookie {
		fail(w, http.StatusUnauthorized, "auth.required", "Connecte-toi.")
		return
	}
	found, ok := sc.sessions[r.PathValue("id")]
	if !ok {
		fail(w, http.StatusNotFound, "sessions.not-found", "Session introuvable.")
		return
	}
	reply(w, http.StatusOK, found)
}

// socket is the Runner's connection: its hello accepted with the fixture,
// its heartbeats answered, its session.state kept.
func (s *server) socket(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	sc := s.scenario
	s.mu.Unlock()
	if sc == nil || r.URL.Query().Get("client") != "runner" || r.Header.Get("Authorization") != "Bearer "+sc.token {
		fail(w, http.StatusUnauthorized, "auth.required", "Runner inconnu.")
		return
	}
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(1 << 20)
	ctx := r.Context()
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			s.mu.Lock()
			if sc.conn == conn {
				sc.conn = nil
			}
			s.mu.Unlock()
			return
		}
		var message map[string]any
		if json.Unmarshal(data, &message) != nil {
			continue
		}
		s.logger.Info("runner", "type", message["type"], "state", message["state"])
		switch message["type"] {
		case "hello":
			accepted, err := s.fixture("hello.accepted.json")
			if err != nil {
				return
			}
			accepted["id"], accepted["at"], accepted["runnerId"] = newID(), now(), sc.runnerID
			if write(ctx, conn, accepted) != nil {
				return
			}
			s.mu.Lock()
			sc.conn = conn
			s.flush(ctx, sc)
			s.mu.Unlock()
		case "heartbeat":
			ack, err := s.fixture("heartbeat.ack.json")
			if err != nil {
				return
			}
			ack["id"], ack["at"] = newID(), now()
			_ = write(ctx, conn, ack)
		case "session.state":
			s.mu.Lock()
			if found, ok := sc.sessions[fmt.Sprint(message["sessionId"])]; ok && found.State != "ended" {
				found.State = fmt.Sprint(message["state"])
				found.Outcome, found.Error = text(message["outcome"]), text(message["error"])
			}
			s.mu.Unlock()
		}
	}
}

// flush sends the Sessions waiting for the Runner, with s.mu held.
func (s *server) flush(ctx context.Context, sc *scenario) {
	if sc.conn == nil {
		return
	}
	for len(sc.pending) > 0 {
		if err := write(ctx, sc.conn, sc.pending[0]); err != nil {
			return
		}
		sc.pending = sc.pending[1:]
	}
}

// fixture is a message of packages/contracts/fixtures/runner/.
func (s *server) fixture(name string) (map[string]any, error) {
	data, err := os.ReadFile(filepath.Join(s.fixtures, name))
	if err != nil {
		return nil, err
	}
	var message map[string]any
	return message, json.Unmarshal(data, &message)
}

func write(ctx context.Context, conn *websocket.Conn, message any) error {
	data, err := json.Marshal(message)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return conn.Write(ctx, websocket.MessageText, data)
}

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// fail answers the error envelope of ADR 0008.
func fail(w http.ResponseWriter, status int, code, message string) {
	reply(w, status, map[string]any{"code": code, "message": message})
}

func text(value any) *string {
	if s, ok := value.(string); ok && s != "" {
		return &s
	}
	return nil
}

func random(n int) []byte {
	b := make([]byte, n)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		panic(errors.New("fakeserver: no randomness"))
	}
	return b
}

func now() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

// newID is a UUID v7, as the server's ids.
func newID() string {
	b := random(16)
	var ms [8]byte
	binary.BigEndian.PutUint64(ms[:], uint64(time.Now().UnixMilli()))
	copy(b[:6], ms[2:])
	b[6] = 0x70 | (b[6] & 0x0f)
	b[8] = 0x80 | (b[8] & 0x3f)
	return strings.ToLower(fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]))
}
