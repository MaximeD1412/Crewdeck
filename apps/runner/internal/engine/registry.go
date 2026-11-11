package engine

import (
	"fmt"
	"sort"
	"sync"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// Registry holds the Runner's adapters, one per Moteur. Its zero value is
// empty and ready.
type Registry struct {
	mu      sync.RWMutex
	engines map[contracts.EngineId]Engine
}

// Register adds an adapter; a second one for the same Moteur is a bug, and
// panics.
func (r *Registry) Register(e Engine) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.engines[e.ID()]; ok {
		panic(fmt.Sprintf("engine: %s registered twice", e.ID()))
	}
	if r.engines == nil {
		r.engines = map[contracts.EngineId]Engine{}
	}
	r.engines[e.ID()] = e
}

// Get gives the adapter of a Moteur.
func (r *Registry) Get(id contracts.EngineId) (Engine, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	e, ok := r.engines[id]
	return e, ok
}

// All gives every adapter, in the order of their ids.
func (r *Registry) All() []Engine {
	r.mu.RLock()
	defer r.mu.RUnlock()
	all := make([]Engine, 0, len(r.engines))
	for _, e := range r.engines {
		all = append(all, e)
	}
	sort.Slice(all, func(i, j int) bool { return all[i].ID() < all[j].ID() })
	return all
}
