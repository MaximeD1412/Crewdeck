package command

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The health addresses of packages/contracts/fixtures/process-sealed: the
// Runner accepts what zod accepts there, refuses what zod refuses, and
// refuses the few zod accepts that it is stricter on (definition.spec.ts
// proves zod's side of each list).
func TestTheHealthAddressIsCheckedAsZodChecksItOrMoreStrictly(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "process-sealed", "health-urls.json"))
	if err != nil {
		t.Fatal(err)
	}
	var urls struct {
		Accepted      []string `json:"accepted"`
		Refused       []string `json:"refused"`
		RunnerRefuses []string `json:"runnerRefuses"`
	}
	if err := json.Unmarshal(raw, &urls); err != nil {
		t.Fatal(err)
	}
	opens := func(healthURL string) bool {
		plain, err := json.Marshal(map[string]any{"commands": map[string]any{
			"cmd-tests": map[string]any{"run": "pnpm test", "where": "worktree", "healthUrl": healthURL},
		}})
		if err != nil {
			t.Fatal(err)
		}
		_, ok := sealedCommands(plain)
		return ok
	}
	for _, url := range urls.Accepted {
		if !opens(url) {
			t.Errorf("%q refused, zod accepts it", url)
		}
	}
	for _, url := range append(urls.Refused, urls.RunnerRefuses...) {
		if opens(url) {
			t.Errorf("%q accepted, want it refused", url)
		}
	}
}
