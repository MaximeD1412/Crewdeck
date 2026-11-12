package mirror

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
)

// The fetch's errors; none carries a body GitHub answered.
var (
	// ErrRefused is GitHub refusing the token (401, 403 without a rate
	// limit), or a repository the token cannot see.
	ErrRefused = errors.New("mirror: GitHub refused the token")
	// ErrUnavailable is GitHub down (5xx) or unreachable.
	ErrUnavailable = errors.New("mirror: GitHub unavailable")
	// ErrGone is an object GitHub no longer has (deleted, transferred): the
	// caller deletes it from the copy.
	ErrGone = errors.New("mirror: gone from GitHub")
)

// LimitedError is GitHub's rate limit: no request before RetryAt.
type LimitedError struct {
	RetryAt time.Time
}

func (e *LimitedError) Error() string {
	return "mirror: GitHub limits the requests until " + e.RetryAt.UTC().Format(time.RFC3339)
}

// Client reads GitHub's GraphQL API, with the token of each repository.
type Client struct {
	// BaseURL is github.API unless a test points it at a fake; GraphQL is at BaseURL + "/graphql".
	BaseURL string
	// HTTP is a client with a timeout when nil.
	HTTP *http.Client
	// Tokens gives the token source of a repository (the « Miroir » token of its installation).
	Tokens func(repository string) github.TokenSource
	// Logger gets a debug line per request: its operation, repository, status and duration.
	Logger *slog.Logger
	// Now is time.Now unless a test fixes it.
	Now func() time.Time
}

// pageSize is GitHub's maximum for a connection.
const pageSize = 100

const pageInfo = "pageInfo { hasNextPage endCursor }"

var repositoryName = regexp.MustCompile(`^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$`)

func splitRepository(repository string) (string, string, error) {
	if !repositoryName.MatchString(repository) || strings.Contains(repository, "..") {
		return "", "", fmt.Errorf("mirror: %q is not owner/name", repository)
	}
	owner, name, _ := strings.Cut(repository, "/")
	return owner, name, nil
}

func (c *Client) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

type graphQLError struct {
	Type string `json:"type"`
}

// graphql posts one operation and returns its data.
func (c *Client) graphql(ctx context.Context, repository, operation, query string, variables map[string]any) (json.RawMessage, error) {
	token, err := c.Tokens(repository).Token(ctx)
	if err != nil {
		return nil, fmt.Errorf("mirror: %s: the token: %w", repository, err)
	}
	payload, err := json.Marshal(map[string]any{"query": query, "operationName": operation, "variables": variables})
	if err != nil {
		return nil, err
	}
	base := c.BaseURL
	if base == "" {
		base = github.API
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimSuffix(base, "/")+"/graphql", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	client := c.HTTP
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	started := c.now()
	response, err := client.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%w: %s, %s", ErrUnavailable, operation, repository)
	}
	defer response.Body.Close()
	if c.Logger != nil {
		c.Logger.Debug("github graphql", "operation", operation, "repository", repository, "status", response.StatusCode, "duration_ms", c.now().Sub(started).Milliseconds())
	}
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1<<16))
		return nil, c.statusError(response, operation, repository)
	}
	var answer struct {
		Data   json.RawMessage `json:"data"`
		Errors []graphQLError  `json:"errors"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 64<<20)).Decode(&answer); err != nil {
		return nil, fmt.Errorf("%w: %s, %s: an answer that is not JSON", ErrUnavailable, operation, repository)
	}
	for _, e := range answer.Errors {
		switch e.Type {
		case "RATE_LIMITED":
			return nil, &LimitedError{RetryAt: c.retryAt(response.Header)}
		case "NOT_FOUND":
			// A null in data: the caller tells a repository it cannot see from an object gone.
		case "FORBIDDEN":
			return nil, fmt.Errorf("%w: %s, %s", ErrRefused, operation, repository)
		default:
			return nil, fmt.Errorf("mirror: %s, %s: GitHub's GraphQL error %q", operation, repository, e.Type)
		}
	}
	return answer.Data, nil
}

func (c *Client) statusError(response *http.Response, operation, repository string) error {
	limited := response.Header.Get("Retry-After") != "" || response.Header.Get("X-RateLimit-Remaining") == "0"
	switch {
	case (response.StatusCode == http.StatusForbidden || response.StatusCode == http.StatusTooManyRequests) && limited:
		return &LimitedError{RetryAt: c.retryAt(response.Header)}
	case response.StatusCode == http.StatusTooManyRequests:
		return &LimitedError{RetryAt: c.retryAt(response.Header)}
	case response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden:
		return fmt.Errorf("%w: %s, %s: %d", ErrRefused, operation, repository, response.StatusCode)
	case response.StatusCode >= 500:
		return fmt.Errorf("%w: %s, %s: %d", ErrUnavailable, operation, repository, response.StatusCode)
	default:
		return fmt.Errorf("mirror: %s, %s: GitHub answered %d", operation, repository, response.StatusCode)
	}
}

// retryAt is when GitHub lets the next request through: Retry-After, else
// X-RateLimit-Reset, else in a minute.
func (c *Client) retryAt(header http.Header) time.Time {
	if seconds, err := strconv.Atoi(header.Get("Retry-After")); err == nil && seconds >= 0 {
		return c.now().Add(time.Duration(seconds) * time.Second)
	}
	if epoch, err := strconv.ParseInt(header.Get("X-RateLimit-Reset"), 10, 64); err == nil {
		return time.Unix(epoch, 0)
	}
	return c.now().Add(time.Minute)
}

type connection[T any] struct {
	PageInfo struct {
		HasNextPage bool   `json:"hasNextPage"`
		EndCursor   string `json:"endCursor"`
	} `json:"pageInfo"`
	Nodes []T `json:"nodes"`
}

// descend follows path in data to a connection. A null `repository` is a
// repository the token cannot see; another null is an object gone, unless its
// key ends with "?": then the connection is empty.
func descend(data json.RawMessage, path []string) (json.RawMessage, error) {
	for _, key := range path {
		optional := strings.HasSuffix(key, "?")
		key = strings.TrimSuffix(key, "?")
		var object map[string]json.RawMessage
		if err := json.Unmarshal(data, &object); err != nil {
			return nil, fmt.Errorf("mirror: an answer without %s", key)
		}
		data = object[key]
		if len(data) == 0 || string(data) == "null" {
			switch {
			case optional:
				return nil, nil
			case key == "repository":
				return nil, ErrRefused
			default:
				return nil, ErrGone
			}
		}
	}
	return data, nil
}

// pages reads the connection at path of operation, from the page after
// `after` ("" for the first) to the last.
func pages[T any](ctx context.Context, c *Client, repository, operation, query string, variables map[string]any, path []string, after string) ([]T, error) {
	var nodes []T
	for {
		vars := map[string]any{}
		for k, v := range variables {
			vars[k] = v
		}
		if after != "" {
			vars["after"] = after
		} else {
			vars["after"] = nil
		}
		data, err := c.graphql(ctx, repository, operation, query, vars)
		if err != nil {
			return nil, err
		}
		raw, err := descend(data, path)
		if err != nil || raw == nil {
			return nodes, err
		}
		var page connection[T]
		if err := json.Unmarshal(raw, &page); err != nil {
			return nil, fmt.Errorf("mirror: %s, %s: an answer of another shape", operation, repository)
		}
		nodes = append(nodes, page.Nodes...)
		if !page.PageInfo.HasNextPage || page.PageInfo.EndCursor == "" {
			return nodes, nil
		}
		after = page.PageInfo.EndCursor
	}
}

// complete returns first's nodes followed by those of its later pages.
func complete[T any](ctx context.Context, c *Client, repository, operation, query string, variables map[string]any, path []string, first connection[T]) ([]T, error) {
	if !first.PageInfo.HasNextPage {
		return first.Nodes, nil
	}
	rest, err := pages[T](ctx, c, repository, operation, query, variables, path, first.PageInfo.EndCursor)
	if err != nil {
		return nil, err
	}
	return append(first.Nodes, rest...), nil
}

// The selections of an object's connections.
const (
	labelsSelection        = "name"
	assigneesSelection     = "login"
	commentsSelection      = "id author { login } body url createdAt updatedAt"
	refSelection           = "number repository { nameWithOwner }"
	commitsSelection       = "commit { oid message }"
	reviewsSelection       = "id author { login } state body commit { oid } submittedAt"
	reviewCommentSelection = "id author { login } body path line createdAt pullRequestReview { id }"
	threadsSelection       = "id comments(first: 100) { " + pageInfo + " nodes { " + reviewCommentSelection + " } }"
)

func connectionField(field, selection, after string) string {
	return fmt.Sprintf("%s(first: %d%s) { %s nodes { %s } }", field, pageSize, after, pageInfo, selection)
}

// An issue's state and a PR's are of two enums: GraphQL refuses one response
// name for both, even in exclusive fragments, so each has its alias.
var issueFields = strings.Join([]string{
	"number title body issueState: state stateReason url createdAt updatedAt closedAt author { login } milestone { number }",
	connectionField("labels", labelsSelection, ""),
	connectionField("assignees", assigneesSelection, ""),
	connectionField("comments", commentsSelection, ""),
	"parent { " + refSelection + " }",
	connectionField("subIssues", refSelection, ""),
	connectionField("blockedBy", refSelection, ""),
}, " ")

var pullFields = strings.Join([]string{
	"number title body pullState: state url createdAt updatedAt closedAt mergedAt author { login } milestone { number }",
	connectionField("labels", labelsSelection, ""),
	connectionField("assignees", assigneesSelection, ""),
	connectionField("comments", commentsSelection, ""),
	"headRefName headRefOid baseRefName isDraft mergeable mergeCommit { oid } statusCheckRollup { state }",
	connectionField("closingIssuesReferences", refSelection, ""),
	connectionField("commits", commitsSelection, ""),
	connectionField("reviews", reviewsSelection, ""),
	connectionField("reviewThreads", threadsSelection, ""),
}, " ")

var objectQuery = "query MirrorObject($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { issueOrPullRequest(number: $number) { __typename ... on Issue { " +
	issueFields + " } ... on PullRequest { " + pullFields + " } } } }"

// objectPage is the paged query completing one of an object's connections.
type objectPage struct {
	operation string
	query     string
}

func newObjectPage(operation, field, selection string, types ...string) objectPage {
	var fragments []string
	for _, t := range types {
		fragments = append(fragments, "... on "+t+" { page: "+connectionField(field, selection, ", after: $after")+" }")
	}
	return objectPage{
		operation: operation,
		query: "query " + operation + "($owner: String!, $name: String!, $number: Int!, $after: String) { repository(owner: $owner, name: $name) { issueOrPullRequest(number: $number) { " +
			strings.Join(fragments, " ") + " } } }",
	}
}

var (
	labelsPage        = newObjectPage("MirrorObjectLabels", "labels", labelsSelection, "Issue", "PullRequest")
	assigneesPage     = newObjectPage("MirrorObjectAssignees", "assignees", assigneesSelection, "Issue", "PullRequest")
	commentsPage      = newObjectPage("MirrorObjectComments", "comments", commentsSelection, "Issue", "PullRequest")
	subIssuesPage     = newObjectPage("MirrorObjectSubIssues", "subIssues", refSelection, "Issue")
	blockedByPage     = newObjectPage("MirrorObjectBlockedBy", "blockedBy", refSelection, "Issue")
	closingIssuesPage = newObjectPage("MirrorObjectClosingIssues", "closingIssuesReferences", refSelection, "PullRequest")
	commitsPage       = newObjectPage("MirrorObjectCommits", "commits", commitsSelection, "PullRequest")
	reviewsPage       = newObjectPage("MirrorObjectReviews", "reviews", reviewsSelection, "PullRequest")
	threadsPage       = newObjectPage("MirrorObjectReviewThreads", "reviewThreads", threadsSelection, "PullRequest")
)

var objectPagePath = []string{"repository", "issueOrPullRequest", "page"}

const threadCommentsQuery = "query MirrorThreadComments($id: ID!, $after: String) { node(id: $id) { ... on PullRequestReviewThread { page: comments(first: 100, after: $after) { " +
	pageInfo + " nodes { " + reviewCommentSelection + " } } } } }"

type actor struct {
	Login string `json:"login"`
}

func login(a *actor) string {
	if a == nil {
		return ""
	}
	return a.Login
}

type refNode struct {
	Number     int `json:"number"`
	Repository struct {
		NameWithOwner string `json:"nameWithOwner"`
	} `json:"repository"`
}

type commentNode struct {
	ID        string `json:"id"`
	Author    *actor `json:"author"`
	Body      string `json:"body"`
	URL       string `json:"url"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type reviewNode struct {
	ID     string `json:"id"`
	Author *actor `json:"author"`
	State  string `json:"state"`
	Body   string `json:"body"`
	Commit *struct {
		Oid string `json:"oid"`
	} `json:"commit"`
	SubmittedAt string `json:"submittedAt"`
}

type reviewCommentNode struct {
	ID                string `json:"id"`
	Author            *actor `json:"author"`
	Body              string `json:"body"`
	Path              string `json:"path"`
	Line              *int   `json:"line"`
	CreatedAt         string `json:"createdAt"`
	PullRequestReview *struct {
		ID string `json:"id"`
	} `json:"pullRequestReview"`
}

type threadNode struct {
	ID       string                        `json:"id"`
	Comments connection[reviewCommentNode] `json:"comments"`
}

type objectNode struct {
	Typename    string `json:"__typename"`
	Number      int    `json:"number"`
	Title       string `json:"title"`
	Body        string `json:"body"`
	IssueState  string `json:"issueState"`
	PullState   string `json:"pullState"`
	StateReason string `json:"stateReason"`
	URL         string `json:"url"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
	ClosedAt    string `json:"closedAt"`
	Author      *actor `json:"author"`
	Milestone   *struct {
		Number int `json:"number"`
	} `json:"milestone"`
	Labels    connection[struct{ Name string }]  `json:"labels"`
	Assignees connection[struct{ Login string }] `json:"assignees"`
	Comments  connection[commentNode]            `json:"comments"`
	Parent    *refNode                           `json:"parent"`
	SubIssues connection[refNode]                `json:"subIssues"`
	BlockedBy connection[refNode]                `json:"blockedBy"`

	MergedAt    string `json:"mergedAt"`
	HeadRefName string `json:"headRefName"`
	HeadRefOid  string `json:"headRefOid"`
	BaseRefName string `json:"baseRefName"`
	IsDraft     bool   `json:"isDraft"`
	Mergeable   string `json:"mergeable"`
	MergeCommit *struct {
		Oid string `json:"oid"`
	} `json:"mergeCommit"`
	StatusCheckRollup *struct {
		State string `json:"state"`
	} `json:"statusCheckRollup"`
	ClosingIssuesReferences connection[refNode]                                        `json:"closingIssuesReferences"`
	Commits                 connection[struct{ Commit struct{ Oid, Message string } }] `json:"commits"`
	Reviews                 connection[reviewNode]                                     `json:"reviews"`
	ReviewThreads           connection[threadNode]                                     `json:"reviewThreads"`
}

// FetchObject reads the issue or PR `number` of repository with everything
// the Miroir keeps of it; ErrGone when GitHub no longer has it.
func (c *Client) FetchObject(ctx context.Context, repository string, number int) (Object, error) {
	owner, name, err := splitRepository(repository)
	if err != nil {
		return Object{}, err
	}
	variables := map[string]any{"owner": owner, "name": name, "number": number}
	data, err := c.graphql(ctx, repository, "MirrorObject", objectQuery, variables)
	if err != nil {
		return Object{}, err
	}
	raw, err := descend(data, []string{"repository", "issueOrPullRequest"})
	if err != nil {
		return Object{}, fmt.Errorf("%w: %s#%d", err, repository, number)
	}
	var node objectNode
	if err := json.Unmarshal(raw, &node); err != nil {
		return Object{}, fmt.Errorf("mirror: %s#%d: an answer of another shape", repository, number)
	}
	o := Object{
		Repository: repository, Number: number, IsPull: node.Typename == "PullRequest",
		Title: node.Title, Body: node.Body, State: node.IssueState + node.PullState, StateReason: node.StateReason, URL: node.URL,
		Author: login(node.Author), CreatedAt: node.CreatedAt, UpdatedAt: node.UpdatedAt, ClosedAt: node.ClosedAt,
	}
	if node.Milestone != nil {
		o.Milestone = node.Milestone.Number
	}
	labels, err := completePage(ctx, c, repository, labelsPage, variables, node.Labels)
	if err != nil {
		return Object{}, err
	}
	for _, l := range labels {
		o.Labels = append(o.Labels, l.Name)
	}
	assignees, err := completePage(ctx, c, repository, assigneesPage, variables, node.Assignees)
	if err != nil {
		return Object{}, err
	}
	for _, a := range assignees {
		o.Assignees = append(o.Assignees, a.Login)
	}
	comments, err := completePage(ctx, c, repository, commentsPage, variables, node.Comments)
	if err != nil {
		return Object{}, err
	}
	for _, cm := range comments {
		o.Comments = append(o.Comments, Comment{ID: cm.ID, Author: login(cm.Author), Body: cm.Body, URL: cm.URL, CreatedAt: cm.CreatedAt, UpdatedAt: cm.UpdatedAt})
	}
	if !o.IsPull {
		return o, c.issueRelations(ctx, &o, node, variables)
	}
	return o, c.pullParts(ctx, &o, node, variables)
}

// completePage completes the object's connection first with the paged query p.
func completePage[T any](ctx context.Context, c *Client, repository string, p objectPage, variables map[string]any, first connection[T]) ([]T, error) {
	return complete(ctx, c, repository, p.operation, p.query, variables, objectPagePath, first)
}

func (c *Client) issueRelations(ctx context.Context, o *Object, node objectNode, variables map[string]any) error {
	if node.Parent != nil && strings.EqualFold(node.Parent.Repository.NameWithOwner, o.Repository) {
		o.Parent = node.Parent.Number
	}
	children, err := completePage(ctx, c, o.Repository, subIssuesPage, variables, node.SubIssues)
	if err != nil {
		return err
	}
	for _, child := range children {
		// The schema keeps the sub-issues of one repository.
		if strings.EqualFold(child.Repository.NameWithOwner, o.Repository) {
			o.SubIssues = append(o.SubIssues, child.Number)
		}
	}
	blockers, err := completePage(ctx, c, o.Repository, blockedByPage, variables, node.BlockedBy)
	if err != nil {
		return err
	}
	for _, b := range blockers {
		o.BlockedBy = append(o.BlockedBy, Ref{Repository: b.Repository.NameWithOwner, Number: b.Number})
	}
	return nil
}

func (c *Client) pullParts(ctx context.Context, o *Object, node objectNode, variables map[string]any) error {
	p := &Pull{HeadRef: node.HeadRefName, HeadOid: node.HeadRefOid, BaseRef: node.BaseRefName, IsDraft: node.IsDraft, Mergeable: node.Mergeable, MergedAt: node.MergedAt}
	o.Pull = p
	if node.MergeCommit != nil {
		p.MergeCommit = node.MergeCommit.Oid
	}
	if node.StatusCheckRollup != nil {
		p.ChecksState = node.StatusCheckRollup.State
	}
	closing, err := completePage(ctx, c, o.Repository, closingIssuesPage, variables, node.ClosingIssuesReferences)
	if err != nil {
		return err
	}
	for _, ref := range closing {
		p.ClosingIssues = append(p.ClosingIssues, Ref{Repository: ref.Repository.NameWithOwner, Number: ref.Number})
	}
	commits, err := completePage(ctx, c, o.Repository, commitsPage, variables, node.Commits)
	if err != nil {
		return err
	}
	for _, cm := range commits {
		p.Commits = append(p.Commits, Commit{Oid: cm.Commit.Oid, Message: cm.Commit.Message})
	}
	reviews, err := completePage(ctx, c, o.Repository, reviewsPage, variables, node.Reviews)
	if err != nil {
		return err
	}
	for _, r := range reviews {
		review := Review{ID: r.ID, Author: login(r.Author), State: r.State, Body: r.Body, SubmittedAt: r.SubmittedAt}
		if r.Commit != nil {
			review.CommitOid = r.Commit.Oid
		}
		p.Reviews = append(p.Reviews, review)
	}
	threads, err := completePage(ctx, c, o.Repository, threadsPage, variables, node.ReviewThreads)
	if err != nil {
		return err
	}
	for _, thread := range threads {
		comments, err := complete(ctx, c, o.Repository, "MirrorThreadComments", threadCommentsQuery, map[string]any{"id": thread.ID}, []string{"node", "page"}, thread.Comments)
		if err != nil {
			return err
		}
		for _, cm := range comments {
			comment := ReviewComment{ID: cm.ID, Author: login(cm.Author), Body: cm.Body, Path: cm.Path, CreatedAt: cm.CreatedAt}
			if cm.Line != nil {
				comment.Line = *cm.Line
			}
			if cm.PullRequestReview != nil {
				comment.ReviewID = cm.PullRequestReview.ID
			}
			p.ReviewComments = append(p.ReviewComments, comment)
		}
	}
	return nil
}

const checksQuery = "query MirrorChecks($owner: String!, $name: String!, $oid: GitObjectID!, $after: String) { repository(owner: $owner, name: $name) { object(oid: $oid) { ... on Commit { statusCheckRollup { " +
	"contexts(first: 100, after: $after) { " + pageInfo + " nodes { __typename " +
	"... on CheckRun { name status conclusion detailsUrl startedAt completedAt } " +
	"... on StatusContext { context state targetUrl createdAt } } } } } } } }"

type contextNode struct {
	Typename    string `json:"__typename"`
	Name        string `json:"name"`
	Status      string `json:"status"`
	Conclusion  string `json:"conclusion"`
	DetailsURL  string `json:"detailsUrl"`
	StartedAt   string `json:"startedAt"`
	CompletedAt string `json:"completedAt"`
	Context     string `json:"context"`
	State       string `json:"state"`
	TargetURL   string `json:"targetUrl"`
	CreatedAt   string `json:"createdAt"`
}

// FetchChecks reads the check runs and commit statuses of the commit sha;
// none when it has no check, ErrGone when GitHub does not have the commit.
func (c *Client) FetchChecks(ctx context.Context, repository, sha string) ([]Check, error) {
	owner, name, err := splitRepository(repository)
	if err != nil {
		return nil, err
	}
	nodes, err := pages[contextNode](ctx, c, repository, "MirrorChecks", checksQuery, map[string]any{"owner": owner, "name": name, "oid": sha},
		[]string{"repository", "object", "statusCheckRollup?", "contexts"}, "")
	if err != nil {
		return nil, fmt.Errorf("%w: the checks of %s in %s", err, sha, repository)
	}
	checks := []Check{}
	for _, n := range nodes {
		switch n.Typename {
		case "CheckRun":
			checks = append(checks, Check{Typename: n.Typename, Name: n.Name, Status: n.Status, Conclusion: n.Conclusion, DetailsURL: n.DetailsURL, StartedAt: n.StartedAt, CompletedAt: n.CompletedAt})
		case "StatusContext":
			checks = append(checks, Check{Typename: n.Typename, Name: n.Context, Conclusion: n.State, DetailsURL: n.TargetURL, StartedAt: n.CreatedAt})
		}
	}
	return checks, nil
}

// Collections are a repository's labels, milestones and releases.
type Collections struct {
	Labels     []Label
	Milestones []Milestone
	Releases   []Release
}

const (
	labelsQuery     = "query MirrorLabels($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) { labels(first: 100, after: $after) { " + pageInfo + " nodes { name color description } } } }"
	milestonesQuery = "query MirrorMilestones($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) { milestones(first: 100, after: $after, states: [OPEN, CLOSED]) { " + pageInfo + " nodes { number title state description dueOn } } } }"
	releasesQuery   = "query MirrorReleases($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) { releases(first: 100, after: $after, orderBy: {field: CREATED_AT, direction: DESC}) { " + pageInfo + " nodes { tagName name description isDraft isPrerelease createdAt publishedAt } } } }"
)

// FetchCollections reads the repository's labels, milestones and releases, all pages.
func (c *Client) FetchCollections(ctx context.Context, repository string) (Collections, error) {
	owner, name, err := splitRepository(repository)
	if err != nil {
		return Collections{}, err
	}
	variables := map[string]any{"owner": owner, "name": name}
	labels, err := pages[Label](ctx, c, repository, "MirrorLabels", labelsQuery, variables, []string{"repository", "labels"}, "")
	if err != nil {
		return Collections{}, err
	}
	milestones, err := pages[Milestone](ctx, c, repository, "MirrorMilestones", milestonesQuery, variables, []string{"repository", "milestones"}, "")
	if err != nil {
		return Collections{}, err
	}
	releases, err := pages[struct {
		TagName      string `json:"tagName"`
		Name         string `json:"name"`
		Description  string `json:"description"`
		IsDraft      bool   `json:"isDraft"`
		IsPrerelease bool   `json:"isPrerelease"`
		CreatedAt    string `json:"createdAt"`
		PublishedAt  string `json:"publishedAt"`
	}](ctx, c, repository, "MirrorReleases", releasesQuery, variables, []string{"repository", "releases"}, "")
	if err != nil {
		return Collections{}, err
	}
	out := Collections{Labels: labels, Milestones: milestones}
	for _, r := range releases {
		out.Releases = append(out.Releases, Release{Tag: r.TagName, Name: r.Name, Body: r.Description, IsDraft: r.IsDraft, IsPrerelease: r.IsPrerelease, CreatedAt: r.CreatedAt, PublishedAt: r.PublishedAt})
	}
	return out, nil
}
