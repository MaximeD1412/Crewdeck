package contrat

import (
	"path/filepath"
	"slices"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// The Contrat `idea-analysis` (IDEE-2) on the folders of
// checks/testdata/idea-analysis: a good report passes, each fault fails its
// one rule.
func TestTheIdeaAnalysisContratFailsEachFaultOnItsRule(t *testing.T) {
	c, err := Get("idea-analysis")
	if err != nil {
		t.Fatalf("Get(idea-analysis): %v", err)
	}
	for name, failed := range map[string][]string{
		"pass":             {},
		"pass-new-project": {},
		"fail-summary":     {"idea-analysis.report.schema"},
		"fail-duplicate":   {"idea-analysis.report.duplicates"},
		"fail-project":     {"idea-analysis.report.project"},
	} {
		verdict, err := Check(t.Context(), c, Target{Dir: filepath.Join("checks", "testdata", "idea-analysis", name)})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		status := contracts.ContratVerdictStatusPassed
		if len(failed) > 0 {
			status = contracts.ContratVerdictStatusIncomplete
		}
		if verdict.Status != status || !slices.Equal(verdict.FailedRuleIds, failed) || len(verdict.WarningRuleIds) != 0 {
			t.Errorf("%s: %+v, want %s and %v failed", name, verdict, status, failed)
		}
	}
}

// A folder without the report fails every rule: the Skill wrote nothing.
func TestTheIdeaAnalysisContratFailsAFolderWithoutItsReport(t *testing.T) {
	c, err := Get("idea-analysis")
	if err != nil {
		t.Fatal(err)
	}
	verdict, err := Check(t.Context(), c, Target{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"idea-analysis.report.schema", "idea-analysis.report.figures", "idea-analysis.report.project", "idea-analysis.report.duplicates"}
	if verdict.Status != contracts.ContratVerdictStatusIncomplete || !slices.Equal(verdict.FailedRuleIds, want) {
		t.Errorf("%+v, want every rule failed", verdict)
	}
}
