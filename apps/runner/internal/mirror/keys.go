package mirror

import (
	"encoding/base64"
	"sort"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
)

// NameOpener opens a sealed name with the vault key (keys.Vault.OpenItem).
type NameOpener interface {
	OpenItem(item keys.SealedItem, aad []byte) ([]byte, error)
}

// ProjectsOf are the copy's keys for the server's Projets (mirror.projects,
// ADR 0012): the groups of a Projet on GitHub under its repository, those on
// Local under local/<projectId>, the folder from the Runner's state
// (projectId → path). A Projet with both groups on one Source has one key,
// with one group on each, two. A group on GitHub without a repository (not
// linked yet) has no key. A Local key's name is the Projet's sealed name
// opened with vault (nil: none opened), else the key itself; it never
// leaves the machine.
func ProjectsOf(items []contracts.RunnerMirrorProjectsProjectsElem, folders map[string]string, vault NameOpener) []Project {
	var out []Project
	for _, item := range items {
		groups := map[string][]string{}
		for _, g := range []struct{ group, source string }{
			{GroupTicket, string(item.Sources.Ticket)},
			{GroupCode, string(item.Sources.Code)},
		} {
			groups[g.source] = append(groups[g.source], g.group)
		}
		repository, _ := item.Repository.(string)
		if gs := groups[SourceGitHub]; len(gs) > 0 && repository != "" {
			name, _ := item.DisplayName.(string)
			if name == "" {
				name = repository
			}
			repoID, _ := asInt(item.GithubRepoId)
			installation, _ := asInt(item.InstallationId)
			out = append(out, Project{
				Repository: repository, ProjectID: item.ProjectId, Source: SourceGitHub, Groups: gs,
				GitHubRepoID: int64(repoID), InstallationID: int64(installation), DisplayName: name,
				IntegrationBranch: item.IntegrationBranch,
			})
		}
		if gs := groups[SourceLocal]; len(gs) > 0 {
			k := LocalPrefix + item.ProjectId
			name := openName(vault, item.ProjectId, item.NameSealed)
			if name == "" {
				name = k
			}
			out = append(out, Project{
				Repository: k, ProjectID: item.ProjectId, Source: SourceLocal, Groups: gs, DisplayName: name,
				IntegrationBranch: item.IntegrationBranch, Folder: folders[item.ProjectId],
			})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Repository < out[j].Repository })
	return out
}

// openName is PROJET-6's sealed name (aad project:<id>:name), "" when it does not open.
func openName(vault NameOpener, projectID string, sealed *contracts.RunnerMirrorProjectsProjectsElemNameSealed) string {
	if vault == nil || sealed == nil {
		return ""
	}
	key, err := base64.RawURLEncoding.DecodeString(sealed.Key)
	if err != nil {
		return ""
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(sealed.Ciphertext)
	if err != nil {
		return ""
	}
	name, err := vault.OpenItem(keys.SealedItem{Key: key, Ciphertext: ciphertext}, []byte("project:"+projectID+":name"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(name))
}

// KeyOf is the key holding the Projet's group among the copy's keys; false when none does.
func KeyOf(projects []Project, projectID, group string) (Project, bool) {
	for _, p := range projects {
		if p.ProjectID == projectID && p.Has(group) {
			return p, true
		}
	}
	return Project{}, false
}
