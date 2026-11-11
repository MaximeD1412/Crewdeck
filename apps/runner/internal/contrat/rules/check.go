package rules

import (
	"context"
	"fmt"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/checks"
	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// `check`: the named Go function of internal/contrat/checks/ passes, given `params`.

func validateCheck(r Rule) error {
	if _, ok := checks.Lookup(r.Name); !ok {
		return fmt.Errorf("no check named %q", r.Name)
	}
	return nil
}

func evaluateCheck(ctx context.Context, t target.Target, r Rule) (bool, error) {
	fn, ok := checks.Lookup(r.Name)
	if !ok {
		return false, fmt.Errorf("no check named %q", r.Name)
	}
	return fn(ctx, t, r.Params)
}
