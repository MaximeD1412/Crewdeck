package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

var exampleFixtures = filepath.Join("..", "..", "..", "..", "packages", "contracts", "fixtures", "contrats", "example")

func runContratCheck(t *testing.T, args ...string) (contracts.ContratVerdict, error) {
	t.Helper()
	var out bytes.Buffer
	root := newRootCommand()
	root.SetOut(&out)
	root.SetArgs(append([]string{"contrat", "check"}, args...))
	if err := root.Execute(); err != nil {
		return contracts.ContratVerdict{}, err
	}
	var verdict contracts.ContratVerdict
	if err := json.Unmarshal(out.Bytes(), &verdict); err != nil {
		t.Fatalf("output %q is not a verdict: %v", out.String(), err)
	}
	return verdict, nil
}

func TestContratCheckWithoutAPRFailsOnlyThePrRuleOfThePassingFolder(t *testing.T) {
	verdict, err := runContratCheck(t, "example", "--dir", filepath.Join(exampleFixtures, "pass"))
	if err != nil {
		t.Fatalf("contrat check: %v", err)
	}
	// Without --pr, only the pr rule fails: there is no PR to read.
	if verdict.ContractId != "example" || verdict.Version != 1 || strings.Join(verdict.FailedRuleIds, ",") != "example.pr" {
		t.Fatalf("verdict %+v", verdict)
	}
}

func TestContratCheckPrintsAPassedVerdictForThePassingFolderAndItsPR(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer ghs_debug" || r.URL.Path != "/repos/acme/atelier/pulls/12" {
			http.Error(w, "{}", http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(`{"body":"Closes #38","base":{"ref":"develop"},"head":{"ref":"feat/38-contrats","sha":"4b825dc642cb6eb9a060e54bf8d69288fbee4904"},"labels":[{"name":"conception"}]}`))
	}))
	t.Cleanup(srv.Close)
	t.Setenv("GH_TOKEN", "ghs_debug")

	verdict, err := runContratCheck(t, "example", "--dir", filepath.Join(exampleFixtures, "pass"), "--pr", "12", "--repo", "acme/atelier", "--github-api", srv.URL)
	if err != nil {
		t.Fatalf("contrat check: %v", err)
	}
	if verdict.Status != contracts.ContratVerdictStatusPassed || len(verdict.FailedRuleIds) != 0 || verdict.HeadSha == nil {
		t.Fatalf("verdict %+v, want passed with the PR's head", verdict)
	}
}

func TestContratCheckPrintsTheFailedRules(t *testing.T) {
	verdict, err := runContratCheck(t, "example", "--dir", filepath.Join(exampleFixtures, "fail-example.readme"))
	if err != nil {
		t.Fatalf("contrat check: %v", err)
	}
	if verdict.Status != contracts.ContratVerdictStatusIncomplete || strings.Join(verdict.FailedRuleIds, ",") != "example.readme,example.pr" {
		t.Fatalf("verdict %+v", verdict)
	}
}

func TestContratCheckRefusesAnUnknownContratOrAPRWithoutItsRepository(t *testing.T) {
	if _, err := runContratCheck(t, "nowhere", "--dir", "."); err == nil || !strings.Contains(err.Error(), "nowhere") {
		t.Fatalf("unknown Contrat: %v", err)
	}
	if _, err := runContratCheck(t, "example", "--dir", ".", "--pr", "12"); err == nil {
		t.Fatal("--pr without --repo accepted")
	}
	if _, err := runContratCheck(t, "example"); err == nil {
		t.Fatal("no --dir accepted")
	}
}

func TestTheContratCommandIsHidden(t *testing.T) {
	command, _, err := newRootCommand().Find([]string{"contrat"})
	if err != nil || command.Name() != "contrat" || !command.Hidden {
		t.Fatalf("contrat command %v, %v: want it hidden", command, err)
	}
}
