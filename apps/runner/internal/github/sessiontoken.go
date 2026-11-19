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
	"sync"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contracts"
)

// RenewBefore is how long before its expiry a Session's token is renewed.
const RenewBefore = 10 * time.Minute

// ErrSessionEnded is the token of a Session that ended: none.
var ErrSessionEnded = errors.New("github: the Session ended")

// ErrNoRepository is the server's answer for a Session whose Projet has no
// repository it reaches (`sessions.no-repository`): a Local Projet, or a
// Projet without a Dépôt GitHub; the Session runs without a token.
var ErrNoRepository = errors.New("github: the Session's Projet has no repository the server reaches")

// Issued is a Session's token and when it expires.
type Issued struct {
	Token     string
	ExpiresAt time.Time
}

// SessionToken is one Session's GitHub token (RUNNER-10, ADR 0002): fetched
// at its first use, kept in memory only, renewed once less than RenewBefore
// is left, until End. The askpass and the gh shim ask it at each call, so a
// renewal reaches the agents that run long.
type SessionToken struct {
	// Fetch asks the server for a new token of the Session.
	Fetch func(ctx context.Context) (Issued, error)
	// Now is time.Now unless a test moves it.
	Now func() time.Time

	mu      sync.Mutex
	current Issued
	ended   bool
}

// Token is the current token: the one kept while more than RenewBefore is
// left, else a new one; the one kept, still valid, when that renewal fails.
func (s *SessionToken) Token(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ended {
		return "", ErrSessionEnded
	}
	now := s.now()
	if s.current.Token != "" && now.Before(s.current.ExpiresAt.Add(-RenewBefore)) {
		return s.current.Token, nil
	}
	issued, err := s.Fetch(ctx)
	if err == nil && issued.Token == "" {
		err = errors.New("github: the server gave an empty token")
	}
	if err != nil {
		if s.current.Token != "" && now.Before(s.current.ExpiresAt) {
			return s.current.Token, nil
		}
		return "", err
	}
	s.current = issued
	return issued.Token, nil
}

// End forgets the token: the Session ended, or stopped, it gives none again.
func (s *SessionToken) End() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ended, s.current = true, Issued{}
}

func (s *SessionToken) now() time.Time {
	if s.Now == nil {
		return time.Now()
	}
	return s.Now()
}

// ServerTokens asks the server for the Sessions' tokens with the Runner's
// token (`POST /api/runner/sessions/:id/github-token`).
type ServerTokens struct {
	Server      string
	RunnerToken string
	// HTTP has a 30 s timeout when nil.
	HTTP *http.Client
}

// Fetch is the Session's new token; an error names the server's code, never
// a token.
func (s ServerTokens) Fetch(ctx context.Context, sessionID string) (Issued, error) {
	endpoint := strings.TrimSuffix(s.Server, "/") + "/api/runner/sessions/" + url.PathEscape(sessionID) + "/github-token"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, nil)
	if err != nil {
		return Issued{}, err
	}
	request.Header.Set("Authorization", "Bearer "+s.RunnerToken)
	client := s.HTTP
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return Issued{}, fmt.Errorf("github: the Session's token: %w", err)
	}
	defer response.Body.Close()
	body := io.LimitReader(response.Body, 1<<16)
	if response.StatusCode != http.StatusOK {
		var envelope struct {
			Code string `json:"code"`
		}
		_ = json.NewDecoder(body).Decode(&envelope)
		if envelope.Code == "sessions.no-repository" {
			return Issued{}, ErrNoRepository
		}
		return Issued{}, fmt.Errorf("github: the Session's token: %s %s", response.Status, envelope.Code)
	}
	var issued contracts.RunnerSessionGithubToken
	if err := json.NewDecoder(body).Decode(&issued); err != nil {
		return Issued{}, errors.New("github: the Session's token: an unreadable reply")
	}
	return Issued{Token: issued.Token, ExpiresAt: issued.ExpiresAt}, nil
}
