package mirror

import (
	"bytes"
	"errors"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
)

// sealedNames opens a sealed name whose ciphertext is the name itself, under
// its Projet's aad only.
type sealedNames struct{}

func (sealedNames) OpenItem(item keys.SealedItem, aad []byte) ([]byte, error) {
	if !bytes.Equal(aad, []byte("project:"+atelierID+":name")) {
		return nil, errors.New("aad")
	}
	return item.Ciphertext, nil
}

// A Projet created Local whose code moved to GitHub (SOURCE-9) keeps its
// name sealed: its GitHub key opens it, as its Local key does.
func TestAGitHubKeyWithoutADisplayNameOpensTheSealedName(t *testing.T) {
	sealed := &contracts.RunnerMirrorProjectsProjectsElemNameSealed{Key: "a2V5", Ciphertext: "QXRlbGllcg"}
	item := contracts.RunnerMirrorProjectsProjectsElem{ProjectId: atelierID, Repository: "acme/atelier", GithubRepoId: 101, InstallationId: 7,
		IntegrationBranch: "develop", NameSealed: sealed,
		Sources: contracts.RunnerMirrorProjectsProjectsElemSources{Ticket: SourceLocal, Code: SourceGitHub}}
	got := ProjectsOf([]contracts.RunnerMirrorProjectsProjectsElem{item}, nil, sealedNames{})
	if len(got) != 2 || got[0].Repository != "acme/atelier" || got[0].DisplayName != "Atelier" || got[1].DisplayName != "Atelier" {
		t.Fatalf("keys %+v", got)
	}
	// Without a vault: the repository names it.
	if got := ProjectsOf([]contracts.RunnerMirrorProjectsProjectsElem{item}, nil, nil); got[0].DisplayName != "acme/atelier" {
		t.Errorf("name %q without a vault", got[0].DisplayName)
	}
}
