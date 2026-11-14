---
id: SOURCE-3
title: "Following a Local folder: the watcher and its scans, local.changed with sealed texts, the server's Tickets, milestones and changes of a Local Projet on screen in under 2 s"
epic: SOURCE
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [SOURCE-2, BOUCLE-1]
adr: [0012, 0007, 0003]
risques: [OPS-9]
stories: [US-99, US-20]
screens: []
revue_visuelle: false
video: false
---

## Context

US-99: the Pilote edits a Local Ticket by hand and sees it on screen in under 2 s, the product keeping the state of the work as for any Projet. US-20: a change at a Source (a file of a Projet's folder) on screen in under 2 s, without reloading. ADR 0012, « Following the folder »: the Runner watches `tickets/` in the working tree and the integration branch's ref (fsnotify, 200 ms debounce), scans everything at start and every 60 s, every 2 s for a folder on a Windows drive under WSL (`/mnt/<x>/`, no inotify; risk OPS-9). « What the server keeps of a Local Projet »: the same rows as for GitHub, every text sealed by the Runner under the vault key; the Runner reports through `local.changed { projectId, items }` (identifiers, states, sealed texts, `contentHash`), written with their events in one transaction (ADR 0007), with the same latency measure as a webhook's. A file whose front matter does not parse raises `ticket.local-unreadable`. The Boucle (BOUCLE-2), the planning (PILOTAGE-1), the Source winning (SOURCE-6) and the migration (SOURCE-8) read these rows.

## Current state of the code

- `apps/runner/go.mod`: no `fsnotify`.
- `apps/server/src/decisions/decisions.service.ts`: `DecisionsService.raise(tx, …)` / `resolve` (one open per `(kind, subjectId)`); `packages/contracts/src/api/decisions.ts`: `DECISION_KINDS`; `apps/web/src/views/a-toi.ts`.
- `apps/server/src/runners/runner-dispatcher.ts`: `registerRunnerHandler`; `apps/runner/internal/protocol/client.go`: `OnConnected`.
- Created by SOURCE-2: `apps/runner/internal/source/` (`Reader`, `Writer`, the `Watcher` interface left for this ticket), `local/` (`Open`, `Scan` with `Unreadable { Path, Reason: front-matter|duplicate-number }`, `OnChange`, the Ticket file, `milestones.yml` read in order, `local.db` v1 with `tickets`, `changes`), `ContentHash`, `Vault.DeriveKey`, the running Runner opening one Local project per entry of `State.Projects`.
- Created by BOUCLE-1: `tickets`, `milestones`, `code_changes` with `source`, `titleSealed`, `labelsSealed` and the product's readable labels, `zSealed` (`packages/contracts/src/keys/`), `TicketsWriter.upsertTickets|upsertMilestones|upsertCodeChanges|removeTicket(tx, projectId, source, items)` writing rows, `ready` and events with `sourceAt`, `productLabels(labels)`, the web slices `tickets`, `milestones`, `codeChanges` keeping sealed titles as they come.
- Created by SOURCE-1: `artifact_sources` (`apps/server/src/process/sources/`), behind BOUCLE-1's `ProjectSources.isGithub(projectId, group)` (`apps/server/src/projects/project-sources.ts`).

## To do

- **Protocol** `packages/contracts/src/runner/local.ts`, Runner → server `local.changed { projectId, full: boolean, items, unreadable }`, fixtures in `packages/contracts/fixtures/runner/local/`, `pnpm exec nx run contracts:generate`:
  - `{ kind: 'ticket', number, state, stateReason, readyMark, labels (the readable ones: `priority:*`, `size:*`, `ready-for-agent`, `needs-human`), labelsSealed (the others as one sealed JSON array, or null), branchPrefix ('feat'|'fix'|'chore', from a `type:*` label, `feat` by default), visualReview (the label `revue-visuelle`), titleSealed, milestoneRank (int|null), blockedBy, parent, contentHash, createdAt, updatedAt, closedAt, observedAt }`, `{ kind: 'ticket-removed', number, observedAt }`;
  - `{ kind: 'milestone', rank (its order in `tickets/milestones.yml`, from 1), titleSealed, dueOn: zDay|null, observedAt }`, `{ kind: 'milestone-removed', rank }`;
  - `{ kind: 'change', number, ticketNumber (from its head branch `<feat|fix|chore>/<n>-…`, or null), titleSealed, state 'draft'|'open'|'merged'|'closed', baseRef, headSha, mergeSha, createdAt, updatedAt, mergedAt, closedAt, observedAt }` (no head branch name: its slug is the Ticket's title);
  - `unreadable: [{ key, reason: 'front-matter'|'duplicate-number', pathSealed }]`, always the Projet's whole current set; `key` is base64url of 16 bytes of HMAC(`DeriveKey("crewdeck/v1/path-key")`, relative path).
  - Sealing: `Vault.SealItem` with additional data `local:<projectId>:ticket:<number>:title`, `…:ticket:<number>:labels`, `…:milestone:<rank>:title`, `…:change:<number>:title`, `…:unreadable:<key>:path`.
- **Runner** `apps/runner/internal/source/local/watch.go` (the `Watcher`), `github.com/fsnotify/fsnotify` added:
  - fsnotify on `<folder>/tickets/` (and `milestones.yml`) and on `<folder>/.git/HEAD`, `.git/refs/heads/` and `.git/packed-refs`; events debounced 200 ms per Projet, then `Scan`; a full `Scan` at start and every 60 s; a folder under `/mnt/<letter>/` is polled (a `Scan` every 2 s, fsnotify not used); `OnRefsMoved(projectID)` called when a ref file changes, for the documentation index and SOURCE-5.
  - `report.go`: after a scan or an `OnChange` of SOURCE-2's writes, the items whose digest (HMAC of the plaintext item under `DeriveKey("crewdeck/v1/report-digest")`) differs from the last one sent go out as one `local.changed`; the digests are kept in `local.db` (the next migration of SOURCE-2's schema: `reported (project_id, kind, id, digest)`) once the send succeeded; on each accepted connection, one `full: true` report per Local Projet with every item.
  - `observedAt`: the file's modification time for a Ticket, the time of the write for what the Runner wrote itself.
- **Server** `apps/server/src/tickets/local/local-changed.handler.ts`, the `local.changed` handler, one transaction per message:
  - the Projet must be the Pilote's; ticket and milestone items are applied only when its `ticket` group is Local, change items only when its `code` group is (`ProjectSources.isGithub` false), else dropped with a log line (`local.not-local`, ids only);
  - `TicketsWriter.upsertTickets|upsertMilestones|upsertCodeChanges(tx, projectId, 'local', items)` with `sourceAt` = `observedAt` (source `runner`, the latency measure of CORE-8), `removeTicket` for `ticket-removed`; with `full: true`, the Projet's Local rows absent from the message are removed with their events;
  - `ticket.local-unreadable` (added to `DECISION_KINDS`): one open per `subjectId = <projectId>:<key>`, `subjectType: 'project'`, tone `caution`, label « Fichier de Ticket illisible », meta the reason (« front matter illisible » or « numéro déjà pris par un autre fichier »), params `{ pathSealed, reason }`, link `/projets/<projectId>`; resolved (`outcome: 'fixed'`) when a message's `unreadable` no longer holds its key.
- **Web**: `apps/web/src/sources/local-sealed.ts`: `openLocalText(projectId, sealed, aad)` with the vault (`apps/web/src/keys/vault.ts`), cached in memory per value, « … » while the vault is locked; used by the views that show a Local Ticket's, milestone's or change's title and labels; `apps/web/src/views/a-toi.ts` shows a `ticket.local-unreadable`'s file name from `pathSealed`.
- `docs/pilotage/risques.json`: OPS-9's two solutions ticked.

## Decisions already made

- The report sends differences, and everything again on each connection: the 60 s scan catches what fsnotify missed without resending a whole folder each minute, and a Runner back online repairs whatever changed meanwhile.
- A Local Ticket's readable labels are the product's four families (BOUCLE-1); `branchPrefix` and `visualReview` are the two facts the Boucle needs from the others, computed on the Runner so that the labels stay sealed.
- A milestone is named by its rank in `milestones.yml`, as the Miroir numbers it (MIROIR-6): the server never sees its title.
- The unreadable set is sent whole each time: resolving a Décision never waits for a file that no longer exists.
- Nothing of a body, a comment, a file's path or name reaches the server in clear (ADR 0003): the path's key is a keyed hash, its name sealed.

## Acceptance criteria

- [ ] Writing `tickets/12-x.md` by hand in a temporary git repository sends a `local.changed` with that Ticket within 1 s (Go test, fake server); the same under a forced polling mode within 2.5 s.
- [ ] A ticket item's `labels` hold only the product's labels; `type:fix` gives `branchPrefix: 'fix'`, none `feat`; `revue-visuelle` gives `visualReview: true`; its title and other labels open in TypeScript with the additional data above, and fail to open with another number.
- [ ] Editing a file twice within 100 ms sends one report; a scan that finds nothing new sends nothing; reconnecting sends `full: true`.
- [ ] The handler writes the Tickets, milestones and changes with `source: 'local'` and their events in one transaction, `sourceAt` from `observedAt`; a tab sees a Ticket edited by hand without reload (integration test through the fake Runner).
- [ ] A `full: true` report without Ticket 7 removes it with `ticket.removed`; items of a Projet whose `ticket` group is on GitHub are dropped.
- [ ] A front matter that does not parse raises `ticket.local-unreadable` once; fixing the file resolves it; the database, the events and the server's logs hold no file name nor title (marker string test).
- [ ] Every new protocol message has its fixture, valid in TypeScript and Go.

## Verification

- `cd apps/runner && go test ./internal/source/local/ -run 'Watch|Report|Poll'`
- `pnpm exec nx test contracts -- src/runner/`
- `pnpm exec nx test server -- src/tickets/local/`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- local-changed`
- `pnpm exec nx test web -- src/sources/ src/views/a-toi.spec.ts`
- `pnpm exec nx run contracts:generate` with no diff, then `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the `local.db` migration runs on the Runner's update).

## Out of scope

- Reading a Local Ticket's body, comments, a change or a diff in the page: SOURCE-4. A change's branch moving and its merge: SOURCE-5.
- A Ticket changed or closed at its Source while a PhaseRun holds it: SOURCE-6.
- The documentation index of a Local Projet: MIROIR-5.

## Dependencies

- SOURCE-2.
- BOUCLE-1.
