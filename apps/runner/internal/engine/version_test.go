package engine_test

import (
	"context"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/engine"
)

// versionedAdapter is how an adapter uses KnownVersions: it declares the
// ranges it was tested on, and its Capabilities says whether the installed
// Moteur is in one of them (risk IA-3).
type versionedAdapter struct {
	versionOutput string // what `<moteur> --version` printed
}

var exampleKnownVersions = engine.KnownVersions{">=2.1 <2.3", "=3.0.1"}

func (a versionedAdapter) Capabilities(context.Context) (contracts.EngineCapabilities, error) {
	caps := contracts.EngineCapabilities{Engine: contracts.EngineIdClaudeCode, Installed: a.versionOutput != ""}
	if version, ok := engine.ParseVersion(a.versionOutput); ok {
		caps.Version = &version
		caps.KnownVersion = exampleKnownVersions.Contains(version)
	}
	return caps, nil
}

func TestKnownVersionIsFalseForAVersionOutsideTheDeclaredRanges(t *testing.T) {
	for output, want := range map[string]bool{
		"2.1.319 (Claude Code)": true,
		"2.2.0 (Claude Code)":   true,
		"2.1 (Claude Code)":     true,
		"3.0.1":                 true,
		"2.3.0 (Claude Code)":   false,
		"2.0.99 (Claude Code)":  false,
		"3.0.2":                 false,
		"codex-cli 0.167.1":     false,
		"":                      false,
	} {
		caps, err := versionedAdapter{output}.Capabilities(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if caps.KnownVersion != want {
			t.Errorf("%q: knownVersion %v, want %v", output, caps.KnownVersion, want)
		}
	}
}

func TestParseVersionReadsTheFirstVersionOfAMoteursOutput(t *testing.T) {
	for output, want := range map[string]string{
		"2.1.319 (Claude Code)\n": "2.1.319",
		"codex-cli 0.167.1":       "0.167.1",
		"v1.2.3-beta.1":           "1.2.3-beta.1",
	} {
		if got, ok := engine.ParseVersion(output); !ok || got != want {
			t.Errorf("ParseVersion(%q) = %q, %v; want %q", output, got, ok, want)
		}
	}
	if got, ok := engine.ParseVersion("Claude Code"); ok {
		t.Errorf("ParseVersion without a version = %q", got)
	}
}

func TestAPrereleaseIsBelowItsRelease(t *testing.T) {
	ranges := engine.KnownVersions{">=2.1"}
	if ranges.Contains("2.1.0-beta.1") {
		t.Error("2.1.0-beta.1 is in >=2.1")
	}
	if !ranges.Contains("2.1.1-beta.1") {
		t.Error("2.1.1-beta.1 is not in >=2.1")
	}
}

func TestAMalformedRangeContainsNothing(t *testing.T) {
	for _, r := range []string{"~2.1", ">=two", ""} {
		if (engine.KnownVersions{r}).Contains("2.1.0") {
			t.Errorf("%q contains 2.1.0", r)
		}
	}
}
