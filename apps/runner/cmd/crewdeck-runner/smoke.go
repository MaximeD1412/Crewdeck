//go:build smoke

// The flags of the nightly's smoke test (RUNNER-14, apps/runner/smoke/): a
// build with `-tags smoke` only. A release build (`runner:dist`) never has
// the tag, so never the fake Moteur (smoke/smoke_test.go).

package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"

	"github.com/maximed1412/crewdeck/apps/runner/internal/accounts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine/fake"
	"github.com/spf13/cobra"
)

func init() { buildFlags = smokeFlags }

// smokeFlags adds, hidden: --engine-fake <stream.jsonl>, the fake Moteur
// replaying the stream's normalised events for every Moteur, found on PATH
// by `link`; --github-url <url>, where the Sessions clone their GitHub
// repository from (a file:// folder of bare repositories, `<owner>/<name>.git`).
func smokeFlags(root *cobra.Command) {
	var stream, githubURL string
	flags := root.PersistentFlags()
	flags.StringVar(&stream, "engine-fake", "", "the fake Moteur's stream of events, for every Moteur (smoke test)")
	flags.StringVar(&githubURL, "github-url", "", "where the Sessions clone the GitHub repositories from (smoke test)")
	_ = flags.MarkHidden("engine-fake")
	_ = flags.MarkHidden("github-url")
	root.PersistentPreRunE = func(*cobra.Command, []string) error {
		if githubURL != "" {
			sessionsGitHubURL = githubURL
		}
		if stream == "" {
			return nil
		}
		events, err := readStream(stream)
		if err != nil {
			return err
		}
		runnerEngines = func(accounts.Store) *engine.Registry { return fakeEngines(events) }
		lookEngine = func(name string) (string, error) { return name, nil }
		return nil
	}
}

// fakeEngines registers the fake Moteur for every Moteur, each run emitting events.
func fakeEngines(events []contracts.EngineEvent) *engine.Registry {
	var registry engine.Registry
	for _, id := range []contracts.EngineId{contracts.EngineIdClaudeCode, contracts.EngineIdCodex} {
		registry.Register(&fake.Engine{EngineID: id, Events: events})
	}
	return &registry
}

// readStream reads one normalised event per line, blank lines skipped.
func readStream(path string) ([]contracts.EngineEvent, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("--engine-fake: %w", err)
	}
	var events []contracts.EngineEvent
	lines := bufio.NewScanner(bytes.NewReader(data))
	for n := 1; lines.Scan(); n++ {
		line := bytes.TrimSpace(lines.Bytes())
		if len(line) == 0 {
			continue
		}
		var event contracts.EngineEvent
		if err := json.Unmarshal(line, &event); err != nil {
			return nil, fmt.Errorf("--engine-fake: %s, line %d: %w", path, n, err)
		}
		events = append(events, event)
	}
	if len(events) == 0 {
		return nil, fmt.Errorf("--engine-fake: %s has no event", path)
	}
	return events, lines.Err()
}
