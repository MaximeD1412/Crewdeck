---
id: PROCESS-4
title: "The engine's core: PhaseRun and StepRun pinned to a Version, the kind handlers, admission and Entrées fed inside a Phase"
epic: PROCESS
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PROCESS-3]
adr: [0011, 0007]
risques: []
stories: [US-96]
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0011, « The engine »: the server interprets each Projet's Versions instead of a fixed state machine. A **PhaseRun** is one item through one Phase, pinned to the Version active when it starts, so that activating a new Version (PROCESS-10) never touches a running one (US-96: what is in progress finishes on the version it started with). A **StepRun** is one pass of an Étape; it starts when every Entrée is fed, and its kind's handler does the work (an agent's Session, a gate's Décision, a Commande, the checks, the merge). This ticket builds the core every kind and every item uses: the tables, the handler registry, `Engine.admit`, the feeding inside a Phase, the events. Lineage across Phases is PROCESS-5, Retours PROCESS-6; the handlers are their Étapes' tickets; the Boucle (BOUCLE-2), the Conception (CONCEPTION-1) and the Idée (IDEE-2) admit their items.

## Current state of the code

- Created by PROCESS-3: `apps/server/src/process/` (`ProcessService`, `process_versions` with `@@unique([projectId, number])`, `process_drafts`, `process.upserted`, the slice `processes`); by PROCESS-1 and PROCESS-2: `packages/contracts/src/process/` (`zProcessDefinition`, `FOR_EACH`, `CATALOGUE`, `zArtifactType`).
- `packages/contracts/src/events/index.ts`: `RESOURCES` has `step-run` (no module registered its payload) and no `phase-run`.
- `apps/server/src/realtime/registry.ts` (`Registry<T>`, the multi-provider pattern of `STATE_CONTRIBUTORS`), `transactions.ts`, `events.writer.ts`.
- No `step_runs` table on develop. RUNNER-12's ticket planned one in `apps/server/src/steps/` (`StepsService`): this ticket creates it in the engine, and RUNNER-12 starts the agent Étapes' Sessions from it.
- `apps/server/src/scope/scope.models.ts`: composite foreign keys carrying `pilotId`.

## To do

- **Contracts** `packages/contracts/src/api/phase-runs.ts`:
  - `PHASE_RUN_STATES = ['running', 'waiting', 'done', 'stopped', 'failed']`, `PHASE_RUN_WAITING_ON = ['queue', 'decision']` (what a `waiting` PhaseRun waits for: its turn in a Phase without `forEach`, PROCESS-5; a Décision, PROCESS-6);
  - `STEP_RUN_STATES = ['running', 'waiting', 'interrupted', 'blocked', 'done', 'failed', 'stopped', 'superseded']` (`waiting`: on the Pilote, a gate; `interrupted`: its Session cut, the Runner gone or a limit reached, to resume; `blocked`: its agent cannot go on and says why, to unblock; `superseded`: undone by a rerun, a Retour's or `rerunFrom`'s), `STEP_VERDICTS = ['passed', 'changes', 'failed']`;
  - `zArtifactRef { portId, type: zArtifactType, id (1 to 200: an Idée's or a Ticket's id, a document's path, a change's number), sha? }`;
  - `zPhaseRun { id, projectId, processVersion (its number), phaseId, itemType, itemId, state, waitingOn | null, startedAt, endedAt | null }`;
  - `zStepRun { id, projectId, phaseRunId, stepId, kind, iteration, state, inputs: { portId, artifacts: ArtifactRef[] }[], outputs: ArtifactRef[], verdict | null, failure | null, reason | null, sessionId | null, startedAt, endedAt | null }` (`reason`: why a rerun started it, `loop-back` or the caller's, e.g. BOUCLE-4's `fix-conflict`);
  - `runningWorkByVersion(phaseRuns)`: `{ version, count }[]` of the `running` and `waiting` ones, for the panel's foot and the activation's dialog;
  - `events/phase-run.ts` and `events/step-run.ts` (`registerEventPayload`), `'phase-run'` added to `RESOURCES`; `STATE_SLICES` gains `phaseRuns` (every `running` or `waiting` PhaseRun) and `stepRuns` (the StepRuns of those).
- **Prisma** (migration `<date>_engine`):
  - `ProcessVersion`: `@@unique([pilotId, id])`.
  - `PhaseRun` (`phase_runs`): `id`, `pilotId`, `projectId` (→ `projects`), `processVersionId` (→ `process_versions`), `phaseId`, `itemType`, `itemId`, `state` enum `PhaseRunState`, `waitingOn` text null, `startedAt`, `endedAt` null, `lastSeq`; `@@unique([pilotId, id])`, `@@index([pilotId, projectId, state])`, `@@index([pilotId, itemType, itemId])`; a partial unique index on `(project_id, phase_id, item_type, item_id)` where `state` is `running` or `waiting`.
  - `StepRun` (`step_runs`): `id`, `pilotId`, `projectId`, `phaseRunId` (→ `phase_runs`), `stepId`, `kind`, `iteration` int default 1, `state` enum `StepRunState`, `inputs` jsonb, `outputs` jsonb default `[]`, `verdict` enum `StepVerdict` null, `failure` text null, `reason` text null, `sessionId` uuid null, `contratVerdict` jsonb null (written by RUNNER-12 on `step.verdict`), `startedAt`, `endedAt` null, `lastSeq`; `@@index([pilotId, phaseRunId])`, a GIN index (`jsonb_path_ops`) on `outputs`.
  - Every foreign key composite with `pilotId`, cascading from the Projet.
- **Server** `apps/server/src/process/engine/`:
  - `kinds/handler.ts`: `StepKindHandler { kind: StepKind; start(tx, run): Promise<'running' | 'waiting'>; onSignal(tx, run, signal: unknown): Promise<StepResult | null>; stop?(tx, run): Promise<void> }`, `run: StepRunContext { phaseRun, stepRun, step, definition }`, `StepResult = { state: 'done', outputs: ArtifactRef[], verdict?: StepVerdict } | { state: 'failed', failure: string } | { state: 'interrupted' | 'blocked', failure: string } | { state: 'running' | 'waiting' }` (the last one resumes an `interrupted` or `blocked` StepRun); the token `STEP_KIND_HANDLERS` (`Registry<StepKindHandler>`), one handler per kind (a second one throws at start).
  - `feeding.ts`, pure: `readySteps(definition, phaseRun, stepRuns): { stepId, inputs }[]`, the Étapes of the PhaseRun's Phase that have no StepRun yet (other than `superseded`) and whose every Entrée resolves:
    - an Entrée no arrow reaches, of the Phase's `forEach` type: the item (`{ type, id: itemId }`);
    - an arrow from an Étape of the same Phase: the outputs on that Sortie of the latest `done` StepRun of that Étape in this PhaseRun (`superseded` ones ignored); unresolved while it has none, or none on that Sortie;
    - an arrow from another Phase whose type is the Phase's `forEach` type: the item; any other arrow from another Phase: resolved, with no Artefact (PROCESS-5 replaces this by lineage).
  - `engine.ts`, `Engine`:
    - `phaseFor(tx, projectId, forEach)`: the id of the active Version's Phase with that `forEach`, or `null`;
    - `admit(tx, { projectId, phaseId, item: { type, id } }): PhaseRun`: the active Version pinned; the Phase must exist and `item.type` be its `forEach`'s type (else `EngineInputError`, a caller's bug); an unfinished PhaseRun of the same item and Phase is returned as is; else the PhaseRun `running`, then `advance`;
    - `signal(tx, stepRunId, signal)`: the StepRun `running`, `waiting`, `interrupted` or `blocked` (else nothing, `false`), its kind's `onSignal`; a result is written (outputs, verdict, `done`; `failure` and `failed`, `interrupted` or `blocked`; back to `running` or `waiting`), then `advance`;
    - `retry(tx, stepRunId)`: a `failed` StepRun gets a new StepRun of the same Étape and iteration, its PhaseRun `running` again (« Relancer l'Étape », ATOI-2);
    - `stop(tx, phaseRunId)`: each `running`, `waiting`, `interrupted` or `blocked` StepRun through its handler's `stop`, then `stopped`; the PhaseRun `stopped`;
    - `supersedeFrom(tx, phaseRun, stepId)`: the StepRuns of that Étape and of every Étape it reaches by arrows inside the Phase, not yet `superseded`, through their handler's `stop` when they run, then `superseded` (their outputs no longer feed anything);
    - `rerunFrom(tx, phaseRunId, stepId, { reason })`: `supersedeFrom`, then a new StepRun of that Étape, iteration + 1, `reason` recorded, its inputs resolved again, then `advance`; it counts against no Retour (BOUCLE-4 reruns the Code in `fix-conflict` mode after a merge conflict and counts its own reruns by `reason`); the PhaseRun `running` or `waiting` (else `EngineInputError`);
    - `registerStartGuard(forEach, guard)`, `guard(tx, { projectId, phaseRun, stepId, kind }): Promise<boolean>`: asked before each StepRun of a PhaseRun of the Phase with that `forEach` starts (one guard per `forEach`, a second throws); `false` leaves that Étape ready but not started, the PhaseRun `running`; `startQueued(tx, projectId)`: `advance` of every `running` PhaseRun of the Projet, oldest first, for the guard's owner once a slot frees (BOUCLE-2 keeps one Ticket in flight per Projet, its guard letting the gates and `merge` through);
    - `advance(tx, phaseRun)`: each ready Étape gets its StepRun (`inputs` recorded) and its handler's `start` sets `running` or `waiting`; a kind without a handler makes it `failed` with `failure: 'no-handler'`; then the PhaseRun is `done` when no StepRun is `running`, `waiting`, `interrupted` or `blocked`, none `failed` and nothing is ready (a ready Étape held by a guard counts as ready), `failed` when one is `failed` and none runs.
    - Every write with its `phase-run.upserted` or `step-run.upserted` in the caller's transaction; the PhaseRun's row locked (`FOR UPDATE`) at the start of `signal`, `retry`, `stop`, `rerunFrom` and `advance`, so that two signals of one PhaseRun are ordered.
  - `engine.module.ts` (exports `Engine`, `STEP_KIND_HANDLERS`), the contributors of `phaseRuns` and `stepRuns`.
- **Web**: the slices `phase-run` and `step-run` (collections, snapshot keys `phaseRuns`, `stepRuns`) registered in `apps/web/src/store/`.
- **Tests**:
  - `apps/server/src/process/engine/feeding.spec.ts` on « Process Crewdeck »'s « Développement »: the item feeds `st-code`; `st-checks`, `st-review` (once the checks' Verdict exists), `st-rv` start after `st-code`'s `done`; `st-merge` waits for both Verdicts; an Étape whose predecessor is `done` without an output on that Sortie never starts.
  - `apps/server/test/integration/process-engine.spec.ts`, with test handlers registered for the kinds of a small definition (each finishing on a signal): admission pins the active Version; a Version 2 inserted while the PhaseRun runs leaves it on Version 1 and the next admission takes Version 2; admitting the same item twice returns the same PhaseRun; a full pass ends `done`; a handler's `failed` makes the PhaseRun `failed` and `retry` resumes it; a kind without a handler gives `no-handler`; `stop` calls each handler's `stop`; an `interrupted` StepRun resumes on a `running` result; `rerunFrom` of `st-code` supersedes the StepRuns from it on and starts iteration 2 with its `reason`; a guard returning `false` holds the Étape until `startQueued`; each change and its event in one transaction, payloads valid; `GET /api/state` lists the unfinished PhaseRuns and their StepRuns.

## Decisions already made

- The engine is pure feeding (`feeding.ts`) plus a thin writer (`engine.ts`): the rules are tested without a database, the writes with one.
- The handlers own the work, the engine only the sequence: a handler never writes a StepRun's state, it returns a `StepResult` from `onSignal`; the domain modules (`sessions`, `decisions`, `tickets`…) call `Engine.signal` when their thing ends.
- `inputs` and `outputs` are Artefact references, never content (ADR 0003): ids, paths, numbers and SHAs, readable by the server.
- An Étape runs at most once per PhaseRun and iteration: a `failed` one waits for `retry` (ATOI-2's « Relancer l'Étape »), a `superseded` one may run again (a Retour, PROCESS-6, or `rerunFrom`); `interrupted` and `blocked` keep their PhaseRun open until resumed or stopped.
- A missing handler fails the Étape with `no-handler` rather than blocking the PhaseRun silently: until an Étape's ticket lands, its StepRun says so.
- `step_runs` is the engine's: RUNNER-12 starts an agent Étape's Session from a StepRun, writes `sessionId` and `contratVerdict`, and signals the end; it creates no table of its own.
- The unfinished PhaseRuns and their StepRuns are in `GET /api/state`; finished ones are read by their pages' own lists (bounded by their Projet or their item).
- One unfinished PhaseRun per item and Phase (the partial unique index): an admission repeated by a double click or a retry gives the same PhaseRun.

## Acceptance criteria

- [ ] `Engine.admit` of a Ticket into the `ticket.ready` Phase creates a `running` PhaseRun pinned to the active Version and a StepRun of `st-code` whose input is the Ticket; its events are written in the transaction.
- [ ] Signalling `st-code` `done` with a `changement` output starts `st-checks` and `st-rv` (and `st-review` once `st-checks` is `done`); `st-merge` starts only once both Verdicts and the change are there.
- [ ] A Version 2 written while a PhaseRun runs (as PROCESS-10's activation will) leaves that PhaseRun on Version 1 to the end; the next admission uses Version 2.
- [ ] A second `admit` of the same item and Phase returns the unfinished PhaseRun; two signals at once on one PhaseRun are applied one after the other.
- [ ] A failed Étape makes the PhaseRun `failed`; `retry` starts a new StepRun of that Étape and the PhaseRun is `running` again.
- [ ] A kind with no handler gives a StepRun `failed` with `no-handler`.
- [ ] `stop` stops every running StepRun through its handler and the PhaseRun is `stopped`.
- [ ] A handler's `interrupted` or `blocked` result keeps the PhaseRun open; a later `running` result resumes the StepRun.
- [ ] `rerunFrom(tx, phaseRunId, 'st-code', { reason: 'fix-conflict' })` supersedes `st-code` and every StepRun after it in the Phase, starts `st-code` at iteration 2 with that `reason`, and the downstream Étapes run again on its new outputs; no Retour's count changes.
- [ ] With a guard on `ticket.ready` refusing every Étape but `merge` and the gates, a second Ticket's `st-code` stays ready and unstarted; once the guard accepts, `startQueued` starts it; a second guard for the same `forEach` throws at start.
- [ ] `GET /api/state` has `phaseRuns` and `stepRuns`; the page's store follows their events.

## Verification

- `pnpm exec nx test contracts -- src/api/phase-runs.spec.ts`
- `pnpm exec nx test server -- src/process/engine/`
- `pnpm exec nx test-integration server -- process-engine`
- `pnpm exec nx test web -- src/store/`
- `pnpm exec nx run contracts:generate` then `git diff --exit-code`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the migration runs with the deploy).

## Out of scope

- Lineage, Entrées fed across Phases, the absent Entrée, Phases without `forEach`, an Idée without a Projet: PROCESS-5. Retours and `loop-back.exhausted`: PROCESS-6.
- The handlers: RUNNER-12 (an agent Étape's Session), IDEE-2, IDEE-3, PROJET-4, CONCEPTION-3 to CONCEPTION-10, BOUCLE-3, BOUCLE-4, BOUCLE-6, BOUCLE-9, PROCESS-12. The Décisions of a failed Étape and « Relancer l'Étape »: ATOI-2.
- The guard keeping one Ticket in flight per Projet: BOUCLE-2; the merge conflict's `rerunFrom`: BOUCLE-4; the Décisions of an `interrupted` or `blocked` StepRun: their handlers' tickets.
- Admitting the Boucle's Tickets: BOUCLE-2; a Conception: CONCEPTION-1; an Idée: IDEE-2. Activation: PROCESS-10.

## Dependencies

- PROCESS-3.
