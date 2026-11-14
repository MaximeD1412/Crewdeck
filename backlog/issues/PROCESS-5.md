---
id: PROCESS-5
title: "The engine across Phases: lineage, Entrées fed from another Phase or absent, « pour chaque » items, Phases run one at a time, the Idée without a Projet"
epic: PROCESS
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PROCESS-4]
adr: [0011]
risques: []
stories: [US-95]
screens: []
revue_visuelle: false
video: false
---

## Context

US-95: a Phase repeats for each item of a list (each noted Idée, each retained Idée, each ready Ticket). ADR 0011, « The engine »: items flow from Phase to Phase, each PhaseRun recording the PhaseRun whose output became its item (**lineage**: a Ticket's Développement points to its Conception, a Conception to its Idée), and an Entrée fed by an arrow from another Phase takes the output of the nearest ancestor that ran that Étape (the Revue visuelle of Ticket #12 gets the Maquettes its own Conception approved, never another's), or is « absente ». A Phase without `forEach` (the « Livraison » after each merge, PROCESS-13) starts a PhaseRun each time its first Entrées get an Artefact, one at a time per Projet, in order. An Idée noted without a Projet (US-5) runs the « Idée » Phase of the release's « Process Crewdeck ». PROCESS-4 built the engine inside one Phase; this ticket links the Phases. BOUCLE-2, CONCEPTION-1, IDEE-2 and PROCESS-13 rely on it.

## Current state of the code

- Created by PROCESS-4: `apps/server/src/process/engine/` (`Engine.admit`, `signal`, `retry`, `stop`, `supersedeFrom`, `rerunFrom`, the start guards, `advance`), `feeding.ts` (`readySteps`, an arrow from another Phase of a type other than the item's resolving to no Artefact), `phase_runs` (`projectId` and `processVersionId` required, `waitingOn` with `queue`), `step_runs` (`outputs` jsonb with its GIN index, `inputs`), `zPhaseRun`, `zStepRun`.
- Created by PROCESS-1: `BUILTIN_TEMPLATES['process-crewdeck']` (its Phase `ph-idee`, `forEach: 'idea.noted'`), `FOR_EACH`.

## To do

- **Prisma** (migration `<date>_lineage`), `phase_runs`: `parentPhaseRunId` (composite foreign key to `phase_runs`, set null on delete), `projectId` and `processVersionId` nullable, `builtinTemplate` text null; checks `(project_id IS NULL) = (builtin_template IS NOT NULL)` and `(process_version_id IS NULL) = (builtin_template IS NOT NULL)`.
- **Contracts**: `zPhaseRun` gains `parentPhaseRunId | null`, `builtinTemplate: 'process-crewdeck' | null`, and `projectId` and `processVersion` become nullable; `zStepRun`'s inputs gain `absent: boolean`.
- **Server** `apps/server/src/process/engine/`:
  - `lineage.ts`: `findParent(tx, projectId | null, item)`: the PhaseRun of the latest `done` StepRun whose `outputs` hold `{ type, id }` of the item (`outputs @> '[{"type":…,"id":…}]'`), among the Pilote's StepRuns of the same Projet or of no Projet; `ancestors(tx, phaseRun)`: its parent, the parent's parent…, nearest first.
  - `Engine.admit(tx, { projectId, phaseId, item, parentPhaseRunId? })`: the parent given (a Ticket drafted from an Idée, US-56, IDEE-5), else `findParent`, else none (a Ticket written by hand); `projectId: null` only for an `idea` into the `idea.noted` Phase of `BUILTIN_TEMPLATES['process-crewdeck']`, the PhaseRun then `builtinTemplate: 'process-crewdeck'` and reading that definition (any other admission without a Projet is `EngineInputError`).
  - `feeding.ts`: `readySteps` gets the ancestors' StepRuns; an Entrée fed by an arrow from another Phase whose type is not the item's takes the outputs on that Sortie of the latest `done`, non-`superseded` StepRun of the arrow's source Étape in the nearest ancestor that ran it (ids are stable across Versions, so an ancestor on another Version answers); none: `artifacts: []`, `absent: true`, and the Étape runs (its Skill and Contrat say what « absente » means).
  - After a StepRun is `done`, for each Artefact of a Sortie with an arrow to an Étape of another Phase `P` (the arrows of the producing PhaseRun's Version; `P` looked up by id in the Projet's active Version, nothing when it has none):
    - `P` has a `forEach` whose type is the Artefact's: `idea.noted` admits it at once (parent: this PhaseRun); `idea.retained` and `ticket.ready` start nothing (admitted by « Démarrer la Conception », CONCEPTION-1, and by the Boucle, BOUCLE-2; `findParent` finds this PhaseRun then);
    - `P` has no `forEach` and the arrow reaches one of its first Entrées (no arrow from inside `P` reaches it): a PhaseRun of `P` for that Artefact, pinned to the active Version, parent this PhaseRun; `running` when no other PhaseRun of `P` in the Projet holds the turn (`running`, `waiting` or `failed`), else `waiting` with `waitingOn: 'queue'`;
    - any other arrow: nothing (lineage feeds it later).
  - When a PhaseRun of a Phase without `forEach` ends `done` or `stopped`, the oldest `queue` PhaseRun of that Phase and Projet starts (`advance`); a `failed` one keeps the turn until `retry` or `stop`.
- **Tests**:
  - `apps/server/src/process/engine/feeding.spec.ts`: lineage on « Process Crewdeck »: a Ticket's PhaseRun whose parent is a Conception that approved Maquettes gets them on `st-rv.maquettes` (with their SHA); two Conceptions, each Ticket gets its own's; a Ticket with no parent gets `st-rv.maquettes` absent and `st-rv` starts.
  - `apps/server/test/integration/process-engine.spec.ts` (extended), with test handlers: the Tickets output by a Conception's `st-ap-tickets` get that Conception as parent when admitted; an Idée noted without a Projet runs `ph-idee` on the builtin template, and its Conception admitted later on a Projet has it as parent; a definition with a « Livraison » Phase without `forEach` after `st-merge` (fixture of PROCESS-2's cases) starts one PhaseRun per merged change, the second `waiting` on `queue` until the first is `done`, in order; a `failed` one holds the queue until `retry`; an arrow into an `idea.noted` Phase admits at once.

## Decisions already made

- The parent is found by the item's Artefact in the outputs, not by the arrows: the Conception may have run on another Version than the Ticket's, and the item's id is what both share.
- Lineage reads the ancestors' StepRuns by the source Étape's id: Étape ids are stable across Versions (ADR 0011), so a Ticket on Version 3 reads the Maquettes its Conception approved on Version 2.
- An Entrée « absente » never blocks: the Étape runs, `absent: true` tells its handler, which tells the Skill; the Contrat judges what it needs.
- The arrows that trigger a PhaseRun are those of the producing PhaseRun's Version (what was drawn when the work ran); the PhaseRun they start is pinned to the active Version, as every new work.
- A failed PhaseRun of a Phase without `forEach` holds the turn: the Livraisons stay in order, a failed one waits for its Décision (PROCESS-12).
- An Idée without a Projet runs on the release's « Process Crewdeck » (no Version row: `builtinTemplate`); setting its Projet changes nothing in that PhaseRun, the next Phases follow the Projet's Process; a retained Idée without a Projet cannot be admitted to a Conception (CONCEPTION-1 asks for the Projet first).

## Acceptance criteria

- [ ] A Ticket written by the Découpage of Conception C, once admitted, has C's PhaseRun as parent; a Ticket written by hand has none.
- [ ] The Revue visuelle of that Ticket gets the Maquettes approved in C (their SHA), never those of another Conception; without an ancestor that ran the Maquettes' approval, its Entrée is `absent` and it starts.
- [ ] An Idée with no Projet runs « Analyse de l'Idée » and « Tri de l'Idée » of the builtin « Process Crewdeck »; its Conception on a Projet points to that PhaseRun.
- [ ] Two merges in a row of a Projet whose Process has a Phase without `forEach` after the Merge give two PhaseRuns of that Phase, the second waiting until the first is `done`, started in order; a failed one keeps the second waiting until it is retried or stopped.
- [ ] An Artefact sent by an arrow into an `idea.retained` or `ticket.ready` Phase starts nothing by itself.
- [ ] An admission without a Projet into any other Phase is refused.

## Verification

- `pnpm exec nx test server -- src/process/engine/`
- `pnpm exec nx test-integration server -- process-engine`
- `pnpm exec nx run contracts:generate` then `git diff --exit-code`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the migration runs with the deploy).

## Out of scope

- Retours: PROCESS-6. The « Livraison » Phase and its Commande « Lancer »: PROCESS-12, PROCESS-13.
- Who admits: the Idée (IDEE-2), « Démarrer la Conception » (CONCEPTION-1), the Boucle (BOUCLE-2); a Ticket drafted from an Idée: IDEE-5.

## Dependencies

- PROCESS-4.
