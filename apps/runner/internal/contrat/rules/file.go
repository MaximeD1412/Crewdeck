package rules

import (
	"context"
	"errors"
	"io/fs"
	"os"

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
		_, err := os.Stat(resolve(t, r.Path))
		if errors.Is(err, fs.ErrNotExist) {
			return false, nil
		}
		return err == nil, err
	}
	matches, err := files(t, r.Glob)
	if err != nil {
		return false, err
	}
	return len(matches) >= max(r.Min, 1), nil
}
