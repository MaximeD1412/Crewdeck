package folders

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/protocol"
)

const prepareID = "019a6f00-0000-7000-8000-0000000000f3"

// keep makes path the Projet's folder in runner.json.
func (f *fixture) keep(t *testing.T, projectID, path string) {
	t.Helper()
	linked, err := f.store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if linked.Projects == nil {
		linked.Projects = map[string]string{}
	}
	linked.Projects[projectID] = path
	if err := f.store.Save(linked); err != nil {
		t.Fatal(err)
	}
}

func status(projectID string) contracts.RunnerProjectFolderStatus {
	return contracts.RunnerProjectFolderStatus{Type: protocol.TypeProjectFolderStatus, Id: requestID, ProjectId: projectID, ReleaseBranch: "main", IntegrationBranch: "develop"}
}

func prepare(projectID string) contracts.RunnerProjectFolderPrepare {
	return contracts.RunnerProjectFolderPrepare{Type: protocol.TypeProjectFolderPrepare, Id: requestID, RequestId: prepareID, ProjectId: projectID, ReleaseBranch: "main", IntegrationBranch: "develop"}
}

// stateOf is the project.folder.state sent, checked against its schema and holding no path.
func (f *fixture) stateOf(t *testing.T, message any) contracts.RunnerProjectFolderState {
	t.Helper()
	state, ok := message.(contracts.RunnerProjectFolderState)
	if !ok {
		t.Fatalf("sent %T, want project.folder.state", message)
	}
	data, _ := json.Marshal(state)
	if err := json.Unmarshal(data, &contracts.RunnerProjectFolderState{}); err != nil {
		t.Fatalf("project.folder.state %s: %v", data, err)
	}
	if strings.Contains(string(data), f.home) {
		t.Fatalf("project.folder.state %s holds the path", data)
	}
	return state
}

func figures(state contracts.RunnerProjectFolderState) Readiness {
	return Readiness{Present: state.Present, IsGit: state.IsGit, HasCommits: state.HasCommits, ReleaseBranch: state.ReleaseBranch, IntegrationBranch: state.IntegrationBranch}
}

func TestAStatusSaysTheFiguresOfTheProjetsFolder(t *testing.T) {
	pilotGit(t, true)
	f := newFixture(t)
	path := filepath.Join(f.home, "projets", "recettes")
	repository(t, path, 1)
	f.keep(t, thisProject, path)

	if err := f.handler.HandleStatus(context.Background(), status(thisProject)); err != nil {
		t.Fatal(err)
	}

	sent := f.sender.take()
	if len(sent) != 1 {
		t.Fatalf("sent %d messages, want one project.folder.state", len(sent))
	}
	state := f.stateOf(t, sent[0])
	if state.ProjectId != thisProject {
		t.Fatalf("project.folder.state of %s", state.ProjectId)
	}
	assertReadiness(t, figures(state), Readiness{Present: true, IsGit: true, HasCommits: true, ReleaseBranch: true})
	f.assertNoClearText(t, "recettes", f.home)
}

func TestAStatusOfAProjetWithoutAFolderSaysItAbsent(t *testing.T) {
	pilotGit(t, true)
	f := newFixture(t)

	if err := f.handler.HandleStatus(context.Background(), status(thisProject)); err != nil {
		t.Fatal(err)
	}

	sent := f.sender.take()
	if len(sent) != 1 {
		t.Fatalf("sent %d messages, want one project.folder.state", len(sent))
	}
	assertReadiness(t, figures(f.stateOf(t, sent[0])), Readiness{})
}

func TestAStatusOfAFolderThatIsNoMoreSaysItAbsent(t *testing.T) {
	pilotGit(t, true)
	f := newFixture(t)
	path := filepath.Join(f.home, "projets", "recettes")
	repository(t, path, 1)
	f.keep(t, thisProject, path)
	if err := os.RemoveAll(path); err != nil {
		t.Fatal(err)
	}
	touch(t, path)

	if err := f.handler.HandleStatus(context.Background(), status(thisProject)); err != nil {
		t.Fatal(err)
	}

	assertReadiness(t, figures(f.stateOf(t, f.sender.take()[0])), Readiness{})
}

// A preparation answers its request, then says the folder's new figures.
func TestAPrepareAnswersThenSaysTheNewState(t *testing.T) {
	pilotGit(t, true)
	f := newFixture(t)
	path := filepath.Join(f.home, "projets", "recettes")
	touch(t, filepath.Join(path, "main.go"))
	f.keep(t, thisProject, path)

	if err := f.handler.HandlePrepare(context.Background(), prepare(thisProject)); err != nil {
		t.Fatal(err)
	}

	sent := f.sender.take()
	if len(sent) != 2 {
		t.Fatalf("sent %d messages, want project.folder.prepared then project.folder.state", len(sent))
	}
	prepared, ok := sent[0].(contracts.RunnerProjectFolderPrepared)
	if !ok || prepared.RequestId != prepareID || prepared.ProjectId != thisProject || !prepared.Ok || prepared.Error != nil {
		t.Fatalf("sent %+v, want project.folder.prepared ok", sent[0])
	}
	data, _ := json.Marshal(prepared)
	if err := json.Unmarshal(data, &contracts.RunnerProjectFolderPrepared{}); err != nil {
		t.Fatalf("project.folder.prepared %s: %v", data, err)
	}
	assertReadiness(t, figures(f.stateOf(t, sent[1])), Readiness{Present: true, IsGit: true, HasCommits: true, ReleaseBranch: true, IntegrationBranch: true})
	if got := git(t, path, "log", "-1", "--format=%s"); got != FirstCommit {
		t.Fatalf("commit %q", got)
	}
	f.assertNoClearText(t, "recettes", f.home)
}

func TestAPrepareWithoutAGitIdentitySaysIt(t *testing.T) {
	pilotGit(t, false)
	f := newFixture(t)
	path := filepath.Join(f.home, "projets", "recettes")
	touch(t, filepath.Join(path, "main.go"))
	f.keep(t, thisProject, path)

	if err := f.handler.HandlePrepare(context.Background(), prepare(thisProject)); err != nil {
		t.Fatal(err)
	}

	sent := f.sender.take()
	if len(sent) != 2 {
		t.Fatalf("sent %d messages, want project.folder.prepared then project.folder.state", len(sent))
	}
	prepared := sent[0].(contracts.RunnerProjectFolderPrepared)
	if prepared.Ok || prepared.Error == nil || *prepared.Error != contracts.RunnerProjectFolderPreparedErrorGitIdentityMissing {
		t.Fatalf("project.folder.prepared %+v, want git-identity-missing", prepared)
	}
	assertReadiness(t, figures(f.stateOf(t, sent[1])), Readiness{Present: true, IsGit: true})
}

func TestAPrepareOfAProjetWithoutAFolderSaysFolderMissing(t *testing.T) {
	pilotGit(t, true)
	f := newFixture(t)

	if err := f.handler.HandlePrepare(context.Background(), prepare(thisProject)); err != nil {
		t.Fatal(err)
	}

	sent := f.sender.take()
	if len(sent) != 2 {
		t.Fatalf("sent %d messages, want project.folder.prepared then project.folder.state", len(sent))
	}
	prepared := sent[0].(contracts.RunnerProjectFolderPrepared)
	if prepared.Ok || prepared.Error == nil || *prepared.Error != contracts.RunnerProjectFolderPreparedErrorFolderMissing {
		t.Fatalf("project.folder.prepared %+v, want folder-missing", prepared)
	}
	assertReadiness(t, figures(f.stateOf(t, sent[1])), Readiness{})
}
