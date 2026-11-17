package folders

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

const (
	runnerID  = "019a6f00-0000-7000-8000-0000000000e1"
	requestID = "019a6f00-0000-7000-8000-0000000000f1"
	tabID     = "019a6f00-0000-7000-8000-0000000000f2"
)

// sender records what the handler sends.
type sender struct {
	mu   sync.Mutex
	sent []any
}

func (s *sender) Send(_ context.Context, message any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent = append(s.sent, message)
	return nil
}

func (s *sender) take() []any {
	s.mu.Lock()
	defer s.mu.Unlock()
	sent := s.sent
	s.sent = nil
	return sent
}

// vault is a vault key as the link leaves it: sealed by an Appareil for this
// Runner, opened with the Runner's key.
func vault(t *testing.T) *keys.Vault {
	t.Helper()
	runner, _ := keys.GenerateKeyPair()
	device, _ := keys.GenerateKeyPair()
	vaultKey, _ := keys.GenerateAESKey()
	w, err := keys.SealWrap(device, keys.PublicKeyBytes(runner), vaultKey, []byte(keys.InfoVaultWrap), keys.VaultWrapAAD(runnerID, 1))
	if err != nil {
		t.Fatal(err)
	}
	v, err := keys.Unlock(runner, keys.PublicKeyBytes(device), runnerID, 1, w)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

type fixture struct {
	handler *Handler
	vault   *keys.Vault
	sender  *sender
	store   state.Store
	home    string
	logs    *bytes.Buffer
}

// newFixture is a linked Runner of a temporary home, its handler sending to a fake.
func newFixture(t *testing.T) *fixture {
	t.Helper()
	c, home := checker(t)
	f := &fixture{vault: vault(t), sender: &sender{}, store: state.Store{Dir: c.StateDir}, home: home, logs: &bytes.Buffer{}}
	if err := f.store.Save(state.State{Server: "https://crewdeck.example", RunnerID: runnerID, Token: "rnr_token"}); err != nil {
		t.Fatal(err)
	}
	f.handler = New(Config{
		Checker: c,
		Store:   f.store,
		Vault:   f.vault,
		Send:    f.sender.Send,
		Logger:  slog.New(slog.NewJSONHandler(f.logs, &slog.HandlerOptions{Level: slog.LevelDebug})),
	})
	return f
}

func (f *fixture) seal(t *testing.T, plaintext, aad string) (string, string) {
	t.Helper()
	item, err := f.vault.SealItem([]byte(plaintext), []byte(aad))
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(item.Key), base64.RawURLEncoding.EncodeToString(item.Ciphertext)
}

func (f *fixture) check(t *testing.T, path string) contracts.RunnerFolderCheck {
	t.Helper()
	data, _ := json.Marshal(contracts.FolderCheck{Path: path})
	key, ciphertext := f.seal(t, string(data), "folder.check:"+requestID)
	return contracts.RunnerFolderCheck{Type: protocol.TypeFolderCheck, Id: requestID, RequestId: requestID, TabId: tabID, Sealed: contracts.RunnerFolderCheckSealed{Key: key, Ciphertext: ciphertext}}
}

// checkFor is the check of `path` while choosing projectID's folder again.
func (f *fixture) checkFor(t *testing.T, path, projectID string) contracts.RunnerFolderCheck {
	t.Helper()
	data, _ := json.Marshal(contracts.FolderCheck{Path: path, ProjectId: &projectID})
	key, ciphertext := f.seal(t, string(data), "folder.check:"+requestID)
	return contracts.RunnerFolderCheck{Type: protocol.TypeFolderCheck, Id: requestID, RequestId: requestID, TabId: tabID, Sealed: contracts.RunnerFolderCheckSealed{Key: key, Ciphertext: ciphertext}}
}

func (f *fixture) attach(t *testing.T, projectID, path string) contracts.RunnerProjectFolderAttach {
	t.Helper()
	data, _ := json.Marshal(contracts.FolderCheck{Path: path})
	key, ciphertext := f.seal(t, string(data), "project:"+projectID+":folder")
	return contracts.RunnerProjectFolderAttach{Type: protocol.TypeProjectFolderAttach, Id: requestID, ProjectId: projectID, Sealed: contracts.RunnerProjectFolderAttachSealed{Key: key, Ciphertext: ciphertext}}
}

// opened opens a folder.checked as the tab does.
func (f *fixture) opened(t *testing.T, message contracts.RunnerFolderChecked) contracts.FolderCheckResult {
	t.Helper()
	key, _ := base64.RawURLEncoding.DecodeString(message.Sealed.Key)
	ciphertext, _ := base64.RawURLEncoding.DecodeString(message.Sealed.Ciphertext)
	plaintext, err := f.vault.OpenItem(keys.SealedItem{Key: key, Ciphertext: ciphertext}, []byte("folder.checked:"+message.RequestId))
	if err != nil {
		t.Fatalf("open folder.checked: %v", err)
	}
	var result contracts.FolderCheckResult
	if err := json.Unmarshal(plaintext, &result); err != nil {
		t.Fatalf("decode %s: %v", plaintext, err)
	}
	return result
}

// present is the one projects.folders sent, its ids.
func present(t *testing.T, sent []any) []string {
	t.Helper()
	if len(sent) != 1 {
		t.Fatalf("sent %d messages, want one projects.folders", len(sent))
	}
	message, ok := sent[0].(contracts.RunnerProjectsFolders)
	if !ok {
		t.Fatalf("sent %T, want projects.folders", sent[0])
	}
	data, _ := json.Marshal(message)
	if err := json.Unmarshal(data, &contracts.RunnerProjectsFolders{}); err != nil {
		t.Fatalf("projects.folders %s: %v", data, err)
	}
	return message.Present
}

func (f *fixture) assertNoClearText(t *testing.T, secrets ...string) {
	t.Helper()
	for _, secret := range secrets {
		if strings.Contains(f.logs.String(), secret) {
			t.Fatalf("the logs hold %q:\n%s", secret, f.logs)
		}
	}
}

func TestACheckAnswersItsTabWithItsResultSealed(t *testing.T) {
	f := newFixture(t)
	repository(t, filepath.Join(f.home, "projets", "recettes"), 2)

	if err := f.handler.HandleCheck(context.Background(), f.check(t, "~/projets/recettes")); err != nil {
		t.Fatal(err)
	}

	sent := f.sender.take()
	if len(sent) != 1 {
		t.Fatalf("sent %d messages, want one folder.checked", len(sent))
	}
	checked, ok := sent[0].(contracts.RunnerFolderChecked)
	if !ok || checked.RequestId != requestID || checked.TabId != tabID || checked.Type != protocol.TypeFolderChecked {
		t.Fatalf("sent %+v", sent[0])
	}
	data, _ := json.Marshal(checked)
	if err := json.Unmarshal(data, &contracts.RunnerFolderChecked{}); err != nil {
		t.Fatalf("folder.checked %s: %v", data, err)
	}
	if strings.Contains(string(data), "recettes") || strings.Contains(string(data), f.home) {
		t.Fatalf("folder.checked %s holds the path or the name in clear", data)
	}
	branch := "main"
	want := contracts.FolderCheckResult{State: contracts.FolderCheckResultStateReady, HasCode: true, Branch: &branch, Name: "recettes"}
	got := f.opened(t, checked)
	if got.State != want.State || got.HasCode != want.HasCode || got.Name != want.Name || got.Branch != "main" {
		t.Fatalf("opened %+v, want %+v", got, want)
	}
	f.assertNoClearText(t, "recettes", f.home)
}

func TestACheckSaysAnotherProjetsFolderIsTaken(t *testing.T) {
	f := newFixture(t)
	folder := filepath.Join(f.home, "recettes")
	repository(t, folder, 2)
	if err := f.handler.HandleAttach(context.Background(), f.attach(t, otherProject, folder)); err != nil {
		t.Fatal(err)
	}
	f.sender.take()

	if err := f.handler.HandleCheck(context.Background(), f.check(t, folder)); err != nil {
		t.Fatal(err)
	}

	checked := f.sender.take()[0].(contracts.RunnerFolderChecked)
	if got := f.opened(t, checked); got.State != contracts.FolderCheckResultStateTaken {
		t.Fatalf("opened %+v, want taken", got)
	}
}

func TestARepickCheckOfTheProjetsOwnFolderIsNotTakenButAnothersIs(t *testing.T) {
	f := newFixture(t)
	folder := filepath.Join(f.home, "recettes")
	repository(t, folder, 2)
	// Its folder deleted then made again at the same path: runner.json still names it.
	if err := f.handler.HandleAttach(context.Background(), f.attach(t, thisProject, folder)); err != nil {
		t.Fatal(err)
	}
	f.sender.take()

	if err := f.handler.HandleCheck(context.Background(), f.checkFor(t, folder, thisProject)); err != nil {
		t.Fatal(err)
	}
	if got := f.opened(t, f.sender.take()[0].(contracts.RunnerFolderChecked)); got.State != contracts.FolderCheckResultStateReady {
		t.Fatalf("its own folder: opened %+v, want ready", got)
	}
	if err := f.handler.HandleCheck(context.Background(), f.checkFor(t, folder, otherProject)); err != nil {
		t.Fatal(err)
	}
	if got := f.opened(t, f.sender.take()[0].(contracts.RunnerFolderChecked)); got.State != contracts.FolderCheckResultStateTaken {
		t.Fatalf("another Projet's folder: opened %+v, want taken", got)
	}
}

func TestACheckThatDoesNotOpenIsDroppedAndLoggedByItsIdsOnly(t *testing.T) {
	f := newFixture(t)
	mkdir(t, filepath.Join(f.home, "recettes"))
	message := f.check(t, "~/recettes")
	message.RequestId = "019a6f00-0000-7000-8000-0000000000f9" // sealed for another request

	if err := f.handler.HandleCheck(context.Background(), message); err != nil {
		t.Fatal(err)
	}

	if sent := f.sender.take(); len(sent) != 0 {
		t.Fatalf("sent %+v, want nothing", sent)
	}
	if !strings.Contains(f.logs.String(), message.RequestId) || !strings.Contains(f.logs.String(), tabID) {
		t.Fatalf("the logs do not say the request:\n%s", f.logs)
	}
	f.assertNoClearText(t, message.Sealed.Ciphertext, message.Sealed.Key)
}

func TestAnAttachStoresTheFolderAndSaysTheProjetsFolders(t *testing.T) {
	f := newFixture(t)
	folder := filepath.Join(f.home, "recettes")
	mkdir(t, folder) // not a git repository yet: « git init » is its preparation

	if err := f.handler.HandleAttach(context.Background(), f.attach(t, thisProject, "~/recettes")); err != nil {
		t.Fatal(err)
	}

	saved, err := f.store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(saved.Projects, map[string]string{thisProject: folder}) || saved.Token != "rnr_token" {
		t.Fatalf("saved %+v, want the folder beside the link", saved)
	}
	info, _ := os.Stat(f.store.Path())
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("runner.json has mode %o", info.Mode().Perm())
	}
	if got := present(t, f.sender.take()); !reflect.DeepEqual(got, []string{thisProject}) {
		t.Fatalf("present %v", got)
	}
	f.assertNoClearText(t, "recettes", f.home)
}

func TestAnAttachOfAFolderGoneStoresNothingAndDropsTheOneBefore(t *testing.T) {
	f := newFixture(t)
	before := filepath.Join(f.home, "avant")
	mkdir(t, before)
	if err := f.handler.HandleAttach(context.Background(), f.attach(t, thisProject, before)); err != nil {
		t.Fatal(err)
	}
	f.sender.take()

	if err := f.handler.HandleAttach(context.Background(), f.attach(t, thisProject, "~/recettes")); err != nil {
		t.Fatal(err)
	}

	saved, _ := f.store.Load()
	if _, ok := saved.Projects[thisProject]; ok {
		t.Fatalf("saved %+v, want no folder for the Projet", saved.Projects)
	}
	if got := present(t, f.sender.take()); len(got) != 0 {
		t.Fatalf("present %v, want none", got)
	}
}

func TestAnAttachThatDoesNotOpenStoresNothing(t *testing.T) {
	f := newFixture(t)
	mkdir(t, filepath.Join(f.home, "recettes"))
	message := f.attach(t, thisProject, "~/recettes")
	message.ProjectId = otherProject // sealed for another Projet

	if err := f.handler.HandleAttach(context.Background(), message); err != nil {
		t.Fatal(err)
	}

	saved, _ := f.store.Load()
	if len(saved.Projects) != 0 || len(f.sender.take()) != 0 {
		t.Fatalf("saved %+v, want nothing stored nor sent", saved.Projects)
	}
}

func TestTheProjetsFoldersAreSaidOnEachConnection(t *testing.T) {
	f := newFixture(t)
	mkdir(t, filepath.Join(f.home, "recettes"))
	saved, _ := f.store.Load()
	saved.Projects = map[string]string{thisProject: filepath.Join(f.home, "recettes"), otherProject: filepath.Join(f.home, "parti")}
	if err := f.store.Save(saved); err != nil {
		t.Fatal(err)
	}

	f.handler.Report(context.Background())
	f.handler.Report(context.Background())

	sent := f.sender.take()
	for _, message := range [][]any{sent[:1], sent[1:]} {
		if got := present(t, message); !reflect.DeepEqual(got, []string{thisProject}) {
			t.Fatalf("present %v, want the folder that exists", got)
		}
	}
}

func TestARemovedFolderDropsOutOnTheNextTick(t *testing.T) {
	f := newFixture(t)
	folder := filepath.Join(f.home, "recettes")
	mkdir(t, folder)
	if err := f.handler.HandleAttach(context.Background(), f.attach(t, thisProject, folder)); err != nil {
		t.Fatal(err)
	}
	f.sender.take()

	f.handler.Tick(context.Background())
	if sent := f.sender.take(); len(sent) != 0 {
		t.Fatalf("an unchanged tick sent %+v", sent)
	}
	if err := os.RemoveAll(folder); err != nil {
		t.Fatal(err)
	}
	f.handler.Tick(context.Background())
	if got := present(t, f.sender.take()); len(got) != 0 {
		t.Fatalf("present %v, want none", got)
	}
	f.handler.Tick(context.Background())
	if sent := f.sender.take(); len(sent) != 0 {
		t.Fatalf("an unchanged tick sent %+v", sent)
	}
	mkdir(t, folder)
	f.handler.Tick(context.Background())
	if got := present(t, f.sender.take()); !reflect.DeepEqual(got, []string{thisProject}) {
		t.Fatalf("present %v, want the folder back", got)
	}
}

// A tick that could not send (no connection) sends on the next one.
func TestATickNotSentIsSentOnTheNextOne(t *testing.T) {
	f := newFixture(t)
	folder := filepath.Join(f.home, "recettes")
	mkdir(t, folder)
	if err := f.handler.HandleAttach(context.Background(), f.attach(t, thisProject, folder)); err != nil {
		t.Fatal(err)
	}
	f.sender.take()
	connected := false
	f.handler.cfg.Send = func(ctx context.Context, message any) error {
		if !connected {
			return protocol.ErrNotConnected
		}
		return f.sender.Send(ctx, message)
	}
	if err := os.RemoveAll(folder); err != nil {
		t.Fatal(err)
	}

	f.handler.Tick(context.Background())
	connected = true
	f.handler.Tick(context.Background())

	if got := present(t, f.sender.take()); len(got) != 0 {
		t.Fatalf("present %v, want none", got)
	}
}
