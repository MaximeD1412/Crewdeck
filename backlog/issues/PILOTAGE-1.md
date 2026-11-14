---
id: PILOTAGE-1
title: "Planning of a Projet: milestones with their estimated end, critical path, what comes next, for Tickets of any Source"
epic: PILOTAGE
type: feature
priority: P0
size: M
milestone: M4 Boucle
blocked_by: [BOUCLE-1, UI-6, BOUCLE-2, PROCESS-4]
adr: [0006, 0008]
risques: []
stories: [US-16]
screens: [planning]
revue_visuelle: true
video: false
reprend: 106
---

## Context

US-16: the planning of each **Projet** says what is next, what is blocked and by what, so that the Pilote sees when a milestone will be done. Everything it needs is already in the store: the **Tickets** and milestones of BOUCLE-1, on GitHub or Local (a Local Ticket's and milestone's titles sealed, decrypted by the page), the **Boucle**'s admissions (BOUCLE-2), the PhaseRuns and StepRuns of the engine (PROCESS-4) and the open **Décisions**: the page is a pure view, no route of its own (ADR 0008, « Front data »). Since the refonte, what a Ticket is doing is no longer a fixed `loopStep`: it is the state of its PhaseRun and of its running StepRun, the **Étape** named as the Projet's pinned **Process** version names it. The ticket tree beside the planning is PILOTAGE-2, which reuses this ticket's critical path.

## Current state of the code

- `apps/web/src/store/` (slices pilot, runner, runner-link, ai-account, device, decision); `apps/web/src/routes.ts` has no `/planning`; `apps/web/src/views/` has no planning view. `packages/contracts/src/composants/index.ts`: `COMPOSANTS`.
- Created by BOUCLE-1: the `tickets` slice (every open Ticket and those closed in the last 30 days, `source`, `milestoneNumber`, `blockedBy`, `ready`, the merge date of its change) and the `milestones` slice (`title`, `state`, `dueOn`, `openCount`, `closedCount`, `closedAt`), titles decrypted by the store for Local.
- Created by BOUCLE-2: `packages/contracts/src/loops/order.ts` (`compareForLoop`, the milestone's `rank`), the `agentLoops` and `loopRecords` slices. Created by PROCESS-4: the `phaseRuns` and `stepRuns` slices (state, `startedAt`, the Étape's id) and the pinned definitions. Created by ATOI-1: the `decisions` slice.
- Created by UI-6: `Timeline` (`weeks`, `today`; rows `label`, `detail`, `start`, `span`, `tone`, `meta`), `TicketTree`; UI-2, UI-5: `Card`, `Tabs`, `ProjectFilter`, `TicketRow`, `Icon`. Created by UI-3: the Cadre's menu entry « Planning » (`current="planning"`).

## To do

- `apps/web/src/views/ticket-activity.ts`: pure `ticketActivity(ticket, store)` → `{ kind: 'idle' | 'running' | 'waiting' | 'done', stepName?, since?, decisionKind? }`: from the Ticket's open LoopRecord, its PhaseRun (`running` / `waiting`) and its latest StepRun (the Étape's name in the pinned definition, `startedAt`), `decisionKind` the open Décision whose subject is the Ticket. Shared with PILOTAGE-2.
- `apps/web/src/views/critical-path.ts`: pure `criticalPath(tickets)`: the longest chain of open Tickets linked by `blockedBy` (ties: the chain whose head comes first by `compareForLoop`); returns the numbers head first.
- `apps/web/src/views/estimate.ts`: pure `milestoneEstimates(milestones, tickets, today)`: `rate` = Tickets of the Projet whose change merged in the last 14 days ÷ 14; for the milestones in `compareForLoop`'s order, the remaining work of a milestone is its open Tickets plus those of the milestones before it; `end = today + ceil(remaining / rate)` days. `rate = 0` → no estimate. A closed milestone keeps `closedAt` (« terminé le 6 nov. »).
- `apps/web/src/views/planning.ts`: pure `planningView(store, projectId | 'all', today)`:
  - header « Planning », count « <Projet> · <n> Tickets ouverts »; `ProjectFilter` chips with each Projet's open count and « Tous les Projets »;
  - « Jalons » (`Timeline` from the current ISO week −1 to the latest estimated end, at most 12 weeks, `weeks` labelled `S46`…): a row per milestone with an open Ticket or closed in the last 30 days, label its title without an `M<n> ` prefix; done: tone `go`, detail « terminé le <date> »; in progress: tone `accent`, detail « fin estimée <date> », meta « <closed>/<total> »; its next Ticket waiting on a Ticket whose activity is `waiting`: tone `caution`, detail « bloqué par #<n> · fin estimée <date> »; no merge in 14 days: « pas encore d'estimation »;
  - « Chemin critique »: the chain « #51 › #56 › #57 » and one sentence naming the milestone it holds and the head's activity: `waiting` with its Décision's reason (« Le jalon Rappels attend #51, interrompu : limite de Claude atteinte. »), `running` with its Étape and duration (« … attend #51, en Review depuis 2 h. »), `idle` (« … attend #51, prêt. »), then « Fin estimée le 4 déc. au rythme actuel de la Boucle. »;
  - « À suivre »: the next ready Tickets by `compareForLoop` (at most 5), `TicketRow` state `pret`, or `attente` with meta « jalon <titre> · bloqué par #<n> »;
  - with « Tous les Projets »: one group of rows per Projet in « Jalons » (label « <Projet> · <jalon> »), « Chemin critique » and « À suivre » per Projet.
- Router `/planning` (`?projet=<id>`); Composant `PagePlanning` (`packages/contracts/src/composants/page-planning.ts`, `packages/skin-passerelle/src/page-planning.ts`, in `COMPOSANTS`) with its Emplacement `tree` (filled by PILOTAGE-2), actions `openTicket`, `filter`; t() keys under `planning.*` in `packages/sdk/src/i18n/fr.ts`.
- At 390 the Tabs « Planning » / « Arbre des Tickets » switch the page; at 1280 the Tabs are hidden and the `tree` Emplacement sits beside the planning (the mockup's grid).
- Test scenario `apps/server/src/testing/scenarios/planning.ts` (`planning`: a GitHub Projet and a Local one, an interrupted head, a Ticket in Review), Playwright `apps/web/e2e/planning.spec.ts`.

## Decisions already made

- Mockup: `planning` (page `design/screens/crewdeck/planning.html`; captures `design/screens/crewdeck/planning-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The « Arbre des Tickets » card is PILOTAGE-2's.
- « Fin estimée » (founder's choice): the open Tickets of the milestone and of the milestones before it, divided by the Tickets the Projet merged per day over the last 14 days; « pas encore d'estimation » when none was merged. A due date is not an estimate and is not shown here.
- A Ticket's activity is read from its PhaseRun and StepRuns, never from a fixed list of steps: a Projet whose Process adds an Étape shows it by its name.
- A Local Ticket is planned exactly as a GitHub one; only its titles come from the store's decryption.
- Dates as `DESIGN.md`'s Copy: « 20 nov. », in the browser's time zone.
- No server route: the view reads the store; the 30-day window of the `tickets` slice covers the 14 days of the rate.

## Acceptance criteria

- [ ] `milestoneEstimates`: 6 Tickets merged in 14 days and 3 open in the first milestone give an end 7 days ahead; the second milestone counts the first's open Tickets; no merge gives no estimate (unit tests).
- [ ] `criticalPath` returns the longest open chain, and a single Ticket when nothing blocks (unit tests, with a cycle-free and a branching graph).
- [ ] `ticketActivity` gives `running` with the pinned Étape's name, `waiting` with the open Décision's kind, `idle` for a ready Ticket not admitted (unit tests).
- [ ] A milestone whose next Ticket waits on an interrupted Ticket shows « bloqué par #51 · fin estimée … » in `caution`.
- [ ] A Local Projet's milestones and Tickets show with their decrypted titles, and the same estimate as a GitHub one with the same figures.
- [ ] A Ticket merged elsewhere, or a StepRun that starts, updates the planning without reload (store events).
- [ ] « Tous les Projets » shows every Projet's milestones grouped.
- [ ] `/planning` matches the mockup at 390 and 1280 px (Playwright against the fake Runner and the fake GitHub, axe without violations); the captures come from those tests.

## Verification

- `pnpm exec nx test web -- src/views/planning.spec.ts`
- `pnpm exec nx test web -- src/views/estimate.spec.ts`
- `pnpm exec nx test web -- src/views/ticket-activity.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/page-planning.spec.ts`
- `pnpm exec nx e2e web -- planning.spec.ts`
- `scripts/captures.sh planning`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The ticket tree: PILOTAGE-2. Statistics: PILOTAGE-3.
- The Boucle's order itself: BOUCLE-2. A client's read-only view of the planning (Bêta).

## Dependencies

- BOUCLE-1.
- UI-6.
- BOUCLE-2.
- PROCESS-4.
