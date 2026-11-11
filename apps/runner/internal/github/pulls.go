// Package github is what the Runner reads from api.github.com itself, with the
// Session's token (ADR 0002): the facts of an Étape's PR that a Contrat's `pr`
// rules check.
package github

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat/target"
)

// API is GitHub's REST API.
const API = "https://api.github.com"

// TokenSource gives the current token of the Session's repository (RUNNER-10
// renews it); it is never stored nor logged.
type TokenSource interface {
	Token(ctx context.Context) (string, error)
}

// Client reads from GitHub's REST API.
type Client struct {
	// BaseURL is API unless a test points it at a fake.
	BaseURL string
	// HTTP is http.DefaultClient's equivalent, with a timeout, when nil.
	HTTP   *http.Client
	Tokens TokenSource
}

var repository = regexp.MustCompile(`^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$`)

type pull struct {
	Body *string `json:"body"`
	Base struct {
		Ref string `json:"ref"`
	} `json:"base"`
	Head struct {
		Ref string `json:"ref"`
		SHA string `json:"sha"`
	} `json:"head"`
	Labels []struct {
		Name string `json:"name"`
	} `json:"labels"`
}

// PullRequest is the PR `number` of `repo` (`owner/name`): its base and head
// branches, body, labels and head commit.
func (c *Client) PullRequest(ctx context.Context, repo string, number int) (*target.PullRequest, error) {
	if !repository.MatchString(repo) || strings.Contains(repo, "..") {
		return nil, fmt.Errorf("github: %q is not owner/name", repo)
	}
	token, err := c.Tokens.Token(ctx)
	if err != nil {
		return nil, fmt.Errorf("github: the Session's token: %w", err)
	}
	base := c.BaseURL
	if base == "" {
		base = API
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/repos/%s/pulls/%d", strings.TrimSuffix(base, "/"), repo, number), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	client := c.HTTP
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("github: PR %s#%d: %w", repo, number, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<16))
		return nil, fmt.Errorf("github: PR %s#%d: %s", repo, number, response.Status)
	}
	var p pull
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<22)).Decode(&p); err != nil {
		return nil, fmt.Errorf("github: PR %s#%d: %w", repo, number, err)
	}
	pr := &target.PullRequest{Base: p.Base.Ref, Head: p.Head.Ref, HeadSHA: p.Head.SHA, Labels: []string{}}
	if p.Body != nil {
		pr.Body = *p.Body
	}
	for _, label := range p.Labels {
		pr.Labels = append(pr.Labels, label.Name)
	}
	return pr, nil
}
