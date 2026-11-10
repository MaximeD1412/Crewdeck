---
id: PILOTAGE-3
title: "Statistics of each Projet and of all of them: lead time, Boucle success, blocked share, cost per Ticket"
epic: PILOTAGE
type: feature
priority: P1
size: M
milestone: M7 Statistics and switchover
blocked_by: [BOUCLE-4, RUNNER-13, IDEE-5, CONCEPTION-10, CORE-8]
adr: [0003, 0007, 0008]
risques: [BIZ-4, OPS-5]
stories: [US-61, US-20]
screens: [statistiques]
revue_visuelle: true
video: false
---

## Context

US-61: the statistics of each **Projet** and of all of them, so that the Pilote knows what the agents really bring. The PRD defines them (« Pilotage and reports »): the lead time runs from the noting of the **Idée** to the merge of the last **Ticket** it led to; the **Boucle**'s success rate is the share of the Tickets it took that it merged without the Pilote stepping in; the share of blocked Tickets counts those blocked at least once among the Tickets taken; the cost per Ticket is the spend for an API key and the share of the window used for a subscription. Spends are estimates in euros, converted from the provider's bill (ADR 0008, risk BIZ-4). The statistics' health shows the p95 of the delay from a change to the screen (ADR 0007, risk OPS-5). Only figures and dates: nothing here reads an Idée's text (ADR 0003).

## Current state of the code

- No code in the repository: only the docs and `design/`.
- Created by BOUCLE-2: `LoopRecord` (`takenAt`, `endedAt`, `outcome`, `blockedCount`, `pilotIntervened`); BOUCLE-4, BOUCLE-5, BOUCLE-6 fill `outcome`, `blockedCount` and `pilotIntervened`.
- Created by BOUCLE-1: `Ticket.mergedAt`, `Ticket.ideaId` (set by IDEE-5 for an Idée turned straight into a Ticket) and `Ticket.designId` (set by CONCEPTION-9 for the Tickets of a Découpage).
- Created by CONCEPTION-1: `Design.ideaId`. Created by IDEE-1: `Idea.createdAt` (readable; the text is ciphertext).
- Created by RUNNER-9: `AgentSession` with its `stepRunId`; RUNNER-12: `StepRun` (`subjectType: ticket`, `subjectId`). Created by RUNNER-13: the usage figures and `fx_rates` (ECB rate of the spend's day, `costUsdMicros` → `costEurCents`).
- Created by CORE-8: the latency measurements and their p95 over the last 7 days.
- Created by UI-6: `Stat`; UI-2: `Card`, `Tabs`, `ProjectFilter`.

## To do

- Per-Session spend: `AgentSession.costUsdMicros?` (an API key) and `AgentSession.windowPermille?` (share of the subscription's 5-hour window used, per mille) with its `engine` and `aiAccountKind` (`api-key` | `subscription`), from the `session.ended` message's usage. If RUNNER-9/RUNNER-13 did not add them, add the optional `usage` object to `session.ended` (`packages/contracts/src/runner/session.ts`, shared fixture) and fill it in the Claude and Codex adapters from their final event (Claude's result `total_cost_usd`, Codex's token usage priced by RUNNER-13's table).
- `apps/server/src/statistics/`:
  - `statistics.service.ts`, pure functions over the rows of a period `[from, to)`:
    - `leadTimeDays`: for each Idée whose Tickets (`Ticket.ideaId`, or `Ticket.designId` → `Design.ideaId`) are all closed and whose last merge falls in the period, `lastMergedAt − idea.createdAt` in days; the median, and the count of Tickets merged from those Idées (« médiane · 41 Tickets »).
    - `successRate`: `LoopRecord`s with `takenAt` in the period; numerator those with `outcome: merged-by-loop` and `pilotIntervened: false`; « mergés sans intervention, sur pris ».
    - `blockedShare`: the same records with `blockedCount >= 1` over all; « au moins une fois · 4 sur 47 ».
    - `costPerTicket`: over the Tickets merged in the period, the Sessions of their StepRuns: per Moteur paid by an API key, mean `costEurCents` per Ticket (converted at the rate of each Session's day); per Moteur on a subscription, mean `windowPermille` per Ticket (« Claude · 6 % de la fenêtre de 5 h »).
  - The Pilote stepping in = answering a « Ticket bloqué », asking for changes in a visual review, pushing to or merging or closing the PR on GitHub (what BOUCLE-4 to BOUCLE-6 record); approving a visual review or « Reprendre » after an interruption is not.
  - `statistics.controller.ts`: `GET /api/statistics?from=&to=&projectId=` (`zDay`s, at most 366 days, `to > from`): `{ all: Figures, projects: [{ projectId, ...Figures, merged }], health: { latencyP95Ms, samples } }`; 400 with `fields` on a bad period, 404 for another Pilote's Projet, 401.
- Web: `apps/web/src/api/statistics.ts` (a query, not the store: statistics are history, ADR 0008 « Lists »); `apps/web/src/views/statistiques.ts`; router `/statistiques` (`?projet=`, `?periode=7|30|90`); Composant `PageStatistiques` (`packages/contracts/src/composants/page-statistiques.ts`, `packages/skin-passerelle/src/page-statistiques.ts`), actions `filter`, `period`; t() keys under `statistiques.*`.
  - Header « Statistiques », « 30 derniers jours »; `ProjectFilter`; Tabs « 7 jours », « 30 jours », « 90 jours » (30 by default).
  - Four `Stat`: « Délai Idée → merge » (`3,4` j, « médiane · 41 Tickets »), « Réussite de la Boucle » (`86` %), « Tickets bloqués » (`9` %), « Coût par Ticket » (`1,80` €, « Codex · clé API », and the subscription line « Claude · 6 % de la fenêtre de 5 h »); « estimé » beside euros.
  - Card « Par Projet »: a table Projet, Délai, Réussite, Bloqués, Coût / Ticket (« 1,60 € · 5 % »), Mergés; under it the four definitions of the mockup.
  - Health: a fifth `Stat` « Affichage en temps réel » with the p95 (« 0,8 s », « p95 · 7 derniers jours · objectif 2 s »), tone `caution` above 2 s.
  - A period without data shows « — » and « pas encore de Ticket pris sur cette période ».
- Test scenario `apps/server/src/testing/scenarios/statistiques.ts`, Playwright `apps/web/e2e/statistiques.spec.ts`.

## Decisions already made

- Mockup: `statistiques` (page `design/screens/crewdeck/statistiques.html`; captures `design/screens/crewdeck/statistiques-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The health `Stat` is not in the mockup: it uses the same `Stat`, after the four others.
- Costs stay in micro-dollars as billed; euros are computed with the ECB rate of the spend's day (ADR 0008), never today's.
- The lead time counts only Idées that led to at least one merged Ticket; an Idée still with an open Ticket is not counted yet.
- Days in the Pilote's time zone for the period's bounds.

## Acceptance criteria

- [ ] An Idée noted on day 0 whose two Tickets merged on days 2 and 4 has a lead time of 4 days; an Idée with an open Ticket is not counted (unit tests, through `ideaId` and through `designId`).
- [ ] 47 Tickets taken, 40 merged by the Boucle without intervention, 4 blocked once: 85 % success, 9 % blocked (« 4 sur 47 »).
- [ ] A Ticket whose blocked Décision the Pilote answered counts as stepped in; one approved in visual review without changes does not.
- [ ] The cost per Ticket of an API key uses each Session's day rate, and is shown « estimé »; a subscription shows its window share.
- [ ] `GET /api/statistics`: output schema, 400 with `fields` (period over 366 days, `to <= from`), 401, 404 for another Pilote's Projet.
- [ ] The health shows the p95 of CORE-8 over 7 days.
- [ ] `/statistiques` matches the mockup at 390 and 1280 px (Playwright against the fake Runner and the fake GitHub, axe without violations); the captures come from those tests.

## Verification

- `pnpm exec nx test server -- src/statistics/`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- statistics`
- `pnpm exec nx test skin-passerelle -- src/page-statistiques.spec.ts`
- `pnpm exec nx e2e web -- statistiques.spec.ts`
- `scripts/captures.sh apps/web/e2e/statistiques.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

A migration if the Session's usage columns are added here. Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- The weekly report: US-77 (Bêta). A client's summary: US-66 (Bêta).
- Measuring the latency: CORE-8.

## Dependencies

- BOUCLE-4
- RUNNER-13
- IDEE-5
- CONCEPTION-10
- CORE-8
