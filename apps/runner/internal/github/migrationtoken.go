package github

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// ErrMigrationNotRunning is the server's answer for a migration that is not
// copying, verifying nor switched (`source-migration.not-running`): no token.
var ErrMigrationNotRunning = errors.New("github: the migration is not running")

// MigrationTokens asks the server for a migration of Source's token
// (SOURCE-8, `POST /api/runner/source-migrations/:id/github-token`) with the
// Runner's: `issues: write` on the Projet's repository alone.
type MigrationTokens struct {
	Server      string
	RunnerToken string
	// HTTP has a 30 s timeout when nil.
	HTTP *http.Client
}

// Fetch is the migration's new token; an error names the server's code, never a token.
func (m MigrationTokens) Fetch(ctx context.Context, migrationID string) (Issued, error) {
	endpoint := strings.TrimSuffix(m.Server, "/") + "/api/runner/source-migrations/" + url.PathEscape(migrationID) + "/github-token"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, nil)
	if err != nil {
		return Issued{}, err
	}
	request.Header.Set("Authorization", "Bearer "+m.RunnerToken)
	client := m.HTTP
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return Issued{}, fmt.Errorf("github: the migration's token: %w", err)
	}
	defer response.Body.Close()
	body := io.LimitReader(response.Body, 1<<16)
	if response.StatusCode != http.StatusOK {
		var envelope struct {
			Code string `json:"code"`
		}
		_ = json.NewDecoder(body).Decode(&envelope)
		if envelope.Code == "source-migration.not-running" {
			return Issued{}, ErrMigrationNotRunning
		}
		return Issued{}, fmt.Errorf("github: the migration's token: %s %s", response.Status, envelope.Code)
	}
	var issued contracts.RunnerSourceMigrationGithubToken
	if err := json.NewDecoder(body).Decode(&issued); err != nil {
		return Issued{}, errors.New("github: the migration's token: an unreadable reply")
	}
	return Issued{Token: issued.Token, ExpiresAt: issued.ExpiresAt}, nil
}

// Token is a migration's token kept and renewed as a Session's is.
func (m MigrationTokens) Token(migrationID string) *SessionToken {
	return &SessionToken{Fetch: func(ctx context.Context) (Issued, error) { return m.Fetch(ctx, migrationID) }}
}
