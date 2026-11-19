package mirror

import (
	"fmt"
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
	// a refresh asked failed and none succeeded since.
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
		// Its Source is the disk: live once filled, while the Runner runs.
		state = FreshnessLive
	case f.connected && f.live && f.resync == nil && len(p.queue) == 0 && len(p.behind) == 0:
		state = FreshnessLive
	}
	return Freshness{State: state, SyncedAt: p.synced}, nil
}
