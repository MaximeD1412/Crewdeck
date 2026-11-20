package main

import (
	"context"
	"path/filepath"
	"sync"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/artifact"
	"github.com/maximed1412/crewdeck/apps/runner/internal/keys"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
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
	watched  map[string]*watched
}

// watched is a Local Projet's folder followed (SOURCE-3).
type watched struct {
	project *local.Project
	watcher *local.Watcher
	cancel  context.CancelFunc
}

// watchEvery is how often the Watchers follow runner.json's folders, attached or detached.
const watchEvery = 2 * time.Second

// openLocal opens ~/.crewdeck/local.db and the Local Projets runner.json names.
func openLocal(store state.Store, vault func() *keys.Vault) (*localSources, error) {
	db, err := local.OpenDB(local.DefaultPath(store.Dir))
	if err != nil {
		return nil, err
	}
	l := &localSources{db: db, store: store, vault: vault, projects: map[string]*local.Project{}, watched: map[string]*watched{}}
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
	// The clone and worktrees a merge squashes in, a change's mergeability
	// computed in (SOURCE-5).
	p.SetClone((&local.Origin{Home: l.store.Dir, ProjectID: projectID}).Dir())
	p.SetWorktrees(filepath.Join(l.store.Dir, "worktrees", projectID))
	l.projects[projectID] = p
	return p, true
}

// Source is the Local Projet's Source for the Miroir (mirror.LocalSources),
// a change's branch read in the Runner's clone first.
func (l *localSources) Source(projectID string) (source.Reader, bool) {
	p, ok := l.Project(projectID)
	if !ok {
		return nil, false
	}
	p.SetClone((&local.Origin{Home: l.store.Dir, ProjectID: projectID}).Dir())
	return p, true
}

// Artifact is the Local Projet projectID as the page reads it (SOURCE-4):
// its Source, and its clone fetched behind the clone's lock.
func (l *localSources) Artifact(projectID string) (artifact.Project, bool) {
	p, ok := l.Source(projectID)
	if !ok {
		return artifact.Project{}, false
	}
	origin := session.LockedOrigin(l.Origin(projectID))
	return artifact.Project{Source: p, Clone: func(ctx context.Context) (string, error) {
		dir, _, err := origin.Clone(ctx)
		return dir, err
	}}, true
}

// Target is the Local Projet's writer (source.write), a change's branch
// read in the Runner's clone first.
func (l *localSources) Target(projectID string) (source.Target, bool) {
	p, ok := l.Project(projectID)
	if !ok {
		return nil, false
	}
	p.SetClone((&local.Origin{Home: l.store.Dir, ProjectID: projectID}).Dir())
	return p, true
}

// Origin is the clone of the Local Projet's folder its Sessions and
// Commandes work in (session.Config.LocalOrigin), the folder read at each
// clone: one attached again elsewhere is cloned from where it is now.
func (l *localSources) Origin(projectID string) session.Origin {
	return &local.Origin{Home: l.store.Dir, ProjectID: projectID, Folder: l.folder}
}

// watch follows each Local Projet's folder until ctx ends (SOURCE-3): one
// Watcher per folder of runner.json, started with a full report and
// stopped as folders are attached, moved or detached.
func (l *localSources) watch(ctx context.Context, cfg local.WatchConfig) {
	ticker := time.NewTicker(watchEvery)
	defer ticker.Stop()
	for {
		l.follow(ctx, cfg)
		select {
		case <-ctx.Done():
			l.mu.Lock()
			for id, w := range l.watched {
				w.cancel()
				delete(l.watched, id)
			}
			l.mu.Unlock()
			return
		case <-ticker.C:
		}
	}
}

// follow starts a Watcher for each folder not followed yet, and stops those
// of a folder gone or moved.
func (l *localSources) follow(ctx context.Context, cfg local.WatchConfig) {
	folders := l.folders()
	for id := range folders {
		p, ok := l.Project(id)
		if !ok {
			continue
		}
		l.mu.Lock()
		if w := l.watched[id]; w == nil || w.project != p {
			if w != nil {
				w.cancel()
			}
			wctx, cancel := context.WithCancel(ctx)
			w := &watched{project: p, watcher: local.Watch(p, cfg), cancel: cancel}
			l.watched[id] = w
			w.watcher.Full()
			go w.watcher.Run(wctx)
		}
		l.mu.Unlock()
	}
	l.mu.Lock()
	for id, w := range l.watched {
		if folders[id] == "" {
			w.cancel()
			delete(l.watched, id)
		}
	}
	l.mu.Unlock()
}

// full asks each Watcher for a report of every item: the server accepted a connection.
func (l *localSources) full() {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, w := range l.watched {
		w.watcher.Full()
	}
}
