---
id: MIROIR-6
title: "The agents' commands: crewdeck-runner miroir issue|pr view|list, ready, search, sql, status, sync, rebuild, in gh's shapes, with the copy's freshness"
epic: MIROIR
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [MIROIR-4]
adr: [0010, 0004]
risques: [AGT-7]
stories: [US-15]
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0010, « The agents' commands » and « Freshness »: the agents read the state of the work from the **Miroir**, never through many `gh` calls. `crewdeck-runner miroir <command>` answers in `gh`'s shapes, so that a `jq` filter written for `gh` works unchanged, says on stderr when the copy is not live, and reads GitHub first when it is not (risk AGT-7). RUNNER-10 puts a `mirror` shim in each Session's `PATH`; RUNNER-12's official Skills use it. The commands run in the agent's process; anything that writes the copy or needs a token is asked of the running Runner (MIROIR-4), the copy's only writer.

## Current state of the code

- `apps/runner/internal/accounts/refresh.go`: `runner.sock` in the state folder (mode 600), served by the running Runner (`run.go`), one JSON line each way, used by `crewdeck-runner login` and `logout` to ask for the capabilities again.
- `apps/runner/cmd/crewdeck-runner/status.go`: `Status` (`--json`) and its French lines.
- Created by MIROIR-3: `internal/mirror/` (`OpenReadOnly`, `schema.sql`, the tables, `search` FTS5, `Reconcile`, the fetches); by MIROIR-4: `Follower`, `freshness.go` (`Freshness{ State: filling|live|late, SyncedAt }`).
- No `miroir` command.

## To do

- **The Runner's socket** `apps/runner/internal/localsock/`: one listener on `runner.sock`, one JSON request line `{ op, … }` and one reply line `{ ok, error?, … }`, handlers registered by `op`. `accounts` registers `accounts.refresh` (a request without `op` is still it); the follower registers:
  - `mirror.state {}` → each Projet's `Freshness` and whether the socket to the server is connected;
  - `mirror.fetch { repository, number }` → `FetchObject` (and its head's checks), written, before the reply;
  - `mirror.sync { repository?, openOnly }` → `Reconcile` of that Projet (or all), `openOnly` walking only the open issues and PRs without deleting;
  - `mirror.list { repository, kind: issue|pull, state, labels, author, head, limit }` → GitHub's answer in the shape of the rows below, nothing written (for a Projet still filling);
  - `mirror.rebuild {}` → `Store.Rebuild` then every Projet's reconciliation, replying once the rebuild is done (the filling goes on).
  Each op answers within 30 s or fails with `timeout`.
- `apps/runner/cmd/crewdeck-runner/miroir.go`, `crewdeck-runner miroir` (cobra), the repository being `--repo <owner>/<name>` or the current directory's (`git remote get-url origin`, https or ssh), which must be a Projet of the copy (else exit 1, « <owner>/<name> n'est pas un Projet de ce Runner. »):
  - `issue view <n>` and `pr view <n>`, `--json <f1,f2…>`, `-q/--jq <expr>` (`github.com/itchyny/gojq`): one object with exactly the fields asked, named and shaped as the ADR's table (`labels: [{ name }]`, `assignees: [{ login }]`, `author: { login }`, `milestone: { number, title, description, dueOn }` or null, `comments: [{ author: { login }, body, createdAt }]`, `blockedBy: [number]` (same repository), `parent: number|null`, `subIssues: [number]`; for a PR also `headRefName`, `headRefOid`, `baseRefName`, `isDraft`, `mergeable`, `mergeCommit: { oid }|null`, `closingIssuesReferences: [{ number, url, repository: { name, owner: { login } } }]`, `commits: [{ oid, messageHeadline, messageBody }]`, `reviews: [{ author: { login }, state, body, submittedAt, commit: { oid } }]`, `statusCheckRollup: [{ __typename, name, status, conclusion, detailsUrl }]` of the head). `--json` without fields lists the available ones and exits 1, as `gh`. Without `--json`: `gh`'s non-terminal text (`title:`, `state:`, `author:`, `labels:`, `comments:`, `assignees:`, `milestone:`, `number:` lines, `--`, then the body). An issue that does not exist: exit 1, « #<n> n'existe pas dans <owner>/<name>. »
  - `issue list`, `pr list`: `--state open|closed|merged|all` (default `open`), `--label` (repeatable, all of them), `--author`, `--head` (PRs), `--limit` (default 30), `--json`, `--jq`; a JSON array sorted by creation, newest first; without `--json`, `gh`'s non-terminal columns (issues: number, state, title, labels, updatedAt; PRs: number, title, headRefName, state, createdAt; tab-separated). `--search` is refused (exit 1, « --search n'est pas pris en charge : utilise crewdeck-runner miroir search. »).
  - `ready [--all] [--numbers N,…]`: one JSON object per line for the open issues labelled `ready-for-agent`: `number`, `title`, `labels` (names), `assignees` (logins), `milestone` (title or null), `due` (its `dueOn` or null), `priority` (`P<n>` of a `priority:P<n>` label, or null), `size` (of `size:<S>`, `XS` to `XL`, or null), `blockedBy`, `openBlockers` (the blockers still open in the copy), `available` (no open blocker, and no open PR naming it in `closingIssuesReferences` nor on a branch `<feat|fix|chore>/<n>-…`); without `--all` only the available ones; sorted by available first, milestone due date (none last), milestone number, priority (`P0` first, none last), size (`XS` to `XL`, none last), number. No week nor iteration key.
  - `search "<text>" [--kind issue|comment|doc] [--limit 20]`: FTS5 on `search` (each word of the text a quoted term, all required), `{ freshness, rows: [{ kind, repository, number, path, title, snippet }] }` (`snippet()` with `[` `]` and `…`); `issue` covers issues and PRs, `comment` their comments and review comments; `doc` rows come with MIROIR-5.
  - `sql "<select>"`: one `SELECT` or `WITH` statement on `OpenReadOnly`, `{ freshness, rows }` (each row an object keyed by column); any other statement exits 1.
  - `status [--json]`: per Projet its name, state, `syncedAt`, issue and PR counts; the socket's link; the file's size.
  - `sync [--repo]`: `mirror.sync` (all Projets without `--repo`), « Miroir synchronisé : <Projet> » per Projet; `rebuild`: `mirror.rebuild`, « Miroir reconstruit : remplissage en cours ».
  - `freshness` in `search` and `sql` answers: `{ "<owner>/<name>": { state, syncedAt } }` for the Projets the answer covers (all of them for `sql`).
- **Read-through** (ADR 0010, « Freshness »), state from `mirror.state`:
  - `live`: the copy answers.
  - `late`: `view` asks `mirror.fetch` first; `list` and `ready` ask `mirror.sync { openOnly: true }` first; then the copy answers, and stderr says « Miroir en retard pour <Projet> : dernière synchro il y a <durée> » when that read failed (only then: a read that succeeded made the answer fresh).
  - `filling`: `view` as `late`; `list` asks `mirror.list` and passes GitHub's answer through; `ready` exits 3, « Miroir en remplissage pour <Projet> » on stderr.
  - The Runner not running (no answer on `runner.sock`): no read-through; the copy answers with the « en retard » line (`syncedAt` from the database), and in `filling` `list` and `ready` exit 3 with « Miroir en remplissage pour <Projet> » and « Le Runner n'est pas démarré : crewdeck-runner start. »; `sync` and `rebuild` exit 1 with that second line.
  - `<durée>`: « moins d'une minute », « <n> min », « <n> h », « <n> j » (rounded down); `<Projet>` is the Projet's name (`displayName`).
- `crewdeck-runner status` (`status.go`): one line « Miroir : à jour » (every Projet live), « Miroir : en remplissage » (one still filling), « Miroir : en retard depuis <durée> » (else, from the oldest `syncedAt`); `--json` gains `mirror: { state, since? }`. Nothing in the page (ADR 0010).

## Decisions already made

- The answers of `view`, `list` and `ready` keep `gh`'s shape and go to stdout alone; freshness goes to stderr, only when not live (ADR 0010).
- `ready` exits 3 in `filling` rather than answer from a partial copy; every other error exits 1, a usage error 2 (cobra's).
- The commands never write the database nor hold a token: the running Runner does both, through `runner.sock`.
- `available` follows BOUCLE-1's branch rule (`<feat|fix|chore>/<n>-<slug>`): the same Ticket is never « available » to an agent while the Boucle delivers it.
- Messages in French, like the Runner's other messages (AGENTS.md).

## Acceptance criteria

- [ ] `issue view 12 --json number,title,labels,blockedBy` and `pr view 7 --json headRefOid,statusCheckRollup,reviews` print exactly those fields in `gh`'s shapes, and the same `jq` filter gives the same result on a recorded `gh` answer of the same objects (golden test).
- [ ] `--jq '.labels[].name'` works; `--json` without fields lists them and exits 1.
- [ ] `issue list --label ready-for-agent --state open --json number` and `pr list --head feat/12-x` filter as `gh`.
- [ ] `ready` prints the available issues sorted as specified; `--all` adds the unavailable ones after them; `--numbers 3,5` restricts to those; an issue with an open blocker or an open PR on `feat/<n>-…` is not available.
- [ ] A Projet `late`: `view` fetches the object first (call seen on the fake GitHub) and prints no warning; when the fetch fails it prints the copy and the « en retard » line on stderr.
- [ ] A Projet `filling`: `issue list` passes GitHub's answer; `ready` exits 3 with its message.
- [ ] With no Runner running, `view` answers from the copy with the « en retard » line, and `sync` exits 1 with « Le Runner n'est pas démarré ».
- [ ] `search "limite atteinte" --kind comment` finds a comment; `sql "select count(*) as n from issues"` answers `{ freshness, rows: [{ n }] }`; `sql "delete from issues"` exits 1.
- [ ] `crewdeck-runner status` shows each of the three Miroir lines in its state.
- [ ] `crewdeck-runner login` still refreshes the capabilities through `runner.sock`.

## Verification

- `cd apps/runner && go test ./internal/mirror/ ./internal/localsock/ ./internal/accounts/ ./cmd/crewdeck-runner/ -run 'Miroir|Status|Login'`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The `mirror` shim, `mirror gh` and the refresh after a write: RUNNER-10. The Skills' use of `mirror`: RUNNER-12. The documentation's rows of `search`: MIROIR-5.

## Dependencies

- MIROIR-4.
