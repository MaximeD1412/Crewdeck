package main

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/folders"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/migration"
	"github.com/maximed1412/crewdeck/apps/runner/internal/session"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	ghsource "github.com/maximed1412/crewdeck/apps/runner/internal/source/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source/local"
)

// runnerMigrations are the groups of Source this Runner migrates, said in
// its hello (SOURCE-8, SOURCE-9).
var runnerMigrations = []contracts.RunnerHelloMigrationsElem{contracts.RunnerHelloMigrationsElemTicket, contracts.RunnerHelloMigrationsElemCode}

// migrations is the handler of the migrations of Source (SOURCE-8,
// SOURCE-9): the Local side in the Projet's folder, else in the one picked
// for the migration (held pending, promoted once finished); the GitHub
// side through the REST API and git with the migration's token, asked of
// the server. Once finished, the Local watchers report whole and the
// Projet's documents are indexed again (refsMoved).
func migrations(home, server, runnerToken string, locals *localSources, picked *folders.Handler, vault *heldVault,
	send func(context.Context, any) error, refsMoved func(projectID string), logger *slog.Logger) *migration.Handler {
	tokens := github.MigrationTokens{Server: server, RunnerToken: runnerToken}
	token := func(migrationID string) func(ctx context.Context) (string, error) {
		issued := tokens.Token(migrationID)
		return func(ctx context.Context) (string, error) {
			t, err := issued.Token(ctx)
			if err != nil {
				return "", fmt.Errorf("%w: the migration's token: %v", ghsource.ErrUnavailable, err)
			}
			return t, nil
		}
	}
	githubURL := strings.TrimSuffix(sessionsGitHubURL, "/")
	if githubURL == "" {
		githubURL = session.DefaultGitHubURL
	}
	return migration.New(migration.Config{
		Home:   home,
		Send:   send,
		Folder: locals.folder,
		Pending: func(projectID string) (string, bool) {
			pending, ok := picked.Pending(projectID)
			return pending.Path, ok && pending.Path != ""
		},
		Promote: picked.Promote,
		Taken:   picked.Taken,
		Open: func(projectID, folder string) *local.Project {
			if p, ok := locals.Project(projectID); ok && p.Folder() == folder {
				return p
			}
			return local.Open(locals.db, locals.vault, projectID, folder)
		},
		GitHub: func(migrationID, owner, name string) source.Copier {
			return &ghsource.Tickets{BaseURL: miroirGitHubAPI, Owner: owner, Name: name, Token: token(migrationID)}
		},
		Remote: func(migrationID, owner, name string) migration.Remote {
			get := token(migrationID)
			return migration.Remote{URL: githubURL + "/" + owner + "/" + name + ".git", Env: func(ctx context.Context) ([]string, error) {
				t, err := get(ctx)
				if err != nil {
					return nil, err
				}
				return migration.AuthEnv(githubURL+"/", t), nil
			}}
		},
		Vault: vault.Load,
		Finished: func(_ context.Context, projectID, to string) {
			if to == string(contracts.RunnerMigrationCopyToLocal) {
				locals.full()
			}
			refsMoved(projectID)
		},
		Logger: logger,
	})
}
