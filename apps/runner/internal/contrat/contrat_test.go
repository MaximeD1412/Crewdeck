package contrat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

var fixturesDir = filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "contrats")

func example(t *testing.T) Contrat {
	t.Helper()
	c, err := Get("example")
	if err != nil {
		t.Fatalf("Get(example): %v", err)
	}
	return c
}

func examplePR(t *testing.T) *PullRequest {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(fixturesDir, "example", "pr.json"))
	if err != nil {
		t.Fatal(err)
	}
	var pr PullRequest
	if err := json.Unmarshal(data, &pr); err != nil {
		t.Fatal(err)
	}
	return &pr
}

func exampleTarget(t *testing.T, folder string) Target {
	return Target{Dir: filepath.Join(fixturesDir, "example", folder), PR: examplePR(t), IntegrationBranch: "develop"}
}

func check(t *testing.T, c Contrat, target Target) Verdict {
	t.Helper()
	verdict, err := Check(context.Background(), c, target)
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	return verdict
}

func TestThePassingFolderPassesTheExampleContrat(t *testing.T) {
	target := exampleTarget(t, "pass")
	verdict := check(t, example(t), target)

	want := Verdict{
		ContractId:     "example",
		Version:        1,
		Status:         contracts.ContratVerdictStatusPassed,
		FailedRuleIds:  []string{},
		WarningRuleIds: []string{},
		HeadSha:        &target.PR.HeadSHA,
	}
	if !reflect.DeepEqual(verdict, want) {
		t.Fatalf("verdict %+v, want %+v", verdict, want)
	}
}

// Each rule but `pr` (whose facts are not files) has its folder, a copy of
// `pass` that only that rule fails: a `bloquant` one makes the verdict
// incomplete with exactly its id, an `attention` one leaves it passed with
// its id in the warnings.
func TestEachFailingFolderFailsExactlyItsRule(t *testing.T) {
	c := example(t)
	folders, err := filepath.Glob(filepath.Join(fixturesDir, "example", "fail-*"))
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, folder := range folders {
		seen[strings.TrimPrefix(filepath.Base(folder), "fail-")] = true
	}
	for _, rule := range c.Rules {
		if rule.Kind == "pr" {
			continue
		}
		t.Run(rule.ID, func(t *testing.T) {
			if !seen[rule.ID] {
				t.Fatalf("no folder fail-%s", rule.ID)
			}
			delete(seen, rule.ID)
			verdict := check(t, c, exampleTarget(t, "fail-"+rule.ID))
			if rule.Severity == "attention" {
				if verdict.Status != contracts.ContratVerdictStatusPassed || len(verdict.FailedRuleIds) != 0 || !slices.Equal(verdict.WarningRuleIds, []string{rule.ID}) {
					t.Fatalf("verdict %+v, want passed with the warning %s", verdict, rule.ID)
				}
				return
			}
			if verdict.Status != contracts.ContratVerdictStatusIncomplete || !slices.Equal(verdict.FailedRuleIds, []string{rule.ID}) || len(verdict.WarningRuleIds) != 0 {
				t.Fatalf("verdict %+v, want incomplete with exactly %s", verdict, rule.ID)
			}
		})
	}
	for folder := range seen {
		t.Errorf("folder fail-%s names no rule of the example Contrat", folder)
	}
}

func TestTheExampleHasOneRuleOfEachKindAndAnAttentionOne(t *testing.T) {
	kinds := map[string]bool{}
	attention := false
	for _, rule := range example(t).Rules {
		kinds[rule.Kind] = true
		attention = attention || rule.Severity == "attention"
	}
	for _, kind := range []string{"file", "sections", "pattern", "front-matter", "json", "pr", "check"} {
		if !kinds[kind] {
			t.Errorf("no rule of kind %s", kind)
		}
	}
	if !attention {
		t.Error("no attention rule")
	}
}

func TestAPrRulePassesOnAMatchingPRAndFailsWithoutOne(t *testing.T) {
	c := example(t)
	withPR := func(edit func(*PullRequest)) Target {
		target := exampleTarget(t, "pass")
		edit(target.PR)
		return target
	}
	cases := map[string]Target{
		"no PR":                          {Dir: exampleTarget(t, "pass").Dir, IntegrationBranch: "develop"},
		"a base other than integration":  withPR(func(pr *PullRequest) { pr.Base = "main" }),
		"a branch off its pattern":       withPR(func(pr *PullRequest) { pr.Head = "wip" }),
		"a body without its Closes line": withPR(func(pr *PullRequest) { pr.Body = "Ce qui change, Closes #38 en passant." }),
		"no label conception":            withPR(func(pr *PullRequest) { pr.Labels = []string{"revue-visuelle"} }),
	}
	for name, target := range cases {
		t.Run(name, func(t *testing.T) {
			verdict := check(t, c, target)
			if verdict.Status != contracts.ContratVerdictStatusIncomplete || !slices.Equal(verdict.FailedRuleIds, []string{"example.pr"}) {
				t.Fatalf("verdict %+v, want incomplete with exactly example.pr", verdict)
			}
		})
	}
	unknownIntegration := exampleTarget(t, "pass")
	unknownIntegration.IntegrationBranch = ""
	if verdict := check(t, c, unknownIntegration); !slices.Equal(verdict.FailedRuleIds, []string{"example.pr"}) {
		t.Fatalf("without an integration branch, verdict %+v, want example.pr failed", verdict)
	}
	if verdict := check(t, c, cases["no PR"]); verdict.HeadSha != nil {
		t.Fatalf("without a PR, headSha %q", *verdict.HeadSha)
	}
}

func TestAnEndedContextIsAnErrorNotAVerdict(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Check(ctx, example(t), exampleTarget(t, "pass")); !errors.Is(err, context.Canceled) {
		t.Fatalf("Check = %v, want context.Canceled", err)
	}
}

func TestEveryEmbeddedContratLoadsAndTheExampleIsItsFixture(t *testing.T) {
	all, err := All()
	if err != nil {
		t.Fatalf("All: %v", err)
	}
	names, _ := fs.Glob(embedded, "contrats/*.json")
	if len(all) != len(names) || len(all) == 0 {
		t.Fatalf("%d Contrats loaded of %d files", len(all), len(names))
	}
	for _, c := range all {
		if name := fmt.Sprintf("contrats/%s.v%d.json", c.ID, c.Version); !slices.Contains(names, name) {
			t.Errorf("Contrat %s v%d is not in %s", c.ID, c.Version, name)
		}
	}
	data, err := os.ReadFile(filepath.Join(fixturesDir, "example.json"))
	if err != nil {
		t.Fatal(err)
	}
	fixture, err := Parse(data)
	if err != nil {
		t.Fatalf("Parse(example.json): %v", err)
	}
	if !reflect.DeepEqual(fixture, example(t)) {
		t.Fatal("the embedded example differs from fixtures/contrats/example.json")
	}
	if _, err := Get("nowhere"); !errors.Is(err, ErrUnknown) {
		t.Fatalf("Get(nowhere) = %v, want ErrUnknown", err)
	}
}

func TestParseRefusesAContratTheRunnerCannotInterpret(t *testing.T) {
	cases := map[string]string{
		"an unknown field":       `{"id":"x","version":1,"step":"code","rules":[],"extra":1}`,
		"no version":             `{"id":"x","step":"code","rules":[]}`,
		"a rule declared twice":  `{"id":"x","version":1,"step":"code","rules":[{"id":"x.a","label":"l","severity":"bloquant","kind":"file","path":"a"},{"id":"x.a","label":"l","severity":"bloquant","kind":"file","path":"b"}]}`,
		"a rule it cannot check": `{"id":"x","version":1,"step":"code","rules":[{"id":"x.a","label":"l","severity":"bloquant","kind":"lint"}]}`,
	}
	for name, data := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse([]byte(data)); err == nil {
				t.Fatal("Parse accepted it")
			}
		})
	}
}

// The verdict goes into step.verdict as is: empty lists are [], not null.
func TestAVerdictFitsTheStepVerdictMessage(t *testing.T) {
	verdict := check(t, example(t), Target{Dir: exampleTarget(t, "pass").Dir, IntegrationBranch: "develop"})
	message := contracts.RunnerStepVerdict{Type: "step.verdict", Id: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a40", StepRunId: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a41", Verdict: verdict}
	data, err := json.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"warningRuleIds":[]`) || strings.Contains(string(data), "headSha") {
		t.Fatalf("message %s", data)
	}
	var back contracts.RunnerStepVerdict
	if err := json.Unmarshal(data, &back); err != nil {
		t.Fatalf("decode the message: %v", err)
	}
	if !reflect.DeepEqual(back.Verdict, verdict) {
		t.Fatalf("verdict %+v, back %+v", verdict, back.Verdict)
	}
}
