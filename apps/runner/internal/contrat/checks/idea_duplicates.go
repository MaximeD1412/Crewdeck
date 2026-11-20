package checks

import (
	"context"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// The Contrat `idea-analysis`'s rule `idea-analysis.report.duplicates`:
// each of the report's duplicates is one of the open Idées of the context,
// never the Idée analysed itself nor one the agent made up.
func init() {
	Register("idea-duplicates", ideaDuplicates)
}

func ideaDuplicates(_ context.Context, t target.Target, params map[string]any) (bool, error) {
	report, context, ok, err := ideaFiles("idea-duplicates", t, params)
	if !ok || err != nil {
		return false, err
	}
	open := map[string]bool{}
	for _, idea := range context.OpenIdeas {
		open[idea.ID] = idea.ID != context.Idea.ID
	}
	for _, duplicate := range report.Duplicates {
		if duplicate.ID == nil || !open[*duplicate.ID] {
			return false, nil
		}
	}
	return true, nil
}
