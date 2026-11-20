package checks

import (
	"context"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// newProject is the report's projectId of an Idée for a new Projet
// (IDEA_ANALYSIS_NEW_PROJECT).
const newProject = "nouveau"

// The Contrat `idea-analysis`'s rule `idea-analysis.report.project`: the
// report's `projectId` is one of the Projets of the context, or `nouveau`;
// never a Projet the agent made up.
func init() {
	Register("idea-project", ideaProject)
}

func ideaProject(_ context.Context, t target.Target, params map[string]any) (bool, error) {
	report, context, ok, err := ideaFiles("idea-project", t, params)
	if !ok || err != nil || report.ProjectID == nil {
		return false, err
	}
	if *report.ProjectID == newProject {
		return true, nil
	}
	for _, p := range context.Projects {
		if p.ID == *report.ProjectID {
			return true, nil
		}
	}
	return false, nil
}
