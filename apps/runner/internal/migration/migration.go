// Package migration moves a Projet's Tickets from one Source to the other
// (SOURCE-8, ADR 0012), and its code with its changes (SOURCE-9): the
// handler of `migration.copy` and `migration.finish` for the `ticket` and
// `code` groups. The copy is idempotent (each
// item found again by the marker of its origin), verified by passes until
// one finds nothing to copy, then the server switches the Source; the
// finish freezes the old place and carries what changed there since.
package migration

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"sync"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	ghsource "github.com/maximed1412/crewdeck/apps/runner/internal/source/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

// Passes is how many verifying passes may each find something to copy
// before the migration fails `migration.unstable`.
const Passes = 10

// The codes of a failed migration.
const (
	CodeGitHubRefused     = "github.refused"
	CodeGitHubUnavailable = "github.unavailable"
	CodeFolderUnwritable  = "folder.unwritable"
	CodeLocalUnreadable   = "local.unreadable"
	CodeUnstable          = "migration.unstable"
	// CodeBranchDiverged: a branch moved on both places, neither a fast-forward of the other.
	CodeBranchDiverged = "branch.diverged"
)

// ErrNoFolder is a Local side this Runner holds no folder for.
var ErrNoFolder = errors.New("migration: no folder for the Projet on this Runner")

var errUnstable = errors.New("migration: no pass without a change")

// Config is what the handler needs.
type Config struct {
	// Home holds `migrations/<migrationId>.json`, the progress of each.
	Home string
	// Send sends a message to the server.
	Send func(ctx context.Context, message any) error
	// Folder is the Projet's folder in the Runner's state (PROJET-6).
	Folder func(projectID string) (string, bool)
	// Pending is the folder picked for a migration to Local, held pending
	// until the migration finishes; Promote makes it the Projet's folder.
	Pending func(projectID string) (string, bool)
	Promote func(ctx context.Context, projectID, folder string) error
	// Open is the Local Projet in folder (its Tickets, its changes in local.db).
	Open func(projectID, folder string) *local.Project
	// GitHub is the repository's side, written with the migration's token;
	// for the code, its pull requests too (*ghsource.Tickets).
	GitHub func(migrationID, owner, name string) source.Copier
	// Remote is the repository's git remote, reached with the migration's token.
	Remote func(migrationID, owner, name string) Remote
	// Vault keys the fingerprints.
	Vault func() *keys.Vault
	// Finished runs once the Source switched and the old place is frozen
	// (the folder picked promoted, a Projet now Local reported whole): its
	// watchers asked for a full report, its documents indexed again.
	Finished func(ctx context.Context, projectID, to string)
	Logger   *slog.Logger
	// Passes overrides Passes (tests).
	Passes int
}

// Handler runs the migrations the server asks for, one at a time per id.
type Handler struct {
	cfg     Config
	mu      sync.Mutex
	running map[string]bool
}

// New is the handler of cfg.
func New(cfg Config) *Handler {
	if cfg.Logger == nil {
		cfg.Logger = slog.New(slog.DiscardHandler)
	}
	if cfg.Passes == 0 {
		cfg.Passes = Passes
	}
	return &Handler{cfg: cfg, running: map[string]bool{}}
}

// Register handles the migrations' messages on client, each in the
// background under ctx (a copy outlives a lost connection; the server sends
// it again after the next hello, and it resumes).
func (h *Handler) Register(ctx context.Context, client *protocol.Client) {
	protocol.On(client, protocol.TypeMigrationCopy, func(_ context.Context, m contracts.RunnerMigrationCopy) error {
		h.background(m.MigrationId, func() { h.Copy(ctx, m) })
		return nil
	})
	protocol.On(client, protocol.TypeMigrationFinish, func(_ context.Context, m contracts.RunnerMigrationFinish) error {
		h.background(m.MigrationId, func() { h.Finish(ctx, m) })
		return nil
	})
}

// background runs fn unless the migration runs already.
func (h *Handler) background(id string, fn func()) {
	h.mu.Lock()
	if h.running[id] {
		h.mu.Unlock()
		return
	}
	h.running[id] = true
	h.mu.Unlock()
	go func() {
		defer func() {
			h.mu.Lock()
			delete(h.running, id)
			h.mu.Unlock()
		}()
		fn()
	}()
}

// Copy copies the Projet's Tickets, or its code, then verifies until a
// pass changes nothing, then sends `migration.switch`; `migration.failed`
// when it cannot.
func (h *Handler) Copy(ctx context.Context, m contracts.RunnerMigrationCopy) {
	var err error
	switch m.Group {
	case contracts.RunnerMigrationCopyGroupTicket:
		err = h.copy(ctx, m)
	case contracts.RunnerMigrationCopyGroupCode:
		err = h.copyCode(ctx, m)
	default:
		h.cfg.Logger.Warn("migration.group.unsupported", "migrationId", m.MigrationId, "group", m.Group)
		return
	}
	h.failed(ctx, m.MigrationId, contracts.RunnerMigrationFailedStageCopy, err)
}

func (h *Handler) copy(ctx context.Context, m contracts.RunnerMigrationCopy) error {
	p, found, err := loadProgress(h.cfg.Home, m.MigrationId)
	if err != nil {
		return err
	}
	if !found {
		p = &progress{MigrationID: m.MigrationId, Tickets: map[int]int{}, Milestones: map[int]int{}}
	}
	p.ProjectID, p.From, p.To, p.Stage, p.Dir, p.Group = m.ProjectId, string(m.From), string(m.To), stageCopying, "", string(m.Group)
	if m.Repository != nil {
		p.Owner, p.Name = m.Repository.Owner, m.Repository.Name
	}
	if err := p.save(h.cfg.Home); err != nil {
		return err
	}
	from, err := h.side(p, p.From)
	if err != nil {
		return err
	}
	to, err := h.side(p, p.To)
	if err != nil {
		return err
	}
	h.cfg.Logger.Info("migration.copy", "migrationId", p.MigrationID, "from", p.From, "to", p.To)
	_, err = syncPass(ctx, from, to, p, nil, func(done, total int) {
		h.send(ctx, protocol.NewMigrationProgress(p.MigrationID, contracts.RunnerMigrationProgressStateCopying, done, total))
		if done%10 == 0 {
			_ = p.save(h.cfg.Home)
		}
	})
	if err != nil {
		return err
	}
	p.Stage = stageVerifying
	if err := p.save(h.cfg.Home); err != nil {
		return err
	}
	for i := range h.cfg.Passes {
		checked, err := syncPass(ctx, from, to, p, nil, nil)
		if err != nil {
			return err
		}
		h.send(ctx, protocol.NewMigrationProgress(p.MigrationID, contracts.RunnerMigrationProgressStateVerifying, len(checked.tickets)-min(checked.writes, len(checked.tickets)), len(checked.tickets)))
		if checked.writes > 0 {
			h.cfg.Logger.Info("migration.verify.changed", "migrationId", p.MigrationID, "pass", i+1, "writes", checked.writes)
			continue
		}
		return h.switchTo(ctx, p, from.Kind(), checked)
	}
	return errUnstable
}

// switchTo sends `migration.switch`: the fingerprints of the stable pass,
// every Ticket's and milestone's number renumbered.
func (h *Handler) switchTo(ctx context.Context, p *progress, kind string, stable pass) error {
	vault := h.cfg.Vault()
	fingerprints := make([]contracts.RunnerMigrationSwitchFingerprintsElem, 0, len(stable.tickets))
	renumbering := make([]contracts.RunnerMigrationSwitchRenumberingElem, 0, len(stable.tickets))
	for _, t := range stable.tickets {
		key, state, hash := fingerprint(vault, kind, t)
		fingerprints = append(fingerprints, contracts.RunnerMigrationSwitchFingerprintsElem{Key: key, State: state, ContentHash: hash})
		renumbering = append(renumbering, contracts.RunnerMigrationSwitchRenumberingElem{From: t.Number, To: p.Tickets[t.Number]})
	}
	var milestones []contracts.RunnerMigrationSwitchMilestonesElem
	for _, m := range stable.milestones {
		key, hash := milestoneFingerprint(vault, kind, m)
		fingerprints = append(fingerprints, contracts.RunnerMigrationSwitchFingerprintsElem{Key: key, State: "open", ContentHash: hash})
		if to, ok := p.Milestones[m.Number]; ok && m.Number > 0 && to > 0 {
			milestones = append(milestones, contracts.RunnerMigrationSwitchMilestonesElem{From: m.Number, To: to})
		}
	}
	p.Switched = map[int]switchedMilestone{}
	for _, m := range stable.milestones {
		p.Switched[m.Number] = switchedMilestone{Title: m.Title, Due: due(m)}
	}
	p.Stage = stageSwitched
	if err := p.save(h.cfg.Home); err != nil {
		return err
	}
	h.cfg.Logger.Info("migration.switch", "migrationId", p.MigrationID, "tickets", len(renumbering))
	return h.cfg.Send(ctx, protocol.NewMigrationSwitch(p.MigrationID, fingerprints, renumbering, milestones))
}

// Finish freezes the old place, carries what changed there since the
// switch's fingerprints, then switches the Runner's Source and sends
// `migration.finished`; sent again for a migration finished already.
func (h *Handler) Finish(ctx context.Context, m contracts.RunnerMigrationFinish) {
	err := h.finish(ctx, m)
	h.failed(ctx, m.MigrationId, contracts.RunnerMigrationFailedStageFinish, err)
}

func (h *Handler) finish(ctx context.Context, m contracts.RunnerMigrationFinish) error {
	p, found, err := loadProgress(h.cfg.Home, m.MigrationId)
	if err != nil {
		return err
	}
	if !found {
		return errors.New("migration: no progress for the migration on this Runner")
	}
	if p.Stage == stageFinished {
		return h.cfg.Send(ctx, protocol.NewMigrationFinished(p.MigrationID))
	}
	if p.Group == string(contracts.RunnerMigrationCopyGroupCode) {
		return h.finishCode(ctx, p, m)
	}
	from, err := h.side(p, p.From)
	if err != nil {
		return err
	}
	if p.Stage != stageFrozen {
		if err := h.freeze(ctx, p, from); err != nil {
			return err
		}
		if dir, ok := from.(interface{ Dir() string }); ok {
			p.Dir = dir.Dir()
		}
		p.Stage = stageFrozen
		if err := p.save(h.cfg.Home); err != nil {
			return err
		}
	}
	to, err := h.side(p, p.To)
	if err != nil {
		return err
	}
	frozen, frozenMilestones, err := from.ReadAll(ctx)
	if err != nil {
		return err
	}
	seen := map[string]string{}
	for _, f := range m.Fingerprints {
		seen[f.Key] = f.ContentHash
	}
	vault := h.cfg.Vault()
	late := &lateSet{tickets: map[int]bool{}, milestones: map[int]bool{}}
	for _, t := range frozen {
		key, _, hash := fingerprint(vault, from.Kind(), t)
		if seen[key] != hash {
			late.tickets[t.Number] = true
		}
	}
	for _, m := range frozenMilestones {
		if key, hash := milestoneFingerprint(vault, from.Kind(), m); seen[key] != hash {
			late.milestones[m.Number] = true
		}
	}
	if len(late.tickets) > 0 || len(late.milestones) > 0 {
		h.cfg.Logger.Info("migration.finish.late", "migrationId", p.MigrationID, "tickets", len(late.tickets), "milestones", len(late.milestones))
		if _, err := syncPass(ctx, from, to, p, late, nil); err != nil {
			return err
		}
	}
	return h.finished(ctx, p)
}

// finished ends the migration: the folder picked made the Projet's; to
// Local, a full `local.changed` report of the Projet (its Tickets and
// changes at their new numbers, which the server holds untitled since the
// switch); the Runner's Source switched; then `migration.finished`.
func (h *Handler) finished(ctx context.Context, p *progress) error {
	if err := h.promote(ctx, p); err != nil {
		return err
	}
	if folder, ok := h.localFolder(p.ProjectID); ok && p.To == string(contracts.RunnerMigrationCopyToLocal) {
		// A report that fails waits for the next connection's full one.
		_, err := h.cfg.Open(p.ProjectID, folder).Report(ctx, true, func(ctx context.Context, m contracts.RunnerLocalChanged) error { return h.cfg.Send(ctx, m) })
		if err != nil {
			h.cfg.Logger.Warn("migration.report", "migrationId", p.MigrationID, "err", err)
		}
	}
	if h.cfg.Finished != nil {
		h.cfg.Finished(ctx, p.ProjectID, p.To)
	}
	p.Stage = stageFinished
	if err := p.save(h.cfg.Home); err != nil {
		return err
	}
	h.cfg.Logger.Info("migration.finished", "migrationId", p.MigrationID)
	return h.cfg.Send(ctx, protocol.NewMigrationFinished(p.MigrationID))
}

// promote makes the folder picked for a migration to Local the Projet's,
// when it has none yet: the one its copy began in (kept by the progress,
// even once the pick was dropped at a failure), else the one held pending.
func (h *Handler) promote(ctx context.Context, p *progress) error {
	if p.To != string(contracts.RunnerMigrationCopyToLocal) || h.cfg.Promote == nil {
		return nil
	}
	if _, ok := h.folder(p.ProjectID); ok {
		return nil
	}
	folder := p.Folder
	if folder == "" && h.cfg.Pending != nil {
		folder, _ = h.cfg.Pending(p.ProjectID)
	}
	if folder == "" {
		return nil
	}
	return h.cfg.Promote(ctx, p.ProjectID, folder)
}

func (h *Handler) folder(projectID string) (string, bool) {
	if h.cfg.Folder == nil {
		return "", false
	}
	return h.cfg.Folder(projectID)
}

// localFolder is where the Local side is: the Projet's folder, else the
// one picked for the migration, held pending.
func (h *Handler) localFolder(projectID string) (string, bool) {
	if folder, ok := h.folder(projectID); ok {
		return folder, true
	}
	if h.cfg.Pending != nil {
		return h.cfg.Pending(projectID)
	}
	return "", false
}

// archiver is a side frozen by a rename, its new name kept first.
type archiver interface {
	NextArchive() (string, error)
	FreezeAs(ctx context.Context, name string) error
}

// freeze freezes the old place; renamed, under the name the progress
// keeps before the rename.
func (h *Handler) freeze(ctx context.Context, p *progress, from source.Copier) error {
	a, ok := from.(archiver)
	if !ok {
		return from.Freeze(ctx)
	}
	if p.Archive == "" {
		name, err := a.NextArchive()
		if err != nil {
			return err
		}
		p.Archive = name
		if err := p.save(h.cfg.Home); err != nil {
			return err
		}
	}
	return a.FreezeAs(ctx, p.Archive)
}

// side is the Copier of one side of the migration.
func (h *Handler) side(p *progress, kind string) (source.Copier, error) {
	if kind == string(contracts.RunnerMigrationCopyFromGithub) {
		return h.cfg.GitHub(p.MigrationID, p.Owner, p.Name), nil
	}
	dir := ""
	if kind == p.From {
		dir = p.Dir
	}
	folder, ok := h.folder(p.ProjectID)
	if !ok {
		// The folder picked: the one the copy began in once recorded, so
		// that « Réessayer » goes on there after the pick was dropped.
		if folder, ok = p.Folder, p.Folder != ""; !ok {
			if folder, ok = h.localFolder(p.ProjectID); !ok {
				return nil, ErrNoFolder
			}
			p.Folder = folder
			if err := p.save(h.cfg.Home); err != nil {
				return nil, err
			}
		}
	}
	return h.cfg.Open(p.ProjectID, folder).Copier(dir), nil
}

func (h *Handler) send(ctx context.Context, m any) {
	if err := h.cfg.Send(ctx, m); err != nil {
		h.cfg.Logger.Debug("migration.send", "err", err)
	}
}

// failed sends `migration.failed` with err's code; nothing for no error,
// nor when ctx ended (the Runner stops: the copy resumes after its hello).
func (h *Handler) failed(ctx context.Context, id string, stage contracts.RunnerMigrationFailedStage, err error) {
	if err == nil || ctx.Err() != nil {
		return
	}
	code := codeOf(err)
	h.cfg.Logger.Warn("migration.failed", "migrationId", id, "stage", stage, "code", code, "err", err)
	h.send(ctx, protocol.NewMigrationFailed(id, stage, code))
}

func codeOf(err error) string {
	var refused *ghsource.HTTPError
	switch {
	case errors.Is(err, errUnstable):
		return CodeUnstable
	case errors.Is(err, errDiverged):
		return CodeBranchDiverged
	case errors.Is(err, source.ErrUnreadable):
		return CodeLocalUnreadable
	case errors.Is(err, ghsource.ErrUnavailable):
		return CodeGitHubUnavailable
	case errors.As(err, &refused):
		if slices.Contains([]int{500, 502, 503, 504}, refused.Status) {
			return CodeGitHubUnavailable
		}
		return CodeGitHubRefused
	default:
		return CodeFolderUnwritable
	}
}
