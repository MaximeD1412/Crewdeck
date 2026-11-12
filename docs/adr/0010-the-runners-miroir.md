# The Runner's Miroir: the agents' one channel, on the Pilote's machine

> **Status:** accepted, 2026-11-12. Amends [ADR 0002](0002-github-app.md)
> on the tokens the server mints (a « Miroir » token beside the Session's)
> and the App's events, and [ADR 0004](0004-the-runner.md) on the Runner's
> state, protocol and commands.

## Context

In the dotfiles, agents read the state of the work from GitHub through
many separate `gh` calls; their ADR 0006 gives them one channel instead,
the **Miroir**: a local SQLite copy of GitHub (issues, PRs, comments,
reviews, checks) and an index of the validated documentation, read by the
agents, written only from what GitHub answers, with one write path (`mirror
gh`) that refreshes what it touched. The Pilote asked that Crewdeck's agents
work the same way.

Crewdeck has two constraints the dotfiles do not:

- the server never reads content: an issue's body, a comment, a document or
  a diff is read by the browser or the Runner, never by the server
  ([ADR 0002](0002-github-app.md), [ADR 0003](0003-privacy-and-end-to-end-encryption.md),
  US-60). A copy with content can only live on the Pilote's machine;
- the server already learns every change from the App's webhooks and
  already numbers its events per Pilote, with a replay after a lost
  connection and a snapshot on a gap, for the tabs
  ([ADR 0007](0007-real-time.md)); the Runner has its own protocol, without
  that replay yet. The server can be, for the Runner, what the dotfiles'
  relay is for their Miroir.

## Decision

### Where it lives

- **In the Runner**: `~/.crewdeck/miroir.db` (mode 600, in the Runner's
  folder of mode 700), one database for every Projet of the Pilote, in
  `apps/runner/internal/mirror/`. Go with `modernc.org/sqlite` (no cgo: the
  binaries stay static and cross-compiled, FTS5 included), WAL. The schema
  is versioned; a new version rebuilds the copy (`crewdeck-runner miroir
  rebuild`).
- **What it holds**, for the repositories of the Pilote's Projets: every
  issue and PR since the repository's creation (title, body, state and its
  reason, labels, assignees, milestone, author, dates), their comments,
  sub-issues, parent and blocked-by relations; for a PR also its head and
  base branches, head SHA, draft, mergeable, merge commit, closing issues,
  commits (SHA and message), reviews and review comments; the checks (check
  runs and commit statuses) of open PRs' heads and of merge commits; the
  repository's labels, milestones and releases. Priority and size are the
  labels `priority:P<n>` and `size:<S>`: the App cannot read Project boards.
  Not copied: diffs, file contents outside the documentation index,
  captures, workflow runs and logs.
- **The documentation index**: `docs/**/*.md`, `backlog/**/*.md`,
  `design/DESIGN.md`, `AGENTS.md` and `CONTEXT.md` as on `origin/<integration
  branch>`, read from the Runner's own clone
  (`~/.crewdeck/repos/<owner>/<repo>`) after a `git fetch`, FTS5, reindexed
  when that branch's head moves.

### How it follows GitHub

- **The server keeps each webhook's envelope, without content**, in a
  table of its own, `github_changes` (`pilotId`, `seq` from its own counter
  on the Pilote's row, `projectId`, `repository`, `kind`: `issue`, `pull`,
  `push`, `check`, `release`, `label`, `milestone`; `number`, `sha`, `ref`,
  `action`, `at`; a field the webhook does not give is null), kept 7 days,
  for every webhook of a followed repository. Identifiers, states and
  dates only, which [ADR 0003](0003-privacy-and-end-to-end-encryption.md)'s
  table already lets the server read; no content. The tabs' `events` do not
  change.
- **The server's own writes do not wait for their webhook**: a merge, a
  label or a branch the server makes ([ADR 0002](0002-github-app.md))
  writes its envelope as soon as GitHub accepted it (a merge also writes
  one for each issue the PR closes), in the transaction that records the
  gesture; the webhook that follows only repeats it.
- **The App's events** ([ADR 0002](0002-github-app.md)) gain
  `pull_request_review_comment`, `issue_dependencies`, `release`, `label`
  and `milestone`, so that every object the Miroir copies has an event; the
  Boucle reads blocked-by changes from `issue_dependencies` too.
- **The Runner protocol gets its own replay** (`packages/contracts/src/runner/`):
  `hello` carries `mirrorAfter` (the last `github_changes.seq` the Runner
  applied, null for none); after `hello.accepted` the server sends the
  envelopes after it, in order, then each new one live, as `github.changed
  { seq, envelope }`; a `mirrorAfter` it no longer has (older than 7 days),
  or null, gets `mirror.resync` first, then the live stream. The Runner
  stores its cursor in the database, in the transaction that applies an
  envelope.
- **The Runner fetches the content itself**: for each envelope, the object
  it names, with its comments, reviews, relations and checks; a `push` to
  the integration branch reindexes the documentation; `label`, `milestone`
  and `release` reread that collection. An envelope is applied (its cursor
  moved) only once its fetch succeeded; a failed fetch (GitHub refusing,
  limiting or down) is retried with a backoff (1 s doubling to 5 min) and
  holds the later envelopes of its Projet behind it.
- **A reconciliation** when the Runner starts, after a `mirror.resync`, and
  every 15 min, the server's own interval: every issue and PR by pages, the
  labels, milestones and releases, and the documentation index (the
  integration branch's head compared with the indexed one). It also
  catches deletions and any change whose webhook was lost.
- **The « Miroir » token**: the server mints, at the Runner's request
  (`mirror.token` in the Runner protocol), an installation token per App
  installation, restricted to the repositories of the Pilote's Projets and
  to metadata, contents, issues, pull requests, checks and commit statuses,
  **read only**, valid 1 h, renewed by the Runner 10 min before it expires
  while it is linked. It reads between Sessions; a Session keeps its own
  token (RUNNER-10) for its writes.

### Freshness

- Each Projet's copy is **en remplissage** until its first reconciliation
  is complete; then **live** while the Runner's socket is connected, its
  replay is done and no envelope of the Projet waits to be applied; else
  **en retard** since its last applied envelope or reconciliation
  (`syncedAt`).
- A read of one object from a Projet that is not live first fetches it
  from GitHub; a list first runs the Projet's reconciliation of open issues
  and PRs. When that read fails, the copy answers as it is, with the
  warning. A Projet en remplissage never answers a list from its partial
  copy: `issue|pr list` go to GitHub and pass its answer through, `ready`
  exits 3 (« Miroir en remplissage pour <Projet> »).
- The gates still act on GitHub's own state: the server merges with the
  SHA it judged ([ADR 0002](0002-github-app.md)), a claim rereads GitHub.

### The agents' commands

`crewdeck-runner miroir <command>`, the repository being the current
directory's (a Session's worktree) or `--repo <owner/name>`:

| Command | Answer |
|---|---|
| `issue view <n> --json <fields>` | One JSON object with `gh issue view --json`'s field names: `number`, `title`, `body`, `state`, `stateReason`, `url`, `labels` (`[{ name }]`), `assignees` (`[{ login }]`), `milestone` (`{ title, dueOn }`), `author` (`{ login }`), `comments` (`[{ author, body, createdAt }]`), `createdAt`, `updatedAt`, `closedAt`, plus `blockedBy` (`[number]`), `parent` (number or null), `subIssues` (`[number]`) |
| `pr view <n> --json <fields>` | Likewise `gh pr view --json`'s: those of an issue, plus `headRefName`, `headRefOid`, `baseRefName`, `isDraft`, `mergeable`, `mergeCommit`, `closingIssuesReferences`, `commits`, `reviews`, `statusCheckRollup` (as `gh` gives it: `__typename`, `name`, `status`, `conclusion`, `detailsUrl`) |
| `issue list`, `pr list` | A JSON array; flags `--state`, `--label`, `--head`, `--author`, `--json`, `--limit` as `gh`'s |
| `ready [--all] [--numbers N,…]` | One JSON object per line, open `ready-for-agent` issues: `number`, `title`, `labels`, `assignees`, `milestone`, `due`, `priority`, `size`, `blockedBy`, `openBlockers`, `available`; sorted by available first, milestone due date then number, priority (`P0` first), size (`XS` to `XL`), number. There is no week or iteration in Crewdeck: no such key |
| `search "<text>" [--kind issue\|comment\|doc]` | `{ freshness, rows: [{ kind, repository, number, path, title, snippet }] }` |
| `sql "<select>"` | `{ freshness, rows }`, on a read-only connection |
| `status [--json]` | Per Projet: state, `syncedAt`, the socket's link, the size of the copy |
| `sync [--repo]`, `rebuild` | A reconciliation now; drop and refill |

- The answers of `view`, `list` and `ready` keep `gh`'s shape, so that a
  `jq` filter written for `gh` works unchanged; their freshness is on
  stderr, only when the Projet is not live: « Miroir en retard pour
  <Projet> : dernière synchro il y a <durée> » or « Miroir en remplissage
  pour <Projet> ».
- A Session's `PATH` (`~/.crewdeck/sessions/<id>/bin/`, RUNNER-10) holds a
  `mirror` shim (`exec crewdeck-runner miroir "$@"`) beside its `gh` shim,
  so that a Skill derived from a dotfiles skill keeps its commands as they
  are; `mirror gh <args>` and the `gh` shim both run `crewdeck-runner gh`,
  which, after the real `gh` answered, refreshes in the copy the issue or PR
  the command named (with its relations), or runs the reconciliation of
  open issues and PRs when it names none (a GraphQL mutation).
- `crewdeck-runner status` gets one line: « Miroir : à jour », «
  Miroir : en remplissage » or « Miroir : en retard depuis <durée> »
  (French, as the Runner's other messages). Nothing in the page: a late
  copy already shows as « Runner hors ligne ».

## Options that lost

- **A copy of the metadata on the server, the content read from GitHub by
  the Runner**: two channels for the agents, not the dotfiles' one.
- **The Runner polls GitHub with ETags**: the server already knows every
  change within seconds (US-20).
- **The Miroir refreshed only during Sessions, with their tokens**: every
  Session would start on a stale copy and catch it up first.
- **Sharing the dotfiles' code**: Node there, Go here, and the product
  never depends on the dotfiles.
- **An indicator in the page**: a detail of the machine; `crewdeck-runner
  status` is where the Pilote looks at it.

## Consequences

- Tickets: the server's `github_changes`, the App's new events, the
  protocol's `mirrorAfter`, `github.changed`, `mirror.resync` and
  `mirror.token` (`apps/server/src/github/`, `apps/server/src/runners/`,
  `packages/contracts/src/runner/`); a ticket `externe` to add the five
  events to both Apps;
  the Runner's Miroir (`apps/runner/internal/mirror/`); RUNNER-10 amended
  (the `mirror` shim, `crewdeck-runner gh` refreshing the copy); RUNNER-12
  amended (the official Skills read through `mirror`).
- Risk SEC-6 widens: a stolen « Miroir » token reads the Pilote's Projets
  for at most an hour, never writes. A new risk: the copy of the Projets'
  content on the Pilote's disk.
- Tests use a fake server (`httptest`) sending `github.changed` events and
  a fake GitHub (`apps/runner/internal/github/` fakes); no test calls
  GitHub.
- The first files to imitate: `apps/runner/internal/mirror/` (the store and
  its read-through), `apps/runner/cmd/crewdeck-runner/` (the `miroir`
  commands).
- Crewdeck's own development, through the dotfiles' agent-loop, uses the
  dotfiles' Miroir; this repository's `AGENTS.md` gets the dotfiles' rule
  (« read with `mirror`, write with `mirror gh` ») with the dotfiles ticket
  that migrates the prompts.
