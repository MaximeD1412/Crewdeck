package checks

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// The example Contrat's check: the folder `params.path` of the worktree
// exists and holds at least one entry.
func init() {
	Register("example-nonempty-dir", exampleNonemptyDir)
}

func exampleNonemptyDir(_ context.Context, t target.Target, params map[string]any) (bool, error) {
	path, ok := params["path"].(string)
	if !ok || !filepath.IsLocal(filepath.FromSlash(path)) {
		return false, fmt.Errorf("example-nonempty-dir: params.path must be a path of the worktree, got %v", params["path"])
	}
	entries, ok, err := t.ReadDir(path)
	return ok && len(entries) > 0, err
}
