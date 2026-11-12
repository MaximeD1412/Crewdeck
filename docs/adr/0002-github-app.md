# One GitHub App for sign-in, repositories, webhooks and merges

> **Status:** accepted, 2026-11-10. Amended by [ADR 0010](0010-the-runners-miroir.md)
> on the tokens the server mints (a read-only « Miroir » token beside the
> Session's) and on the App's events (five more).

## Context

GitHub is the only code host of the MVP and the Bêta, behind a
**Connecteur** (PRD, « Constraints »). The product signs the **Pilote** in
with GitHub (US-1), follows the repositories they pick (US-3), prepares them
(US-4), learns every change in under 2 s (US-20), merges the Tickets that
pass their review (US-15) and the documents of a **Conception** the Pilote
approves (US-26). The dotfiles console's ADR 0005 kept webhooks through a
relay and said « a GitHub App: to reconsider for the commercial product ».
Agents push branches and open PRs from the Pilote's machine.

## Decision

- **One GitHub App per environment**, « Crewdeck » (prod) and « Crewdeck
  staging », created by hand (ticket `externe`). Its private key, client
  secret and webhook secret are the server's only GitHub secrets.
- **Sign-in** (US-1) is the App's user authorization (OAuth web flow). The
  user access token (8 h) and its refresh token are kept by the server,
  encrypted at rest (`GITHUB_TOKEN_KEY`); the browser gets a fresh access
  token from `POST /api/github/token` to read GitHub itself (below).
- **Following a repository** (US-3) is installing the App on it; the
  installation's repositories are the **Dépôts GitHub** the Pilote can turn
  into **Projets**.
- **Permissions**: metadata (read), contents (read and write), issues (read
  and write), pull requests (read and write), checks (read), commit statuses
  (read), workflows (write: a Ticket may change CI). No administration.
  Events: `installation`, `installation_repositories`, `issues`,
  `issue_comment`, `sub_issues`, `pull_request`, `pull_request_review`,
  `check_suite`, `check_run`, `status`, `push`.
- **Webhooks go straight to the server** (`POST /api/github/webhooks`,
  `X-Hub-Signature-256` checked in constant time, `X-GitHub-Delivery`
  deduplicated). The server is always up: no relay. A reconciliation reads
  each followed repository every 15 min and after the server starts.
- **The server acts with installation tokens** on metadata only: labels,
  branches, merges (squash), and `.process.json`, which it generates from
  the **Paramètres**. It never sends content to GitHub, as it never reads
  it: everything an agent writes (documents, the **Inventaire**, issues'
  bodies, code) is pushed by the Runner.
- **Every gate is bound to a commit.** A Review verdict, a Contrat verdict,
  the checks, the captures of a visual review and the approval of a
  document each record the PR's head SHA they judged. The server merges with
  that SHA (`sha` of the merge API, which GitHub refuses when the head
  moved); a push after a verdict voids it, and the Ticket or the document
  goes back to its review.
- **The Runner gets a token per Session**: an installation token restricted
  to the **Projet**'s repository and to contents, issues, pull requests and
  workflows (read and write), valid 1 h, renewed by the Runner while the
  Session lives. Issues because the agents read their Ticket and create the
  Tickets of a split (US-12) or of an Idée (US-56): content the server must
  not carry. Git
  pushes with it (`x-access-token`), PRs are opened by `crewdeck[bot]`. No
  `gh` sign-in is needed on the machine. The Review agent posts a review of
  kind `COMMENT` (a bot cannot approve its own PR): the verdict that lets the
  Boucle merge is Crewdeck's, not a GitHub approval.
- **What the product writes in a repository** (US-4's « Corriger », US-68's
  approved **Inventaire**), straight to the integration branch, never as a
  PR to merge (the Pilote approved it in Crewdeck already):
  - labels and branches through the API, by the server;
  - `.process.json` as one commit by the server, message `chore(crewdeck) :
    <what>`;
  - the **Inventaire** (`CONTEXT.md`, the « choix techniques », the list of
    what exists): drafted by the Runner's Session on the branch
    `crewdeck/inventaire`, read by the browser from GitHub; approving it
    merges that branch into the integration branch through the merges API
    (one merge commit by the server, which never sees the files), bound to
    the SHA the Pilote read.
  When a branch protection refuses a write, the same change goes as a PR
  and the Décision says so.
- **Approving a document of a Conception** (PRD, mockups, technical design,
  Tickets) is merging its design PR, after the product's confirmation
  (US-26): one gesture, and the repository stays the source of truth for the
  documents. « Demander des changements » posts the Pilote's comment on the
  PR and starts the `--fix` Session.
- **Content is read by the browser, never by the server.** A document under
  review, a PR's diff, an issue's body, the captures of a visual review: the
  page fetches them from `api.github.com` with the Pilote's user token. The
  server's GitHub client (`apps/server/src/github/`) has no method that reads
  a file or a diff, except an allowlist of the Process's own files
  (`.process.json`, the existence of `CONTEXT.md` and `docs/adr/`, for
  US-4's checks); a test fails when another path is read.

## Options that lost

- **An OAuth App and the local `gh`**: a sign-in to set up on every machine,
  the Pilote's personal token in the agents' hands, and webhooks per
  repository to register.
- **A relay for webhooks** (the console's ADR 0005): it was there because the
  console sleeps with the PC; the server does not.
- **The server proxies documents and diffs**: simplest, but the code would
  pass through our servers, against US-60's promise.
- **A PR for every fix of US-4**: the Pilote clicked « Corriger » to have it
  done.

## Consequences

- Two `externe` tickets: create the two Apps (name, permissions, events,
  webhook URL, callback URL) and put their secrets in the GitHub
  environments and on the server.
- Tests use a fake GitHub (`apps/server/test/fakes/github.ts`) for the API
  and signed fixture payloads for the webhooks; no test calls GitHub.
- A PR merged by `crewdeck[bot]` is the Boucle's; a merge by the Pilote on
  GitHub is read back from its webhook like any other change.
