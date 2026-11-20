package main

import (
	"encoding/base64"
	"fmt"
	"reflect"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mirror"
	"github.com/maximed1412/crewdeck/apps/runner/internal/steps/ideaanalysis"
)

// The context of an analysis (IDEE-2) lists the open Tickets of a Local
// Projet as of a GitHub one, both read from the Runner's copy.
func TestTheContextOfAnAnalysisListsTheOpenTicketsOfALocalProjetAsOfAGitHubOne(t *testing.T) {
	f := newMiroirFixture(t)
	f.states(t, map[string]mirror.KeyState{ghKey: {State: mirror.FreshnessLive, SyncedAt: at(0)},
		localKey: {State: mirror.FreshnessLive, SyncedAt: at(0)}})
	vault := miroirVault(t)
	ideaID := "7a1c2e4d-0000-4000-8000-000000000001"
	text, err := vault.SealItem([]byte("Exporter le planning en PDF"), []byte(ideaID+":text"))
	if err != nil {
		t.Fatal(err)
	}
	step := &contracts.RunnerSessionStartStep{
		StepKind: contracts.RunnerSessionStartStepStepKindIdeaAnalysis, Skill: "idea-analysis", ContractId: "idea-analysis",
		Ideas: &contracts.RunnerSessionStartStepIdeas{
			Idea: contracts.RunnerSessionStartStepIdeasIdea{Id: ideaID, Number: 64, Text: contracts.RunnerSessionStartStepIdeasIdeaText{
				Key: base64.RawURLEncoding.EncodeToString(text.Key), Ciphertext: base64.RawURLEncoding.EncodeToString(text.Ciphertext)}},
			Open: []contracts.RunnerSessionStartStepIdeasOpenElem{},
		},
	}

	got, err := ideaanalysis.New(f.store, vault, nil).Context(step)
	if err != nil {
		t.Fatal(err)
	}

	tickets := map[string]string{}
	names := map[string]string{}
	for _, p := range got.Projects {
		names[p.ID] = p.Name
		for _, ticket := range p.Tickets {
			if len(ticket) != 2 || ticket["title"] == nil {
				t.Errorf("%s: ticket %v, want its number and title alone", p.ID, ticket)
			}
			tickets[p.ID] += fmt.Sprint(ticket["number"], " ")
		}
	}
	if want := map[string]string{"P1": "Atelier", "P2": "Carnet"}; !reflect.DeepEqual(names, want) {
		t.Fatalf("Projets %v, want %v", names, want)
	}
	if want := map[string]string{"P1": "15 14 13 12 ", "P2": "14 13 12 "}; !reflect.DeepEqual(tickets, want) {
		t.Fatalf("open Tickets %q, want %q", tickets, want)
	}
	if got.Idea.Text != "Exporter le planning en PDF" {
		t.Fatalf("idea %+v", got.Idea)
	}
}
