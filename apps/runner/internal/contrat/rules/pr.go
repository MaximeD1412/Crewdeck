package rules

import (
	"context"
	"slices"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// `pr`: the Étape's PR exists and targets `base` (`integration`: the Projet's
// integration branch), comes from a branch matching `branch`, has a body
// matching every regex of `body` (`^` and `$` at each line), carries every
// one of `labels`.

// Integration is the `base` naming the Projet's integration branch.
const Integration = "integration"

func validatePR(r Rule) error {
	if r.Branch != "" {
		if _, err := compileRegex(r.Branch); err != nil {
			return err
		}
	}
	for _, body := range r.Body {
		if _, err := compileRegex(body); err != nil {
			return err
		}
	}
	return nil
}

func evaluatePR(_ context.Context, t target.Target, r Rule) (bool, error) {
	pr := t.PR
	if pr == nil {
		return false, nil
	}
	if base := r.Base; base != "" {
		if base == Integration {
			base = t.IntegrationBranch
		}
		if base == "" || pr.Base != base {
			return false, nil
		}
	}
	if r.Branch != "" {
		re, err := compileRegex(r.Branch)
		if err != nil {
			return false, err
		}
		if !re.MatchString(pr.Head) {
			return false, nil
		}
	}
	for _, body := range r.Body {
		re, err := compileRegex("(?m)" + body)
		if err != nil {
			return false, err
		}
		if !re.MatchString(pr.Body) {
			return false, nil
		}
	}
	for _, label := range r.Labels {
		if !slices.Contains(pr.Labels, label) {
			return false, nil
		}
	}
	return true, nil
}
