package mirror

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
)

// The follower's periods (ADR 0010).
const (
	// ReconcileEvery is the server's own interval: every Projet is reconciled that often.
	ReconcileEvery = 15 * time.Minute
	// RenewBefore is how long before the earliest expiresAt the tokens are asked again.
	RenewBefore = 10 * time.Minute
	// TokenTimeout is how long the server may take to answer a mirror.token.
	TokenTimeout = 30 * time.Second
	// MaxFetches is how many Projets read GitHub at once.
	MaxFetches = 4
)

// FollowBackoff is the wait after a failed fetch or token request: 1 s
// doubling to 5 min. A rate limit waits for GitHub's own RetryAt instead.
var FollowBackoff = protocol.Backoff{Min: time.Second, Max: 5 * time.Minute}

// Clock is the follower's time, which a test drives.
type Clock interface {
	Now() time.Time
	// Timer fires once d passed; stop releases it.
	Timer(d time.Duration) (fired <-chan time.Time, stop func())
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

func (realClock) Timer(d time.Duration) (<-chan time.Time, func()) {
	t := time.NewTimer(d)
	return t.C, func() { t.Stop() }
}

// FollowerConfig is what a Follower follows GitHub with.
type FollowerConfig struct {
	Store *Store
	// GitHub reads GitHub; its Tokens are the follower's « Miroir » tokens.
	GitHub *Client
	Logger *slog.Logger
	// Clock is the real one unless a test drives it.
	Clock Clock
	// Backoff defaults to FollowBackoff.
	Backoff protocol.Backoff
	// Locals are the Local Projets' Sources (SOURCE-2); nil: no Local key is filled.
	Locals LocalSources
	// Folders are the Local Projets' folders in the Runner's state (projectId → path).
	Folders func() map[string]string
	// Vault opens a Local Projet's sealed name; nil: its key names it.
	Vault func() NameOpener
	// Tokens, when set, give the GitHub tokens in place of the server's «
	// Miroir » ones: the commands' tests, which run no server.
	Tokens func(repository string) github.TokenSource
	// Clones are the Projets' clones of the Runner, the documentation
	// index's (MIROIR-5); without them no document is indexed.
	Clones Clones
}

// Follower keeps the copy live from the server's envelopes (ADR 0010,
// MIROIR-4), the Miroir's only writer: each github.changed is queued in its
// Projet's order and applied by fetching what it names, its rows and the
// cursor in one transaction; a failed fetch holds its Projet's later
// envelopes, never another Projet's; every Projet is reconciled at start,
// after a mirror.resync and every ReconcileEvery, one at a time; the «
// Miroir » tokens are asked after each accepted hello and mirror.projects,
// kept in memory only, and renewed RenewBefore their expiry.
//
// The cursor never passes an envelope not applied: it is the lowest seq not
// yet applied minus one, the later seqs applied being kept beside it in meta
// until it catches up, so that a restart replays only what is missing.
type Follower struct {
	store   *Store
	mirror  *Mirror
	folders func() map[string]string
	vault   func() NameOpener
	logger  *slog.Logger
	clock   Clock
	backoff protocol.Backoff

	client    atomic.Pointer[protocol.Client]
	fetches   chan struct{} // MaxFetches slots
	reconcile chan struct{} // one reconciliation at a time
	writing   sync.Mutex    // the cursor's writes, committed in the order they are computed
	kick      chan struct{} // wakes the token loop

	mu       sync.Mutex
	ctx      context.Context // Run's, nil before it
	started  time.Time
	projects map[string]*followed
	workers  sync.WaitGroup

	cursor       int64
	hasCursor    bool
	ahead        map[int64]bool // applied after the cursor
	lastReceived int64          // the last seq received on this connection: an older one is a replay of one known
	connected    bool
	live         bool // mirror.live received on this connection
	resync       *resync
	// epoch counts the resyncs: an envelope's seq is of the server of its
	// epoch, one of an older epoch moves no cursor.
	epoch uint64

	tokens      map[string]installationToken // by repository, lower case
	tokensReady bool                         // a mirror.token.issued arrived
	tok         tokenRequest
	marks       uint64 // the behind marks' last seq
}

// followed is one Projet the follower follows.
type followed struct {
	project  Project
	queue    []change // received, not applied yet, in seq order
	wanted   uint64   // reconciliations asked…
	done     uint64   // …and the last one finished
	failures int
	filled   bool
	synced   time.Time
	// behind are the objects whose refresh failed (a fetch; 0 a
	// synchronization), each with its mark's seq: the copy stays late until
	// a refresh of it begun after succeeds (risk AGT-7, after an agent's
	// write).
	behind map[int]uint64
	// docsWanted are the documentation indexes asked (a reconciliation, a
	// push on the integration branch, a moved Local ref), docsDone the last
	// one finished; docsFailed while the last try failed, docsRetry when the
	// next one runs.
	docsWanted, docsDone uint64
	docsFailed           bool
	docsFailures         int
	docsRetry            time.Time
	wake                 chan struct{}
	cancel               context.CancelFunc
	stopped              chan struct{}
}

// resync is a mirror.resync in progress: each Projet's reconciliation asked
// by it, then mirror.live's seq.
type resync struct {
	need map[string]uint64
	live *int64
}

type installationToken struct {
	installation int64
	token        string
	expiresAt    time.Time
}

// tokenRequest is the token loop's state.
type tokenRequest struct {
	ask      bool      // ask now
	awaiting bool      // a request waits for its answer…
	next     time.Time // …until then; else the retry or the renewal
	failures int
}

// change is a github.changed's envelope, as the follower applies it.
type change struct {
	seq        int64
	repository string
	kind       contracts.RunnerGithubChangedChangeKind
	number     int
	sha        string
	received   time.Time
	epoch      uint64
	ref        string // a push's
}

// NewFollower is the follower of cfg.Store, from where its last run left the copy.
func NewFollower(cfg FollowerConfig) (*Follower, error) {
	if cfg.Clock == nil {
		cfg.Clock = realClock{}
	}
	if cfg.Backoff.Min == 0 {
		cfg.Backoff = FollowBackoff
	}
	f := &Follower{
		store:     cfg.Store,
		folders:   cfg.Folders,
		vault:     cfg.Vault,
		logger:    cfg.Logger,
		clock:     cfg.Clock,
		backoff:   cfg.Backoff,
		fetches:   make(chan struct{}, MaxFetches),
		reconcile: make(chan struct{}, 1),
		kick:      make(chan struct{}, 1),
		projects:  map[string]*followed{},
		tokens:    map[string]installationToken{},
	}
	if f.logger == nil {
		f.logger = (&Mirror{}).logger()
	}
	cfg.GitHub.Tokens = f.tokenSource
	if cfg.Tokens != nil {
		cfg.GitHub.Tokens, f.tokensReady = cfg.Tokens, true
	}
	if cfg.GitHub.Now == nil {
		cfg.GitHub.Now = f.clock.Now
	}
	f.mirror = &Mirror{Store: cfg.Store, GitHub: cfg.GitHub, Locals: cfg.Locals, Logger: f.logger, Now: f.clock.Now, Clones: cfg.Clones}
	cursor, err := cfg.Store.Cursor()
	if err != nil {
		return nil, err
	}
	if cursor != nil {
		f.cursor, f.hasCursor, f.lastReceived = *cursor, true, *cursor
	}
	if f.ahead, err = cfg.Store.applied(); err != nil {
		return nil, err
	}
	projects, err := cfg.Store.Projects()
	if err != nil {
		return nil, err
	}
	marks, err := cfg.Store.marks()
	if err != nil {
		return nil, err
	}
	for _, p := range projects {
		// Reconciled at start, once the tokens arrived.
		f.projects[key(p.Repository)] = newFollowed(p, marks[p.Repository])
	}
	return f, nil
}

func key(repository string) string { return strings.ToLower(repository) }

func newFollowed(p Project, m marks) *followed {
	return &followed{project: p, wanted: 1, filled: m.filled, synced: m.synced, wake: make(chan struct{}, 1)}
}

// NewClient is a protocol client of cfg that the follower follows: each
// hello carries the cursor, each accepted connection asks the tokens, and
// the Miroir's messages are the follower's. Send goes through the last
// client made.
func (f *Follower) NewClient(cfg protocol.Config) *protocol.Client {
	cfg.Cursor = f.store.Cursor
	onAccepted, onClosed := cfg.OnAccepted, cfg.OnClosed
	cfg.OnAccepted = func(accepted contracts.RunnerHelloAccepted) {
		f.accepted()
		if onAccepted != nil {
			onAccepted(accepted)
		}
	}
	cfg.OnClosed = func() {
		f.closed()
		if onClosed != nil {
			onClosed()
		}
	}
	client := protocol.New(cfg)
	protocol.On(client, protocol.TypeMirrorProjects, f.projectsChanged)
	protocol.On(client, protocol.TypeGitHubChanged, f.changed)
	protocol.On(client, protocol.TypeMirrorResync, f.resynced)
	protocol.On(client, protocol.TypeMirrorLive, f.lived)
	protocol.On(client, protocol.TypeMirrorTokenIssued, f.tokenIssued)
	protocol.On(client, protocol.TypeMirrorTokenFailed, f.tokenFailed)
	f.client.Store(client)
	return client
}

func (f *Follower) send(ctx context.Context, message any) error {
	client := f.client.Load()
	if client == nil {
		return protocol.ErrNotConnected
	}
	return client.Send(ctx, message)
}

// Run follows until ctx ends: the Projets' workers, the token loop and the
// periodic reconciliation.
func (f *Follower) Run(ctx context.Context) error {
	f.mu.Lock()
	f.ctx = ctx
	f.started = f.clock.Now()
	for _, p := range f.projects {
		f.start(p)
	}
	f.mu.Unlock()
	tokens := make(chan struct{})
	go func() {
		defer close(tokens)
		f.followTokens(ctx)
	}()
	f.reconcileEvery(ctx)
	<-tokens
	f.workers.Wait()
	return nil
}

// start runs p's worker, once Run did; f.mu is held.
func (f *Follower) start(p *followed) {
	if f.ctx == nil || p.stopped != nil {
		return
	}
	ctx, cancel := context.WithCancel(f.ctx)
	p.cancel, p.stopped = cancel, make(chan struct{})
	f.workers.Add(1)
	go func() {
		defer f.workers.Done()
		defer close(p.stopped)
		f.work(ctx, p)
	}()
}

func wake(p *followed) {
	select {
	case p.wake <- struct{}{}:
	default:
	}
}

func (f *Follower) wakeAll() {
	for _, p := range f.projects {
		wake(p)
	}
}

// accepted: a new connection, whose server replays every envelope after the
// stored cursor; those queued are dropped, they come again.
func (f *Follower) accepted() {
	f.mu.Lock()
	f.connected, f.live, f.resync = true, false, nil
	f.lastReceived = 0
	if f.hasCursor {
		f.lastReceived = f.cursor
	}
	for _, p := range f.projects {
		p.queue = nil
	}
	f.wakeAll()
	f.mu.Unlock()
	f.askToken()
}

func (f *Follower) closed() {
	f.mu.Lock()
	f.connected, f.live = false, false
	f.mu.Unlock()
}

// projectsChanged makes the copy's Projets the server's: a new one starts
// unfilled and gets its reconciliation; one no longer a Projet stops, its
// rows deleted and its queued envelopes counted as applied. Then the tokens.
func (f *Follower) projectsChanged(_ context.Context, m contracts.RunnerMirrorProjects) error {
	var folders map[string]string
	if f.folders != nil {
		folders = f.folders()
	}
	var vault NameOpener
	if f.vault != nil {
		vault = f.vault()
	}
	projects := ProjectsOf(m.Projects, folders, vault)
	kept := map[string]bool{}
	for _, p := range projects {
		kept[key(p.Repository)] = true
	}
	f.mu.Lock()
	var removed []*followed
	var orphans []change
	for k, p := range f.projects {
		if kept[k] {
			continue
		}
		delete(f.projects, k)
		if f.resync != nil {
			delete(f.resync.need, k)
		}
		removed = append(removed, p)
		orphans = append(orphans, p.queue...)
		if p.cancel != nil {
			p.cancel()
		}
	}
	f.mu.Unlock()
	// Its worker ends before its rows go: nothing of it is written after.
	for _, p := range removed {
		if p.stopped != nil {
			<-p.stopped
		}
	}
	if err := f.store.PutProjects(projects); err != nil {
		return err
	}
	marks, err := f.store.marks()
	if err != nil {
		return err
	}
	f.mu.Lock()
	for _, p := range projects {
		if current, ok := f.projects[key(p.Repository)]; ok {
			if current.project.IntegrationBranch != p.IntegrationBranch || current.project.Has(GroupCode) != p.Has(GroupCode) {
				// Its documents are another branch's, or none.
				current.docsWanted++
				wake(current)
			}
			current.project = p
			if p.Source == SourceLocal {
				// Its Source may have moved its folder or its groups: read again.
				current.wanted++
				wake(current)
			}
			continue
		}
		added := newFollowed(p, marks[p.Repository])
		f.projects[key(p.Repository)] = added
		f.start(added)
	}
	f.mu.Unlock()
	sort.Slice(orphans, func(i, j int) bool { return orphans[i].seq < orphans[j].seq })
	for _, c := range orphans {
		if err := f.commit(c.seq, c.epoch, "", nil); err != nil {
			return err
		}
	}
	if err := f.finishResync(); err != nil {
		return err
	}
	f.logger.Info("mirror projects", "count", len(projects), "removed", len(removed))
	f.askToken()
	return nil
}

// changed queues an envelope in its Projet's order; one already received or
// applied (a replay) is ignored, one of no Projet is applied at once.
func (f *Follower) changed(_ context.Context, m contracts.RunnerGithubChanged) error {
	c := change{seq: int64(m.Change.Seq), repository: m.Change.Repository, kind: m.Change.Kind, received: f.clock.Now()}
	if n, ok := asInt(m.Change.Number); ok {
		c.number = n
	}
	if sha, ok := m.Change.Sha.(string); ok {
		c.sha = sha
	}
	if ref, ok := m.Change.Ref.(string); ok {
		c.ref = ref
	}
	f.mu.Lock()
	// While a resync runs, the stored cursor is no longer the server's.
	if c.seq <= f.lastReceived || f.ahead[c.seq] || (f.hasCursor && f.resync == nil && c.seq <= f.cursor) {
		f.lastReceived = max(f.lastReceived, c.seq)
		f.mu.Unlock()
		return nil
	}
	f.lastReceived = c.seq
	c.epoch = f.epoch
	p, ok := f.projects[key(c.repository)]
	if ok {
		p.queue = append(p.queue, c)
		wake(p)
	}
	f.mu.Unlock()
	if !ok {
		return f.commit(c.seq, c.epoch, "", nil)
	}
	return nil
}

func asInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	}
	return 0, false
}

// resynced: the server no longer has every envelope after the cursor, or
// never had them (another server, whose counter may be below it). Every
// Projet is reconciled; the queued envelopes are dropped, the
// reconciliations cover them, and so are the seqs applied after the cursor;
// the cursor becomes mirror.live's seq once they all finished.
func (f *Follower) resynced(context.Context, contracts.RunnerMirrorResync) error {
	f.writing.Lock()
	defer f.writing.Unlock()
	f.mu.Lock()
	f.epoch++
	f.ahead = map[int64]bool{}
	r := &resync{need: map[string]uint64{}}
	for k, p := range f.projects {
		if p.project.Source == SourceLocal {
			continue // no envelope names a Local key
		}
		p.queue = nil
		p.wanted++
		r.need[k] = p.wanted
		wake(p)
	}
	f.resync = r
	f.mu.Unlock()
	f.logger.Info("mirror resync", "projects", len(r.need))
	return nil
}

// lived: the replay is over; after a resync, its seq is the cursor once the
// reconciliations finished.
func (f *Follower) lived(_ context.Context, m contracts.RunnerMirrorLive) error {
	seq := int64(m.Seq)
	f.mu.Lock()
	f.live = true
	if f.resync != nil && f.resync.live == nil {
		// The server's counter, even below the stored cursor.
		f.resync.live = &seq
		f.lastReceived = seq
	} else {
		f.lastReceived = max(f.lastReceived, seq)
	}
	f.mu.Unlock()
	f.logger.Info("mirror live", "seq", seq)
	return f.finishResync()
}

// finishResync moves the cursor to mirror.live's seq once every
// reconciliation the resync asked finished, and lets the queued envelopes go.
func (f *Follower) finishResync() error {
	f.writing.Lock()
	defer f.writing.Unlock()
	f.mu.Lock()
	r := f.resync
	if r == nil || r.live == nil {
		f.mu.Unlock()
		return nil
	}
	for k, gen := range r.need {
		if p, ok := f.projects[k]; ok && p.done < gen {
			f.mu.Unlock()
			return nil
		}
	}
	cursor := *r.live
	ahead := map[int64]bool{}
	for seq := range f.ahead {
		if seq > cursor {
			ahead[seq] = true
		}
	}
	cursor = catchUp(cursor, ahead)
	f.mu.Unlock()
	if err := f.store.Update(func(tx *sql.Tx) error { return writeCursor(tx, cursor, ahead) }); err != nil {
		return err
	}
	f.mu.Lock()
	f.cursor, f.hasCursor, f.ahead = cursor, true, ahead
	if f.resync == r {
		f.resync = nil
	}
	f.wakeAll()
	f.mu.Unlock()
	f.logger.Info("mirror resync done", "seq", cursor)
	return nil
}

// catchUp moves cursor over the seqs of ahead that follow it, removing them.
func catchUp(cursor int64, ahead map[int64]bool) int64 {
	for ahead[cursor+1] {
		delete(ahead, cursor+1)
		cursor++
	}
	return cursor
}

func writeCursor(tx *sql.Tx, cursor int64, ahead map[int64]bool) error {
	if err := SetMeta(tx, MetaMirrorAfter, strconv.FormatInt(cursor, 10)); err != nil {
		return err
	}
	return writeAhead(tx, ahead)
}

func writeAhead(tx *sql.Tx, ahead map[int64]bool) error {
	seqs := make([]int64, 0, len(ahead))
	for seq := range ahead {
		seqs = append(seqs, seq)
	}
	sort.Slice(seqs, func(i, j int) bool { return seqs[i] < seqs[j] })
	parts := make([]string, len(seqs))
	for i, seq := range seqs {
		parts[i] = strconv.FormatInt(seq, 10)
	}
	return SetMeta(tx, MetaMirrorApplied, strings.Join(parts, ","))
}

// commit applies the envelope seq of epoch: in one transaction, what write
// puts (for the repository, still a Projet), the Projet's synced_at, and the
// cursor. One of an older epoch moves no cursor: its seq is of the server
// before the resync; one received during a resync is only marked applied,
// the cursor waits for mirror.live's seq.
func (f *Follower) commit(seq int64, epoch uint64, repository string, write func(*sql.Tx) error) error {
	f.writing.Lock()
	defer f.writing.Unlock()
	f.mu.Lock()
	current := epoch == f.epoch
	cursor, has := f.cursor, f.hasCursor && f.resync == nil
	ahead := make(map[int64]bool, len(f.ahead)+1)
	for s := range f.ahead {
		ahead[s] = true
	}
	if current && (!has || seq > cursor) {
		ahead[seq] = true
	}
	if has {
		cursor = catchUp(cursor, ahead)
	}
	f.mu.Unlock()
	at := f.clock.Now()
	err := f.store.Update(func(tx *sql.Tx) error {
		if repository != "" {
			var n int
			if err := tx.QueryRow("SELECT count(*) FROM projects WHERE repository = ?", repository).Scan(&n); err != nil {
				return fmt.Errorf("mirror: projects: %w", err)
			}
			if n > 0 {
				if write != nil {
					if err := write(tx); err != nil {
						return err
					}
				}
				if err := exec(tx, "UPDATE projects SET synced_at = ? WHERE repository = ?", at.UTC().Format(time.RFC3339), repository); err != nil {
					return err
				}
			}
		}
		switch {
		case !current:
			return nil
		case has:
			return writeCursor(tx, cursor, ahead)
		}
		return writeAhead(tx, ahead)
	})
	if err != nil {
		return err
	}
	f.mu.Lock()
	if current {
		f.cursor, f.ahead = cursor, ahead
	}
	if p, ok := f.projects[key(repository)]; ok && repository != "" {
		p.synced = at.UTC().Truncate(time.Second)
	}
	f.mu.Unlock()
	return nil
}

// job is a worker's next step: its Projet's reconciliation, or its first
// envelope; repository is the Projet's when the job was taken, mirror.projects
// may change the Projet meanwhile.
type job struct {
	repository string
	reconcile  bool
	docs       bool
	generation uint64
	change     change
}

// next is p's next job: none before the tokens, the reconciliation first,
// then the envelopes, which wait while a resync runs, then the
// documentation index, after its wait when it failed: a failed index never
// holds an envelope.
func (f *Follower) next(p *followed) (job, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	local := p.project.Source == SourceLocal
	switch {
	case !f.tokensReady && !local: // a Local key never waits on a network
		return job{}, false
	case p.done < p.wanted:
		return job{repository: p.project.Repository, reconcile: true, generation: p.wanted}, true
	case f.resync == nil && len(p.queue) > 0:
		return job{repository: p.project.Repository, change: p.queue[0]}, true
	case p.docsDone < p.docsWanted && !f.clock.Now().Before(p.docsRetry):
		return job{repository: p.project.Repository, docs: true, generation: p.docsWanted}, true
	}
	return job{}, false
}

// docsWait is when p's failed index is tried again; zero when none waits.
func (f *Follower) docsWait(p *followed) time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	if p.docsDone < p.docsWanted {
		return p.docsRetry
	}
	return time.Time{}
}

// work is p's worker: one job at a time, a failed one retried after its wait.
func (f *Follower) work(ctx context.Context, p *followed) {
	for {
		j, ok := f.next(p)
		if !ok {
			var retry <-chan time.Time
			stop := func() {}
			if at := f.docsWait(p); !at.IsZero() {
				retry, stop = f.clock.Timer(at.Sub(f.clock.Now()))
			}
			select {
			case <-ctx.Done():
				stop()
				return
			case <-p.wake:
			case <-retry:
			}
			stop()
			continue
		}
		var err error
		switch {
		case j.docs:
			// Its failure waits in docsRetry: the envelopes go on meanwhile.
			f.indexDocs(ctx, p, j.repository, j.generation)
			if ctx.Err() != nil {
				return
			}
			continue
		case j.reconcile:
			err = f.reconcileProject(ctx, p, j.repository, j.generation)
		default:
			err = f.apply(ctx, p, j.repository, j.change)
		}
		if ctx.Err() != nil {
			return
		}
		if err == nil {
			f.mu.Lock()
			p.failures = 0
			f.mu.Unlock()
			continue
		}
		if !f.sleepUntil(ctx, f.retryAt(p, err)) {
			return
		}
	}
}

// retryAt is when p's failed job is tried again: GitHub's RetryAt for a rate
// limit, else after the backoff.
func (f *Follower) retryAt(p *followed, err error) time.Time {
	var limited *LimitedError
	if errors.As(err, &limited) {
		return limited.RetryAt
	}
	f.mu.Lock()
	delay := f.backoff.Delay(p.failures)
	p.failures++
	f.mu.Unlock()
	return f.clock.Now().Add(delay)
}

func (f *Follower) sleepUntil(ctx context.Context, at time.Time) bool {
	fired, stop := f.clock.Timer(at.Sub(f.clock.Now()))
	defer stop()
	select {
	case <-ctx.Done():
		return false
	case <-fired:
		return true
	}
}

func acquire(ctx context.Context, slots chan struct{}) bool {
	select {
	case slots <- struct{}{}:
		return true
	case <-ctx.Done():
		return false
	}
}

// reconcileProject runs p's reconciliation, one Projet at a time.
func (f *Follower) reconcileProject(ctx context.Context, p *followed, repository string, generation uint64) error {
	if IsLocal(repository) {
		return f.reconcileLocal(ctx, p, repository, generation)
	}
	begun := f.markSeq()
	if !acquire(ctx, f.reconcile) {
		return ctx.Err()
	}
	defer func() { <-f.reconcile }()
	if !acquire(ctx, f.fetches) {
		return ctx.Err()
	}
	_, err := f.mirror.Reconcile(ctx, repository)
	<-f.fetches
	if err != nil {
		if ctx.Err() == nil {
			f.logger.Warn("mirror reconcile failed", "repository", repository, "class", errorClass(err), "error", err.Error())
		}
		return err
	}
	marks, err := f.store.marks()
	if err != nil {
		return err
	}
	f.mu.Lock()
	m := marks[repository]
	p.done, p.filled, p.synced = max(p.done, generation), m.filled, m.synced
	p.caughtUp(0, begun)
	p.docsWanted++ // the branch may have moved without an envelope
	wake(p)
	f.mu.Unlock()
	return f.finishResync()
}

// reconcileLocal reads a Local key's whole Source: its folder is on the disk,
// it never holds a GitHub reconciliation's turn.
func (f *Follower) reconcileLocal(ctx context.Context, p *followed, repository string, generation uint64) error {
	_, err := f.mirror.ReconcileLocal(ctx, repository)
	if err != nil {
		if ctx.Err() == nil {
			f.logger.Warn("mirror local reconcile failed", "repository", repository, "class", errorClass(err), "error", err.Error())
		}
		return err
	}
	marks, err := f.store.marks()
	if err != nil {
		return err
	}
	f.mu.Lock()
	m := marks[repository]
	p.done, p.filled, p.synced = max(p.done, generation), m.filled, m.synced
	p.docsWanted++
	wake(p)
	f.mu.Unlock()
	return nil
}

// indexDocs runs the key's documentation index (MIROIR-5): asked by
// generation, it is done once one begun after the ask succeeds; a failure
// waits its backoff in docsRetry, the GitHub key late meanwhile.
func (f *Follower) indexDocs(ctx context.Context, p *followed, repository string, generation uint64) error {
	err := f.mirror.IndexDocs(ctx, repository)
	f.mu.Lock()
	defer f.mu.Unlock()
	switch {
	case err == nil:
		p.docsDone, p.docsFailed, p.docsFailures, p.docsRetry = max(p.docsDone, generation), false, 0, time.Time{}
	case ctx.Err() == nil:
		f.logger.Warn("mirror docs failed", "repository", repository, "class", errorClass(err), "error", err.Error())
		p.docsFailed = true
		p.docsRetry = f.clock.Now().Add(f.backoff.Delay(p.docsFailures))
		p.docsFailures++
	}
	return err
}

// RefsMoved asks the documentation index of the Local Projet whose refs
// moved (SOURCE-3's watcher: a commit, a merge, a branch made or gone in
// its folder), on the key holding its code.
func (f *Follower) RefsMoved(projectID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, p := range f.projects {
		if p.project.Source == SourceLocal && p.project.ProjectID == projectID && p.project.Has(GroupCode) {
			p.docsWanted++
			wake(p)
		}
	}
}

// apply fetches what the envelope c names and commits it with the cursor.
func (f *Follower) apply(ctx context.Context, p *followed, repository string, c change) error {
	started := f.clock.Now()
	if !acquire(ctx, f.fetches) {
		return ctx.Err()
	}
	write, err := f.fetch(ctx, repository, c)
	<-f.fetches
	if err == nil {
		err = f.commit(c.seq, c.epoch, repository, write)
	}
	attrs := []any{"repository", repository, "kind", string(c.kind), "number", c.number, "seq", c.seq,
		"duration_ms", f.clock.Now().Sub(started).Milliseconds()}
	if err != nil {
		if ctx.Err() == nil {
			f.logger.Warn("mirror envelope failed", append(attrs, "class", errorClass(err), "error", err.Error())...)
		}
		return err
	}
	f.mu.Lock()
	if len(p.queue) > 0 && p.queue[0].seq == c.seq && p.queue[0].epoch == c.epoch {
		p.queue = p.queue[1:]
	}
	if c.kind == contracts.RunnerGithubChangedChangeKindPush && c.ref == "refs/heads/"+p.project.IntegrationBranch && p.project.Has(GroupCode) {
		p.docsWanted++ // the worker indexes it once the envelopes before are applied
	}
	f.mu.Unlock()
	f.logger.Info("mirror envelope applied", attrs...)
	return nil
}

// fetch reads from GitHub what c names and returns what writes it: an issue
// or a PR (with its head's checks), a commit's checks for the PRs of the
// copy whose head or merge commit it is, the repository's labels,
// milestones and releases; nothing for a push, which asks the documentation
// index once applied (MIROIR-5).
func (f *Follower) fetch(ctx context.Context, repository string, c change) (func(*sql.Tx) error, error) {
	gh := f.mirror.GitHub
	switch c.kind {
	case contracts.RunnerGithubChangedChangeKindIssue, contracts.RunnerGithubChangedChangeKindPull:
		if c.number == 0 {
			return nil, nil
		}
		object, err := f.mirror.fetchObject(ctx, repository, c.number)
		if err != nil {
			return nil, err
		}
		if object.gone || object.object.Pull == nil || object.object.Pull.HeadOid == "" {
			return object.put, nil
		}
		pull := object.object.Pull
		checks, err := gh.FetchChecks(ctx, repository, pull.HeadOid)
		if errors.Is(err, ErrGone) {
			checks, err = nil, nil
		}
		if err != nil {
			return nil, err
		}
		return func(tx *sql.Tx) error {
			if err := object.put(tx); err != nil {
				return err
			}
			return PutChecks(tx, repository, pull.HeadOid, pull.ChecksState, checks)
		}, nil
	case contracts.RunnerGithubChangedChangeKindCheck:
		if c.sha == "" {
			return nil, nil
		}
		var n int
		if err := f.store.db.QueryRow("SELECT count(*) FROM pulls WHERE repository = ? AND (head_oid = ? OR merge_commit_oid = ?)", repository, c.sha, c.sha).Scan(&n); err != nil {
			return nil, fmt.Errorf("mirror: read the copy: %w", err)
		}
		if n == 0 {
			// No PR of the copy has this commit: the copy keeps none of its checks.
			return nil, nil
		}
		checks, err := gh.FetchChecks(ctx, repository, c.sha)
		if errors.Is(err, ErrGone) {
			checks, err = nil, nil
		}
		if err != nil {
			return nil, err
		}
		// The rollup's state is unknown here: the next walk reads these checks again once.
		return func(tx *sql.Tx) error { return PutChecks(tx, repository, c.sha, "", checks) }, nil
	case contracts.RunnerGithubChangedChangeKindLabel, contracts.RunnerGithubChangedChangeKindMilestone, contracts.RunnerGithubChangedChangeKindRelease:
		collections, err := gh.FetchCollections(ctx, repository)
		if err != nil {
			return nil, err
		}
		return func(tx *sql.Tx) error {
			return PutCollections(tx, repository, collections.Labels, collections.Milestones, collections.Releases)
		}, nil
	}
	return nil, nil
}

// errorClass names a failure in the log, never with what GitHub answered.
func errorClass(err error) string {
	var limited *LimitedError
	switch {
	case errors.As(err, &limited):
		return "limited"
	case errors.Is(err, ErrUnavailable):
		return "unavailable"
	case errors.Is(err, ErrRefused):
		return "refused"
	case errors.Is(err, ErrNotAProject):
		return "not-a-project"
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return "canceled"
	}
	return "other"
}

// reconcileEvery asks every Projet's reconciliation each ReconcileEvery from the start.
func (f *Follower) reconcileEvery(ctx context.Context) {
	next := f.started.Add(ReconcileEvery)
	for {
		fired, stop := f.clock.Timer(next.Sub(f.clock.Now()))
		select {
		case <-ctx.Done():
			stop()
			return
		case <-fired:
		}
		stop()
		for now := f.clock.Now(); !next.After(now); {
			next = next.Add(ReconcileEvery)
		}
		f.mu.Lock()
		for _, p := range f.projects {
			p.wanted++
			wake(p)
		}
		f.mu.Unlock()
	}
}

// tokenSource is the « Miroir » token of the repository's installation.
func (f *Follower) tokenSource(repository string) github.TokenSource {
	return mirrorToken{f: f, repository: repository}
}

type mirrorToken struct {
	f          *Follower
	repository string
}

func (t mirrorToken) Token(context.Context) (string, error) {
	t.f.mu.Lock()
	token, ok := t.f.tokens[key(t.repository)]
	t.f.mu.Unlock()
	if !ok {
		return "", fmt.Errorf("%w: no « Miroir » token for %s", ErrRefused, t.repository)
	}
	return token.token, nil
}

func (f *Follower) kickTokens() {
	select {
	case f.kick <- struct{}{}:
	default:
	}
}

// askToken asks the tokens now.
func (f *Follower) askToken() {
	f.mu.Lock()
	f.tok.ask = true
	f.mu.Unlock()
	f.kickTokens()
}

// tokenIssued keeps the tokens in memory, by repository, and plans their renewal.
func (f *Follower) tokenIssued(_ context.Context, m contracts.RunnerMirrorTokenIssued) error {
	tokens := map[string]installationToken{}
	var earliest time.Time
	for _, t := range m.Tokens {
		for _, repo := range t.Repositories {
			tokens[key(repo)] = installationToken{installation: int64(t.InstallationId), token: t.Token, expiresAt: t.ExpiresAt}
		}
		if earliest.IsZero() || t.ExpiresAt.Before(earliest) {
			earliest = t.ExpiresAt
		}
	}
	var renewAt time.Time // none without a token: asked again on the next hello or mirror.projects
	if !earliest.IsZero() {
		renewAt = earliest.Add(-RenewBefore)
	}
	f.mu.Lock()
	f.tokens, f.tokensReady = tokens, true
	f.tok.awaiting, f.tok.failures, f.tok.next = false, 0, renewAt
	f.wakeAll()
	f.mu.Unlock()
	f.logger.Info("mirror token issued", "installations", len(m.Tokens), "renewAt", renewAt.UTC().Format(time.RFC3339))
	f.kickTokens()
	return nil
}

// tokenFailed: the server could not mint a token; asked again after the backoff.
func (f *Follower) tokenFailed(_ context.Context, m contracts.RunnerMirrorTokenFailed) error {
	f.mu.Lock()
	delay := f.backoff.Delay(f.tok.failures)
	f.tok.failures++
	f.tok.awaiting, f.tok.next = false, f.clock.Now().Add(delay)
	f.mu.Unlock()
	f.logger.Warn("mirror token failed", "code", m.Code, "in", delay.String())
	f.kickTokens()
	return nil
}

// followTokens sends mirror.token when asked, when an answer is late (after
// the backoff), on a retry and on the renewal.
func (f *Follower) followTokens(ctx context.Context) {
	for {
		f.mu.Lock()
		now := f.clock.Now()
		due := !f.tok.next.IsZero() && !now.Before(f.tok.next)
		send := false
		switch {
		case f.tok.ask:
			send = true
		case due && f.tok.awaiting:
			delay := f.backoff.Delay(f.tok.failures)
			f.tok.failures++
			f.tok.awaiting, f.tok.next = false, now.Add(delay)
			f.logger.Warn("mirror token unanswered", "in", delay.String())
		case due:
			send = true
		}
		if send {
			f.tok.ask, f.tok.awaiting, f.tok.next = false, true, now.Add(TokenTimeout)
		}
		next := f.tok.next
		f.mu.Unlock()
		if send {
			if err := f.send(ctx, protocol.NewMirrorToken()); err != nil {
				// Not connected: the next accepted connection asks.
				f.mu.Lock()
				if f.tok.awaiting && f.tok.next.Equal(next) {
					f.tok.awaiting, f.tok.next = false, time.Time{}
				}
				next = f.tok.next
				f.mu.Unlock()
			}
		}
		var fired <-chan time.Time
		stop := func() {}
		if !next.IsZero() {
			fired, stop = f.clock.Timer(next.Sub(f.clock.Now()))
		}
		select {
		case <-ctx.Done():
			stop()
			return
		case <-f.kick:
		case <-fired:
		}
		stop()
	}
}

// markSeq is the behind marks' last seq.
func (f *Follower) markSeq() uint64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.marks
}

// markBehind records, f.mu held, that the refresh of p's object number (0:
// all of them) failed.
func (f *Follower) markBehind(p *followed, number int) {
	f.marks++
	if p.behind == nil {
		p.behind = map[int]uint64{}
	}
	p.behind[number] = f.marks
}

// caughtUp clears, f.mu held, the marks a refresh begun after seq begun
// leaves behind it: the object's (number), or every one (0).
func (p *followed) caughtUp(number int, begun uint64) {
	for n, seq := range p.behind {
		if seq <= begun && (number == 0 || n == number) {
			delete(p.behind, n)
		}
	}
}
