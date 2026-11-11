package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/maximed1412/crewdeck/apps/runner/internal/contrat"
	"github.com/maximed1412/crewdeck/apps/runner/internal/github"
	"github.com/spf13/cobra"
)

// newContratCommand is `crewdeck-runner contrat check`, hidden: it checks a
// folder (and a PR) against an embedded Contrat and prints the verdict as
// JSON, for debugging a Contrat and for the tests. A Session's check is
// RUNNER-12's, with the Session's token.
func newContratCommand() *cobra.Command {
	command := &cobra.Command{
		Use:    "contrat",
		Short:  "Check an Étape's output against its Contrat",
		Hidden: true,
		Args:   cobra.NoArgs,
	}
	var (
		dir, repo, integration, api string
		number                      int
	)
	check := &cobra.Command{
		Use:   "check <contractId>",
		Short: "Print the verdict of a folder, and of a PR, against an embedded Contrat",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := contrat.Get(args[0])
			if err != nil {
				return fmt.Errorf("Ce Runner n’a pas de Contrat %s.", args[0])
			}
			target := contrat.Target{Dir: dir, IntegrationBranch: integration}
			if number != 0 {
				if repo == "" {
					return errors.New("--pr va avec --repo <owner/name>.")
				}
				client := &github.Client{BaseURL: api, Tokens: envToken{}}
				if target.PR, err = client.PullRequest(cmd.Context(), repo, number); err != nil {
					return err
				}
			}
			verdict, err := contrat.Check(cmd.Context(), c, target)
			if err != nil {
				return err
			}
			out := json.NewEncoder(cmd.OutOrStdout())
			out.SetIndent("", "  ")
			return out.Encode(verdict)
		},
	}
	check.Flags().StringVar(&dir, "dir", "", "the Étape's worktree")
	check.Flags().IntVar(&number, "pr", 0, "the number of the Étape's PR")
	check.Flags().StringVar(&repo, "repo", "", "the PR's repository, owner/name")
	check.Flags().StringVar(&integration, "integration", "develop", "the Projet's integration branch, for base: integration")
	check.Flags().StringVar(&api, "github-api", github.API, "GitHub's REST API")
	_ = check.Flags().MarkHidden("github-api")
	_ = check.MarkFlagRequired("dir")
	command.AddCommand(check)
	return command
}

// envToken is the token of GH_TOKEN, else GITHUB_TOKEN: the debug command has no Session.
type envToken struct{}

func (envToken) Token(context.Context) (string, error) {
	for _, name := range []string{"GH_TOKEN", "GITHUB_TOKEN"} {
		if token := os.Getenv(name); token != "" {
			return token, nil
		}
	}
	return "", errors.New("--pr lit GitHub avec le jeton de GH_TOKEN ou GITHUB_TOKEN.")
}
