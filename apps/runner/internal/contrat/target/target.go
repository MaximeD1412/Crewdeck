// Package target is what a Contrat is checked on: the Étape's worktree and
// its PR. Its own package, so that the rules and the named checks share it
// with the interpreter (ADR 0005).
package target

// Target is an Étape's output: its worktree, its PR when it opened one, and
// the Projet's integration branch, which a `pr` rule's `base: integration`
// names.
type Target struct {
	Dir               string
	PR                *PullRequest
	IntegrationBranch string
}

// PullRequest holds the facts of the Étape's PR a `pr` rule reads, from GitHub.
type PullRequest struct {
	Base    string   `json:"base"`
	Head    string   `json:"head"`
	Body    string   `json:"body"`
	Labels  []string `json:"labels"`
	HeadSHA string   `json:"headSha"`
}
