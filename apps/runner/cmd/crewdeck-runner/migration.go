package main

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/maximed1412/crewdeck/apps/runner/internal/migration"
	"github.com/maximed1412/crewdeck/apps/runner/internal/source"
	ghsource "github.com/maximed1412/crewdeck/apps/runner/internal/source/github"
)

// runnerMigrations are the groups of Source this Runner migrates, said in
// its hello (SOURCE-8).
var runnerMigrations = []contracts.RunnerHelloMigrationsElem{contracts.RunnerHelloMigrationsElemTicket}

// migrations is the handler of the migrations of Source (SOURCE-8): the
// Local side in the Projet's folder, the GitHub side through the REST API
// with the migration's token, asked of the server; a Projet now Local is
// scanned whole once finished.
func migrations(home, server, runnerToken string, locals *localSources, vault *heldVault, send func(context.Context, any) error, logger *slog.Logger) *migration.Handler {
	tokens := github.MigrationTokens{Server: server, RunnerToken: runnerToken}
	return migration.New(migration.Config{
		Home: home,
		Send: send,
		Local: func(projectID, dir string) (source.Copier, error) {
			p, ok := locals.Project(projectID)
			if !ok {
				return nil, migration.ErrNoFolder
			}
			return p.Copier(dir), nil
		},
		GitHub: func(migrationID, owner, name string) source.Copier {
			token := tokens.Token(migrationID)
			return &ghsource.Tickets{BaseURL: miroirGitHubAPI, Owner: owner, Name: name, Token: func(ctx context.Context) (string, error) {
				t, err := token.Token(ctx)
				if err != nil {
					return "", fmt.Errorf("%w: the migration's token: %v", ghsource.ErrUnavailable, err)
				}
				return t, nil
			}}
		},
		Vault: vault.Load,
		Finished: func(_, to string) {
			if to == string(contracts.RunnerMigrationCopyToLocal) {
				locals.full()
			}
		},
		Logger: logger,
	})
}
