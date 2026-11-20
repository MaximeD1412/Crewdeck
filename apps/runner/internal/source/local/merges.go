package local

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
)

// DefaultRetryEvery is how often a blocked merge's files are looked at in
// the folder's working tree: the merge is retried once none is modified.
const DefaultRetryEvery = 5 * time.Second

// MergesConfig is how Merges reach the Local Projets and the server.
type MergesConfig struct {
	DB *DB
	// Project is a Local Projet of the Runner's state, its clone and worktrees set.
	Project func(projectID string) (*Project, bool)
	// Send carries a result to the server (protocol.ErrNotConnected while offline).
	Send       func(context.Context, contracts.RunnerMergeLocalResult) error
	RetryEvery time.Duration // zero is DefaultRetryEvery
	Logger     *slog.Logger
}

// Merges run the server's `merge.local` (SOURCE-5), each answered with its
// `merge.local.result`, and retry the blocked ones by themselves: every
// RetryEvery once the files git named are no longer modified, at once when
// a ref of the folder moved, each retry with its own result. A change no
// longer open ends its pending merge (`stale`); a new `merge.local` for a
// change replaces its pending one. The files are never logged nor sent.
type Merges struct {
	cfg      MergesConfig
	requests chan contracts.RunnerMergeLocal
	moved    chan string

	mu      sync.Mutex
	running map[pendingKey]bool
}

type pendingKey struct {
	projectID string
	number    int
}

// NewMerges are the Runner's merges; Run starts them.
func NewMerges(cfg MergesConfig) *Merges {
	if cfg.RetryEvery <= 0 {
		cfg.RetryEvery = DefaultRetryEvery
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.New(slog.DiscardHandler)
	}
	return &Merges{cfg: cfg, requests: make(chan contracts.RunnerMergeLocal, 16), moved: make(chan string, 16), running: map[pendingKey]bool{}}
}

// Register takes the server's `merge.local` on client.
func (m *Merges) Register(client *protocol.Client) {
	protocol.On(client, protocol.TypeMergeLocal, func(_ context.Context, message contracts.RunnerMergeLocal) error {
		m.Request(message)
		return nil
	})
}

// Request queues a merge; its result is sent once it ran.
func (m *Merges) Request(message contracts.RunnerMergeLocal) {
	select {
	case m.requests <- message:
	default:
		go func() { m.requests <- message }()
	}
}

// RefsMoved retries the Projet's blocked merges at once (Watcher's OnRefsMoved).
func (m *Merges) RefsMoved(projectID string) {
	select {
	case m.moved <- projectID:
	default:
	}
}

// Run carries the merges until ctx ends.
func (m *Merges) Run(ctx context.Context) {
	ticker := time.NewTicker(m.cfg.RetryEvery)
	defer ticker.Stop()
	var wg sync.WaitGroup
	defer wg.Wait()
	spawn := func(fn func()) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			fn()
		}()
	}
	for {
		select {
		case <-ctx.Done():
			return
		case r := <-m.requests:
			spawn(func() { m.attempt(ctx, r.ProjectId, r.ChangeNumber, r.Sha) })
		case projectID := <-m.moved:
			spawn(func() { m.retry(ctx, projectID, true) })
		case <-ticker.C:
			spawn(func() { m.retry(ctx, "", false) })
		}
	}
}

// retry runs again the pending merges of projectID ("" for every Projet):
// all of them when forced, else those whose change is no longer open or
// whose files are no longer modified.
func (m *Merges) retry(ctx context.Context, projectID string, force bool) {
	pending, err := m.cfg.DB.pendingMerges(ctx, projectID)
	if err != nil {
		m.cfg.Logger.Warn("local.merge.pending", "error", err)
		return
	}
	for _, pm := range pending {
		p, ok := m.cfg.Project(pm.projectID)
		if !ok {
			continue
		}
		if !force {
			c, err := p.Change(ctx, pm.number)
			if err == nil && c.State == source.ChangeOpen && p.modified(ctx, pm.files) {
				continue
			}
		}
		m.attempt(ctx, pm.projectID, pm.number, pm.sha)
	}
}

// attempt merges and sends the result; one attempt at a time per change.
func (m *Merges) attempt(ctx context.Context, projectID string, number int, sha string) {
	key := pendingKey{projectID, number}
	m.mu.Lock()
	if m.running[key] {
		m.mu.Unlock()
		return
	}
	m.running[key] = true
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		delete(m.running, key)
		m.mu.Unlock()
	}()
	log := m.cfg.Logger.With("projectId", projectID, "changeNumber", number)
	p, ok := m.cfg.Project(projectID)
	if !ok {
		log.Warn("local.merge.no-folder")
		return
	}
	result, err := p.Merge(ctx, number, sha)
	if err != nil {
		if ctx.Err() == nil {
			log.Warn("local.merge.failed", "error", err) // a gitError: never git's output
		}
		return
	}
	log.Info("local.merge", "outcome", string(result.Outcome))
	message := protocol.NewMergeLocalResult(projectID, number, sha, contracts.RunnerMergeLocalResultOutcome(result.Outcome), result.MergeSha)
	if err := m.cfg.Send(ctx, message); err != nil && ctx.Err() == nil {
		log.Debug("local.merge.unsent", "reason", err)
	}
}

// modified says whether one of files is modified in the folder's working
// tree or index (`git status --porcelain`); an error counts as modified.
func (p *Project) modified(ctx context.Context, files []string) bool {
	cmd := gitCommand(ctx, p.folder, append([]string{"status", "--porcelain", "--"}, files...)...)
	cmd.Env = append(cmd.Env, "GIT_LITERAL_PATHSPECS=1")
	out, err := cmd.Output()
	return err != nil || strings.TrimSpace(string(out)) != ""
}

type pendingMerge struct {
	projectID string
	number    int
	sha       string
	files     []string
}

// pendingMerges are the blocked merges of projectID, "" for every Projet.
func (d *DB) pendingMerges(ctx context.Context, projectID string) ([]pendingMerge, error) {
	rows, err := d.db.QueryContext(ctx, `SELECT project_id, number, sha, files FROM pending_merges WHERE ? = '' OR project_id = ? ORDER BY since`, projectID, projectID)
	if err != nil {
		return nil, fmt.Errorf("local: read the pending merges: %w", err)
	}
	defer rows.Close()
	var list []pendingMerge
	for rows.Next() {
		var pm pendingMerge
		var files string
		if err := rows.Scan(&pm.projectID, &pm.number, &pm.sha, &files); err != nil {
			return nil, fmt.Errorf("local: read the pending merges: %w", err)
		}
		_ = json.Unmarshal([]byte(files), &pm.files)
		list = append(list, pm)
	}
	return list, rows.Err()
}
