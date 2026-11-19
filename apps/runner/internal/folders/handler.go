package folders

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
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

// Handler answers the server's folder.check and project.folder.attach, says
// the Projets' folders that exist (projects.folders), and where each stands
// for its Process (project.folder.status, project.folder.prepare).
type Handler struct {
	cfg Config

	// mu serializes the reads and writes of runner.json's projects, and the sends of projects.folders.
	mu sync.Mutex
	// said is the last set of projects.folders sent; nil before the first.
	said []string
	// preparing serializes the preparations of the Projets' folders (PROJET-3).
	preparing sync.Mutex
}

// New is the handler of cfg.
func New(cfg Config) *Handler {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	return &Handler{cfg: cfg}
}

// Register makes the client hand the server's folder.check,
// project.folder.attach, project.folder.status and project.folder.prepare to
// the handler; a preparation runs aside.
func (h *Handler) Register(client *protocol.Client) {
	protocol.On(client, protocol.TypeFolderCheck, h.HandleCheck)
	protocol.On(client, protocol.TypeProjectFolderAttach, h.HandleAttach)
	protocol.On(client, protocol.TypeProjectFolderStatus, h.HandleStatus)
	protocol.On(client, protocol.TypeProjectFolderPrepare, h.handlePrepareAside)
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
	projects, err := h.projects()
	h.mu.Unlock()
	if err != nil {
		return err
	}
	projectID := ""
	if input.ProjectId != nil {
		projectID = *input.ProjectId
	}
	result := h.cfg.Checker.Check(input.Path, projects, projectID)
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
	result := h.cfg.Checker.Check(input.Path, linked.Projects, message.ProjectId)
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
	h.say(ctx, h.present(linked.Projects))
	return nil
}

// Report says the Projets' folders that exist, whatever was said before: on
// each accepted connection.
func (h *Handler) Report(ctx context.Context) {
	h.mu.Lock()
	defer h.mu.Unlock()
	projects, err := h.projects()
	if err != nil {
		h.cfg.Logger.Warn("projects.folders", "error", err)
		return
	}
	h.say(ctx, h.present(projects))
}

// Tick says the Projets' folders that exist when they are not those said last.
func (h *Handler) Tick(ctx context.Context) {
	h.mu.Lock()
	defer h.mu.Unlock()
	projects, err := h.projects()
	if err != nil {
		h.cfg.Logger.Warn("projects.folders", "error", err)
		return
	}
	if present := h.present(projects); h.said == nil || !slices.Equal(present, h.said) {
		h.say(ctx, present)
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
func (h *Handler) say(ctx context.Context, present []string) {
	err := h.cfg.Send(ctx, protocol.NewProjectsFolders(present))
	if err == nil {
		h.said = present
		return
	}
	if !errors.Is(err, protocol.ErrNotConnected) && ctx.Err() == nil {
		h.cfg.Logger.Warn("projects.folders", "error", err)
	}
}

// projects are runner.json's; h.mu is held.
func (h *Handler) projects() (map[string]string, error) {
	linked, err := h.cfg.Store.Load()
	if err != nil {
		return nil, err
	}
	return linked.Projects, nil
}

// present are the ids of the Projets whose folder is still a folder, sorted.
func (h *Handler) present(projects map[string]string) []string {
	present := []string{}
	for id, path := range projects {
		if info, err := os.Stat(path); err == nil && info.IsDir() {
			present = append(present, id)
		}
	}
	sort.Strings(present)
	return present
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
