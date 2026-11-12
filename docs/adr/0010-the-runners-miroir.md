# The Runner's Miroir: the agents' one channel, on the Pilote's machine

> **Status:** accepted, 2026-11-12. Amends [ADR 0002](0002-github-app.md)
> on the tokens the server mints (a « Miroir » token beside the Session's)
> and [ADR 0004](0004-the-runner.md) on the Runner's state and commands.

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
  connection and a snapshot on a gap; the Runner is one of its WebSocket's
  clients ([ADR 0007](0007-real-time.md)). The server is already, for the
  Runner, what the dotfiles' relay is for their Miroir.

## Decision

### Where it lives

- **In the Runner**: `~/.crewdeck/miroir.db` (mode 600, in the Runner's
  folder of mode 700), one database for every Projet of the Pilote, in
  `apps/runner/internal/mirror/`. Go with `modernc.org/sqlite` (no cgo: the
  binaries stay static and cross-compiled, FTS5 included), WAL. The schema
  is versioned; a new version rebuilds the copy (`crewdeck-runner miroir
  rebuild`).
- **What it holds**: the same as the dotfiles' Miroir (their ADR 0006, «
  What is copied »), for the repositories of the Pilote's Projets: issues
  and PRs since always, comments, sub-issues and blocked-by relations, the
  labels (`priority:` and `size:` included: the App cannot read Project
  boards), reviews and review comments, the checks of open PRs' heads and of
  merge commits, milestones, releases. Not diffs, file contents outside the
  documentation index, captures, workflow logs.
- **The documentation index**: the same files (`docs/**/*.md`,
  `backlog/**/*.md`, `design/DESIGN.md`, `AGENTS.md`, `CONTEXT.md`) as on
  `origin/<integration branch>`, read from the Runner's own clone
  (`~/.crewdeck/repos/<owner>/<repo>`) after a `git fetch`, FTS5.

### How it follows GitHub

- **The server forwards each webhook as an envelope without content**: a
  new event type `github.changed`, payload `{ projectId, repository, kind:
  'issue'|'pull'|'push'|'check', number, sha, ref, action, at }` (the
  fields a webhook gives as metadata, null when absent), written in the
  Pilote's `events` like any other change ([ADR 0007](0007-real-time.md)):
  numbered, kept 7 days, replayed to the Runner after a reconnection. Tabs
  receive it too, to keep their `seq` without gaps; the page's store
  ignores the type. Nothing more is stored on the server: the envelope only
  holds what the webhook handler already reads ([ADR 0003](0003-privacy-and-end-to-end-encryption.md)'s
  table is unchanged).
- **The Runner fetches the content itself**: for each envelope, the object
  it names (with its comments, reviews and checks), or a reindex of the
  documentation on a push to the integration branch. A snapshot instead of
  a replay (the Runner was offline more than 7 days) runs a full
  reconciliation.
- **A reconciliation** at the Runner's start, after a snapshot, and every
  15 min, the server's own interval: every issue and PR by pages (which
  also brings the blocked-by changes no webhook carries).
- **The « Miroir » token**: the server mints, at the Runner's request
  (`mirror.token` in the Runner protocol), an installation token per App
  installation, restricted to the repositories of the Pilote's Projets and
  to metadata, contents, issues, pull requests, checks and commit statuses,
  **read only**, valid 1 h, renewed by the Runner 10 min before it expires
  while it is linked. It reads between Sessions; a Session keeps its own
  token (RUNNER-10) for its writes.

### Freshness

The same rules as the dotfiles (their ADR 0006, « Freshness »): a Projet's
copy is **live** while the Runner's socket is connected with no event
missing, else **en retard** since its last applied event; every answer of
`crewdeck-runner miroir` carries `freshness`; a read of an object en retard
first fetches it from GitHub, a list first runs a reconciliation of its
Projet; the gates still act on GitHub's own state (the server merges with
the SHA it judged, [ADR 0002](0002-github-app.md)).

### The agents' commands

- `crewdeck-runner miroir issue view|list`, `pr view|list`, `ready`,
  `search`, `sql`, `status`, `sync`, `rebuild`: the dotfiles' `mirror`
  commands, their flags and their JSON field names (`gh --json`'s).
- A Session's `PATH` (`~/.crewdeck/sessions/<id>/bin/`, RUNNER-10) holds a
  `mirror` shim (`exec crewdeck-runner miroir "$@"`) beside its `gh` shim,
  so that a Skill derived from a dotfiles skill keeps its commands as they
  are; `mirror gh <args>` and the `gh` shim both run `crewdeck-runner gh`,
  which, after the real `gh` answered, refreshes in the copy the issue or PR
  the command named.
- `crewdeck-runner status` gets one line: « Miroir : à jour », or «
  Miroir : en retard depuis <durée> » (French, as the Runner's other
  messages). Nothing in the page: a late copy already shows as « Runner
  hors ligne ».

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

- Tickets: the server's `github.changed` events and the `mirror.token`
  message (`apps/server/src/github/`, `packages/contracts/src/runner/`);
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
