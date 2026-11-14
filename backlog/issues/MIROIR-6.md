---
id: MIROIR-6
title: "The agents' reads for every Source: crewdeck-runner miroir issue|pr view|list, ready, search, sql, status, sync, rebuild, in gh's shapes, a Local Projet answered from its folder, with the copy's freshness"
epic: MIROIR
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [MIROIR-4, SOURCE-2]
adr: [0010, 0012, 0004]
risques: [AGT-7]
stories: [US-15]
screens: []
revue_visuelle: false
video: false
reprend: 165
---

## Context

ADR 0010, « The agents' commands » and « Freshness »: the agents read the state of the work from the **Miroir**, never through many `gh` calls. `crewdeck-runner miroir <command>` answers in `gh`'s shapes, so that a `jq` filter written for `gh` works unchanged, says on stderr when the copy is not live, and reads the **Source** first when it is not (risk AGT-7). ADR 0012, « The agents' one channel, for every Source », widens it: the same reads answer for a **Local** **Projet** (PROJET-6), a Local **Ticket** as an issue, a local change of code as a PR, so that one official Skill and one **Contrat** serve an **Étape** whatever its Source (RUNNER-12). The copy holds every Projet: a GitHub one filled by the follower (MIROIR-4), a Local one read from its folder and `local.db` through `apps/runner/internal/source/local/` (SOURCE-2), `miroir.db` being rebuilt from both while `local.db`, original data, is never touched. RUNNER-10 puts a `mirror` shim in each Session's `PATH`. The commands run in the agent's process; anything that writes the copy or needs a token is asked of the running Runner, the copy's only writer. The agents' writes are MIROIR-7.

## Current state of the code

- `apps/runner/internal/accounts/refresh.go`: `SocketName = "runner.sock"` in the state folder (mode 600), `Serve`, served by the running Runner (`run.go`), one JSON line each way, used by `crewdeck-runner login` and `logout` to ask for the capabilities again (`ErrNoRunner` when nobody listens).
- `apps/runner/cmd/crewdeck-runner/status.go`: `Status` (`--json`) and `printStatus`'s French lines.
- `apps/runner/internal/mirror/` (MIROIR-3, merged): `Store` (`Open`, `OpenReadOnly`, `Rebuild`, `PutProjects`, `Projects`, `MarkFilled`, `MarkSynced`), `schema.sql` (`SchemaVersion = 1`; `projects(repository PK, project_id, github_repo_id NOT NULL, installation_id NOT NULL, display_name, integration_branch, filled_at, synced_at)`, `issues`, `pulls`, `comments`, `reviews`, `checks`, `milestones`, FTS5 `search`…, every table keyed by `repository` `<owner>/<name>`), `PutObject`, `DeleteObject`, `PutChecks`, `PutCollections`, `Mirror.Refresh`, `Mirror.Reconcile`. `go.mod` has `cobra`, `modernc.org/sqlite`; not `gojq`.
- Created by MIROIR-1: `mirror.projects { projects: [{ projectId, repository, githubRepoId, installationId, displayName, integrationBranch }] }` (Projets with a GitHub repository only), `MirrorRelay` (`apps/server/src/github/changes/mirror-relay.ts`); by MIROIR-4: `Follower`, `Store.Cursor`, `freshness.go` (`Freshness{ State: filling|live|late, SyncedAt }`).
- Created by PROJET-6: a Local Projet (`Project` without repository, `nameSealed`), its folder in the Runner's state (`projects`: projectId → path, `runner.json`); by SOURCE-1: `artifact_sources` (`ticket`, `code`: `local | github`); by SOURCE-2: `apps/runner/internal/source/` (one interface: read, write, watch, copy) and `local/` (the clone `~/.crewdeck/repos/local/<projectId>` with the folder as `origin`, the Ticket files `tickets/<n>-<slug>.md` and `tickets/milestones.yml`, `~/.crewdeck/local.db`: counter, comments, review remarks, local changes' records).
- No `miroir` command.

## To do

- **Which Projets the Runner copies** (`packages/contracts/src/runner/mirror.ts`, then `pnpm exec nx run contracts:generate`): each `mirror.projects` item gains `sources: { ticket: 'local' | 'github', code: 'local' | 'github' }` and `nameSealed` (the Local name, PROJET-6's sealed value, or null); `repository`, `githubRepoId`, `installationId` and `displayName` become nullable (null for a Projet without a GitHub repository). `MirrorRelay` lists every Projet of the Pilote (not only those with a repository) with its two Sources, and sends the list again after a change of `artifact_sources` (SOURCE-1's service calls `ProjectsService.onChanged`, wired here). MIROIR-2's token and MIROIR-4's follower keep using only the items with a repository.
- **The copy's keys** (`schema.sql`, `SchemaVersion` 2, a rebuild refilling it): a Projet has one key per place its groups live: `<owner>/<name>` for what is on GitHub, `local/<projectId>` for what is Local (a Projet with both groups on one Source has one key; with one group Local and one on GitHub, two). `projects` becomes `(repository PK, project_id, source 'github'|'local', groups 'ticket'|'code'|'ticket,code', github_repo_id NULL, installation_id NULL, display_name, integration_branch, folder NULL, filled_at, synced_at)`; `display_name` of a Local key is the name opened by the Runner with the vault key (`internal/keys`), never sent back. `Store.PutProjects` builds the keys from `mirror.projects` and the Runner's state.
- **A Local Projet in the copy** `apps/runner/internal/mirror/local.go`, reading only through SOURCE-2's interface (`internal/source/local/`), writing with MIROIR-3's `PutObject`, `DeleteObject`, `PutChecks`, `PutCollections`:
  - `RefreshLocal(ctx, key, number)`: one Ticket or one local change, its comments and reviews; absent → `DeleteObject`.
  - `ReconcileLocal(ctx, key)`: every Ticket file and local change, the milestones; deletes what is gone; `MarkFilled`, `MarkSynced`.
  - Run by the follower when the Runner starts, on each `mirror.projects`, every 15 min with GitHub's reconciliations, and by the read-through below. A folder missing (PROJET-6's `project.folder-missing`) fails the read with `unavailable`, the copy kept.
  - The shapes, as `gh` prints them:
    - a **Ticket file** → an issue: `number`, `title`, `body`, `state` `OPEN`/`CLOSED`, `stateReason` `COMPLETED`/`NOT_PLANNED` from `state_reason`, `labels` its `labels` plus `ready-for-agent` when `ready: true` (so that `ready` and every `--label ready-for-agent` filter work unchanged), `assignees` `[]`, `milestone` the `tickets/milestones.yml` entry of that title (`number` its position from 1, `dueOn` its `due_on`), `author` null, `blockedBy`, `parent` from the front matter, `subIssues` the Tickets naming it as `parent` sorted by number, `url` the file's `file://` URL, `createdAt` and `updatedAt` the file's modification time, `closedAt` null, `comments` from `local.db`;
    - a **local change** → a PR: `number`, `title`, `body`, `state` `OPEN`/`CLOSED`/`MERGED`, `headRefName`, `headRefOid` (its branch's head in the Runner's clone), `baseRefName`, `isDraft` false, `mergeable` `UNKNOWN`, `mergeCommit { oid }` once merged, `closingIssuesReferences` from the body's `Closes|Fixes|Resolves #<n>` (GitHub's keywords), their `repository` being the Ticket group's key, `commits` (`git log <base>..<head>` in the clone: `oid`, `messageHeadline`, `messageBody`), `reviews` (`local.db`'s review remarks: `author { login }` the Rôle, `state` `APPROVED`/`CHANGES_REQUESTED`/`COMMENTED`, `body`, `submittedAt`, `commit { oid }`), `statusCheckRollup` the checks of `headRefOid` that SOURCE-2's interface gives for a local change (its Commandes' checks: `__typename` `CheckRun`, `name`, `status`, `conclusion`, `detailsUrl` null), `[]` while it gives none.
- **The Runner's socket** `apps/runner/internal/localsock/`: one listener on `runner.sock`, one JSON request line `{ op, … }` and one reply line `{ ok, error?, … }`, handlers registered by `op`. `accounts` registers `accounts.refresh` (a request without `op` is still it); the follower registers:
  - `mirror.state {}` → each key's `Freshness` and whether the socket to the server is connected;
  - `mirror.fetch { repository, number }` → `FetchObject` (and its head's checks) for a GitHub key, `RefreshLocal` for a Local one, written, before the reply;
  - `mirror.sync { repository?, openOnly }` → `Reconcile` or `ReconcileLocal` of that key (or all), `openOnly` walking only the open issues and PRs without deleting (a Local key walks all: its folder is on the disk);
  - `mirror.list { repository, kind: issue|pull, state, labels, author, head, limit }` → GitHub's answer in the shape of the rows below, nothing written (for a GitHub key still filling);
  - `mirror.rebuild {}` → `Store.Rebuild` then every key's reconciliation, replying once the rebuild is done (the filling goes on); `local.db` is never touched.
  Each op answers within 30 s or fails with `timeout`.
- `apps/runner/cmd/crewdeck-runner/miroir.go`, `crewdeck-runner miroir` (cobra):
  - **The Projet**: `--repo <key>` (`<owner>/<name>` or `local/<projectId>`), or the current directory's `git remote get-url origin`: a GitHub URL (https or ssh) names its repository; a path names the Local Projet whose folder (the Runner's state) or whose clone (`~/.crewdeck/repos/local/<projectId>`) it is. Neither a Projet of the copy: exit 1, « <dépôt> n'est pas un Projet de ce Runner. ». Then `issue …` read the key of the Projet's `ticket` group, `pr …` the key of its `code` group, whichever key named it.
  - `issue view <n>` and `pr view <n>`, `--json <f1,f2…>`, `-q/--jq <expr>` (`github.com/itchyny/gojq`, added to `go.mod`): one object with exactly the fields asked, named and shaped as ADR 0010's table (`labels: [{ name }]`, `assignees: [{ login }]`, `author: { login }` or null, `milestone: { number, title, description, dueOn }` or null, `comments: [{ author: { login }, body, createdAt }]`, `blockedBy: [number]` (same key), `parent: number|null`, `subIssues: [number]`; for a PR also `headRefName`, `headRefOid`, `baseRefName`, `isDraft`, `mergeable`, `mergeCommit: { oid }|null`, `closingIssuesReferences: [{ number, url, repository: { name, owner: { login } } }]`, `commits: [{ oid, messageHeadline, messageBody }]`, `reviews: [{ author: { login }, state, body, submittedAt, commit: { oid } }]`, `statusCheckRollup: [{ __typename, name, status, conclusion, detailsUrl }]` of the head). `--json` without fields lists the available ones and exits 1, as `gh`. Without `--json`: `gh`'s non-terminal text (`title:`, `state:`, `author:`, `labels:`, `comments:`, `assignees:`, `milestone:`, `number:` lines, `--`, then the body). An issue that does not exist: exit 1, « #<n> n'existe pas dans <Projet>. »
  - `issue list`, `pr list`: `--state open|closed|merged|all` (default `open`), `--label` (repeatable, all of them), `--author`, `--head` (PRs), `--limit` (default 30), `--json`, `--jq`; a JSON array sorted by creation, newest first (a Local key by number, highest first: its dates are the files'); without `--json`, `gh`'s non-terminal columns (issues: number, state, title, labels, updatedAt; PRs: number, title, headRefName, state, createdAt; tab-separated). `--search` is refused (exit 1, « --search n'est pas pris en charge : utilise crewdeck-runner miroir search. »).
  - `ready [--all] [--numbers N,…]`: one JSON object per line for the open issues labelled `ready-for-agent`: `number`, `title`, `labels` (names), `assignees` (logins), `milestone` (title or null), `due` (its `dueOn` or null), `priority` (`P<n>` of a `priority:P<n>` label, or null), `size` (of `size:<S>`, `XS` to `XL`, or null), `blockedBy`, `openBlockers` (the blockers still open in the copy), `available` (no open blocker, and no open PR of the Projet's `code` key naming it in `closingIssuesReferences` nor on a branch `<feat|fix|chore>/<n>-…`); without `--all` only the available ones; sorted by available first, milestone due date (none last), milestone number, priority (`P0` first, none last), size (`XS` to `XL`, none last), number. No week nor iteration key.
  - `search "<text>" [--kind issue|comment|doc] [--limit 20]`: FTS5 on `search` (each word of the text a quoted term, all required), `{ freshness, rows: [{ kind, repository, number, path, title, snippet }] }` (`snippet()` with `[` `]` and `…`), `repository` being the key; `issue` covers issues and PRs, `comment` their comments and reviews; `doc` rows come with MIROIR-5.
  - `sql "<select>"`: one `SELECT` or `WITH` statement on `OpenReadOnly`, `{ freshness, rows }` (each row an object keyed by column); any other statement exits 1.
  - `status [--json]`: per key its Projet's name, Source, state, `syncedAt`, issue and PR counts; the socket's link; the file's size.
  - `sync [--repo]`: `mirror.sync` (every key without `--repo`), « Miroir synchronisé : <Projet> » per Projet; `rebuild`: `mirror.rebuild`, « Miroir reconstruit : remplissage en cours ».
  - `freshness` in `search` and `sql` answers: `{ "<key>": { state, syncedAt } }` for the keys the answer covers (all of them for `sql`).
- **Read-through** (ADR 0010, « Freshness »), state from `mirror.state`, the same rules for both Sources:
  - `live`: the copy answers. A Local key is `live` once filled while the Runner runs; its read-through is a read of the disk, so `view` still asks `mirror.fetch` and `list` and `ready` `mirror.sync` first, and a Local answer is never older than the command.
  - `late`: `view` asks `mirror.fetch` first; `list` and `ready` ask `mirror.sync { openOnly: true }` first; then the copy answers, and stderr says « Miroir en retard pour <Projet> : dernière synchro il y a <durée> » when that read failed (only then: a read that succeeded made the answer fresh).
  - `filling`: `view` as `late`; for a GitHub key `list` asks `mirror.list` and passes GitHub's answer through, `ready` exits 3, « Miroir en remplissage pour <Projet> » on stderr; for a Local key `list` and `ready` ask `mirror.sync` (the folder's whole read) then answer.
  - The Runner not running (no answer on `runner.sock`): no read-through; the copy answers with the « en retard » line (`syncedAt` from the database), and in `filling` `list` and `ready` exit 3 with « Miroir en remplissage pour <Projet> » and « Le Runner n'est pas démarré : crewdeck-runner start. »; `sync` and `rebuild` exit 1 with that second line.
  - `<durée>`: « moins d'une minute », « <n> min », « <n> h », « <n> j » (rounded down); `<Projet>` is the Projet's name.
- `crewdeck-runner status` (`status.go`): one line « Miroir : à jour » (every key live), « Miroir : en remplissage » (one still filling), « Miroir : en retard depuis <durée> » (else, from the oldest `syncedAt`); `--json` gains `mirror: { state, since? }`. Nothing in the page (ADR 0010).
- Fixtures: a Local Projet as a temporary git repository (folder, `tickets/` with three Ticket files, `milestones.yml`, a `local.db` with a comment, a local change and a review), beside MIROIR-3's fake GitHub; golden answers of `gh` in `apps/runner/cmd/crewdeck-runner/testdata/miroir/`.

## Decisions already made

- The answers of `view`, `list` and `ready` keep `gh`'s shape and go to stdout alone; freshness goes to stderr, only when not live (ADR 0010).
- One shape for both Sources: a Skill or a Contrat never tests the Source (ADR 0012). A Local Ticket's `ready: true` is shown as the label `ready-for-agent`, never written to the file.
- A Local key is `local/<projectId>`: no GitHub repository of a Pilote's Projets is named so, the key is stable across a rename, and the folder's path never enters an answer but as a Ticket's `file://` URL, on the Pilote's own machine.
- A Projet with one group Local and one on GitHub has two keys; `issue` reads the `ticket` group's, `pr` the `code` group's, and a `closingIssuesReferences` names the Ticket's key: the two numberings never share a primary key.
- The copy is filled from SOURCE-2's interface only: `mirror` never parses a Ticket file nor opens `local.db` itself, so a Source is read by one package.
- `ready` exits 3 in `filling` for a GitHub key rather than answer from a partial copy; a Local key never waits on a network. Every other error exits 1, a usage error 2 (cobra's).
- The commands never write the database nor hold a token: the running Runner does both, through `runner.sock`.
- `available` follows BOUCLE-1's branch rule (`<feat|fix|chore>/<n>-<slug>`): the same Ticket is never « available » to an agent while the Boucle delivers it.
- GitHub's side of the copy stays MIROIR-3's fetches and MIROIR-4's follower in `internal/mirror/`: these reads need nothing more from it; `internal/source/github/` comes with the first ticket that writes or copies through SOURCE-2's interface (MIROIR-7, SOURCE-8).
- Messages in French, like the Runner's other messages (AGENTS.md).

## Acceptance criteria

- [ ] `issue view 12 --json number,title,labels,blockedBy` and `pr view 7 --json headRefOid,statusCheckRollup,reviews` print exactly those fields in `gh`'s shapes, and the same `jq` filter gives the same result on a recorded `gh` answer of the same objects (golden test), for a GitHub key.
- [ ] The same two commands in a worktree of a Local Projet's clone print Ticket file 12 and local change 7 in the same shapes: `labels` holds `ready-for-agent` for a `ready: true` file, `milestone.dueOn` comes from `milestones.yml`, `reviews` and `comments` from `local.db`, `closingIssuesReferences` from the body's `Closes #12`; the same `jq` filter as the GitHub golden test passes.
- [ ] `--jq '.labels[].name'` works; `--json` without fields lists them and exits 1.
- [ ] `issue list --label ready-for-agent --state open --json number` and `pr list --head feat/12-x` filter as `gh`, on both Sources.
- [ ] `ready` prints the available issues sorted as specified; `--all` adds the unavailable ones after them; `--numbers 3,5` restricts to those; an issue with an open blocker or an open PR on `feat/<n>-…` is not available; the same on a Local Projet.
- [ ] A Ticket file edited by hand, then `issue view` from a Session answers the edit (the Local read-through), with nothing on stderr.
- [ ] A Projet with its Tickets Local and its code on GitHub: `issue view 3` reads `tickets/3-…md`, `pr view 3` GitHub's PR #3.
- [ ] A GitHub key `late`: `view` fetches the object first (call seen on the fake GitHub) and prints no warning; when the fetch fails it prints the copy and the « en retard » line on stderr.
- [ ] A GitHub key `filling`: `issue list` passes GitHub's answer; `ready` exits 3 with its message.
- [ ] With no Runner running, `view` answers from the copy with the « en retard » line, and `sync` exits 1 with « Le Runner n'est pas démarré ».
- [ ] `search "limite atteinte" --kind comment` finds a comment of each Source; `sql "select count(*) as n from issues"` answers `{ freshness, rows: [{ n }] }`; `sql "delete from issues"` exits 1.
- [ ] `rebuild` refills a Local Projet from its folder and leaves `local.db` byte for byte unchanged.
- [ ] The server sends a Local Projet in `mirror.projects` with its `sources` and `nameSealed`, and again after its Sources change (integration test with `fake-runner`); MIROIR-2's token still covers only the repositories.
- [ ] `crewdeck-runner status` shows each of the three Miroir lines in its state.
- [ ] `crewdeck-runner login` still refreshes the capabilities through `runner.sock`.

## Verification

- `cd apps/runner && go test ./internal/mirror/ ./internal/localsock/ ./internal/accounts/ ./cmd/crewdeck-runner/ -run 'Miroir|Local|Status|Login'`
- `pnpm exec nx test contracts -- src/runner/`
- `pnpm exec nx test-integration server -- github-changes`
- `pnpm exec nx run contracts:generate` with no diff once committed, then `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the copy's new schema rebuilds `miroir.db` on the Runner's next start).

## Out of scope

- The agents' writes (`miroir issue|pr create|edit|comment|review|close`): MIROIR-7. The `mirror` shim, `mirror gh` and the refresh after a write: RUNNER-10. The Skills' use of `mirror`: RUNNER-12.
- The documentation's rows of `search`: MIROIR-5. Following a Local folder live and `local.changed`: SOURCE-3. The snapshot of a taken Ticket and « modifié depuis sa prise »: SOURCE-6.
- Recording the Commandes' checks of a local change: whoever runs them in the worktree (BOUCLE-9); this ticket only reads them.

## Dependencies

- MIROIR-4, SOURCE-2.
