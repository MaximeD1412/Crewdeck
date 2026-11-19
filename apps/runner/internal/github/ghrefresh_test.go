package github_test

import (
	"testing"

	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
)

func TestNamedSaysWhatAGhCommandChanged(t *testing.T) {
	cases := []struct {
		name   string
		args   []string
		stdout string
		want   github.Refresh
	}{
		// The writes that name their object.
		{"issue close", []string{"issue", "close", "12"}, "", github.Refresh{Number: 12}},
		{"issue comment #n", []string{"issue", "comment", "#12", "--body", "x"}, "", github.Refresh{Number: 12}},
		{"flags before the number", []string{"issue", "edit", "--add-label", "bug", "-R", "acme/shop", "8"}, "", github.Refresh{Number: 8, Repository: "acme/shop"}},
		{"--repo=", []string{"pr", "review", "--repo=acme/shop", "--approve", "9"}, "", github.Refresh{Number: 9, Repository: "acme/shop"}},
		{"pr merge of a URL", []string{"pr", "merge", "https://github.com/o/r/pull/7"}, "", github.Refresh{Number: 7, Repository: "o/r"}},
		{"issue reopen of a URL", []string{"issue", "reopen", "https://github.com/o/r/issues/4"}, "", github.Refresh{Number: 4, Repository: "o/r"}},
		{"pr ready of a branch", []string{"pr", "ready", "feat/3-x"}, "", github.Refresh{Branch: "feat/3-x"}},
		{"pr comment of no argument: the current branch's PR", []string{"pr", "comment", "--body", "x"}, "", github.Refresh{All: true}},
		{"issue develop", []string{"issue", "develop", "5", "--name", "feat/5-x"}, "", github.Refresh{Number: 5}},
		{"issue transfer", []string{"issue", "transfer", "5", "acme/autre"}, "", github.Refresh{Number: 5}},
		{"issue lock", []string{"issue", "lock", "5"}, "", github.Refresh{Number: 5}},
		{"pr delete is not gh's but issue delete is", []string{"issue", "delete", "5", "--yes"}, "", github.Refresh{Number: 5}},
		{"--repo before the group", []string{"--repo", "acme/shop", "issue", "comment", "12", "--body", "x"}, "", github.Refresh{Number: 12, Repository: "acme/shop"}},
		{"-R before the verb", []string{"issue", "-R", "acme/shop", "comment", "12", "--body", "x"}, "", github.Refresh{Number: 12, Repository: "acme/shop"}},
		{"--repo= before the group", []string{"--repo=acme/shop", "pr", "--repo=acme/shop", "merge", "7"}, "", github.Refresh{Number: 7, Repository: "acme/shop"}},
		{"-Racme/shop before a label's verb", []string{"label", "-Racme/shop", "create", "urgent"}, "", github.Refresh{All: true, Repository: "acme/shop"}},
		{"--repo before a read", []string{"--repo", "acme/shop", "issue", "view", "12"}, "", github.Refresh{None: true}},
		// The creations: the URL they print last.
		{"issue create", []string{"issue", "create", "--title", "t", "--body", "b"}, "Creating issue in acme/shop\n\nhttps://github.com/acme/shop/issues/31\n", github.Refresh{Number: 31, Repository: "acme/shop"}},
		{"pr create", []string{"pr", "create", "--fill"}, "https://github.com/acme/shop/pull/32\n", github.Refresh{Number: 32, Repository: "acme/shop"}},
		{"issue create printing nothing", []string{"issue", "create", "--title", "t"}, "", github.Refresh{All: true}},
		// The labels: every object may carry them.
		{"label create", []string{"label", "create", "bug"}, "", github.Refresh{All: true}},
		{"label delete", []string{"label", "delete", "bug", "--yes"}, "", github.Refresh{All: true}},
		// The API.
		{"api POST on an issue", []string{"api", "-X", "POST", "repos/o/r/issues/5/labels", "-f", "labels[]=bug"}, "", github.Refresh{Number: 5, Repository: "o/r"}},
		{"api --method PATCH on a PR", []string{"api", "--method", "PATCH", "/repos/o/r/pulls/6"}, "", github.Refresh{Number: 6, Repository: "o/r"}},
		{"api -XPOST", []string{"api", "-XPOST", "repos/o/r/pulls/6/reviews"}, "", github.Refresh{Number: 6, Repository: "o/r"}},
		{"api --method=DELETE on an issue's comment", []string{"api", "--method=DELETE", "repos/o/r/issues/comments/99"}, "", github.Refresh{All: true, Repository: "o/r"}},
		{"api graphql mutation", []string{"api", "graphql", "-f", "query=mutation { addComment(input: {}) { clientMutationId } }"}, "", github.Refresh{All: true}},
		{"api graphql mutation, the flag joined", []string{"api", "graphql", "-fquery=mutation M { x }"}, "", github.Refresh{All: true}},
		{"api with a field: gh's POST", []string{"api", "repos/o/r/issues/5/comments", "-f", "body=x"}, "", github.Refresh{Number: 5, Repository: "o/r"}},
		// The reads.
		{"issue view", []string{"issue", "view", "12"}, "", github.Refresh{None: true}},
		{"pr list", []string{"pr", "list"}, "", github.Refresh{None: true}},
		{"pr checks", []string{"pr", "checks", "7"}, "", github.Refresh{None: true}},
		{"pr diff", []string{"pr", "diff", "7"}, "", github.Refresh{None: true}},
		{"issue status", []string{"issue", "status"}, "", github.Refresh{None: true}},
		{"api GET", []string{"api", "repos/o/r/pulls"}, "", github.Refresh{None: true}},
		{"api -X GET with a field", []string{"api", "-X", "GET", "repos/o/r/issues", "-f", "state=all"}, "", github.Refresh{None: true}},
		{"api graphql query", []string{"api", "graphql", "-f", "query=query { viewer { login } }"}, "", github.Refresh{None: true}},
		{"label list", []string{"label", "list"}, "", github.Refresh{None: true}},
		{"repo view", []string{"repo", "view"}, "", github.Refresh{None: true}},
		{"no command", nil, "", github.Refresh{None: true}},
		{"help", []string{"issue", "close", "--help"}, "", github.Refresh{None: true}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := github.Named(c.args, c.stdout); got != c.want {
				t.Errorf("Named(%q, %q) = %+v, want %+v", c.args, c.stdout, got, c.want)
			}
		})
	}
}
