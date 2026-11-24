package folders

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"sync"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// ReportEvery is how often the Runner looks at its Projets' folders, saying
// them again when the set of those that exist changed (ADR 0012).
const ReportEvery = 60 * time.Second

// Vault is what the folders need of the vault key (keys.Vault, or the
// Runner's held one).
type Vault interface {
	SealItem(plaintext, aad []byte) (keys.SealedItem, error)
	OpenItem(item keys.SealedItem, aad []byte) ([]byte, error)
}

// Config is what the handler works with.
type Config struct {
	Checker Checker
	// Store holds runner.json, whose `projects` are the Projets' folders.
	Store state.Store
	// Vault opens the server's sealed paths and seals the checks' results:
	// the vault held, whose key a rotation replaces (E2E-4).
	Vault Vault
	// Send sends a message on the current connection (protocol.ErrNotConnected without one).
	Send   func(ctx context.Context, message any) error
	Logger *slog.Logger
}

// Handler answers the server's folder.check and project.folder.attach, and
// says the Projets' folders that exist (projects.folders).
type Handler struct {
	cfg Config

	// mu serializes the reads and writes of runner.json's projects, and the sends of projects.folders.
	mu sync.Mutex
	// said is the last projects.folders sent; nil before the first.
	said *folders
}

// folders are what projects.folders says: the Projets whose folder exists,
// and those whose pending folder does (SOURCE-9).
type folders struct {
	present, pending []string
}

func (f folders) equal(other folders) bool {
	return slices.Equal(f.present, other.present) && slices.Equal(f.pending, other.pending)
}

// New is the handler of cfg.
func New(cfg Config) *Handler {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	return &Handler{cfg: cfg}
}

// Register makes the client hand the server's folder.check and project.folder.attach to the handler.
func (h *Handler) Register(client *protocol.Client) {
	protocol.On(client, protocol.TypeFolderCheck, h.HandleCheck)
	protocol.On(client, protocol.TypeProjectFolderAttach, h.HandleAttach)
	protocol.On(client, protocol.TypeProjectFolderPick, h.HandlePick)
	protocol.On(client, protocol.TypeProjectFolderDrop, h.HandleDrop)
}

// HandleCheck opens the tab's path, checks it, and answers that tab with the
// result sealed (`folder.checked:<requestId>`). A check naming a Projet (its
// folder chosen again) does not count that Projet's own folder as taken. A
// path that does not open is dropped: the tab says the Runner does not answer.
func (h *Handler) HandleCheck(ctx context.Context, message contracts.RunnerFolderCheck) error {
	input, ok := h.open(message.Sealed.Key, message.Sealed.Ciphertext, "folder.check:"+message.RequestId)
	if !ok {
		h.cfg.Logger.Warn("folder.check unopened", "requestId", message.RequestId, "tabId", message.TabId)
		return nil
	}
	h.mu.Lock()
	linked, err := h.cfg.Store.Load()
	h.mu.Unlock()
	if err != nil {
		return err
	}
	projectID := ""
	if input.ProjectId != nil {
		projectID = *input.ProjectId
	}
	result := h.cfg.Checker.Check(input.Path, held(linked, projectID), "")
	plaintext, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("folders: encode a check: %w", err)
	}
	sealed, err := h.cfg.Vault.SealItem(plaintext, []byte("folder.checked:"+message.RequestId))
	if err != nil {
		return fmt.Errorf("folders: seal a check: %w", err)
	}
	h.cfg.Logger.Debug("folder.checked", "requestId", message.RequestId, "tabId", message.TabId, "state", result.State)
	return h.cfg.Send(ctx, protocol.NewFolderChecked(message.RequestId, message.TabId, b64(sealed.Key), b64(sealed.Ciphertext)))
}

// HandleAttach opens the Projet's path and checks it again: a folder that may
// be a Projet's (`ready`, `not-git`) becomes its folder in runner.json, any
// other drops the one it had. projects.folders follows.
func (h *Handler) HandleAttach(ctx context.Context, message contracts.RunnerProjectFolderAttach) error {
	input, ok := h.open(message.Sealed.Key, message.Sealed.Ciphertext, "project:"+message.ProjectId+":folder")
	if !ok {
		h.cfg.Logger.Warn("project.folder.attach unopened", "projectId", message.ProjectId)
		return nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	linked, err := h.cfg.Store.Load()
	if err != nil {
		return err
	}
	result := h.cfg.Checker.Check(input.Path, held(linked, message.ProjectId), "")
	_, had := linked.Projects[message.ProjectId]
	switch {
	case result.Attachable():
		if linked.Projects == nil {
			linked.Projects = map[string]string{}
		}
		linked.Projects[message.ProjectId] = result.Path
	case had:
		delete(linked.Projects, message.ProjectId)
	}
	if result.Attachable() || had {
		if err := h.cfg.Store.Save(linked); err != nil {
			return err
		}
	}
	h.cfg.Logger.Info("project.folder.attach", "projectId", message.ProjectId, "state", result.State)
	h.say(ctx, h.found(linked))
	return nil
}

// HandlePick opens the folder a migration of the message's group to Local
// will use and checks it again (Result.Pickable): a folder that may be is
// held as the Projet's pending folder, replacing the one before; any other
// drops the one before. projects.folders follows. The folder is left as it is.
func (h *Handler) HandlePick(ctx context.Context, message contracts.RunnerProjectFolderPick) error {
	input, ok := h.open(message.Sealed.Key, message.Sealed.Ciphertext, "project:"+message.ProjectId+":folder")
	if !ok {
		h.cfg.Logger.Warn("project.folder.pick unopened", "projectId", message.ProjectId)
		return nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	linked, err := h.cfg.Store.Load()
	if err != nil {
		return err
	}
	result := h.cfg.Checker.Check(input.Path, held(linked, message.ProjectId), "")
	pickable := result.Pickable(string(message.Group))
	_, had := linked.Pending[message.ProjectId]
	switch {
	case pickable:
		if linked.Pending == nil {
			linked.Pending = map[string]state.PendingFolder{}
		}
		linked.Pending[message.ProjectId] = state.PendingFolder{Path: result.Path, Group: string(message.Group)}
	case had:
		delete(linked.Pending, message.ProjectId)
	}
	if pickable || had {
		if err := h.cfg.Store.Save(linked); err != nil {
			return err
		}
	}
	h.cfg.Logger.Info("project.folder.pick", "projectId", message.ProjectId, "group", message.Group, "state", result.State, "pickable", pickable)
	h.say(ctx, h.found(linked))
	return nil
}

// HandleDrop forgets the Projet's pending folder, its migration failed; the
// folder itself is never touched. projects.folders follows.
func (h *Handler) HandleDrop(ctx context.Context, message contracts.RunnerProjectFolderDrop) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	linked, err := h.cfg.Store.Load()
	if err != nil {
		return err
	}
	if _, had := linked.Pending[message.ProjectId]; had {
		delete(linked.Pending, message.ProjectId)
		if err := h.cfg.Store.Save(linked); err != nil {
			return err
		}
	}
	h.cfg.Logger.Info("project.folder.drop", "projectId", message.ProjectId)
	h.say(ctx, h.found(linked))
	return nil
}

// Pending is the Projet's pending folder, false without one.
func (h *Handler) Pending(projectID string) (state.PendingFolder, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	linked, err := h.cfg.Store.Load()
	if err != nil {
		return state.PendingFolder{}, false
	}
	pending, ok := linked.Pending[projectID]
	return pending, ok
}

// ErrTaken is a folder another Projet holds, as its folder or its pending one.
var ErrTaken = errors.New("folders: the folder is another Projet's")

// Taken is whether folder is another Projet's than projectID, as its folder
// or its pending one (the pick dropped, another Projet may have taken it since).
func (h *Handler) Taken(projectID, folder string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	linked, err := h.cfg.Store.Load()
	if err != nil {
		return true
	}
	return taken(linked, projectID, folder)
}

func taken(linked state.State, projectID, folder string) bool {
	for _, path := range held(linked, projectID) {
		if filepath.Clean(path) == filepath.Clean(folder) {
			return true
		}
	}
	return false
}

// Promote makes folder the Projet's folder, at the finish of its migration
// to Local (the one its copy began in, kept even once the pick was dropped),
// its pending one when folder is ""; and says projects.folders. A Projet
// with neither is left as it is; a folder another Projet holds is ErrTaken.
func (h *Handler) Promote(ctx context.Context, projectID, folder string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	linked, err := h.cfg.Store.Load()
	if err != nil {
		return err
	}
	if folder == "" {
		folder = linked.Pending[projectID].Path
	}
	if folder == "" {
		return nil
	}
	if taken(linked, projectID, folder) {
		return ErrTaken
	}
	if linked.Projects == nil {
		linked.Projects = map[string]string{}
	}
	linked.Projects[projectID] = folder
	delete(linked.Pending, projectID)
	if err := h.cfg.Store.Save(linked); err != nil {
		return err
	}
	h.cfg.Logger.Info("project.folder.promoted", "projectId", projectID)
	h.say(ctx, h.found(linked))
	return nil
}

// Report says the Projets' folders that exist, whatever was said before: on
// each accepted connection.
func (h *Handler) Report(ctx context.Context) {
	h.mu.Lock()
	defer h.mu.Unlock()
	linked, err := h.cfg.Store.Load()
	if err != nil {
		h.cfg.Logger.Warn("projects.folders", "error", err)
		return
	}
	h.say(ctx, h.found(linked))
}

// Tick says the Projets' folders that exist when they are not those said last.
func (h *Handler) Tick(ctx context.Context) {
	h.mu.Lock()
	defer h.mu.Unlock()
	linked, err := h.cfg.Store.Load()
	if err != nil {
		h.cfg.Logger.Warn("projects.folders", "error", err)
		return
	}
	if found := h.found(linked); h.said == nil || !found.equal(*h.said) {
		h.say(ctx, found)
	}
}

// Every ticks every `every` until ctx ends.
func (h *Handler) Every(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.Tick(ctx)
		}
	}
}

// say sends projects.folders; h.mu is held.
func (h *Handler) say(ctx context.Context, found folders) {
	err := h.cfg.Send(ctx, protocol.NewProjectsFolders(found.present, found.pending))
	if err == nil {
		h.said = &found
		return
	}
	if !errors.Is(err, protocol.ErrNotConnected) && ctx.Err() == nil {
		h.cfg.Logger.Warn("projects.folders", "error", err)
	}
}

// held are the folders taken by others than projectID: the Projets' folders
// and their pending ones, keyed apart.
func held(linked state.State, projectID string) map[string]string {
	taken := map[string]string{}
	for id, path := range linked.Projects {
		if id != projectID {
			taken[id] = path
		}
	}
	for id, pending := range linked.Pending {
		if id != projectID {
			taken["pending:"+id] = pending.Path
		}
	}
	return taken
}

// found are the Projets whose folder, and whose pending folder, is still a folder.
func (h *Handler) found(linked state.State) folders {
	pending := map[string]string{}
	for id, folder := range linked.Pending {
		pending[id] = folder.Path
	}
	return folders{present: existing(linked.Projects), pending: existing(pending)}
}

// existing are the ids whose path is still a folder, sorted.
func existing(paths map[string]string) []string {
	ids := []string{}
	for id, path := range paths {
		if info, err := os.Stat(path); err == nil && info.IsDir() {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

// open opens a sealed FolderCheck; false when it does not open or parse.
func (h *Handler) open(key, ciphertext, aad string) (contracts.FolderCheck, bool) {
	rawKey, err := base64.RawURLEncoding.DecodeString(key)
	if err != nil {
		return contracts.FolderCheck{}, false
	}
	rawCiphertext, err := base64.RawURLEncoding.DecodeString(ciphertext)
	if err != nil {
		return contracts.FolderCheck{}, false
	}
	plaintext, err := h.cfg.Vault.OpenItem(keys.SealedItem{Key: rawKey, Ciphertext: rawCiphertext}, []byte(aad))
	if err != nil {
		return contracts.FolderCheck{}, false
	}
	var check contracts.FolderCheck
	if err := json.Unmarshal(plaintext, &check); err != nil {
		return contracts.FolderCheck{}, false
	}
	return check, true
}

func b64(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}
