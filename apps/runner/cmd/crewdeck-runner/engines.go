package main

import (
	"github.com/maximed1412/crewdeck/apps/runner/internal/accounts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/claude"
)

// runnerEngines are the adapters `run` drives; tests replace them.
var runnerEngines = newEngines

// newEngines are the Runner's adapters, each reading its Compte IA's key in
// the store. Codex joins them with its adapter (RUNNER-6).
func newEngines(store accounts.Store) *engine.Registry {
	var registry engine.Registry
	registry.Register(&claude.Engine{APIKey: store.Provider(contracts.EngineIdClaudeCode)})
	return &registry
}
