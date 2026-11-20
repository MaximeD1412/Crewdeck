package mirror

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

// FreshnessState is how current a Projet's copy is.
type FreshnessState string

const (
	// FreshnessFilling: the copy was never fully reconciled.
	FreshnessFilling FreshnessState = "filling"
	// FreshnessLive: connected, the replay over, every envelope received applied.
	FreshnessLive FreshnessState = "live"
	// FreshnessLate: disconnected, replaying, resyncing, an envelope waits, or
	// a refresh asked failed and none succeeded since, or the documentation
	// index's last try failed (MIROIR-5).
	FreshnessLate FreshnessState = "late"
)

// Freshness is a Projet's: its state, and when its copy last changed from GitHub.
type Freshness struct {
	State    FreshnessState
	SyncedAt time.Time // zero before the first
}

// State is the freshness of the repository's copy; ErrNotAProject if it is
// none of the server's Projets.
func (f *Follower) State(repository string) (Freshness, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p, ok := f.projects[key(repository)]
	if !ok {
		return Freshness{}, fmt.Errorf("mirror: %s: %w", repository, ErrNotAProject)
	}
	state := FreshnessLate
	switch {
	case !p.filled:
		state = FreshnessFilling
	case p.project.Source == SourceLocal:
		// Its Source is the disk: live once filled, while the Runner runs,
		// unless its documents' last index failed (its folder gone).
		if !p.docsFailed {
			state = FreshnessLive
		}
	case f.connected && f.live && f.resync == nil && len(p.queue) == 0 && len(p.behind) == 0 && !p.docsFailed:
		state = FreshnessLive
	}
	return Freshness{State: state, SyncedAt: p.synced}, nil
}

// fillMoved wakes the WaitFilled waiting; f.mu held.
func (f *Follower) fillMoved() {
	close(f.fill)
	f.fill = make(chan struct{})
}

// WaitFilled returns once the server's Projets arrived on the current
// connection (a Projet made while the Runner was away is among them) and
// every one's copy was filled once (FreshnessFilling no more),
// so that what is read of the copy misses none of them; ctx's error, with
// the keys still filling, if it ends first.
func (f *Follower) WaitFilled(ctx context.Context) error {
	for {
		f.mu.Lock()
		known, filling, moved := f.projectsKnown, []string{}, f.fill
		for _, p := range f.projects {
			if !p.filled {
				filling = append(filling, p.project.Repository)
			}
		}
		f.mu.Unlock()
		if known && len(filling) == 0 {
			return nil
		}
		select {
		case <-ctx.Done():
			if !known {
				return fmt.Errorf("mirror: the server's Projets never arrived: %w", ctx.Err())
			}
			sort.Strings(filling)
			return fmt.Errorf("mirror: still filling %s: %w", strings.Join(filling, ", "), ctx.Err())
		case <-moved:
		}
	}
}
