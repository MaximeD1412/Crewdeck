---
id: BOUCLE-1
title: "Tickets mirrored from GitHub: issues, milestones, PRs, checks and native blocked-by"
epic: BOUCLE
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PROJET-1, PROJET-2]
adr: [0002, 0003, 0007, 0008]
risques: [OPS-4]
stories: [US-15, US-16]
screens: []
revue_visuelle: false
video: false
---

## Context

A **Ticket** is an issue of the **Projet**'s repository (glossary). The **Boucle** (BOUCLE-2 to BOUCLE-8), the planning and the ticket tree (PILOTAGE-1, PILOTAGE-2), the statistics (PILOTAGE-3), an **Idée** turned into a Ticket (IDEE-5) and the **Découpage** (CONCEPTION-9) all read the same mirror: what each Ticket is, whether it is ready, which PR delivers it, and on which commit its checks stand. GitHub stays the source of truth; this ticket keeps a metadata copy, fed by the webhooks within 2 s (US-20) and repaired by the reconciliation (risk OPS-4). The server never stores nor logs an issue's or a comment's body (ADR 0003: titles are readable, content is not).

## Current state of the code

- No code in the repository: only the docs (`docs/product/prd.md`, `docs/adr/0001` to `0009`, `CONTEXT.md`, `AGENTS.md`, `design/`, `docs/pilotage/risques.json`).
- Created by CORE-3: `apps/server/src/github/` (the `GitHubClient` interface, installation tokens) and the fake GitHub `apps/server/test/fakes/github.ts`.
- Created by CORE-5: `apps/server/src/realtime/` (`EventsWriter.write`, `StateContributor`, `GET /api/state`).
- Created by CORE-2: `apps/server/src/scope/` (scoped Prisma models).
- Created by PROJET-1: the webhook receiver `POST /api/github/webhooks` with its dispatcher (handlers registered per event name, the Pilote's scope opened from the installation) and the reconciliation that each module joins (a `reconcile(project)` step, every 15 min and at start).
- Created by PROJET-2: the `Project` model (`apps/server/src/projects/`) with its repository (`owner`, `name`, installation id) and the Projet's integration branch.

## To do

- Prisma models (`apps/server/prisma/schema.prisma`, scoped by `pilotId`, `@map` snake_case, UUIDv7 ids), one migration:
  - `Ticket`: `id`, `pilotId`, `projectId`, `number` (int), `title`, `state` (`open` | `closed`), `closedAt?`, `labels` (string[]), `milestoneNumber?`, `priority?` (`P0` | `P1` | `P2`), `size?` (`S` | `M` | `L`), `blockedBy` (int[], issue numbers of the same repository), `ready` (bool, stored), `prNumber?`, `prState?` (`draft` | `open` | `merged` | `closed`), `prBranch?`, `headSha?`, `checks` (`none` | `pending` | `passed` | `failed`), `checksSha?`, `mergedAt?`, `mergedBy?` (`loop` | `pilot`), `loopStep?` (left null here, set by BOUCLE-2 onwards), `ideaId?` (set by IDEE-5), `designId?` (set by CONCEPTION-9), `githubCreatedAt`, `updatedAt`. Unique `(projectId, number)`.
  - `Milestone`: `id`, `pilotId`, `projectId`, `number`, `title`, `state` (`open` | `closed`), `dueOn?` (`zDay`), `openCount`, `closedCount`, `closedAt?`. Unique `(projectId, number)`.
  - `TicketCheck`: `id`, `pilotId`, `ticketId`, `sha`, `name`, `state` (`running` | `passed` | `failed`), `durationMs?`, `url`. Unique `(ticketId, sha, name)`.
- Contracts `packages/contracts/src/api/tickets.ts`: `zTicket`, `zMilestone`, `zTicketCheck`, `zTicketChecksState`, the list output `{ items, nextCursor }`; events `ticket.upserted`, `milestone.upserted` (and `ticket.removed` when an issue is deleted or transferred) in `packages/contracts/src/events/`.
- `apps/server/src/tickets/`:
  - `tickets.webhooks.ts`: handlers on PROJET-1's dispatcher for `issues` (opened, edited, closed, reopened, labeled, unlabeled, milestoned, demilestoned, deleted, transferred), `sub_issues`, `issue_comment` (forwarded as `TicketCommentEvent { projectId, issueNumber, commentId, author, isPullRequest, createdAt }` on an in-process emitter for BOUCLE-5 and BOUCLE-6, never the body), `pull_request` (opened, edited, synchronize, ready_for_review, converted_to_draft, closed, reopened), `pull_request_review` (forwarded as `PullRequestReviewEvent { prNumber, reviewer, state, commitId }`, no body), `check_suite`, `check_run`, `status`.
  - `pr-link.ts`: pure function `ticketNumberOfBranch(branch): number | null` for `^(feat|fix|chore)/(\d+)-[a-z0-9-]+$`; a PR is linked to a Ticket by its head branch only (the server never reads a PR body).
  - `readiness.ts`: pure function `isReady(ticket, ticketsByNumber)`: open, labels include `ready-for-agent`, not `needs-human`, and every `blockedBy` number is a closed Ticket (an unknown number counts as open).
  - `labels.ts`: pure functions `priorityOf(labels)` (`P0`, `P1`, `P2` or `priority:P0`…) and `sizeOf(labels)` (`S`, `M`, `L` or `size:S`…), null when absent.
  - `checks.ts`: pure function `aggregateChecks(checks)`: `none` without any check, `pending` if one is queued or in progress, `failed` if one ended in failure, cancelled, timed_out or action_required, else `passed` (success, neutral, skipped).
  - `tickets.reconcile.ts`: joins PROJET-1's reconciliation: lists open issues and those updated since the last run (installation token), milestones, open PRs and the check runs and statuses of their head; reads each open issue's native blocked-by (`GET /repos/{owner}/{repo}/issues/{number}/dependencies/blocked_by`) through new `GitHubClient` methods `listIssues`, `listMilestones`, `listPullRequests`, `listChecksForRef`, `listBlockedBy` (metadata only, implemented in the fake GitHub too).
  - After any change of an issue, recompute `ready` for it and for every Ticket it blocks; each change writes its row and its `ticket.upserted` event in one transaction, with `sourceAt` = the webhook's delivery time (latency, CORE-8).
  - A PR merged sets `mergedAt` and `mergedBy` (`loop` when merged by `crewdeck[bot]`, else `pilot`) on its Ticket; a Ticket is never deleted when its issue closes.
  - `tickets.state.ts`: `StateContributor` keys `tickets` (every open Ticket and the Tickets closed in the last 30 days, all Projets) and `milestones` (every milestone that is open or closed in the last 30 days).
  - `tickets.controller.ts`: `GET /api/projects/:id/tickets?state=open|closed&cursor=` (50 per page, ordered by number descending), `GET /api/projects/:id/tickets/:number` (the Ticket with its `checks` rows of its `headSha`). 404 `ticket.not-found`, 404 for another Pilote's Projet.
- Web: `tickets` and `milestones` slices of `apps/web/src/store/`, applying the two events; `apps/web/src/api/tickets.ts`.

## Decisions already made

- Blocked-by comes from GitHub's native issue dependencies only (what `plan-backlog` creates); a « Blocked by #n » line in a body is never parsed (the server does not read bodies). ADR 0002's event list has no dependency event: a change of dependencies is caught by the next `issues` event of the issue or by the reconciliation, never by polling from the page.
- Priority and size come from labels (pick-issue's fallback): the App cannot read the Pilote's user-owned GitHub Project fields. Missing values sort last (BOUCLE-2).
- Milestones come from the `milestone` object of the issue payloads (its `open_issues`, `closed_issues`, `due_on`, `state`, `closed_at`) and from the reconciliation; no milestone webhook is subscribed.
- The `issue.body`, `comment.body`, `pull_request.body` and `review.body` fields are dropped at the edge of the handler, before any storage, event or log.
- `ready` is stored (not computed on read) so that the Boucle's choice and the page agree on one value, written in the same transaction as the change that moved it.
- Cross-repository blockers are ignored (counted as absent) at the MVP.

## Acceptance criteria

- [ ] An `issues.opened` webhook with the label `ready-for-agent` creates the Ticket, `ready: true`, and a tab receives its `ticket.upserted` event; the row and the event are written in one transaction.
- [ ] A Ticket blocked by an open Ticket is not ready; closing the blocker makes it ready, with its own `ticket.upserted` event.
- [ ] The label `needs-human` makes a Ticket not ready; removing it makes it ready again.
- [ ] A PR on the branch `feat/42-connexion-github` links to Ticket #42 (`prNumber`, `prState`, `headSha`); a PR on another branch links to nothing.
- [ ] `check_run` and `status` events on the PR's head update `TicketCheck` rows and `checks` (`pending`, then `passed` or `failed`); checks of an older SHA never change the current `checks`.
- [ ] A PR merged by `crewdeck[bot]` sets `mergedBy: loop`, by anyone else `mergedBy: pilot`.
- [ ] A payload whose bodies carry a marker string leaves the marker in no table, no event and no log line (test over the logger's output and the database).
- [ ] The reconciliation alone (no webhook) brings a Ticket created on GitHub, its blocked-by and its milestone counts to the right state.
- [ ] `GET /api/projects/:id/tickets` follows ADR 0008's route baseline: output schema, 400 with `fields` on a bad `state`, 401 without a session, 404 for another Pilote's Projet, `nextCursor` after 50 items.
- [ ] `isReady`, `ticketNumberOfBranch`, `priorityOf`, `sizeOf` and `aggregateChecks` have unit tests for each case listed above.

## Verification

- `pnpm exec nx test server -- src/tickets/`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- tickets`
- `pnpm exec nx test contracts`, `pnpm exec nx run contracts:generate` with no diff
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

A migration (tables `tickets`, `milestones`, `ticket_checks`); the GitHub Apps already subscribe to these events (INFRA-11). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- Choosing and taking Tickets: BOUCLE-2. `loopStep` and its display: BOUCLE-3.
- Merging and the head SHA gate: BOUCLE-4.
- What a comment says (blocked, changes requested): BOUCLE-5, BOUCLE-6 read it in the browser.
- Creating issues: CONCEPTION-9 and IDEE-5 (through the Runner).

## Dependencies

- PROJET-1
- PROJET-2
