// Package contrat checks an Étape's output against its Contrat (ADR 0005):
// the Contrats are data, declared in packages/contracts/src/contrats/,
// generated to JSON in contrats/ and embedded here. The Runner is their only
// interpreter; it sends the verdict, never the content.
package contrat

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"path"
	"sort"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/rules"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// Written by `nx run contracts:generate`, one file per Contrat, `<id>.v<version>.json`.
//
//go:embed contrats/*.json
var embedded embed.FS

// Target is what a Contrat is checked on: the worktree, the PR, the integration branch.
type Target = target.Target

// PullRequest is the facts of the Étape's PR, read from GitHub.
type PullRequest = target.PullRequest

// Verdict is what the Runner sends in `step.verdict`.
type Verdict = contracts.ContratVerdict

// Rule is one rule of a Contrat.
type Rule = rules.Rule

// Contrat is a Contrat as generated: its id, version, Étape and rules, in the order they are checked.
type Contrat struct {
	ID      string `json:"id"`
	Version int    `json:"version"`
	Step    string `json:"step"`
	Rules   []Rule `json:"rules"`
}

// ErrUnknown is the error of Get for a Contrat this Runner does not embed.
var ErrUnknown = errors.New("contrat: unknown Contrat")

// Parse reads a generated Contrat and checks the Runner can interpret every rule.
func Parse(data []byte) (Contrat, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var c Contrat
	if err := decoder.Decode(&c); err != nil {
		return Contrat{}, fmt.Errorf("contrat: %w", err)
	}
	if c.ID == "" || c.Version < 1 || c.Step == "" {
		return Contrat{}, errors.New("contrat: an id, a version and a step")
	}
	seen := map[string]bool{}
	for _, rule := range c.Rules {
		if err := rules.Validate(rule); err != nil {
			return Contrat{}, fmt.Errorf("contrat %s v%d: %w", c.ID, c.Version, err)
		}
		if seen[rule.ID] {
			return Contrat{}, fmt.Errorf("contrat %s v%d: rule %s declared twice", c.ID, c.Version, rule.ID)
		}
		seen[rule.ID] = true
	}
	return c, nil
}

// All are the Contrats this Runner embeds, sorted by id.
func All() ([]Contrat, error) {
	names, err := fs.Glob(embedded, "contrats/*.json")
	if err != nil {
		return nil, err
	}
	all := make([]Contrat, 0, len(names))
	for _, name := range names {
		data, err := embedded.ReadFile(name)
		if err != nil {
			return nil, err
		}
		c, err := Parse(data)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", path.Base(name), err)
		}
		all = append(all, c)
	}
	sort.Slice(all, func(i, j int) bool { return all[i].ID < all[j].ID })
	return all, nil
}

// Get is the embedded Contrat `id`, the version this Runner checks.
func Get(id string) (Contrat, error) {
	all, err := All()
	if err != nil {
		return Contrat{}, err
	}
	for _, c := range all {
		if c.ID == id {
			return c, nil
		}
	}
	return Contrat{}, fmt.Errorf("%w: %s", ErrUnknown, id)
}

// Check interprets every rule of `c` on `t`: a failed `bloquant` rule makes
// the verdict `incomplete` and goes to FailedRuleIds, a failed `attention`
// one to WarningRuleIds, both in the Contrat's order. An error (a read that
// failed, the context ended) is not a verdict.
func Check(ctx context.Context, c Contrat, t Target) (Verdict, error) {
	verdict := Verdict{
		ContractId:     c.ID,
		Version:        c.Version,
		Status:         contracts.ContratVerdictStatusPassed,
		FailedRuleIds:  []string{},
		WarningRuleIds: []string{},
	}
	for _, rule := range c.Rules {
		if err := ctx.Err(); err != nil {
			return Verdict{}, err
		}
		passed, err := rules.Evaluate(ctx, t, rule)
		if err != nil {
			return Verdict{}, fmt.Errorf("contrat %s v%d: %w", c.ID, c.Version, err)
		}
		switch {
		case passed:
		case rule.Severity == rules.Attention:
			verdict.WarningRuleIds = append(verdict.WarningRuleIds, rule.ID)
		default:
			verdict.FailedRuleIds = append(verdict.FailedRuleIds, rule.ID)
			verdict.Status = contracts.ContratVerdictStatusIncomplete
		}
	}
	if t.PR != nil && t.PR.HeadSHA != "" {
		sha := t.PR.HeadSHA
		verdict.HeadSha = &sha
	}
	return verdict, nil
}
