package rules

import (
	"context"
	"errors"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// `file`: `path` exists (a file or a folder), or at least `min` (1 by default) files match `glob`.

func validateFile(r Rule) error {
	if err := validatePathOrGlob(r); err != nil {
		return err
	}
	if r.Min != 0 && r.Glob == "" {
		return errors.New("a min goes with a glob")
	}
	if r.Min < 0 {
		return errors.New("a min is positive")
	}
	return nil
}

func evaluateFile(_ context.Context, t target.Target, r Rule) (bool, error) {
	if r.Path != "" {
		_, ok, err := t.Stat(r.Path)
		return ok, err
	}
	matches, err := t.Glob(r.Glob)
	if err != nil {
		return false, err
	}
	regular := 0
	for _, match := range matches {
		info, ok, err := t.Stat(match)
		if err != nil {
			return false, err
		}
		if ok && info.Mode().IsRegular() {
			regular++
		}
	}
	return regular >= max(r.Min, 1), nil
}
