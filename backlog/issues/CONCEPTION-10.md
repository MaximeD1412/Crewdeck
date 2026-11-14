---
id: CONCEPTION-10
title: "The approval gate of the Tickets: validating a Conception's Tickets in one pass, made ready at their Source"
epic: CONCEPTION
type: feature
priority: P1
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-9]
adr: [0002, 0003, 0006, 0008, 0011, 0012]
risques: []
stories: [US-12, US-26]
screens: [decoupage, decoupage-confirmation]
revue_visuelle: true
video: false
reprend: 81
---

## Context

US-12: the Pilote validates the Tickets of an approved Conception in one pass, so that the agents know exactly what to build. Approving them is an Action sensible (US-26, `document.approve`). The refonte (PRD #169, ADRs 0011 and 0012) makes it the `approval` **gate** whose Entrée is Ticket (« Validation des Tickets » in « Process Crewdeck », Ticket → Ticket « prêt »): the Découpage (CONCEPTION-9) has already written the Tickets at the Projet's Tickets' Source, not ready; approving makes them ready there (`ready-for-agent` on GitHub, `ready: true` in the Local files), and the gate's Sortie, through the arrow into the « pour chaque Ticket prêt » Phase, gives the Boucle its items (PROCESS-5, BOUCLE-2). Nothing is merged: the Tickets are not files of a change. The proposed Tickets are read by the browser at their Source (SOURCE-4's reader), never by the server (ADR 0002). This ticket builds that gate's approval, `/conceptions/:id/tickets/:stepId` and the « Tickets proposés » card of an incomplete Découpage on the Conception page.

## Current state of the code

- `SENSITIVE_ACTION_IDS` has `document.approve`; `confirmSensitiveAction` in `apps/web/src/dialogs/confirm.ts`; `GitHubClient` in `apps/server/src/github/github.client.ts`.
- Created by CONCEPTION-4: the `approval` kind handler (`apps/server/src/process/engine/kinds/approval.ts`, `apps/server/src/designs/approvals.ts`), `POST /api/designs/:id/gates/:stepRunId/approve` and `request-changes`, the signals `document-voided` / `document-refreshed`, the remarks pattern; by CONCEPTION-3: `renderRemarks`.
- Created by CONCEPTION-9: the `split` Étape, its outputs (one per Ticket), the Tickets' hidden markers, epics as parents, the re-check when a Ticket changes at its Source; `apps/runner/internal/contrat/checks/ticket_body.go`.
- Created by IDEE-5: `ticket.set-ready { projectId, numbers }` (server → Runner for Local Tickets), `apps/web/src/api/ticket-comments.ts` (a comment on a Ticket, GitHub or Local through BOUCLE-5's `comment.write`).
- Created by BOUCLE-1: `tickets` rows (`source`, number, `ready`, labels, `blockedBy`, `parent`, sealed title for Local) in the store. By SOURCE-4: the document reader (`ticket` kind, GitHub with the user token, Local through the relay). By PROJET-5: `DocumentReader`.
- Created by CONCEPTION-2: `PageConception` with its `aside` slot. By UI-2 / UI-4 / UI-6: `ListRow`, `StatusBadge`, `IconButton`, `TextField`, `CheckRow`, `KeyValue`, `Dialog`.

## To do

- **The gate on Tickets** (in CONCEPTION-4's `approvals.ts`):
  - `start`: raises `document-review` (subject the gate's StepRun, label « Tickets « <title> » », context « N Tickets »).
  - `approve` for a gate whose Entrée is `ticket`: input `{ seq }` (no `sha`: 400 when given), `@SensitiveAction('document.approve')`; the gate waits (422 `designs.not-waiting`: a voided gate is re-checking) and the split's verdict is `passed` (422 `designs.contract-not-passed`). Makes every Ticket of its Entrée ready, epics apart and `type:externe` Tickets apart: GitHub `GitHubClient.addLabels(repo, n, ['ready-for-agent'])` for each (idempotent, a failure mid-way → 502 `github.unavailable`, the gate still waiting, « Approuver » again finishes); Local `ticket.set-ready` for all of them (422 `runner.offline`). Then the gate's StepRun passed with one output per Ticket `{ portId: <its Sortie>, type: 'ticket', id: number }`, the Décision resolved (outcome `approved`), `design.upserted`; the engine feeds the arrow into the « pour chaque Ticket prêt » Phase and the Conception's PhaseRun ends (Design `done`).
  - `request-changes` for a gate on Tickets: `zRequestChangesInput` gains `commentIds: string[]` (one comment per Ticket with remarks, at least one); same rules as CONCEPTION-4's.
- `apps/web/src/tickets/summarize.ts`: pure `parseTicketBody(markdown) → { sections, criteria, screens }` (the template's sections, the `- [ ]` count under the acceptance criteria, the screens of its mockup line) and `summarize(tickets) → { count, sizes: { S, M, L }, criticalPath: number[] (the longest chain of `blockedBy`), incomplete: number[] (no criterion or a missing section) }`, sizes from the `size:` labels; unit-tested on the fixtures of the Go `ticket_body.go`, with the same results.
- `/conceptions/:id/tickets/:stepId`: `apps/web/src/views/decoupage.ts`, Composant `PageDecoupage` (`packages/contracts/src/composants/page-decoupage.ts`, skin implementation, in `COMPOSANTS`) with `examples`:
  - the Tickets of the gate's Entrée, their rows from the store (title, decrypted for Local; labels; `blockedBy`), their bodies through SOURCE-4's reader (`ticket` kind), keyed by Projet + number + version;
  - header « Découpage · <title> », « <Projet> · N Tickets », back to the Conception;
  - « Tickets proposés »: one `ListRow` per Ticket in dependency order (epics not listed), numbered `k · <title>`, meta « aucune dépendance » or « dépend de 1, 3 » (by the same positions) · « écran <id> » for each screen · « N critères », a `StatusBadge` of its size, an `IconButton` « Remarque sur ce Ticket » opening a `TextField` « Ta remarque » under the row; a Ticket in `incomplete` gets a `caution` tone and « Incomplet ». Opening a row shows its whole body through `DocumentReader` in a `Dialog`.
  - « Vérifications »: `CheckRow` « Contrat du découpage » from the split's verdict (« N sur N » Tickets complete when passed, the failed labels otherwise).
  - « Résumé »: Tickets, Tailles (« 3 S · 3 M »), Chemin critique (« 1 → 3 → 5 »), Remarques.
  - « Demander des changements » (shown only when the gate has a Retour): one comment per Ticket with remarks (`ticket-comments.ts`, `renderRemarks`), then `request-changes` with their ids.
  - « Approuver les N Tickets »: Action sensible `document.approve`, title « Approuver les N Tickets de « <title> » ? », consequences « Crewdeck va : rendre prêts pour la Boucle les N Tickets de <Projet>, sur GitHub » (« dans ton dossier » for Local) « , avec leurs dépendances ; la Boucle les prendra ensuite. », then `approve`. Disabled while the Contrat is not passed, and for a Local Projet whose Runner is « hors ligne » (bodies unreadable, `ticket.set-ready` impossible), each with its reason.
- On the Conception page (CONCEPTION-2's `aside` slot), when the split is `incomplete` or its gate waits: the card « Tickets proposés » with the same rows (read-only, no remark), so that the incomplete state names the Tickets the banner talks about.
- The `document-review` Décision of a gate on Tickets opens this page; CONCEPTION-2's « Valider les Tickets » leads here.
- Copy under `t('decoupage.*')`.
- Tests and scenarios: `apps/server/src/testing/scenarios/decoupage.ts` (`decoupage`, `decoupage-confirmation`: the fake GitHub holding the mockup's six Tickets as issues without `ready-for-agent`, one with a remark; a Local variant with the fake Runner answering `artifact.read` and `ticket.set-ready`), `apps/web/e2e/decoupage.spec.ts`; CONCEPTION-2's `conception-contrat-incomplet` scenario gains its five Tickets.

## Decisions already made

- Mockup: `decoupage`, `decoupage-confirmation` (pages `design/screens/crewdeck/decoupage.html`, `…/decoupage-confirmation.html`; captures `design/screens/crewdeck/decoupage-390.png`, `…-1280.png` and the same for the state). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The mockup's consequence « créer les 6 Tickets sur GitHub » no longer holds: the Tickets already exist at their Source, approving makes them ready, and the dialog names that Source.
- Approving merges nothing and needs no SHA: the binding is the split's verdict, voided and re-checked by CONCEPTION-9 whenever one of its Tickets changes at its Source while this gate waits.
- The readiness is set by the server on GitHub (a label is metadata, ADR 0002) and by the Runner on Local (`ticket.set-ready`): the server never writes a Ticket's file.
- The Tickets are numbered by their position for the Pilote; their IDs (`AGENDA-3`) appear in the opened body and in the comment's headings, which the settle mode reads.
- The browser computes the summary and the incomplete Tickets from the bodies; the server knows only the verdict's rule ids (ADR 0003).

## Acceptance criteria

- [ ] On a GitHub Projet the page lists the six proposed Tickets read from the (fake) GitHub, with their dependencies, screens, criteria counts and sizes; the summary shows « 3 S · 3 M » and the critical path « 1 → 3 → 5 »; the server reads no body.
- [ ] A remark on Ticket 5 counts in « Remarques »; « Demander des changements » writes one comment on that Ticket headed in the remarks format and the Découpage reruns in settle mode.
- [ ] « Approuver les 6 Tickets » opens the product's confirmation naming the Source; confirming adds `ready-for-agent` to the six issues (not to the epics), passes the gate with six outputs, and the Conception is « Terminée ».
- [ ] On a Local Projet the same approval sends `ticket.set-ready` with the six numbers; with the Runner « hors ligne » the approval is disabled with its reason.
- [ ] A Ticket edited at its Source while the page is open voids the gate (the approval refused with `designs.not-waiting`) until the re-check passes.
- [ ] An incomplete Découpage shows on the Conception page the two Tickets without criteria marked « Incomplet », and the approval is disabled with its reason.
- [ ] `summarize` gives the same incomplete Tickets as the Go Contrat on the same fixtures.
- [ ] Route baseline for the approval of a gate on Tickets: nominal, 400 with a `sha`, 401, 404 for another Pilote's Conception, 409 stale `seq` and during Resynchronisation, 422 for each rule.
- [ ] Playwright at 390 and 1280 px on both states, axe without violations.

## Verification

- `pnpm exec nx test web -- src/tickets/summarize.spec.ts src/views/decoupage.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/page-decoupage.spec.ts`
- `pnpm exec nx test server -- src/designs/approvals.spec.ts`
- `pnpm exec nx test-integration server -- designs`
- `pnpm exec nx e2e web -- decoupage.spec.ts conception.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh decoupage decoupage-confirmation`.

## For prod

Nothing.

## Out of scope

- Editing a Ticket in the page: the Pilote asks for changes, the agent rewrites (or edits it at its Source, which voids the gate).
- Admitting the ready Tickets into the Boucle: BOUCLE-2. The planning and ticket tree of the Tickets: PILOTAGE-1, PILOTAGE-2.

## Dependencies

- CONCEPTION-9.
