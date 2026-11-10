---
id: BOUCLE-2
title: "Start and stop the Boucle of a Projet, and pick its next ready Ticket"
epic: BOUCLE
type: feature
priority: P0
size: M
milestone: M4 Boucle
blocked_by: [BOUCLE-1, CORE-7, RUNNER-9, RUNNER-12, PROJET-3]
adr: [0001, 0006, 0007, 0008]
risques: []
stories: [US-13, US-15]
screens: [boucle, boucle-arretee, boucle-confirmation-demarrage]
revue_visuelle: true
video: false
---

## Context

US-13: the Pilote starts and stops the **Boucle** of a **Projet**; starting it is their explicit consent to background work on their **Comptes IA** and to the merge of each **Ticket** that passes its review, until they stop it (an **Action sensible**, US-26). The server orchestrates (ADR 0001): it holds the Boucle's state, chooses the next ready Ticket and asks the **Runner** for the Code **Étape**. This ticket builds the state, the choice and the `/boucle` page; the Code Étape is BOUCLE-3, the Review and the merge BOUCLE-4.

## Current state of the code

- No code in the repository: only the docs and `design/`.
- Created by BOUCLE-1: `apps/server/src/tickets/` (`Ticket` with `ready`, `priority`, `size`, `milestoneNumber`, `loopStep`; `Milestone`), the `tickets` and `milestones` store slices.
- Created by CORE-7: `@SensitiveAction('loop.start')`, `apps/web/src/dialogs/confirm.ts` (`crewdeck-confirm`), the `sensitive: true` mark on a Composant's action.
- Created by RUNNER-9: `apps/server/src/sessions/` (`AgentSession`, `POST /api/sessions/:id/stop`).
- Created by RUNNER-12: `apps/server/src/steps/` (`StepRun`, `StepsService.start`) — call `StepsService.start` behind the `LoopWorker` seam below so that BOUCLE-3 wires the real Code Étape.
- Created by PROJET-3: the Projet's readiness (the list of failing checks of a Projet) and its integration branch.
- Created by ATOI-3: the `RunnerWaitingWork` registry. Created by PARAM-1/PARAM-2: `SettingsService.effective(pilotId, projectId)` with `roles.code` and `roles.review`.
- Created by UI-3, UI-5: the Cadre (`current="boucle"`), `TicketRow`, `AgentRow`, `Banner`, `Card`, `StatusDot`, `KeyValue`, `ProjectFilter`.

## To do

- Prisma `AgentLoop` (scoped): `id`, `pilotId`, `projectId` (unique), `state` (`running` | `stopped` | `waiting-runner`), `startedAt?`, `stoppedAt?`, `stoppedBy?` (`pilot` | `run-end`), `scheduleId?` (set by BOUCLE-8), `currentTicketNumber?`, `lastSeq`. Prisma `LoopRecord` (scoped): `id`, `pilotId`, `projectId`, `ticketId`, `takenAt`, `endedAt?`, `outcome?` (`merged-by-loop` | `merged-by-pilot` | `closed`), `blockedCount` (int, 0), `pilotIntervened` (bool, false), `reviewRounds` (int, 0); one open record (no `endedAt`) per Ticket. Statistics (PILOTAGE-3) read it.
- Contracts `packages/contracts/src/api/loops.ts`: `zAgentLoop`, inputs `{ seq }`; event `agent-loop.upserted`.
- `packages/contracts/src/loops/order.ts`: pure `compareForLoop(a, b, milestones)`: milestone due date (earliest first), then the `M<n>` number of the milestone title, then the GitHub milestone number, a Ticket without milestone last; then priority (`P0` < `P1` < `P2` < none); then size (`S` < `M` < `L` < none); then issue number. Used by the server and by the pages (« À suivre », PILOTAGE-1).
- `apps/server/src/loops/`:
  - `loops.controller.ts`: `POST /api/projects/:id/loop/start` (`@SensitiveAction('loop.start')`), `POST /api/projects/:id/loop/stop`. Errors: 404 `loop.project-not-found`; 422 `loop.not-ready` (« Ce Projet n'est pas prêt pour le Process : <ce qui manque>. ») when PROJET-3's readiness has a failing check; 422 `loop.runner-missing` when no Runner is linked; 422 `loop.already-running`; 409 per CORE-7.
  - `loop-scheduler.ts`: `tick(projectId)` in the Pilote's scope, called on start, on `ticket.upserted` of the Projet, on the end of a StepRun of the Projet and when the Runner comes online. While `running` and nothing is in flight (no Ticket of the Projet with `loopStep` in `coding`, `fixing`, `in-review`, `waiting-checks`), it takes the first Ticket of: the Projet's Tickets with `loopStep: interrupted` that the Pilote resumed (BOUCLE-7), then the ready Tickets by `compareForLoop`. Taking = set `loopStep: coding` and `currentTicketNumber`, open the `LoopRecord`, call `LoopWorker.take(ticket)` (interface in `loop-worker.ts`; BOUCLE-3 implements it; here a test double). Runner offline → `state: waiting-runner`, back to `running` when it is online.
  - Tickets waiting for the Pilote (`visual-review`, `blocked`) and `interrupted` ones not resumed do not occupy the slot: the Boucle goes on with the others (US-15); their dependents stay not ready through `blockedBy`.
  - Stop: `state: stopped`, `stoppedBy: pilot`; the Session in progress of the current Ticket is stopped (`AgentSession` stop) and the Ticket gets `loopStep: interrupted`; no Décision is raised (the Pilote did it).
  - A `RunnerWaitingWork` provider `loops`: the Projets whose Boucle is `running` or `waiting-runner` and that have a ready or an in-flight Ticket.
  - `loops.state.ts`: `StateContributor` key `agentLoops`; every change writes `agent-loop.upserted` in its transaction.
- Web:
  - `apps/web/src/api/loops.ts`; `apps/web/src/views/boucle.ts` (pure: store → `PageBoucle` data); router `/boucle` (filter `?projet=<id>`).
  - Composants `PageBoucle` and `LoopCard` (`packages/contracts/src/composants/page-boucle.ts`, `loop-card.ts`; `packages/skin-passerelle/src/page-boucle.ts`, `loop-card.ts`), actions `start` (`sensitive: true`), `stop`, `openSession`, `openTicket`; t() keys under `boucle.*`.
  - All Projets: the Banner « La Boucle merge elle-même », one `LoopCard` per Projet: running (StatusDot `go`, « En cours · depuis 09:12 · 4 Tickets mergés aujourd'hui », its in-flight Tickets as `AgentRow` with « Session », « À suivre » with the next two ready Tickets, « Arrêter la Boucle »), stopped (« Arrêtée · 3 Tickets prêts · 1 interrompu », « Démarrer la Boucle »).
  - One Projet selected (`boucle-arretee`): « Arrêtée · par toi, hier à 19:05 » with its explanation, the cards « Tickets prêts » (TicketRow `pret`, meta « jalon <titre> »), « Interrompu » (TicketRow `interrompu`) and « Rôles de ce Projet » (KeyValue Code, Review from the effective Paramètres).
  - The confirmation (`boucle-confirmation-demarrage`): `crewdeck-confirm` titled « Démarrer la Boucle de <Projet> ? », action « Démarrer la Boucle », its consequences listing the background work « Code sur <Moteur>, Review sur <Moteur> », the merge of each Ticket that passes its review and its checks by the Boucle itself, the Tickets waiting in « À toi », and « La Boucle prend les <n> Tickets prêts un par un. ».
- Test scenarios `apps/server/src/testing/scenarios/boucle.ts` (`boucle`, `boucle-arretee`), Playwright `apps/web/e2e/boucle.spec.ts`.

## Decisions already made

- Mockup: `boucle`, `boucle-arretee`, `boucle-confirmation-demarrage` (pages `design/screens/crewdeck/boucle.html`, `…/boucle-arretee.html`, `…/boucle-confirmation-demarrage.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- Not built here: the « Planifier » button and the « Planifications » card (BOUCLE-8), the « Comptes IA » card (BOUCLE-8), the « Reprendre » button of an interrupted Ticket (BOUCLE-7).
- One Ticket at a time per Projet (several Boucles is US-54, `next`); several Projets run at once.
- Starting a Boucle that has interrupted Tickets does not resume them by itself: they stay in « Interrompu » until « Reprendre » (BOUCLE-7).
- The merges covered by the start happen only while the Boucle is `running` (BOUCLE-4 checks it); a stopped Boucle leaves a Ticket that passed everything waiting for the next start.
- « Tickets mergés aujourd'hui » counts the Projet's Tickets with `mergedBy: loop` since midnight in the Pilote's time zone.
- The confirmation's text comes from the core (t() keys of `apps/web`), never from the Skin.

## Acceptance criteria

- [ ] Starting asks the core's confirmation; confirmed, the Boucle is `running`, its `agent-loop.upserted` event reaches the tab, and the first ready Ticket by `compareForLoop` gets `loopStep: coding` and a `LoopRecord`.
- [ ] `compareForLoop` orders by milestone (due date, `M<n>`, number, none last), priority, size, number (unit tests for each tie).
- [ ] A Ticket in `visual-review` or `blocked` does not stop the Boucle from taking a ready Ticket that does not depend on it.
- [ ] Stopping sets `stopped`, stops the current Session and marks its Ticket `interrupted`; no new Ticket is taken.
- [ ] With the Runner offline, a started Boucle is `waiting-runner` and the `loops` provider lists its Projet; once online it takes its Ticket.
- [ ] 422 `loop.not-ready`, `loop.runner-missing`, `loop.already-running`; 409 with a stale `seq`; 404 for another Pilote's Projet; 401 without a session.
- [ ] `/boucle` matches the three mockups at 390 and 1280 px (Playwright against the fake Runner and the fake GitHub, axe without violations), and the captures of the visual review come from those tests.

## Verification

- `pnpm exec nx test server -- src/loops/`
- `pnpm exec nx test contracts -- src/loops/order.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- loops`
- `pnpm exec nx test skin-passerelle -- src/page-boucle.spec.ts`
- `pnpm exec nx e2e web -- boucle.spec.ts`
- `scripts/captures.sh apps/web/e2e/boucle.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

A migration (tables `agent_loops`, `loop_records`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- The Code Étape behind `LoopWorker`: BOUCLE-3. Review and merge: BOUCLE-4.
- Blocked Tickets and their page: BOUCLE-5. Visual review: BOUCLE-6.
- Limits, interruptions and « Reprendre »: BOUCLE-7. Planification and the Comptes IA card: BOUCLE-8.

## Dependencies

- BOUCLE-1
- CORE-7
- RUNNER-9
- RUNNER-12
- PROJET-3
