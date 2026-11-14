---
id: BOUCLE-1
title: "Tickets and changes of code on the server, whatever their Source: tables with source and sealed titles, fed from GitHub (issues, milestones, PRs, checks, native blocked-by)"
epic: BOUCLE
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PROJET-2]
adr: [0002, 0003, 0007, 0008, 0010, 0012]
risques: [OPS-4]
stories: [US-15, US-16]
screens: []
revue_visuelle: false
video: false
reprend: 58
---

## Context

The server keeps the state of the work of every Projet (ADR 0001): what each Ticket is, whether it is ready, which change of code delivers it, and on which commit its checks stand. The Boucle (BOUCLE-2 to BOUCLE-9), the planning and the ticket tree (PILOTAGE-1, PILOTAGE-2), the statistics (PILOTAGE-3), an Idée turned into a Ticket (IDEE-5) and the Découpage (CONCEPTION-9) all read these rows.

The refonte (PRD #169, ADR 0012) makes a Ticket and a change of code live on a Source, Local or GitHub, one per group (`ticket`, `code`) of the Projet. The server keeps « the same rows as for a GitHub Projet » for a Local one: `tickets` and `code_changes` carry their `source`, numbers, states, the product's labels, blocked-by, parent, dates and SHAs, and every free text of a Local row (titles, milestones' titles, other labels) is sealed by the Runner under the vault key. This ticket creates those tables with both shapes and fills them from GitHub: metadata fed by the webhooks within 2 s (US-20) and repaired by the reconciliation (risk OPS-4). The Local side (the Runner's `local.changed` writing these rows with `source: local`) is SOURCE-3, through the writer this ticket exposes. The server never stores nor logs an issue's, a comment's nor a review's body (ADR 0003: GitHub titles are readable, content is not).

## Current state of the code

- `apps/server/src/github/github.client.ts`: `GitHubClient` with installation tokens and, for metadata, `listIssues`, `getPullRequest`, `listCheckRuns`, `getCombinedStatus`, `listSubIssues`, `listIssueDependencies` (the issues a number is blocked by), `listLabels`; no `listMilestones` nor `listPullRequests`. `octokit.client.ts`; the fake GitHub `apps/server/src/testing/fake-github.ts`, signed payloads in `apps/server/test/fixtures/webhooks/`.
- `apps/server/src/github/webhooks/dispatcher.ts`: `POST /api/github/webhooks`, `GitHubEvents.on(eventName, handler)` (a `GitHubEvent` with `pilotId`, `event`, `action`, `payload` in memory only, `sourceAt`), in the Pilote's scope; `apps/server/src/github/reconciliation/reconciliation.service.ts`: `register({ key, reconcile(target) })`, `target` one installation with its Pilote (`{ pilotId, installationId }`), at start and every 15 min.
- `apps/server/src/realtime/`: `Transactions.run`, `EventsWriter.write(tx, pilotId, type, payload, { sourceAt, source })`, `STATE_CONTRIBUTORS`; `packages/contracts/src/events/index.ts`: `RESOURCES` has `ticket`, not `milestone` nor `code-change`; `registerEventPayload`.
- No `tickets`, `milestones` nor `code_changes` table (last migration `20261119000000_decisions`).
- Created by PROJET-2: `Project` (`apps/server/src/projects/`) with `repositoryId`, `owner`, `name`, `integrationBranch`, the installation of its `Repository`.

## To do

- **Prisma** (`apps/server/prisma/schema.prisma`, scoped by `pilotId`, `@map` snake_case, UUIDv7 ids), one migration:
  - `TicketSource` enum `github | local`.
  - `Ticket` (`tickets`): `id`, `pilotId`, `projectId`, `source`, `number` (int), `title?` (GitHub), `titleSealed?` (jsonb, Local), `state` (`open` | `closed`), `stateReason?` (`completed` | `not_planned`), `closedAt?`, `readyMark` (bool: the label `ready-for-agent` on GitHub, the front matter's `ready` on Local), `ready` (bool, stored), `labels` (string[], readable), `labelsSealed?` (jsonb, Local's other labels), `priority?` (`P0` | `P1` | `P2`), `size?` (`XS` | `S` | `M` | `L` | `XL`), `milestoneNumber?`, `blockedBy` (int[], numbers of the same Projet), `parentNumber?`, `branchPrefix` (`feat` | `fix` | `chore`: from the `type:*` label on GitHub, `type:fix` → `fix`, `type:chore` → `chore`, any other or none → `feat`; reported by the Runner for Local), `visualReview` (bool: the label `revue-visuelle` on GitHub; reported by the Runner for Local), `sourceCreatedAt`, `sourceUpdatedAt`, `updatedAt`. Unique `(projectId, number)`. A `CHECK`: `source = 'github'` has `title` and no `titleSealed`, `source = 'local'` the reverse.
  - `Milestone` (`milestones`): `id`, `pilotId`, `projectId`, `source`, `number`, `rank` (int, readable: the order of the milestones, GitHub's milestone numbers ascending, the order of `tickets/milestones.yml` for Local), `title?`, `titleSealed?`, `state` (`open` | `closed`), `dueOn?` (`zDay`), `openCount`, `closedCount`, `closedAt?`. Unique `(projectId, number)`; the same `CHECK` on the title.
  - `CodeChange` (`code_changes`): `id`, `pilotId`, `projectId`, `source`, `number`, `ticketNumber?`, `title?`, `titleSealed?`, `state` (`draft` | `open` | `merged` | `closed`), `headRef?`, `baseRef`, `headSha?`, `checks` (`none` | `pending` | `passed` | `failed`), `checksSha?`, `mergedAt?`, `mergedBy?` (`loop` | `pilot`), `mergeSha?`, `sourceCreatedAt`, `updatedAt`. Unique `(projectId, number)`; the same `CHECK`.
  - `CodeChangeCheck` (`code_change_checks`): `id`, `pilotId`, `codeChangeId`, `sha`, `name`, `state` (`running` | `passed` | `failed`), `durationMs?`, `url?`. Unique `(codeChangeId, sha, name)`.
- **Contracts** `packages/contracts/src/api/tickets.ts`: `zTicketSource`, `zSealedItem` of `packages/contracts/src/keys/sealed.ts` (`{ key, ciphertext }`, the vault's `SealedItem`, created by PROJET-6 or by this ticket, whichever merges first, ADR 0011's item format; added there if no earlier ticket has), `zTicket`, `zMilestone`, `zCodeChange`, `zCodeChangeCheck`, `zChecksState`, the list output `{ items, nextCursor }`; `RESOURCES` gains `milestone` and `code-change`; events `ticket.upserted|removed`, `milestone.upserted|removed`, `code-change.upserted|removed` registered in `packages/contracts/src/events/tickets.ts`.
- **`apps/server/src/tickets/`**:
  - `tickets.writer.ts`, the one writer of these rows, for every Source: `TicketsWriter.upsertTickets(tx, projectId, source, items)`, `upsertMilestones(…)`, `upsertCodeChanges(…)`, `removeTicket(tx, projectId, number)`. Each writes its rows and their events in the caller's transaction, with `sourceAt` (latency, CORE-8); after any change of a Ticket it recomputes `ready` for it and for every Ticket it blocks, each with its own event. SOURCE-3 calls it with `source: 'local'` and sealed texts.
  - `tickets.webhooks.ts`, the GitHub side, handlers on the dispatcher for `issues` (opened, edited, closed, reopened, labeled, unlabeled, milestoned, demilestoned, deleted, transferred), `sub_issues`, `issue_dependencies` (`blocked_by_added`, `blocked_by_removed`, `blocking_added`, `blocking_removed`: the blocked issue's `blockedBy` reread with `listIssueDependencies`, then its `ready`), `milestone` (created, edited, opened, closed, deleted), `issue_comment` (forwarded as `TicketCommentEvent { projectId, issueNumber, commentId, author, isPullRequest, createdAt }` on an in-process emitter for BOUCLE-5 and BOUCLE-6, never the body), `pull_request` (opened, edited, synchronize, ready_for_review, converted_to_draft, closed, reopened), `pull_request_review` (forwarded as `PullRequestReviewEvent { prNumber, reviewer, state, commitId }`, no body), `check_suite`, `check_run`, `status`. They write with `source: 'github'`, only for the groups of the Projet whose Source is GitHub: `ProjectSources.isGithub(projectId, group)` (`apps/server/src/projects/project-sources.ts`; SOURCE-1's `artifact_sources` when it has landed, else this ticket adds it as `project.repositoryId !== null` and SOURCE-1 replaces its body).
  - `change-link.ts`: pure `ticketNumberOfBranch(branch): number | null` for `^(feat|fix|chore)/(\d+)-[a-z0-9-]+$`; a PR's `ticketNumber` comes from its head branch only (the server never reads a PR body).
  - `readiness.ts`: pure `isReady(ticket, ticketsByNumber)`: open, `readyMark`, `labels` without `needs-human`, and every `blockedBy` number a closed Ticket (an unknown number counts as open).
  - `labels.ts`: pure `priorityOf(labels)` (`P0`, `P1`, `P2` or `priority:P0`…), `sizeOf(labels)` (`XS` to `XL` or `size:S`…), `productLabels(labels)` (`priority:*`, `size:*`, `ready-for-agent`, `needs-human`), `branchPrefixOf(labels)` (`fix` for `type:fix`, `chore` for `type:chore`, else `feat`), `visualReviewOf(labels)` (`revue-visuelle` present), null or empty when absent. For a Local Ticket the writer takes `branchPrefix` and `visualReview` as the Runner reports them.
  - `checks.ts`: pure `aggregateChecks(checks)`: `none` without any check, `pending` if one is queued or in progress, `failed` if one ended in failure, cancelled, timed_out or action_required, else `passed` (success, neutral, skipped).
  - `tickets.reconcile.ts`: registers `{ key: 'tickets', … }` with the reconciliation, for each Projet of the installation whose `ticket` or `code` group is on GitHub: lists open issues and those updated since the last run (installation token), milestones, open PRs and the check runs and statuses of their head; reads each open issue's native blocked-by; through the `GitHubClient` methods that exist and two new ones, `listMilestones` and `listPullRequests` (metadata only, in `octokit.client.ts` and the fake GitHub).
  - A PR merged sets `mergedAt`, `mergeSha` and `mergedBy` (`loop` when merged by `crewdeck[bot]`, else `pilot`); a Ticket is never deleted when its issue closes.
  - `tickets.state.ts`: `StateContributor` keys `tickets` (every open Ticket and those closed in the last 30 days, all Projets), `milestones` (open, or closed in the last 30 days), `codeChanges` (open or draft, and those merged or closed in the last 30 days).
  - `tickets.controller.ts`: `GET /api/projects/:id/tickets?state=open|closed&cursor=` (50 per page, by number descending), `GET /api/projects/:id/tickets/:number` (the Ticket with its code changes, `ticketNumber` = its number, and the `checks` rows of the latest one's `headSha`). 404 `ticket.not-found` « Ce Ticket n'existe pas. » (in `apps/server/src/errors/messages.ts`), 404 for another Pilote's Projet.
- **Web**: `tickets`, `milestones` and `codeChanges` slices of `apps/web/src/store/`, applying the events; `apps/web/src/api/tickets.ts`. A sealed title is kept as it comes; opening it in the page is the reader's (SOURCE-3).

## Decisions already made

- One table per kind of object for every Source, not one per Source: the Boucle, the planning and the statistics read one shape (ADR 0012, « What the server keeps of a Local Projet »). `source` says where the row comes from; a row whose group moves to another Source is rewritten by the migration (SOURCE-8), never duplicated.
- The readable labels of a Local Ticket are the product's (`priority:*`, `size:*`, `ready-for-agent`, `needs-human`): the server needs them to compute `ready`, priority and size; and only those. Every other Local label is in `labelsSealed`; what the Boucle needs of them travels as the two readable figures `branchPrefix` and `visualReview`, computed by the Runner. A GitHub Ticket's labels are all readable (they are on GitHub). A milestone's `rank` is readable for both Sources, so that BOUCLE-2 orders Tickets by milestone without opening a sealed title.
- Blocked-by comes from GitHub's native issue dependencies only (what `plan-backlog` creates); a « Blocked by #n » line in a body is never parsed. A change of dependencies comes from the `issue_dependencies` event, the reconciliation catching a lost one; never from polling by the page.
- Priority and size come from labels: the App cannot read the Pilote's user-owned GitHub Project fields. Missing values sort last (BOUCLE-2).
- Milestones come from the `milestone` event and the `milestone` object of the issue payloads (`open_issues`, `closed_issues`, `due_on`, `state`, `closed_at`), and from the reconciliation.
- The `issue.body`, `comment.body`, `pull_request.body` and `review.body` fields are dropped at the edge of the handler, before any storage, event or log.
- `ready` is stored (not computed on read) so that the Boucle's admission and the page agree on one value, written in the same transaction as the change that moved it.
- No `loopStep`, `ideaId` nor `designId` column: a Ticket's progress is its PhaseRun's StepRuns (PROCESS-4), its origin the PhaseRuns' lineage (PROCESS-5).
- Cross-repository blockers are ignored (counted as absent) at the MVP.

## Acceptance criteria

- [ ] An `issues.opened` webhook with the label `ready-for-agent` creates the Ticket `source: github`, `readyMark` and `ready` true, and a tab receives its `ticket.upserted` event; the row and the event are written in one transaction.
- [ ] A Ticket blocked by an open Ticket is not ready; closing the blocker makes it ready, with its own `ticket.upserted` event.
- [ ] An `issue_dependencies.blocked_by_added` webhook alone makes the blocked Ticket not ready; `blocked_by_removed` makes it ready again.
- [ ] A `milestone.edited` webhook changing `due_on` updates the milestone and sends `milestone.upserted`.
- [ ] The label `needs-human` makes a Ticket not ready; removing it makes it ready again.
- [ ] A GitHub issue labelled `type:fix` and `revue-visuelle` gets `branchPrefix: fix` and `visualReview: true`, one without `type:*` gets `feat`; a Local write keeps the figures the Runner gave; milestones carry `rank` (GitHub: by number) and a Local milestone's `rank` stays readable beside its sealed title.
- [ ] A PR on the branch `feat/42-connexion-github` gives a `code_changes` row with `ticketNumber: 42`, its state and `headSha`; a PR on another branch has no `ticketNumber`.
- [ ] `check_run` and `status` events on the PR's head update `code_change_checks` and `checks` (`pending`, then `passed` or `failed`); checks of an older SHA never change the current `checks`.
- [ ] A PR merged by `crewdeck[bot]` sets `mergedBy: loop` and `mergeSha`, by anyone else `mergedBy: pilot`.
- [ ] `TicketsWriter.upsertTickets` with `source: 'local'` and a sealed title stores it, computes `ready` from `readyMark` and the product's labels, and its event carries `titleSealed` and no `title`; a `github` row with a sealed title and no `title` is refused by the database.
- [ ] A webhook for a Projet whose `ticket` group is not on GitHub writes nothing (`ProjectSources.isGithub` false).
- [ ] A payload whose bodies carry a marker string leaves the marker in no table, no event and no log line (test over the logger's output and the database).
- [ ] The reconciliation alone (no webhook) brings a Ticket created on GitHub, its blocked-by, its milestone counts and its PR to the right state.
- [ ] `GET /api/projects/:id/tickets` follows ADR 0008's route baseline: output schema, 400 with `fields` on a bad `state`, 401 without a session, 404 for another Pilote's Projet, `nextCursor` after 50 items.
- [ ] `isReady`, `ticketNumberOfBranch`, `priorityOf`, `sizeOf`, `productLabels` and `aggregateChecks` have unit tests for each case listed above.

## Verification

- `pnpm exec nx test server -- src/tickets/`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- tickets`
- `pnpm exec nx test contracts`, `pnpm exec nx run contracts:generate` with no diff
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

A migration (tables `tickets`, `milestones`, `code_changes`, `code_change_checks`); the GitHub Apps subscribe to these events, `issue_dependencies` and `milestone` included (INFRA-11). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- The Local rows (`local.changed`, sealed by the Runner) and opening sealed titles in the page: SOURCE-3. A local change of code and its merge: SOURCE-5.
- `artifact_sources` and the Sources of a Projet: SOURCE-1. A Ticket changed or closed at its Source while it runs (`contentHash`, « modifié depuis sa prise »): SOURCE-6. Moving a group to another Source: SOURCE-7, SOURCE-8.
- Admitting ready Tickets into the Boucle's Phase: BOUCLE-2. The Merge and the head SHA gate: BOUCLE-4. The `checks` kind: BOUCLE-9.
- What a comment says (blocked, changes requested): BOUCLE-5, BOUCLE-6 read it in the browser.
- Creating issues: CONCEPTION-9 and IDEE-5 (through `miroir issue create`, MIROIR-7).

## Dependencies

- PROJET-2.
