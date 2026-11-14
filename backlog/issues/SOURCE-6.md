---
id: SOURCE-6
title: "The Source wins: a taken Ticket keeps its version, « modifié depuis sa prise » and « Relancer », a Ticket closed at its Source stops and restarts from its branch"
epic: SOURCE
type: feature
priority: P1
size: M
milestone: M4 Boucle
blocked_by: [BOUCLE-5, SOURCE-3, MIROIR-7]
adr: [0012]
risques: []
stories: [US-103]
screens: [ticket-modifie-a-la-source, ticket-ferme-a-la-source]
revue_visuelle: true
video: false
---

## Context

US-103: what the Pilote's team decides in its tools is never overridden by the agents. A Ticket changed at its **Source** while an agent works on it keeps the version it was taken with, shows « modifié depuis sa prise » and restarts in one click; a Ticket closed at its Source stops, its change of code closed with a comment, its branch kept and the stop in its history, and starts again from that branch if it is reopened. ADR 0012 (« The Source wins ») sets the mechanism for both Sources: an immutable snapshot on the Runner per PhaseRun, a `contentHash` (HMAC-SHA256 of title and body under a key derived from the vault key, so that it says nothing of the text) computed by the Runner, compared with the snapshot's.

## Current state of the code

- `packages/contracts/src/runner/protocol.ts`: the two unions (no Ticket message). `apps/server/src/runners/runner-dispatcher.ts`: one handler per type.
- `packages/skin-passerelle/src/process-track.ts`: `ui-step` states without `stopped`; `banner.ts`, `key-value.ts`.
- No `tickets` table, no Ticket page on develop.
- Created by BOUCLE-1: `tickets` (`source`, `number`, `state`, `stateReason`, `ready`, `prNumber`, `prBranch`, `headSha`, sealed titles for Local), `code_changes`, the GitHub handlers (`issues` closed and reopened, `pull_request`), `GET /api/projects/:id/tickets/:number`.
- Created by SOURCE-3: `local.changed { projectId, items }` (identifiers, states, sealed texts, `contentHash`) written with its events; created by SOURCE-2: `apps/runner/internal/source/` (`Reader`, `Writer`), `local/`, `local.db`, `ContentHash(vault, title, body)` (`v<vaultVersion>.` + HMAC-SHA256, for both Sources).
- Created by MIROIR-7: `miroir issue …` and `miroir pr close|comment` for GitHub (Session token) and Local (`local.db` record, then report). Created by MIROIR-6: `miroir issue view` in gh's shapes.
- Created by BOUCLE-2: the Boucle admitting `ticket.ready` items (`Engine.admit`), its queue. Created by PROCESS-4: `phase_runs`, `step_runs`, the version pinned. Created by RUNNER-9: `SessionsService` stop and interrupt, `session.start`.
- Created by BOUCLE-5: the page `/projets/:id/tickets/:number` (`apps/web/src/views/ticket.ts`, `PageTicket`), its « Avancement » `ProcessTrack`, header, Banners. Created by UI-9: `ui-step` state `stopped`.

## To do

- **Snapshot** (Runner, `apps/runner/internal/source/snapshot.go`): `session.start` gains `phaseRun?: { id, ticketNumber }`; at the first Session of a PhaseRun, the Runner writes `~/.crewdeck/snapshots/<phaseRunId>.json` (mode 600: `title`, `body`, `contentHash`, `takenAt`) from the Source (its Miroir copy, read through first), then reports `ticket.taken { phaseRunId, contentHash, takenAt }`. It never rewrites an existing snapshot. `CREWDECK_PHASE_RUN_ID` is set in the Session's environment.
- `miroir issue view <n>` inside a Session whose `CREWDECK_PHASE_RUN_ID` has a snapshot for `n`: `title` and `body` from the snapshot, every other field live; on stderr « #<n> modifié depuis sa prise : tu travailles sur la version du <HH:MM>. » when the Source's `contentHash` differs.
- A hash of another vault key version than the Ticket's current one is never compared: the Runner recomputes the snapshot's hash under the current version and reports `ticket.taken` again (the snapshot's text unchanged).
- Server → Runner `snapshot.drop { phaseRunId }` when the PhaseRun ends (`done`, `stopped`, `failed`); the Runner also drops snapshots older than 30 days at start.
- **Hashes of GitHub Tickets**: each time the Miroir applies a change of an issue's title or body (MIROIR-4's follower), the Runner reports `ticket.hashes { projectId, items: [{ number, contentHash }] }` (batched, 1 s); Local's come with `local.changed`.
- Contracts `packages/contracts/src/runner/tickets.ts` (`ticket.taken`, `ticket.hashes`, `snapshot.drop`, the `session.start` field), fixtures in `packages/contracts/fixtures/runner/`, then `pnpm exec nx run contracts:generate`.
- **Prisma**: `tickets.contentHash?`, `tickets.contentChangedAt?` (set when the hash changes); `phase_runs.takenContentHash?`, `phase_runs.takenAt?`, `phase_runs.stopReason?` (`closed-at-source | restarted`).
- **Server** `apps/server/src/tickets/source-wins.ts`:
  - the Ticket's view gains `modifiedSinceTake` (its running or waiting PhaseRun's `takenContentHash` differs from the Ticket's `contentHash`) and `takenAt`, `contentChangedAt`; its `ticket.upserted` event when either hash changes.
  - `POST /api/projects/:id/tickets/:number/restart { seq }` (« Relancer sur la nouvelle version »): in one transaction the PhaseRun `stopped` (`restarted`), its open StepRun stopped, its Session interrupted, then the Ticket admitted first in the Boucle's queue on its branch; the new PhaseRun takes the Ticket as its Source has it now. 404 `ticket.not-found`, 409 stale, 422 `ticket.not-modified` (no PhaseRun, or the hashes equal), 422 `runner.offline`.
  - **Closed at the Source** (BOUCLE-1's `issues.closed`, or `local.changed` with `state: closed`) while a PhaseRun runs or waits: in one transaction, the PhaseRun `stopped` (`closed-at-source`), its StepRun stopped, its Session interrupted, its Décisions resolved (`outcome: closed-at-source`); then the change is closed with the comment « Fermée : le Ticket #<n> a été fermé à sa Source. La branche <branche> est gardée ; s'il est rouvert, le travail repart d'elle. »: on GitHub by the App (`GitHubClient.closePullRequest` and `createIssueComment`, added to the fake GitHub), on Local by the Runner (`change.close { projectId, number, comment }`, MIROIR-7's Local writer). Its branch is never deleted.
  - **Reopened** (`issues.reopened`, or `local.changed` with `state: open`) with a change closed by this path: the change reopened (GitHub App, or `change.reopen` to the Runner), and the Ticket first in the Boucle's queue on its branch once it is ready.
- **Web** (`apps/web/src/views/ticket.ts`, `PageTicket`):
  - modified: header count « <Projet> · modifié depuis sa prise »; caution Banner « Modifié depuis sa prise »: « Le Ticket a changé <sur GitHub | dans le dossier du Projet>, sa Source, à <HH:MM>. L'agent continue sur la version prise à <HH:MM> ; relance-le pour qu'il reparte de la nouvelle. », buttons « Relancer sur la nouvelle version » (primary, `restart`) and, on GitHub only, « Voir la modification » (the issue on GitHub);
  - closed: header count « <Projet> · arrêté »; neutral Banner « Fermé à sa Source »: « Le Ticket a été fermé <sur GitHub | dans le dossier du Projet> : son travail s'est arrêté. La branche <branche> est gardée ; s'il est rouvert, il repart d'elle. »; in « Avancement », the step that was running `stopped` with « arrêtée à <HH:MM> : Ticket fermé <…> », the next ones `todo`, the Merge's meta « tant que le Ticket reste fermé »;
  - an « Historique » card (KeyValue, newest first) from the PhaseRun and its StepRuns: « Pris par la Boucle », « <Étape> : … », « Arrêté : fermé <…>, sa Source. La branche est gardée. ».
- t() keys under `ticket.sourceWins.*`. Scenarios `apps/server/src/testing/scenarios/ticket.ts` gain `ticket-modifie-a-la-source` and `ticket-ferme-a-la-source`; Playwright `apps/web/e2e/ticket-source.spec.ts`.

## Decisions already made

- Mockup: `ticket-modifie-a-la-source`, `ticket-ferme-a-la-source` (pages `design/screens/crewdeck/ticket-modifie-a-la-source.html`, `…/ticket-ferme-a-la-source.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The review, checks and PR cards are BOUCLE-5's.
- The server never sees a title or body to compare: only the Runner's hashes (ADR 0003, ADR 0012). The snapshot never leaves the machine.
- Only the Session's own Ticket is frozen: other Tickets the agent reads (its blockers, its parent) are live.
- « Relancer » keeps the branch and the change: the new PhaseRun's Code starts from them, reading the new version. A modified Ticket is never restarted without the Pilote: the agent goes on with its version.
- A label or milestone change is not a modification (the hash covers title and body); readiness lost (`ready-for-agent` removed) does not stop a taken Ticket.
- Closing comes from the Source only: a Ticket closed by Crewdeck itself (« Arrêter » of a Décision, PROCESS-6) is not « fermé à sa Source ».
- « Voir la modification » is GitHub's issue page; a Local Ticket has no history to show, so no button.

## Acceptance criteria

- [ ] The first Session of a PhaseRun writes its snapshot and the server stores `takenContentHash`; a second Session of the same PhaseRun reuses it.
- [ ] Editing Ticket #53's body on the fake GitHub (or its Local file) after it was taken marks it « modifié depuis sa prise » within 2 s; `miroir issue view 53` inside its Session prints the taken body and the stderr line; outside a Session it prints the new one.
- [ ] Changing only a label marks nothing.
- [ ] « Relancer sur la nouvelle version » stops the PhaseRun, starts a new one on the same branch whose snapshot is the new version; 422 `ticket.not-modified` when nothing changed, 409 with an older `seq`, 404 for another Pilote's Ticket.
- [ ] Closing #53 at its Source while its Review runs stops the PhaseRun and the Session, closes its PR with the comment (fake GitHub records it) or its Local change record, keeps its branch, and the history shows « Arrêté : fermé sur GitHub, sa Source. »; the Merge never runs.
- [ ] Reopening #53 reopens its change and the Boucle takes it first, from its branch.
- [ ] The snapshot is deleted when the PhaseRun ends.
- [ ] `ticket-modifie-a-la-source` and `ticket-ferme-a-la-source` match their mockups at 390 and 1280 px (Playwright against the fake Runner and the fake GitHub, axe without violations); the captures come from those tests.
- [ ] The new protocol messages' fixtures are valid in TypeScript and in Go.

## Verification

- `pnpm exec nx test server -- src/tickets/source-wins.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- source-wins`
- `cd apps/runner && go test ./internal/source/ ./internal/mirror/ -run 'Snapshot|Hash'`
- `pnpm exec nx e2e web -- ticket-source.spec.ts`; `scripts/captures.sh ticket-modifie-a-la-source ticket-ferme-a-la-source` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (columns of `tickets` and `phase_runs`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- The Ticket's page itself, its review and checks: BOUCLE-5. Stopping an item from a Décision: PROCESS-6.
- A Ticket moved to another Source: SOURCE-8.

## Dependencies

- BOUCLE-5
- SOURCE-3
- MIROIR-7
