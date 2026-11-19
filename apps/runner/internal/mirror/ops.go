package mirror

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/localsock"
)

// The ops the follower serves on runner.sock (MIROIR-6): the `miroir`
// commands run in the agent's process and ask the running Runner, the
// copy's only writer and the tokens' only holder.
const (
	OpState   = "mirror.state"
	OpFetch   = "mirror.fetch"
	OpSync    = "mirror.sync"
	OpList    = "mirror.list"
	OpRebuild = "mirror.rebuild"
)

// The codes of the ops' failures, beside localsock's.
const (
	CodeUnavailable  = "unavailable"
	CodeNotAProject  = "not-a-project"
	CodeBadRequest   = "bad-request"
	CodeNotSupported = "not-supported"
)

type codedError struct {
	code string
	err  error
}

func (e *codedError) Error() string { return e.err.Error() }
func (e *codedError) Unwrap() error { return e.err }
func (e *codedError) Code() string  { return e.code }

// coded names a failure by its class, never with what GitHub or the folder said.
func coded(err error) error {
	if err == nil {
		return nil
	}
	switch errorClass(err) {
	case "not-a-project":
		return &codedError{CodeNotAProject, err}
	case "canceled":
		return &codedError{localsock.CodeTimeout, err}
	}
	return &codedError{CodeUnavailable, err}
}

const openIssuesWalkQuery = "query MirrorOpenIssues($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) { " +
	"issues(first: 100, after: $after, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) { " + pageInfo +
	" nodes { number updatedAt state blockedBy(first: 100) { nodes { " + refSelection + " } } } } } }"

const openPullsWalkQuery = "query MirrorOpenPulls($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) { " +
	"pullRequests(first: 100, after: $after, states: [OPEN], orderBy: {field: UPDATED_AT, direction: DESC}) { " + pageInfo +
	" nodes { number updatedAt state headRefOid statusCheckRollup { state } } } } }"

// ReconcileOpen walks only the open issues and PRs (`miroir list` and
// `ready` of a late copy): each absent from the copy or changed is fetched,
// with an open PR's checks; nothing is deleted, the Projet's filled mark
// is left as it is, its synced mark moved.
func (m *Mirror) ReconcileOpen(ctx context.Context, repository string) (Result, error) {
	if _, err := m.Store.filledAt(repository); err != nil {
		return Result{}, err
	}
	owner, name, err := splitRepository(repository)
	if err != nil {
		return Result{}, err
	}
	variables := map[string]any{"owner": owner, "name": name}
	issues, err := pages[listed](ctx, m.GitHub, repository, "MirrorOpenIssues", openIssuesWalkQuery, variables, []string{"repository", "issues"}, "")
	if err != nil {
		return Result{}, err
	}
	pulls, err := pages[listed](ctx, m.GitHub, repository, "MirrorOpenPulls", openPullsWalkQuery, variables, []string{"repository", "pullRequests"}, "")
	if err != nil {
		return Result{}, err
	}
	local, err := m.Store.copied(repository)
	if err != nil {
		return Result{}, err
	}
	result := Result{Listed: len(issues) + len(pulls)}
	for _, l := range issues {
		if c, ok := local[l.Number]; ok && c.updatedAt == l.UpdatedAt && c.blockedBy == blockersOf(l.BlockedBy.Nodes) {
			continue
		}
		if _, err := m.Refresh(ctx, repository, l.Number); err != nil {
			return result, err
		}
		result.Fetched++
	}
	for _, l := range pulls {
		c, ok := local[l.Number]
		if !ok || c.updatedAt != l.UpdatedAt || c.headOid != l.HeadRefOid {
			gone, err := m.Refresh(ctx, repository, l.Number)
			if err != nil {
				return result, err
			}
			result.Fetched++
			if gone {
				continue
			}
		}
		rollup := ""
		if l.StatusCheckRollup != nil {
			rollup = l.StatusCheckRollup.State
		}
		if !ok || c.headOid != l.HeadRefOid || !c.checksRead || c.readState != rollup {
			if err := m.refreshChecks(ctx, repository, l.Number, l.HeadRefOid, rollup); err != nil {
				return result, err
			}
			result.Checks++
		}
	}
	// An object open in the copy but in neither walk was closed or merged
	// while the follower was away: it is read again, never deleted on that
	// absence alone (Refresh drops it only when GitHub says it is gone).
	listed := map[int]bool{}
	for _, l := range issues {
		listed[l.Number] = true
	}
	for _, l := range pulls {
		listed[l.Number] = true
	}
	stale := []int{}
	for number, c := range local {
		if c.state == "OPEN" && !listed[number] {
			stale = append(stale, number)
		}
	}
	sort.Ints(stale)
	for _, number := range stale {
		f, err := m.fetchObject(ctx, repository, number)
		if err != nil {
			return result, err
		}
		write := f.put
		// A PR merged or closed meanwhile may have moved its head first: its
		// last head's checks are read as an open PR's are, before anything is
		// written, and written with the object in one transaction. A failed
		// read leaves the PR open in the copy, so the next walk tries again.
		if p := f.object.Pull; !f.gone && p != nil && p.HeadOid != "" {
			if c := local[number]; c.headOid != p.HeadOid || !c.checksRead || c.readState != p.ChecksState {
				checks, err := m.GitHub.FetchChecks(ctx, repository, p.HeadOid)
				if errors.Is(err, ErrGone) {
					checks, err = nil, nil
				}
				if err != nil {
					return result, err
				}
				write = func(tx *sql.Tx) error {
					if err := f.put(tx); err != nil {
						return err
					}
					return PutChecks(tx, repository, p.HeadOid, p.ChecksState, checks)
				}
				result.Checks++
			}
		}
		if err := m.Store.Update(write); err != nil {
			return result, err
		}
		result.Fetched++
	}
	if err := m.Store.MarkSynced(repository, m.now()); err != nil {
		return result, err
	}
	m.logger().Info("mirror reconcile open", "repository", repository, "listed", result.Listed, "fetched", result.Fetched, "checks", result.Checks)
	return result, nil
}

const listIssuesQuery = "query MirrorListIssues($owner: String!, $name: String!, $states: [IssueState!], $after: String) { repository(owner: $owner, name: $name) { " +
	"issues(first: 100, after: $after, states: $states, orderBy: {field: CREATED_AT, direction: DESC}) { " + pageInfo +
	" nodes { number state author { login } labels(first: 100) { nodes { name } } } } } }"

const listPullsQuery = "query MirrorListPulls($owner: String!, $name: String!, $states: [PullRequestState!], $after: String) { repository(owner: $owner, name: $name) { " +
	"pullRequests(first: 100, after: $after, states: $states, orderBy: {field: CREATED_AT, direction: DESC}) { " + pageInfo +
	" nodes { number state headRefName author { login } labels(first: 100) { nodes { name } } } } } }"

type listNode struct {
	Number      int    `json:"number"`
	State       string `json:"state"`
	HeadRefName string `json:"headRefName"`
	Author      *actor `json:"author"`
	Labels      struct {
		Nodes []struct {
			Name string `json:"name"`
		} `json:"nodes"`
	} `json:"labels"`
}

func listStates(f Filter) []string {
	switch strings.ToLower(f.State) {
	case "closed":
		if f.Pulls {
			return []string{"CLOSED", "MERGED"}
		}
		return []string{"CLOSED"}
	case "merged":
		return []string{"MERGED"}
	case "all":
		if f.Pulls {
			return []string{"OPEN", "CLOSED", "MERGED"}
		}
		return []string{"OPEN", "CLOSED"}
	}
	return []string{"OPEN"}
}

// List is GitHub's answer to `issue|pr list` with the filter, in the copy's
// shapes, for a key still filling: the objects listed newest first, those
// passing the filter fetched up to its limit, nothing written.
func (m *Mirror) List(ctx context.Context, repository string, f Filter) ([]map[string]any, error) {
	owner, name, err := splitRepository(repository)
	if err != nil {
		return nil, err
	}
	operation, query, field := "MirrorListIssues", listIssuesQuery, "issues"
	if f.Pulls {
		operation, query, field = "MirrorListPulls", listPullsQuery, "pullRequests"
	}
	if f.State == "merged" && !f.Pulls {
		return []map[string]any{}, nil
	}
	nodes, err := pages[listNode](ctx, m.GitHub, repository, operation, query,
		map[string]any{"owner": owner, "name": name, "states": listStates(f)}, []string{"repository", field}, "")
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for _, n := range nodes {
		if len(out) >= f.limit() {
			break
		}
		light := Object{Number: n.Number, IsPull: f.Pulls, State: n.State, Author: login(n.Author)}
		for _, l := range n.Labels.Nodes {
			light.Labels = append(light.Labels, l.Name)
		}
		if f.Pulls {
			light.Pull = &Pull{HeadRef: n.HeadRefName}
		}
		if !f.Matches(light) {
			continue
		}
		o, err := m.GitHub.FetchObject(ctx, repository, n.Number)
		if errors.Is(err, ErrGone) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if err := m.Store.closingOfLocalTickets(&o); err != nil {
			return nil, err
		}
		shape := Shape{URLOf: func(r Ref) string { return m.Store.urlOf(r) }}
		if o.Pull != nil && o.Pull.HeadOid != "" {
			// The object carries only its rollup's state; the checks are their own read.
			shape.Checks, err = m.GitHub.FetchChecks(ctx, repository, o.Pull.HeadOid)
			if errors.Is(err, ErrGone) {
				shape.Checks, err = nil, nil
			}
			if err != nil {
				return nil, err
			}
		}
		if o.Milestone != 0 {
			if collections, err := m.GitHub.FetchCollections(ctx, repository); err == nil {
				shape.Milestones = map[int]Milestone{}
				for _, ms := range collections.Milestones {
					shape.Milestones[ms.Number] = ms
				}
			}
		}
		out = append(out, View(o, shape))
	}
	return out, nil
}

// KeyState is one key's freshness in mirror.state's reply.
type KeyState struct {
	State    FreshnessState `json:"state"`
	SyncedAt *string        `json:"syncedAt"`
}

// StateReply is mirror.state's reply.
type StateReply struct {
	Connected bool                `json:"connected"`
	Keys      map[string]KeyState `json:"keys"`
}

// FetchRequest is mirror.fetch's request.
type FetchRequest struct {
	Repository string `json:"repository"`
	Number     int    `json:"number"`
}

// SyncRequest is mirror.sync's request: every key without a repository.
type SyncRequest struct {
	Repository string `json:"repository,omitempty"`
	OpenOnly   bool   `json:"openOnly,omitempty"`
}

// SyncReply names the keys synchronized.
type SyncReply struct {
	Synced []string `json:"synced"`
}

// ListRequest is mirror.list's request.
type ListRequest struct {
	Repository string   `json:"repository"`
	Kind       string   `json:"kind"` // issue, pull
	State      string   `json:"state,omitempty"`
	Labels     []string `json:"labels,omitempty"`
	Author     string   `json:"author,omitempty"`
	Head       string   `json:"head,omitempty"`
	Limit      int      `json:"limit,omitempty"`
}

// Filter is the request's filter.
func (r ListRequest) Filter() Filter {
	return Filter{Pulls: r.Kind == "pull", State: r.State, Labels: r.Labels, Author: r.Author, Head: r.Head, Limit: r.Limit}
}

// ListReply is mirror.list's reply.
type ListReply struct {
	Items []map[string]any `json:"items"`
}

func decode[T any](request json.RawMessage) (T, error) {
	var v T
	if err := json.Unmarshal(request, &v); err != nil {
		return v, &codedError{CodeBadRequest, err}
	}
	return v, nil
}

// Register serves the follower's ops on s.
func (f *Follower) Register(s *localsock.Server) {
	s.Handle(OpState, func(context.Context, json.RawMessage) (any, error) { return f.stateReply(), nil })
	s.Handle(OpFetch, func(ctx context.Context, request json.RawMessage) (any, error) {
		r, err := decode[FetchRequest](request)
		if err != nil {
			return nil, err
		}
		return struct{}{}, coded(f.Fetch(ctx, r.Repository, r.Number))
	})
	s.Handle(OpSync, func(ctx context.Context, request json.RawMessage) (any, error) {
		r, err := decode[SyncRequest](request)
		if err != nil {
			return nil, err
		}
		synced, err := f.Sync(ctx, r.Repository, r.OpenOnly)
		return SyncReply{Synced: synced}, coded(err)
	})
	s.Handle(OpList, func(ctx context.Context, request json.RawMessage) (any, error) {
		r, err := decode[ListRequest](request)
		if err != nil {
			return nil, err
		}
		p, ok := f.project(r.Repository)
		if !ok {
			return nil, coded(fmt.Errorf("%w: %s", ErrNotAProject, r.Repository))
		}
		if p.Source == SourceLocal {
			return nil, &codedError{CodeNotSupported, errors.New("mirror: a Local key lists from its copy")}
		}
		items, err := f.mirror.List(ctx, p.Repository, r.Filter())
		return ListReply{Items: items}, coded(err)
	})
	s.Handle(OpRebuild, func(ctx context.Context, _ json.RawMessage) (any, error) {
		return struct{}{}, coded(f.Rebuild(ctx))
	})
}

func (f *Follower) stateReply() StateReply {
	f.mu.Lock()
	connected := f.connected
	keys := make([]string, 0, len(f.projects))
	for _, p := range f.projects {
		keys = append(keys, p.project.Repository)
	}
	f.mu.Unlock()
	reply := StateReply{Connected: connected, Keys: map[string]KeyState{}}
	for _, k := range keys {
		fresh, err := f.State(k)
		if err != nil {
			continue
		}
		state := KeyState{State: fresh.State}
		if !fresh.SyncedAt.IsZero() {
			at := fresh.SyncedAt.UTC().Format(time.RFC3339)
			state.SyncedAt = &at
		}
		reply.Keys[k] = state
	}
	return reply
}

func (f *Follower) project(repository string) (Project, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.projects[key(repository)]
	if !ok {
		return Project{}, false
	}
	return p.project, true
}

func (f *Follower) followed(repository string) (*followed, Project, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.projects[key(repository)]
	if !ok {
		return nil, Project{}, false
	}
	return p, p.project, true
}

// Fetch writes the issue or PR as its Source has it now (a PR with its
// head's checks), or deletes it when the Source no longer has it; a GitHub
// key whose fetch failed stays late until it, or a synchronization, succeeds.
func (f *Follower) Fetch(ctx context.Context, repository string, number int) error {
	p, project, ok := f.followed(repository)
	if !ok {
		return fmt.Errorf("%w: %s", ErrNotAProject, repository)
	}
	if project.Source == SourceLocal {
		_, err := f.mirror.RefreshLocal(ctx, project.Repository, number)
		return err
	}
	begun := f.markSeq()
	err := f.fetchNow(ctx, project.Repository, number)
	f.mu.Lock()
	if err != nil {
		f.markBehind(p, number)
	} else {
		p.caughtUp(number, begun)
	}
	f.mu.Unlock()
	return err
}

func (f *Follower) fetchNow(ctx context.Context, repository string, number int) error {
	if !acquire(ctx, f.fetches) {
		return ctx.Err()
	}
	write, err := f.fetch(ctx, repository, change{kind: contracts.RunnerGithubChangedChangeKindIssue, number: number})
	<-f.fetches
	if err != nil {
		return err
	}
	if write == nil {
		return nil
	}
	return f.store.Update(write)
}

// Sync reconciles the key (every key when ""), openOnly walking only a
// GitHub key's open issues and PRs, then the objects whose refresh failed;
// the keys synchronized, in order. A GitHub key whose synchronization failed
// stays late until one succeeds.
func (f *Follower) Sync(ctx context.Context, repository string, openOnly bool) ([]string, error) {
	var targets []*followed
	f.mu.Lock()
	if repository != "" {
		if p, ok := f.projects[key(repository)]; ok {
			targets = append(targets, p)
		}
	} else {
		for _, p := range f.projects {
			targets = append(targets, p)
		}
	}
	f.mu.Unlock()
	if repository != "" && len(targets) == 0 {
		return nil, fmt.Errorf("%w: %s", ErrNotAProject, repository)
	}
	sort.Slice(targets, func(i, j int) bool { return targets[i].project.Repository < targets[j].project.Repository })
	synced := []string{}
	for _, p := range targets {
		f.mu.Lock()
		k := p.project.Repository
		f.mu.Unlock()
		begun := f.markSeq()
		var err error
		switch {
		case IsLocal(k):
			err = f.reconcileLocal(ctx, p, k, 0)
		case openOnly:
			if err = f.reconcileOpen(ctx, p, k); err == nil {
				// The open walk reads no closed object: each one whose
				// refresh failed is fetched again, its mark cleared by Fetch.
				err = f.refetchBehind(ctx, p, k, begun)
			}
		default:
			err = f.reconcileProject(ctx, p, k, 0)
		}
		f.mu.Lock()
		switch {
		case err != nil && !IsLocal(k):
			f.markBehind(p, 0)
		case err == nil && openOnly:
			if seq, ok := p.behind[0]; ok && seq <= begun {
				delete(p.behind, 0)
			}
		case err == nil:
			p.caughtUp(0, begun)
		}
		f.mu.Unlock()
		if err == nil && (IsLocal(k) || !openOnly) {
			// Its documents too, before the answer: the reconciliation
			// asked their index, which an agent searching after a commit
			// or a merge expects done (MIROIR-5).
			f.mu.Lock()
			generation := p.docsWanted
			f.mu.Unlock()
			err = f.indexDocs(ctx, p, k, generation)
		}
		if err != nil {
			return synced, err
		}
		synced = append(synced, k)
	}
	return synced, nil
}

// refetchBehind fetches each object of p whose refresh failed before seq
// begun, in order; the first failure stops it.
func (f *Follower) refetchBehind(ctx context.Context, p *followed, repository string, begun uint64) error {
	f.mu.Lock()
	var numbers []int
	for n, seq := range p.behind {
		if n != 0 && seq <= begun {
			numbers = append(numbers, n)
		}
	}
	f.mu.Unlock()
	sort.Ints(numbers)
	for _, n := range numbers {
		if err := f.Fetch(ctx, repository, n); err != nil {
			return err
		}
	}
	return nil
}

func (f *Follower) reconcileOpen(ctx context.Context, p *followed, repository string) error {
	if !acquire(ctx, f.reconcile) {
		return ctx.Err()
	}
	defer func() { <-f.reconcile }()
	if !acquire(ctx, f.fetches) {
		return ctx.Err()
	}
	_, err := f.mirror.ReconcileOpen(ctx, repository)
	<-f.fetches
	if err != nil {
		return err
	}
	marks, err := f.store.marks()
	if err != nil {
		return err
	}
	f.mu.Lock()
	p.synced = marks[repository].synced
	f.mu.Unlock()
	return nil
}

// Rebuild empties the copy (Store.Rebuild) and asks every key's
// reconciliation; it returns once the copy is empty, the filling goes on.
// local.db, the Local Projets' original data, is never touched.
func (f *Follower) Rebuild(ctx context.Context) error {
	// No GitHub reconciliation writes meanwhile.
	if !acquire(ctx, f.reconcile) {
		return ctx.Err()
	}
	defer func() { <-f.reconcile }()
	f.writing.Lock()
	defer f.writing.Unlock()
	if err := f.store.Rebuild(); err != nil {
		return err
	}
	f.mu.Lock()
	cursor, has, ahead := f.cursor, f.hasCursor, f.ahead
	f.mu.Unlock()
	// The envelopes already applied stay applied: the reconciliations refill what they wrote.
	if has {
		if err := f.store.Update(func(tx *sql.Tx) error { return writeCursor(tx, cursor, ahead) }); err != nil {
			return err
		}
	}
	f.mu.Lock()
	n := len(f.projects)
	for _, p := range f.projects {
		p.filled, p.synced = false, time.Time{}
		p.wanted++
		wake(p)
	}
	f.mu.Unlock()
	f.logger.Info("mirror rebuilt", "projects", n)
	return nil
}
