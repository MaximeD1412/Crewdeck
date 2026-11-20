package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
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

// E2E-4: a session.start sent after a rotation done while the Runner was
// away has its Idées under the new version, which the rotator adopts off the
// connection's loop: the context is written once it holds it, opened under
// it; never held within FillWait, the Session prepares nothing.
func TestAnAnalysisStartedAfterARotationWaitsForTheNewVersionsAdoption(t *testing.T) {
	w := newRotationWorld(t)
	newKey, _ := keys.GenerateAESKey()
	sealed, err := keys.SealWrap(w.phone, keys.PublicKeyBytes(w.runner), newKey, []byte(keys.InfoVaultWrap), keys.VaultWrapAAD(runnerID, 2))
	if err != nil {
		t.Fatal(err)
	}
	wrap := vaultKeyWrap{Version: 2, Enc: b64url.EncodeToString(sealed.Enc), Ciphertext: b64url.EncodeToString(sealed.Ciphertext), Tag: b64url.EncodeToString(sealed.Tag)}
	next, err := keys.Unlock(w.runner, keys.PublicKeyBytes(w.phone), runnerID, 2, sealed)
	if err != nil {
		t.Fatal(err)
	}
	ideaID := "7a1c2e4d-0000-4000-8000-000000000001"
	text, err := next.SealItem([]byte("Exporter le planning en PDF"), []byte(ideaID+":text"))
	if err != nil {
		t.Fatal(err)
	}
	step := &contracts.RunnerSessionStartStep{
		StepKind: contracts.RunnerSessionStartStepStepKindIdeaAnalysis, Skill: "idea-analysis", ContractId: "idea-analysis",
		Ideas: &contracts.RunnerSessionStartStepIdeas{
			Idea: contracts.RunnerSessionStartStepIdeasIdea{Id: ideaID, Number: 64, Text: contracts.RunnerSessionStartStepIdeasIdeaText{
				Key: b64url.EncodeToString(text.Key), Ciphertext: b64url.EncodeToString(text.Ciphertext)}},
			Open:            []contracts.RunnerSessionStartStepIdeasOpenElem{},
			VaultKeyVersion: 2,
		},
	}
	kind := ideaanalysis.New(newMiroirFixture(t).store, w.held, nil)

	t.Run("never held", func(t *testing.T) {
		before := ideaanalysis.FillWait
		ideaanalysis.FillWait = 50 * time.Millisecond
		t.Cleanup(func() { ideaanalysis.FillWait = before })
		dir := t.TempDir()
		if err := kind.Prepare(t.Context(), dir, step); !errors.Is(err, context.DeadlineExceeded) || !strings.Contains(err.Error(), "version 2 not held") {
			t.Fatalf("Prepare = %v, want the version 2 waited for", err)
		}
		if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(ideaanalysis.ContextPath))); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("context.json written: %v", err)
		}
	})

	dir := t.TempDir()
	prepared := make(chan error, 1)
	go func() { prepared <- kind.Prepare(t.Context(), dir, step) }()
	select {
	case err := <-prepared:
		t.Fatalf("prepared under the version 1 still held: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	// The adoption, late: the holders' list read first, as when the wrap opens from no key held at once.
	if adopted, err := w.rotator().adopt(context.Background(), wrap); !adopted || err != nil {
		t.Fatalf("adopt = %v, %v", adopted, err)
	}
	select {
	case err := <-prepared:
		if err != nil {
			t.Fatalf("Prepare = %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Prepare still waits once the version 2 is held")
	}
	data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(ideaanalysis.ContextPath)))
	if err != nil || !strings.Contains(string(data), "Exporter le planning en PDF") {
		t.Fatalf("context.json %s, %v", data, err)
	}
}
