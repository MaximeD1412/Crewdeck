package ideaanalysis_test

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/mirror"
	"github.com/maximed1412/crewdeck/apps/runner/internal/steps/ideaanalysis"
)

const (
	ideaID   = "7a1c2e4d-0000-4000-8000-000000000001"
	otherID  = "7a1c2e4d-0000-4000-8000-000000000002"
	thirdID  = "7a1c2e4d-0000-4000-8000-000000000003"
	fourthID = "7a1c2e4d-0000-4000-8000-000000000004"
	lostID   = "7a1c2e4d-0000-4000-8000-000000000005"
)

// vault opens the items whose ciphertext is their aad's plaintext as
// base64url: one sealed under another aad does not open.
type vault map[string]string

func (v vault) OpenItem(item keys.SealedItem, aad []byte) ([]byte, error) {
	plain, ok := v[string(aad)]
	if !ok || string(item.Ciphertext) != string(aad) {
		return nil, errors.New("does not open")
	}
	return []byte(plain), nil
}

// sealed is the item of aad for vault.
func sealed(aad string) (key, ciphertext string) {
	return base64.RawURLEncoding.EncodeToString([]byte("key")), base64.RawURLEncoding.EncodeToString([]byte(aad))
}

// store is a copy of three keys: P1's Tickets on GitHub and its code on
// Local, P2 on Local alone.
type store struct{ listed []string }

func (s *store) Projects() ([]mirror.Project, error) {
	return []mirror.Project{
		{Repository: "acme/atelier", ProjectID: "P1", Source: mirror.SourceGitHub, Groups: []string{mirror.GroupTicket}, DisplayName: "acme/atelier"},
		{Repository: "local/P1", ProjectID: "P1", Source: mirror.SourceLocal, Groups: []string{mirror.GroupCode}, DisplayName: "Atelier"},
		{Repository: "local/P2", ProjectID: "P2", Source: mirror.SourceLocal, Groups: []string{mirror.GroupTicket, mirror.GroupCode}, DisplayName: "Carnet"},
	}, nil
}

func (s *store) List(key string, f mirror.Filter) ([]map[string]any, error) {
	if f.State != "open" || f.Pulls {
		return nil, errors.New("not the open Tickets")
	}
	s.listed = append(s.listed, key)
	switch key {
	case "acme/atelier":
		return []map[string]any{{"number": float64(7), "title": "L'export", "body": "jamais lu"}}, nil
	case "local/P2":
		return []map[string]any{{"number": 12, "title": "Le panier", "state": "OPEN"}}, nil
	}
	return nil, errors.New("no key " + key)
}

func step() *contracts.RunnerSessionStartStep {
	text := func(id string) contracts.RunnerSessionStartStepIdeasOpenElemText {
		key, ciphertext := sealed(id + ":text")
		return contracts.RunnerSessionStartStepIdeasOpenElemText{Key: key, Ciphertext: ciphertext}
	}
	key, ciphertext := sealed(ideaID + ":text")
	analysisKey, analysisCiphertext := sealed(otherID + ":analysis")
	return &contracts.RunnerSessionStartStep{
		StepRunId: "019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01", StepKind: contracts.RunnerSessionStartStepStepKindIdeaAnalysis, Skill: "idea-analysis",
		ContractId: "idea-analysis", Inputs: []contracts.RunnerSessionStartStepInputsElem{},
		Ideas: &contracts.RunnerSessionStartStepIdeas{
			Idea: contracts.RunnerSessionStartStepIdeasIdea{Id: ideaID, Number: 64, Text: contracts.RunnerSessionStartStepIdeasIdeaText{Key: key, Ciphertext: ciphertext}},
			Open: []contracts.RunnerSessionStartStepIdeasOpenElem{
				{Id: ideaID, Number: 64, Text: text(ideaID)},
				{Id: otherID, Number: 58, Text: text(otherID), Analysis: &contracts.RunnerSessionStartStepIdeasOpenElemAnalysis{Key: analysisKey, Ciphertext: analysisCiphertext}},
				{Id: thirdID, Number: 61, Text: text(thirdID)},
				{Id: fourthID, Number: 62, Text: text(fourthID)},
				{Id: lostID, Number: 63, Text: text(lostID)},
			},
		},
	}
}

var opened = vault{
	ideaID + ":text":      "Exporter le planning en PDF\nPour le client.",
	otherID + ":text":     "Imprimer le planning",
	otherID + ":analysis": `{"title":"Imprimer le planning de la semaine","summary":"Une version papier du planning."}`,
	thirdID + ":text":     "Chercher par ingrédient\nUne recherche des recettes\nqui contiennent un ingrédient.",
	fourthID + ":text":    "Un thème sombre",
}

func TestTheContextHoldsTheIdeeEachProjetWithItsOpenTicketsAndTheOtherOpenIdees(t *testing.T) {
	s := &store{}
	got, err := ideaanalysis.New(s, opened).Context(step())
	if err != nil {
		t.Fatal(err)
	}
	want := ideaanalysis.Context{
		Idea: ideaanalysis.Idea{ID: ideaID, Number: 64, Text: "Exporter le planning en PDF\nPour le client."},
		Projects: []ideaanalysis.Project{
			{ID: "P1", Name: "acme/atelier", Tickets: []map[string]any{{"number": float64(7), "title": "L'export"}}},
			{ID: "P2", Name: "Carnet", Tickets: []map[string]any{{"number": 12, "title": "Le panier"}}},
		},
		OpenIdeas: []ideaanalysis.OpenIdea{
			{ID: otherID, Number: 58, Title: "Imprimer le planning de la semaine", Summary: "Une version papier du planning."},
			{ID: thirdID, Number: 61, Title: "Chercher par ingrédient", Summary: "Une recherche des recettes\nqui contiennent un ingrédient."},
			{ID: fourthID, Number: 62, Title: "Un thème sombre", Summary: "Un thème sombre"},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("context\n%+v\nwant\n%+v", got, want)
	}
	if !reflect.DeepEqual(s.listed, []string{"acme/atelier", "local/P2"}) {
		t.Fatalf("listed %v, want each Projet's key of Tickets once", s.listed)
	}
}

// An analysis that does not open leaves the Idée its text's title.
func TestAnOpenIdeeWhoseAnalysisDoesNotOpenIsListedByItsText(t *testing.T) {
	v := vault{}
	for aad, plain := range opened {
		v[aad] = plain
	}
	delete(v, otherID+":analysis")
	got, err := ideaanalysis.New(&store{}, v).Context(step())
	if err != nil {
		t.Fatal(err)
	}
	if o := got.OpenIdeas[0]; o.ID != otherID || o.Title != "Imprimer le planning" || o.Summary != "Imprimer le planning" {
		t.Fatalf("open Idée %+v, want its text", o)
	}
}

func TestAnIdeeWhoseTextDoesNotOpenHasNoContext(t *testing.T) {
	v := vault{otherID + ":text": "Imprimer le planning"}
	dir := t.TempDir()
	if err := ideaanalysis.New(&store{}, v).Prepare(t.Context(), dir, step()); err == nil {
		t.Fatal("prepared a context without the Idée's text")
	}
	if _, err := os.Stat(filepath.Join(dir, ".crewdeck", "context.json")); !os.IsNotExist(err) {
		t.Fatal("a context was written")
	}
	if _, err := ideaanalysis.New(&store{}, opened).Context(&contracts.RunnerSessionStartStep{}); !errors.Is(err, ideaanalysis.ErrNoIdea) {
		t.Fatalf("%v, want ErrNoIdea for a step without its Idées", err)
	}
}

func TestPrepareWritesTheContextInTheScratchFolder(t *testing.T) {
	dir := t.TempDir()
	if err := ideaanalysis.New(&store{}, opened).Prepare(t.Context(), dir, step()); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, ".crewdeck", "context.json"))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	idea, _ := got["idea"].(map[string]any)
	if idea["id"] != ideaID || idea["number"] != float64(64) || len(got["projects"].([]any)) != 2 || len(got["openIdeas"].([]any)) != 3 {
		t.Fatalf("context.json %s", data)
	}
}

func TestTheReportGivesItsFiguresAndSealsItsSentencesUnderTheIdeesAnalysis(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, ".crewdeck"), 0o700); err != nil {
		t.Fatal(err)
	}
	report := `{"title":"Exporter le planning en PDF","summary":"Un bouton PDF.","projectId":"P2","projectWhy":"Le planning vit dans Carnet.",
	"impact":3,"impactWhy":"Chaque semaine.","effort":2,"effortWhy":"Un écran.","duplicates":[{"id":"` + otherID + `","why":"La même demande."}],"questions":[],"planned":true}`
	if err := os.WriteFile(filepath.Join(dir, ".crewdeck", "report.json"), []byte(report), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := ideaanalysis.New(&store{}, opened).Report(dir, step())
	if err != nil {
		t.Fatal(err)
	}

	if want := map[string]any{"impact": 3, "effort": 2, "projectId": "P2", "duplicateIds": []string{otherID}}; !reflect.DeepEqual(got.Figures, want) {
		t.Fatalf("figures %v, want %v", got.Figures, want)
	}
	if got.AAD != ideaID+":analysis" {
		t.Fatalf("sealed under %q, want %s:analysis", got.AAD, ideaID)
	}
	want := `{"title":"Exporter le planning en PDF","summary":"Un bouton PDF.","projectWhy":"Le planning vit dans Carnet.","impactWhy":"Chaque semaine.","effortWhy":"Un écran.","duplicates":[{"id":"` + otherID + `","why":"La même demande."}],"questions":[]}`
	if string(got.Content) != want {
		t.Fatalf("content %s\nwant %s", got.Content, want)
	}
}

func TestAMissingReportIsNoReport(t *testing.T) {
	if _, err := ideaanalysis.New(&store{}, opened).Report(t.TempDir(), step()); err == nil {
		t.Fatal("a report read from an empty folder")
	}
}
