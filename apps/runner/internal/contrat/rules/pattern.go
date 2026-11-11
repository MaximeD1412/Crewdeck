package rules

import (
	"context"
	"errors"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// `pattern`: at least `min` (1 by default) lines of the file at `path`, or of
// the files matching `glob`, match `regex`; with `unique`, its capture group 1
// never repeats across them.

func validatePattern(r Rule) error {
	if err := validatePathOrGlob(r); err != nil {
		return err
	}
	re, err := compileRegex(r.Regex)
	if err != nil {
		return err
	}
	if r.Unique && re.NumSubexp() < 1 {
		return errors.New("a unique pattern captures its value in group 1")
	}
	if r.Min < 0 {
		return errors.New("a min is positive")
	}
	return nil
}

func evaluatePattern(_ context.Context, t target.Target, r Rule) (bool, error) {
	re, err := compileRegex(r.Regex)
	if err != nil {
		return false, err
	}
	paths := []string{r.Path}
	if r.Glob != "" {
		if paths, err = t.Glob(r.Glob); err != nil {
			return false, err
		}
	}
	matched := 0
	seen := map[string]bool{}
	for _, path := range paths {
		data, ok, err := t.ReadFile(path)
		if !ok || err != nil {
			return false, err
		}
		for _, line := range strings.Split(string(data), "\n") {
			match := re.FindStringSubmatch(strings.TrimSuffix(line, "\r"))
			if match == nil {
				continue
			}
			matched++
			if r.Unique {
				if seen[match[1]] {
					return false, nil
				}
				seen[match[1]] = true
			}
		}
	}
	return matched >= max(r.Min, 1), nil
}
