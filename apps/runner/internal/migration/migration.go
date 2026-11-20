// Package migration moves a Projet's Tickets from one Source to the other
// (SOURCE-8, ADR 0012): the handler of `migration.copy` and
// `migration.finish` for the `ticket` group. The copy is idempotent (each
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
	// Local is the Local side of the Projet, read in dir (`tickets/` when
	// ""): ErrNoFolder when this Runner has no folder for it.
	Local func(projectID, dir string) (source.Copier, error)
	// GitHub is the repository's side, written with the migration's token.
	GitHub func(migrationID, owner, name string) source.Copier
	// Vault keys the fingerprints.
	Vault func() *keys.Vault
	// Finished runs once the Source switched and the old place is frozen:
	// for a Projet now Local, a full `local.changed` scan.
	Finished func(projectID, to string)
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

// Copy copies the Projet's Tickets, then verifies until a pass changes
// nothing, then sends `migration.switch`; `migration.failed` when it cannot.
func (h *Handler) Copy(ctx context.Context, m contracts.RunnerMigrationCopy) {
	if m.Group != contracts.RunnerMigrationCopyGroupTicket {
		h.cfg.Logger.Warn("migration.group.unsupported", "migrationId", m.MigrationId, "group", m.Group)
		return
	}
	err := h.copy(ctx, m)
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
	p.ProjectID, p.From, p.To, p.Stage, p.Dir = m.ProjectId, string(m.From), string(m.To), stageCopying, ""
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
		if to, ok := p.Milestones[m.Number]; ok && m.Number > 0 && to > 0 {
			milestones = append(milestones, contracts.RunnerMigrationSwitchMilestonesElem{From: m.Number, To: to})
		}
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
	from, err := h.side(p, p.From)
	if err != nil {
		return err
	}
	if p.Stage != stageFrozen {
		if err := from.Freeze(ctx); err != nil {
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
	frozen, _, err := from.ReadAll(ctx)
	if err != nil {
		return err
	}
	seen := map[string]string{}
	for _, f := range m.Fingerprints {
		seen[f.Key] = f.ContentHash
	}
	vault := h.cfg.Vault()
	late := map[int]bool{}
	for _, t := range frozen {
		key, _, hash := fingerprint(vault, from.Kind(), t)
		if seen[key] != hash {
			late[t.Number] = true
		}
	}
	if len(late) > 0 {
		h.cfg.Logger.Info("migration.finish.late", "migrationId", p.MigrationID, "tickets", len(late))
		if _, err := syncPass(ctx, from, to, p, late, nil); err != nil {
			return err
		}
	}
	if h.cfg.Finished != nil {
		h.cfg.Finished(p.ProjectID, p.To)
	}
	p.Stage = stageFinished
	if err := p.save(h.cfg.Home); err != nil {
		return err
	}
	h.cfg.Logger.Info("migration.finished", "migrationId", p.MigrationID)
	return h.cfg.Send(ctx, protocol.NewMigrationFinished(p.MigrationID))
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
	return h.cfg.Local(p.ProjectID, dir)
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
