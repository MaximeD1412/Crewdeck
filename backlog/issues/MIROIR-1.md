---
id: MIROIR-1
title: "GitHub's changes for the Runner: content-free envelopes in github_changes, the Runner's replay and its Projets"
epic: MIROIR
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PROJET-2]
adr: [0010, 0002, 0003, 0007, 0008]
risques: [SEC-10]
stories: [US-20, US-60]
screens: []
revue_visuelle: false
video: false
reprend: 161
---

## Context

ADR 0010, « How it follows GitHub »: the Runner's **Miroir** learns every change from the server, which already receives every webhook of a followed repository (PROJET-1). The server keeps an envelope of each one, without content (identifiers, states and dates only, which ADR 0003's table lets it read), numbered per **Pilote** by a counter of its own, kept 7 days, and replays them to the Runner after its `hello`, then sends each new one live. The tabs' `events` (ADR 0007) do not change. The Runner also learns from the server which repositories are the Pilote's **Projets** (`mirror.projects`, decided here: the ADR needs the Runner to know them and names no message). MIROIR-2 adds the token, MIROIR-4 the Runner's side. The refonte (PRD #169, ADRs 0011–0014) leaves this ticket unchanged but for one boundary: the envelopes are GitHub's alone (ADR 0012 keeps GitHub's webhooks as its way of following a repository), so only a Projet with a GitHub repository gets them; a Local Projet (PROJET-6) enters the Runner's copy through its own Source (SOURCE-2, MIROIR-6), and its folder is followed on the machine (SOURCE-3).

## Current state of the code

- `apps/server/src/github/webhooks/`: `WebhookDispatcher` and `GitHubEvents.on(eventName, handler)` (`dispatcher.ts`): a handler gets a `GitHubEvent` (`deliveryId`, `pilotId`, `installationId`, `event`, `action`, `payload` in memory only, `sourceAt`) in the Pilote's scope; `payload.ts` reads metadata from a payload (`installationIdOf`, `actionOf`). No handler is registered for the repositories' events yet (BOUCLE-1 adds the Tickets').
- `apps/server/src/github/reconciliation/reconciliation.service.ts`: `ReconcileHooks`, `RECONCILE_EVERY_MS` (15 min).
- `apps/server/src/realtime/events.writer.ts`: the tabs' events, `pilots.seq` incremented in the change's transaction (the pattern to copy for a counter); `retention.job.ts`: `EventsRetention`, the one job allowed `prisma.unscoped` (`src/scope/unscoped.lint.spec.ts`).
- `apps/server/src/runners/`: `RunnersGateway` (`hello`, then `RunnerPresence.connected(…, accept)` sends `hello.accepted` before the `onOnline` hooks), `RunnerConnections.of(pilotId)` (the accepted link, `send`), `RunnerCommands.send`, `RunnerDispatcher.registerRunnerHandler`, `apps/server/src/testing/fake-runner.ts`.
- `packages/contracts/src/runner/`: `protocol.ts` (`PROTOCOL_VERSION = 1`, the unions `zRunnerToServer`, `zServerToRunner`), `hello.ts`, `envelope.ts` (`runnerMessage`); fixtures `packages/contracts/fixtures/runner/<type>.json`; `zSeq` in `values.ts`.
- Created by PROJET-2 (PR #157, open): `Project` (`apps/server/src/projects/`, `projects` table) with `githubRepoId`, `owner`, `name`, `fullName`, `displayName`, `integrationBranch`, `accessLost`, and `Repository` with `installationId`.
- No `github_changes`, no `mirror` message (checked on origin/develop e8a0ea3). The Runner's store that consumes them exists: `apps/runner/internal/mirror/` (MIROIR-3, merged: `schema.sql` `projects` keyed by `<owner>/<name>` with `github_repo_id`, `installation_id`, `integration_branch`).

## To do

- **Contracts** `packages/contracts/src/runner/mirror.ts` (exported from `index.ts`, added to the unions of `protocol.ts`, a fixture per message in `fixtures/runner/`), then `pnpm exec nx run contracts:generate`:
  - `zGitHubChangeKind = z.enum(['issue', 'pull', 'push', 'check', 'release', 'label', 'milestone'])`.
  - `zGitHubChange`: `{ seq: zSeq, projectId: zId, repository: string ('<owner>/<name>'), kind, number: int | null, sha: zSha | null, ref: string | null, action: string | null, at: zInstant }`.
  - `hello` gains `mirrorAfter: zSeq.nullable().optional()` (absent from a Runner without a Miroir: the server sends it nothing of this ticket).
  - server → Runner `github.changed { change: zGitHubChange }`; `mirror.resync {}`; `mirror.live { seq: zSeq }` (the replay is over: every envelope up to `seq` was sent; after a `mirror.resync`, `seq` is the counter's value then); `mirror.projects { projects: [{ projectId, repository, githubRepoId, installationId, displayName, integrationBranch }] }`.
- **Prisma** (one migration): `Pilot.githubChangeSeq BigInt @default(0) @map("github_change_seq")`; `GitHubChange` (`github_changes`): `pilotId`, `seq BigInt`, `projectId` (uuid, no foreign key: a removed Projet's envelopes age out), `repository`, `kind` (enum `GitHubChangeKind`), `number Int?`, `sha String?`, `ref String?`, `action String?`, `at Timestamptz`; `@@id([pilotId, seq])`, `@@index([at])`. Scoped by `pilotId` (ADR 0008).
- **Server** `apps/server/src/github/changes/` (`GitHubChangesModule`):
  - `changes.mapping.ts`: pure `changeOf(event: string, payload): ChangeFacts | null`, where `ChangeFacts` is `{ githubRepoId, kind, number, sha, ref, action }`:
    - `issues` → `issue`, `issue.number`; `issue_comment` → `pull` when `issue.pull_request` is present, else `issue`, `issue.number`; `sub_issues` → `issue`, `parent_issue.number`; `issue_dependencies` → `issue`, `blocked_issue.number`;
    - `pull_request`, `pull_request_review`, `pull_request_review_comment` → `pull`, `pull_request.number`, `sha` = `pull_request.head.sha`;
    - `check_run`, `check_suite` → `check`, `sha` = `check_run.head_sha` or `check_suite.head_sha`, `number` = the one `pull_requests[].number` when there is exactly one, else null; `status` → `check`, `sha`;
    - `push` → `push`, `ref`, `sha` = `after`; `release` → `release`; `label` → `label`; `milestone` → `milestone`, `milestone.number`;
    - `action` = the payload's `action` (null for `push` and `status`); any other event, or a payload without `repository.id`, → null.
  - `GitHubChanges` registers one handler per event above on `GitHubEvents`; for a repository that is a Projet of the Pilote (`Project` by `pilotId` and `githubRepoId`, not `accessLost`), in one transaction: `pilots.github_change_seq` incremented (`UPDATE … RETURNING`, row locked), the `github_changes` row inserted with `at` = `GitHubEvent.sourceAt`; after the commit, `MirrorRelay.publish(pilotId, change)`. Another repository writes nothing.
  - `MirrorRelay` (`apps/server/src/github/changes/mirror-relay.ts`): on the Runner's accepted `hello` carrying `mirrorAfter` (a hook the gateway calls with the hello, beside `onOnline`): sends `mirror.projects`; then, when `mirrorAfter` is null or envelopes after it were deleted (the oldest kept `seq` is above `mirrorAfter + 1`, or none is kept while `github_change_seq` is above `mirrorAfter`), `mirror.resync` and no replay (the Runner reconciles); else every envelope with `seq > mirrorAfter`, in order, by pages of 500; then `mirror.live` with the last `seq` sent (or the counter, after a `mirror.resync` or an empty replay); then live. `publish` of a link still replaying buffers the change, sent once the replay reached it (no gap, no duplicate: a `seq` already sent is skipped). A Runner without `mirrorAfter` in its hello gets nothing.
  - `mirror.projects` again, live, after each change of the Pilote's Projets (a Projet followed, unfollowed, renamed, its integration branch changed or `accessLost` changed): a hook PROJET-2's service calls after its commit (`ProjectsService.onChanged`, added here if absent).
  - `GitHubChangesRetention`: every day at 04:15 UTC, deletes `github_changes` older than 7 days (`GITHUB_CHANGES_KEPT_MS`); allowed `prisma.unscoped` beside `EventsRetention` (add it to the lint's allowlist).
- `apps/server/test/fixtures/webhooks/`: one signed payload per event above, from GitHub's webhook docs (bodies and texts replaced by placeholders), used by the mapping's and the integration tests.
- `apps/server/src/testing/fake-runner.ts`: sends `mirrorAfter` when asked and records `github.changed`, `mirror.resync`, `mirror.live`, `mirror.projects`.

## Decisions already made

- The envelope never carries a title, a body, a label's name or a branch other than `ref`: the Runner fetches everything else from GitHub (ADR 0010, ADR 0003). A test asserts the keys of a row and of a `github.changed`.
- The counter is `pilots.github_change_seq`, not the tabs' `seq`: the two streams never share a number (ADR 0010, Revue croisée R1).
- `sub_issues` names the parent and `issue_dependencies` the blocked issue: the Runner stores each relation with the side whose fetch rewrites it (MIROIR-3).
- A `check_run` of several PRs names none: the Runner refreshes the checks of every PR whose head or merge commit is that `sha`.
- `mirror.projects` lists the Pilote's Projets that have a GitHub repository (`Project.repositoryId` set, not `accessLost`) and only those: once PROJET-6 makes the repository optional, a Local Projet is absent from this ticket's list; MIROIR-6 widens the message for it. A Projet whose `ticket` and `code` groups both left GitHub (SOURCE-8) is no longer followed, by that ticket.
- `PROTOCOL_VERSION` stays 1: the new fields are optional and no Runner is released yet.
- Replay pages of 500 envelopes, live sends never queued for an offline Runner (it replays at its next `hello`).

## Acceptance criteria

- [ ] Each of the 14 events maps to its kind, number, sha, ref and action (unit test per fixture); an event of a repository that is not a Projet writes nothing.
- [ ] A webhook of a Projet writes one `github_changes` row with the next `seq` of its Pilote; two concurrent deliveries get two consecutive `seq` (integration).
- [ ] No `github_changes` row nor `github.changed` message has a key outside the envelope's (test on the keys).
- [ ] A Runner connecting with `mirrorAfter: 3` gets `mirror.projects`, then `seq` 4, 5… in order, then the live ones, with no gap nor duplicate when a webhook arrives during the replay (integration with `fake-runner`).
- [ ] `mirrorAfter: null`, or older than the oldest kept envelope, gets `mirror.resync`, then `mirror.live` with the counter, before the live stream; a replay ends with `mirror.live` and its last `seq`.
- [ ] Following or unfollowing a Projet sends `mirror.projects` to the connected Runner.
- [ ] Envelopes older than 7 days are deleted by the retention job; younger ones stay.
- [ ] A Runner whose hello has no `mirrorAfter` receives none of these messages.

## Verification

- `pnpm exec nx test server -- src/github/changes/`
- `pnpm exec nx test contracts -- src/runner/`
- `pnpm exec nx test-integration server -- github-changes`
- `pnpm exec nx run contracts:generate` (commit the Go types it writes), then `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

A migration (`github_changes`, `pilots.github_change_seq`), applied by the deploy. The five new events reach the server only once INFRA-11 subscribed the Apps to them.

## Out of scope

- The « Miroir » token: MIROIR-2. The Runner's side of these messages: MIROIR-4.
- The Tickets' own copy on the server (titles, states, blocked-by): BOUCLE-1.
- A Local Projet in `mirror.projects`: MIROIR-6. Following a Local folder and `local.changed`: SOURCE-3.

## Dependencies

- PROJET-2.
