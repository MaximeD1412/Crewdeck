package session

import (
	_ "embed"
	"strings"
	"text/template"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

//go:embed prompts/step.md
var stepPrompt string

var stepTemplate = template.Must(template.New("step").Parse(stepPrompt))

// initialPrompt is the Session's first message: the embedded template of a
// StepRun, its Skill and its id (RUNNER-12), none without one.
func initialPrompt(step *contracts.RunnerSessionStartStep) (string, error) {
	if step == nil {
		return "", nil
	}
	var out strings.Builder
	err := stepTemplate.Execute(&out, struct{ Skill, StepKind, StepRunID string }{step.Skill, string(step.StepKind), step.StepRunId})
	return out.String(), err
}
