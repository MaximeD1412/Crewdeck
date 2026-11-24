package checks

import (
	"context"
	"fmt"
	"path/filepath"
	"regexp"

	"github.com/bmatcuk/doublestar/v4"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// The Inventaire's check (PROJET-4): every file of the worktree that
// `params.glob` matches has a line that `params.regex` matches, from the
// line's start (`^` and `$` are the line's). No file matched passes: another
// rule says how many are due. A file that cannot be read fails it.
func init() {
	Register("each-file-has-line", eachFileHasLine)
}

func eachFileHasLine(_ context.Context, t target.Target, params map[string]any) (bool, error) {
	glob, ok := params["glob"].(string)
	if !ok || !doublestar.ValidatePattern(glob) || !filepath.IsLocal(filepath.FromSlash(glob)) {
		return false, fmt.Errorf("each-file-has-line: params.glob must be a glob of the worktree, got %v", params["glob"])
	}
	source, ok := params["regex"].(string)
	if !ok {
		return false, fmt.Errorf("each-file-has-line: params.regex must be a string, got %v", params["regex"])
	}
	line, err := regexp.Compile("(?m)" + source)
	if err != nil {
		return false, fmt.Errorf("each-file-has-line: params.regex: %w", err)
	}
	files, err := t.Glob(glob)
	if err != nil {
		return false, err
	}
	for _, file := range files {
		data, ok, err := t.ReadFile(file)
		if err != nil || !ok {
			return false, err
		}
		if !line.Match(data) {
			return false, nil
		}
	}
	return true, nil
}
