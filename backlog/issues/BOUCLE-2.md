---
id: BOUCLE-2
title: "The Boucle: start and stop it, and admit the next ready Ticket into the Projet's « pour chaque Ticket prêt » Phase"
epic: BOUCLE
type: feature
priority: P0
size: M
milestone: M4 Boucle
blocked_by: [BOUCLE-1, CORE-7, RUNNER-9, RUNNER-12, PROJET-3, PROCESS-5]
adr: [0001, 0006, 0007, 0008, 0011]
risques: []
stories: [US-13, US-15]
screens: [boucle, boucle-arretee, boucle-confirmation-demarrage]
revue_visuelle: true
video: false
reprend: 62
---

## Context

US-13: the Pilote starts and stops the **Boucle** of a **Projet**; starting it is their explicit consent to background work on their **Comptes IA** and to the merge of each **Ticket** that passes its Review and its checks, until they stop it (an **Action sensible**). Since ADR 0011 the Boucle is no longer a state machine of its own: it is the **admission** of `ticket.ready` items into the **Phase** of the Projet's active **Process** whose `forEach` is `ticket.ready` (« Développement » in « Process Crewdeck »). The engine (PROCESS-4, PROCESS-5) runs that Phase's **Étapes** for the admitted Ticket; each Étape is a kind handler (`code` BOUCLE-3, `review` and `merge` BOUCLE-4, `checks` BOUCLE-9, `visual-review` BOUCLE-6). This ticket owns the Boucle's state, the choice of the next Ticket, one Ticket at a time per Projet, and the `/boucle` page. A Ticket may live on GitHub or Local (BOUCLE-1's `source`): nothing here depends on which.

## Current state of the code

- No `loops` module, no `AgentLoop` table. `packages/contracts/src/events/index.ts` already lists the resources `agent-loop`, `ticket`, `step-run`; `packages/contracts/src/api/sensitive-actions.ts` lists `loop.start`; `apps/server/src/sensitive-actions/` has `@SensitiveAction(id)`, its interceptor and `SensitiveActionsService.assertFresh`; `apps/web/src/dialogs/confirm.ts` has `confirmSensitiveAction`.
- `apps/server/src/realtime/`: `Transactions.run`, `EventsWriter.write(tx, pilotId, type, payload, { sourceAt, source })`, `STATE_CONTRIBUTORS` for `/api/state`. `apps/server/src/runners/runner-presence.service.ts` knows whether the Runner is online.
- `apps/web/src/routes.ts` has no `/boucle`; the store (`apps/web/src/store/`) has slices pilot, runner, runner-link, ai-account, device, decision.
- Created by BOUCLE-1: `apps/server/src/tickets/` with `Ticket` (`source` `github | local`, `number`, `state`, `ready` stored, `priority`, `size`, `milestoneNumber`, `blockedBy`, sealed title for Local), `Milestone` (`dueOn`), `CodeChange` (`code_changes`), the `tickets` and `milestones` store slices, `ticket.upserted`.
- Created by PROCESS-3: `apps/server/src/process/` (`ProcessService`, the Projet's active version); by PROCESS-4: `phase_runs` (`PhaseRun`: `state` `running | waiting | done | stopped | failed`, `itemType`, `itemId`), `step_runs`, `Engine.admit(tx, { projectId, phaseId, item })`, events `phase-run.upserted`, `step-run.upserted`; by PROCESS-5: the PhaseRun's lineage and the version pinned at its start.
- Created by RUNNER-9: `apps/server/src/sessions/` (`AgentSession`, its stop). Created by RUNNER-12: the agent Étapes' start (a Session with the Étape's Rôle, Skill and Contrat). Created by PROJET-3: the Projet's readiness (its failing checks). Created by PARAM-2/PARAM-3: `SettingsService.effective(pilotId, projectId)` (each Rôle's Moteur and model). Created by ATOI-3: the `RunnerWaitingWork` registry.
- Created by UI-3, UI-5: the Cadre (`current="boucle"`), `TicketRow`, `AgentRow`, `Banner`, `Card`, `StatusDot`, `KeyValue`, `ProjectFilter`.

## To do

- Prisma (scoped by `pilotId`, one migration):
  - `AgentLoop`: `id`, `pilotId`, `projectId` (unique), `state` (`running | stopped | waiting-runner`), `startedAt?`, `stoppedAt?`, `stoppedBy?` (`pilot | run-end`), `scheduleId?` (BOUCLE-8), `lastSeq`.
  - `LoopRecord`, one per admission: `id`, `pilotId`, `projectId`, `ticketId`, `phaseRunId` (unique), `takenAt`, `endedAt?`, `outcome?` (`merged-by-loop | merged-by-pilot | closed | stopped`), `blockedCount` (int, 0), `pilotIntervened` (bool, false), `interruptedAt?`, `queuedAt?` (the Pilote unblocked or resumed it: it takes the slot first). PILOTAGE-3 reads it.
- Contracts `packages/contracts/src/api/loops.ts`: `zAgentLoop`, `zLoopRecord`, inputs `{ seq }`; events `agent-loop.upserted`, `loop-record.upserted` (registered with `registerEventPayload`; resource `loop-record` added to `RESOURCES`).
- `packages/contracts/src/loops/order.ts`: pure `compareForLoop(a, b, milestones)`: milestone due date (earliest first), then the milestone's `rank` (GitHub: the `M<n>` of its title, else its number; Local: its index in `tickets/milestones.yml`), a Ticket without milestone last; then priority (`P0` < `P1` < `P2` < none); then size (`XS` < `S` < `M` < `L` < `XL` < none); then number. Used by the server, `/boucle` and PILOTAGE-1. If BOUCLE-1 keeps no readable `Milestone.rank`, add it (a figure, readable for Local too) and fill it on both sides.
- `apps/server/src/loops/`:
  - `loops.controller.ts`: `POST /api/projects/:id/loop/start` (`@SensitiveAction('loop.start')`), `POST /api/projects/:id/loop/stop`, both `{ seq }`. Errors (French messages in `apps/server/src/errors/messages.ts`): 404 `loop.project-not-found`; 422 `loop.not-ready` (« Ce Projet n'est pas prêt : <ce qui manque>. ») when PROJET-3's readiness has a failing check; 422 `loop.no-ticket-phase` (« Le Process de ce Projet n'a pas de Phase « pour chaque Ticket prêt ». ») when the active version has no Phase with `forEach: 'ticket.ready'`; 422 `loop.runner-missing` when no Runner is linked; 422 `loop.already-running`; 409 per CORE-7.
  - `loop-slot.ts`, one Ticket at a time per Projet: the slot is held by the LoopRecord whose PhaseRun is `running`. A PhaseRun `waiting` (on a Décision of the Pilote: a gate, a blocked or interrupted Ticket, a Retour exhausted) frees it. Registered on PROCESS-4's engine as the start guard of `ticket.ready` PhaseRuns: a StepRun of such a PhaseRun that works on the Runner (an agent kind, `command`, `checks`) starts only while its PhaseRun holds the slot, else it stays queued and its LoopRecord gets `queuedAt`; a gate or the `merge` needs no slot (an approval confirmed by the Pilote merges at once, BOUCLE-6). If PROCESS-4 has no such hook, add it there: `Engine.registerStartGuard(forEach, guard)` and `Engine.startQueued(tx, phaseRunId)`.
  - `loop-scheduler.ts`: `tick(tx, projectId)` in the Pilote's scope, called on start, on `ticket.upserted` and `phase-run.upserted` of the Projet, and when its Runner comes online. While `running` and the slot is free: first the queued LoopRecords (oldest `queuedAt`) through `Engine.startQueued`; else the first ready Ticket by `compareForLoop` that has no open LoopRecord: `Engine.admit(tx, { projectId, phaseId, item: { type: 'ticket', id } })` on the active version's `ticket.ready` Phase, then its LoopRecord. Runner offline → `waiting-runner`, back to `running` when it is online.
  - A PhaseRun `done`, `stopped` or `failed` ends its LoopRecord (`endedAt`; `outcome` is set by the handler that ended it: BOUCLE-4's merge, SOURCE-6's close) and ticks.
  - Stop: `state: stopped`, `stoppedBy: pilot`; the Session of the slot's running StepRun is stopped, that StepRun becomes `interrupted` (PROCESS-4's StepRun state, added if absent), its PhaseRun `waiting`, `LoopRecord.interruptedAt` set; no Décision (the Pilote did it). Nothing is admitted nor started from the queue while stopped.
  - A `RunnerWaitingWork` provider `loops`: the Projets whose Boucle is `running` or `waiting-runner` and that have a ready Ticket or a running PhaseRun.
  - `loops.state.ts`: `StateContributor` keys `agentLoops` and `loopRecords` (the open ones and those ended today); every change writes its event in its transaction.
- Web:
  - `apps/web/src/api/loops.ts`; store slices `agent-loop`, `loop-record`; `apps/web/src/views/boucle.ts` (pure: store → `PageBoucle` data); router `/boucle` (filter `?projet=<id>`).
  - Composants `PageBoucle` and `LoopCard` (`packages/contracts/src/composants/page-boucle.ts`, `loop-card.ts`; `packages/skin-passerelle/src/page-boucle.ts`, `loop-card.ts`), registered in `COMPOSANTS`; actions `start` (`sensitive: true`), `stop`, `openSession`, `openTicket`; t() keys under `boucle.*` in `packages/sdk/src/i18n/fr.ts`.
  - All Projets: the Banner « La Boucle merge elle-même », one `LoopCard` per Projet: running (StatusDot `go`, « En cours · depuis 09:12 · 4 Tickets mergés aujourd'hui », the slot's Ticket as `AgentRow` with « Session », « À suivre » with the next two ready Tickets, « Arrêter la Boucle »), stopped (« Arrêtée · 3 Tickets prêts · 1 interrompu », « Démarrer la Boucle »).
  - One Projet selected (`boucle-arretee`): « Arrêtée · par toi, hier à 19:05 » with its explanation, the cards « Tickets prêts » (TicketRow `pret`, meta « jalon <titre> »), « Interrompu » (TicketRow `interrompu`: LoopRecords with `interruptedAt` whose PhaseRun is `waiting`) and « Rôles de ce Projet » (KeyValue: each agent Étape of the `ticket.ready` Phase, its name → its Rôle's effective Moteur).
  - The confirmation (`boucle-confirmation-demarrage`): `confirmSensitiveAction` titled « Démarrer la Boucle de <Projet> ? », action « Démarrer la Boucle », consequences: the background work « <Étape> sur <Moteur> » for each agent Étape of the Phase (« Code sur Codex, Review sur Claude Code »), the merge of each Ticket that passes its Review and its checks by the Boucle itself, the Tickets waiting in « À toi », « La Boucle prend les <n> Tickets prêts un par un. ».
  - Titles of Local Tickets and milestones, and a Local Projet's name, come decrypted from the store (BOUCLE-1, PROJET-6): the views never ask the server for them.
- Test scenarios `apps/server/src/testing/scenarios/boucle.ts` (`boucle`, `boucle-arretee`, `boucle-confirmation-demarrage`; one Projet on GitHub, one Local), Playwright `apps/web/e2e/boucle.spec.ts`.

## Decisions already made

- Mockup: `boucle`, `boucle-arretee`, `boucle-confirmation-demarrage` (pages `design/screens/crewdeck/boucle.html`, `…/boucle-arretee.html`, `…/boucle-confirmation-demarrage.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- Not built here: « Planifier », the « Planifications » and « Comptes IA » cards (BOUCLE-8), the « Reprendre » button of an interrupted Ticket (BOUCLE-7).
- The Boucle admits; the engine runs. The loops module never starts a Session nor calls a Moteur itself.
- One Ticket at a time per Projet (several Boucles at once is a `next` story); several Projets run at once. A PhaseRun waiting for the Pilote frees the slot (US-15); its dependents stay not ready through `blockedBy`.
- The admitted PhaseRun is pinned to the version active at admission (PROCESS-4): activating a new version while the Boucle runs changes the next admissions only.
- Starting a Boucle that has interrupted Tickets does not resume them: they stay in « Interrompu » until « Reprendre » (BOUCLE-7).
- The merges covered by the start happen only while the Boucle is `running` (BOUCLE-4 checks it); a stopped Boucle leaves a Ticket that passed everything waiting for the next start.
- « Tickets mergés aujourd'hui » counts the LoopRecords with `outcome: merged-by-loop` ended since midnight in the Pilote's time zone.
- The confirmation's text comes from the core (t() keys of `apps/web`), never from the Skin.

## Acceptance criteria

- [ ] Starting asks the core's confirmation; confirmed, the Boucle is `running`, `agent-loop.upserted` reaches the tab, and the first ready Ticket by `compareForLoop` is admitted: a PhaseRun of the `ticket.ready` Phase on the active version and its LoopRecord, for a GitHub Projet and for a Local one alike.
- [ ] `compareForLoop` orders by milestone (due date, rank, none last), priority, size, number (unit tests for each tie, a Local milestone ranked by its file order).
- [ ] While one PhaseRun is `running`, no second Ticket is admitted; once it is `waiting` (a Décision open), the next ready Ticket that does not depend on it is admitted.
- [ ] A PhaseRun leaving `waiting` while another holds the slot starts its StepRun only once the slot is free, before any new admission.
- [ ] Stopping sets `stopped`, stops the current Session, marks its StepRun `interrupted` and its LoopRecord `interruptedAt`; nothing new is admitted.
- [ ] A version activated while the Boucle runs leaves the running PhaseRun on its version; the next admission uses the new one.
- [ ] With the Runner offline, a started Boucle is `waiting-runner` and the `loops` provider lists its Projet; once online it admits its Ticket.
- [ ] 422 `loop.not-ready`, `loop.no-ticket-phase`, `loop.runner-missing`, `loop.already-running`; 409 with a stale `seq`; 404 for another Pilote's Projet; 401 without a session; each change writes its event in the same transaction.
- [ ] `/boucle` matches the three mockups at 390 and 1280 px (Playwright against the fake Runner and the fake GitHub, axe without violations), and the captures of the visual review come from those tests.

## Verification

- `pnpm exec nx test server -- src/loops/`
- `pnpm exec nx test contracts -- src/loops/order.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- loops`
- `pnpm exec nx test skin-passerelle -- src/page-boucle.spec.ts`
- `pnpm exec nx e2e web -- boucle.spec.ts`
- `scripts/captures.sh boucle boucle-arretee boucle-confirmation-demarrage`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

A migration (tables `agent_loops`, `loop_records`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- The Étapes of the Phase: `code` BOUCLE-3, `review` and `merge` BOUCLE-4, `checks` BOUCLE-9, `visual-review` BOUCLE-6.
- Retours and their maximum: PROCESS-6. A Ticket changed or closed at its Source: SOURCE-6.
- Blocked Tickets and their page: BOUCLE-5. Limits, interruptions and « Reprendre »: BOUCLE-7. Planification and the Comptes IA card: BOUCLE-8.

## Dependencies

- BOUCLE-1
- CORE-7
- RUNNER-9
- RUNNER-12
- PROJET-3
- PROCESS-5
