package rules

import (
	"context"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// `json`: the file at `path` is JSON valid against `schema`.

func validateJSON(r Rule) error {
	if err := validatePath(r.Path); err != nil {
		return err
	}
	_, err := compileSchema(r.Schema)
	return err
}

func evaluateJSON(_ context.Context, t target.Target, r Rule) (bool, error) {
	data, err := readFile(t, r.Path)
	if data == nil || err != nil {
		return false, err
	}
	return matchesSchema(r.Schema, data)
}
