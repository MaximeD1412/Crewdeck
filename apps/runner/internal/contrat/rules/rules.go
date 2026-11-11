// Package rules interprets each kind of a Contrat's rules (ADR 0005), one
// file per kind, as packages/contracts/src/contrats/define.ts declares them.
package rules

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"

	"github.com/bmatcuk/doublestar/v4"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// The severities of a rule: a failed `bloquant` one makes the verdict
// `incomplete`, a failed `attention` one only warns.
const (
	Bloquant  = "bloquant"
	Attention = "attention"
)

// The kinds of rules.
const (
	KindFile        = "file"
	KindSections    = "sections"
	KindPattern     = "pattern"
	KindFrontMatter = "front-matter"
	KindJSON        = "json"
	KindPR          = "pr"
	KindCheck       = "check"
)

// Rule is one rule of a Contrat as generated to JSON: its id, French label,
// severity and kind, and the parameters of its kind (the others empty).
type Rule struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Severity string `json:"severity"`
	Kind     string `json:"kind"`

	Path     string          `json:"path,omitempty"`
	Glob     string          `json:"glob,omitempty"`
	Min      int             `json:"min,omitempty"`
	Headings []string        `json:"headings,omitempty"`
	Level    int             `json:"level,omitempty"`
	Regex    string          `json:"regex,omitempty"`
	Unique   bool            `json:"unique,omitempty"`
	Schema   json.RawMessage `json:"schema,omitempty"`
	Base     string          `json:"base,omitempty"`
	Branch   string          `json:"branch,omitempty"`
	Body     []string        `json:"body,omitempty"`
	Labels   []string        `json:"labels,omitempty"`
	Name     string          `json:"name,omitempty"`
	Params   map[string]any  `json:"params,omitempty"`
}

type kind struct {
	validate func(Rule) error
	evaluate func(context.Context, target.Target, Rule) (bool, error)
}

var kinds = map[string]kind{
	KindFile:        {validateFile, evaluateFile},
	KindSections:    {validateSections, evaluateSections},
	KindPattern:     {validatePattern, evaluatePattern},
	KindFrontMatter: {validateFrontMatter, evaluateFrontMatter},
	KindJSON:        {validateJSON, evaluateJSON},
	KindPR:          {validatePR, evaluatePR},
	KindCheck:       {validateCheck, evaluateCheck},
}

// Validate says whether the Runner can interpret `r`: a known severity and
// kind, its regexes valid in RE2, its schema a JSON Schema, its check
// registered. The TypeScript declaration is validated by zod; this catches
// what only Go can say.
func Validate(r Rule) error {
	if r.Severity != Bloquant && r.Severity != Attention {
		return fmt.Errorf("rule %s: unknown severity %q", r.ID, r.Severity)
	}
	k, ok := kinds[r.Kind]
	if !ok {
		return fmt.Errorf("rule %s: unknown kind %q", r.ID, r.Kind)
	}
	if err := k.validate(r); err != nil {
		return fmt.Errorf("rule %s: %w", r.ID, err)
	}
	return nil
}

// Evaluate says whether `t` passes `r`, a valid rule. An error is for what is
// not the output's fault (a read that failed): a missing or malformed file
// fails the rule, it is not an error.
func Evaluate(ctx context.Context, t target.Target, r Rule) (bool, error) {
	k, ok := kinds[r.Kind]
	if !ok {
		return false, fmt.Errorf("rule %s: unknown kind %q", r.ID, r.Kind)
	}
	passed, err := k.evaluate(ctx, t, r)
	if err != nil {
		return false, fmt.Errorf("rule %s: %w", r.ID, err)
	}
	return passed, nil
}

func validatePath(path string) error {
	if path == "" || !filepath.IsLocal(filepath.FromSlash(path)) {
		return fmt.Errorf("%q is not a path of the worktree", path)
	}
	return nil
}

func validateGlob(glob string) error {
	if err := validatePath(glob); err != nil {
		return err
	}
	if !doublestar.ValidatePattern(glob) {
		return fmt.Errorf("%q is not a valid glob", glob)
	}
	return nil
}

// validatePathOrGlob checks that exactly one of path and glob is given.
func validatePathOrGlob(r Rule) error {
	switch {
	case (r.Path == "") == (r.Glob == ""):
		return errors.New("a path or a glob, not both")
	case r.Path != "":
		return validatePath(r.Path)
	default:
		return validateGlob(r.Glob)
	}
}

func compileRegex(source string) (*regexp.Regexp, error) {
	re, err := regexp.Compile(source)
	if err != nil {
		return nil, fmt.Errorf("regex %q: %w", source, err)
	}
	return re, nil
}
