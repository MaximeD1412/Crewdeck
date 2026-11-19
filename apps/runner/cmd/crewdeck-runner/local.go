package main

import (
	"sync"

	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
	"github.com/maximed1412/crewdeck/apps/runner/internal/state"
)

// localSources are the Local Projets of the running Runner (SOURCE-2, ADR
// 0012): local.db, which only it writes, and one local.Project per folder
// of runner.json, a folder attached while it runs opened on its first use.
type localSources struct {
	db    *local.DB
	store state.Store
	vault func() *keys.Vault

	mu       sync.Mutex
	projects map[string]*local.Project
}

// openLocal opens ~/.crewdeck/local.db and the Local Projets runner.json names.
func openLocal(store state.Store, vault func() *keys.Vault) (*localSources, error) {
	db, err := local.OpenDB(local.DefaultPath(store.Dir))
	if err != nil {
		return nil, err
	}
	l := &localSources{db: db, store: store, vault: vault, projects: map[string]*local.Project{}}
	for id := range l.folders() {
		l.Project(id)
	}
	return l, nil
}

func (l *localSources) Close() error { return l.db.Close() }

// folders are the Local Projets' folders as runner.json holds them now.
func (l *localSources) folders() map[string]string {
	s, err := l.store.Load()
	if err != nil {
		return nil
	}
	return s.Projects
}

func (l *localSources) folder(projectID string) (string, bool) {
	path, ok := l.folders()[projectID]
	return path, ok && path != ""
}

// Project is the Local Projet projectID, opened once; false when runner.json
// has no folder for it.
func (l *localSources) Project(projectID string) (*local.Project, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	path, ok := l.folder(projectID)
	if !ok {
		return nil, false
	}
	if p, ok := l.projects[projectID]; ok && p.Folder() == path {
		return p, true
	}
	p := local.Open(l.db, l.vault, projectID, path)
	l.projects[projectID] = p
	return p, true
}

// Origin is the clone of the Local Projet's folder its Sessions and
// Commandes work in (session.Config.LocalOrigin), the folder read at each
// clone: one attached again elsewhere is cloned from where it is now.
func (l *localSources) Origin(projectID string) session.Origin {
	return &local.Origin{Home: l.store.Dir, ProjectID: projectID, Folder: l.folder}
}
