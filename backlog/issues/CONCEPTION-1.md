---
id: CONCEPTION-1
title: "Conceptions: a PhaseRun admitted from a retained Idée, the Design record, the Conceptions list"
epic: CONCEPTION
type: feature
priority: P0
size: M
milestone: M6 Conception
blocked_by: [IDEE-3, RUNNER-12, PROCESS-5]
adr: [0001, 0003, 0007, 0008, 0011]
risques: []
stories: [US-8]
screens: [conceptions, conceptions-vide]
revue_visuelle: true
video: false
reprend: 77
---

## Context

US-8: the Pilote starts the Conception of a retained Idée in one click, so that an agent runs the product design with them. The refonte (PRD #169, ADR 0011) changes what a Conception is: no fixed list of six Étapes and no `nextStep` function, no Étapes optionnelles (US-83 is removed). A **Conception** is the **PhaseRun** of a retained Idée through the Phase of its Projet's Process whose `forEach` is `idea.retained` (« Conception » in « Process Crewdeck »), admitted by PROCESS-4's `Engine.admit` when the Pilote clicks « Lancer la Conception », pinned to the version active then, its parent being the Idée's PhaseRun (PROCESS-5's lineage). The engine starts each Étape when its Entrées are fed; each kind is a handler (CONCEPTION-3, 5, 7, 8, 9 for the agent Étapes, CONCEPTION-4, 6, 10 for the approval gates). Whether the Maquettes or the Revue croisée run is only whether they are in the Process. This ticket lays the `designs` domain record every CONCEPTION ticket uses, the admission, the Conception's steps as read from its pinned version, and the `/conceptions` list. The model is the dotfiles `design` tool's record (`MaximeD1412/dotfiles`, `agents/tools/design/README.md` « Conceptions »): facts stored, states computed.

## Current state of the code

- No `designs` module, no `/conceptions` page on develop; `RESOURCES` (`packages/contracts/src/events/index.ts`) already lists `design` and `step-run`; `NAV_IDS` (`packages/contracts/src/composants/cadre.ts`) has the Conceptions entry.
- Created by IDEE-3: `retained` Idées, the `idea-triage` gate passing the Idée on its Sortie, the retained Idée's page (`idee-retenue`) with a slot for « Lancer la Conception ». By IDEE-5: `Idea.ticketNumber` for an Idée turned into a Ticket.
- Created by PROCESS-1: `ProcessDefinition` (`phases` with `forEach`, `steps` with `phaseId`, `kind`, `name`, `col`, `row`, `tools`), the catalogue (family, `judges`). By PROCESS-3: `process_versions`, `GET /api/projects/:id/process`. By PROCESS-4: `phase_runs` (`processVersionId`, `phaseId`, `itemType`, `itemId`, `state`), `step_runs` (`phaseRunId`, `stepId`, `kind`, `iteration`, `state`, `outputs`, `sessionId`), `Engine.admit(tx, { projectId, phaseId, item })`, events `phase-run`, `step-run`. By PROCESS-5: `parentPhaseRunId`, Entrées fed across Phases. By PROCESS-6: the PhaseRun `stopped` on « Arrêter » of `loop-back.exhausted`.
- Created by RUNNER-12: agent Sessions of a StepRun. By RUNNER-9: `AgentSession`. By UI-5 / UI-6: `ListRow`, `AgentRow`, `ProcessTrack`, `StatusBadge`, `Tabs`, `Empty`.

## To do

- **Contracts** `packages/contracts/src/api/designs.ts`:
  - `zDesignStep = { stepId, kind, name, judges: boolean, state: 'todo' | 'queued' | 'running' | 'waiting' | 'passed' | 'changes-requested' | 'incomplete' | 'failed', stepRunId: zId | null, sessionId: zId | null, iteration: number, startedAt: zInstant | null }`: one per Étape of the pinned Phase, its latest StepRun's state (`waiting` a gate waiting for the Pilote, `changes-requested` a judge that took a Retour).
  - `zDesign = { id, projectId, ideaId, phaseRunId, processVersion: number, title: string | null, slug: string | null, prdPath: string | null, state: 'in-progress' | 'done' | 'abandoned', steps: zDesignStep[], startedAt, doneAt: zInstant | null }`; `zStartDesignInput = { seq }`; event payload `design.upserted` (`registerEventPayload`).
- **Prisma** `Design` (`designs`: `pilotId`, `projectId`, `ideaId` unique, `phaseRunId` unique, `title?`, `slug?`, `prdPath?`, `state`, `startedAt`, `doneAt?`). No table of Étapes: they are the pinned version's, their state the StepRuns'.
- **Server** `apps/server/src/designs/`:
  - `design-steps.ts`: pure `designSteps(definition, phaseId, stepRuns) → zDesignStep[]` (the Phase's Étapes ordered by `row` then `col`, each with its latest StepRun) and `designProgress(steps) → { k, n, current }` (`n` the Étapes of the Phase that write an Artefact — agent family, not `judges` —, `k` the position of the one in progress or last passed). Unit-tested on « Process Crewdeck », on a Phase without Maquettes, and on one without Revue croisée.
  - `POST /api/ideas/:id/design { seq }` (« Lancer la Conception »), one transaction with `design.upserted`: the Idée is `retained` (422 `designs.idea-not-retained`), without a Conception (422 `designs.already-started`), not turned into a Ticket (422 `designs.idea-has-ticket`), its Projet visé an existing Projet of the Pilote (422 `designs.no-project`: a new Projet needs creating first), whose active version has a Phase with `forEach: idea.retained` (422 `designs.no-design-phase`). Calls `Engine.admit(tx, { projectId, phaseId, item: { type: 'idea', id }, parentPhaseRunId: <the Idée's PhaseRun> })` and creates the `Design` with the PhaseRun's id; the engine starts the Étapes whose Entrées the Idée feeds.
  - `designs/phase-runs.listener.ts`: on a `phase-run` or `step-run` change of a Design's PhaseRun, writes `design.upserted` in the same transaction; PhaseRun `done` → Design `done` with `doneAt`; PhaseRun `stopped` → `abandoned`.
  - `designs.state.ts`: `StateContributor` key `designs`: the Conceptions `in-progress`, and the `done` or `abandoned` ones of the last 90 days, each with its `steps` computed from its pinned version; `GET /api/designs?state=done&cursor=` for older ones (50 per page, ADR 0008's cursor).
  - Messages: `designs.idea-not-retained` « Retiens d'abord cette Idée. », `designs.already-started` « La Conception de cette Idée est déjà lancée. », `designs.idea-has-ticket` « Cette Idée est déjà devenue un Ticket. », `designs.no-project` « Choisis d'abord un Projet existant pour cette Idée. », `designs.no-design-phase` « Le Process de ce Projet n'a pas de Conception. ».
- **Web**:
  - « Lancer la Conception » (primary) in the retained Idée's page slot, with « Un agent mène la Conception avec toi, dans une session que tu suis et à laquelle tu réponds. Rien n'est construit sans ton accord. »; on success, navigate to `/conceptions/:id`.
  - The store's `designs` slice (`apps/web/src/store/`), fed by `/api/state` and `design.upserted`.
  - `/conceptions`: `apps/web/src/views/conceptions.ts` and Composant `PageConceptions` (`packages/contracts/src/composants/page-conceptions.ts`, `packages/skin-passerelle/src/page-conceptions.ts`, in `COMPOSANTS`): header « Conceptions », « N en cours »; Projet chips with counts; tabs « En cours » · « Terminées » with counts (an abandoned one badged « Arrêtée »); one `ListRow` per Conception (title: `Design.title`, else the Idée's decrypted title from the plaintext cache; meta « <Projet> · retenue le <date> »; a `StatusBadge` of the current Étape: « <Étape> en cours », « <Type d'artefact of the gate's Entrée> à relire » for a waiting gate (« PRD à relire », « Tickets à valider »), « Contrat incomplet », « Étape échouée », « En attente du Runner »; « Étape k sur n »; a compact `ProcessTrack` of the Étapes); opening a row goes to `/conceptions/:id`.
  - The card « Sessions en cours »: one `AgentRow` per running agent StepRun of a Conception (Projet, « <title> · <Étape> », Moteur, « depuis 12 min ») with « Ouvrir » (`?session=<id>`).
  - Empty state (`conceptions-vide`): « Aucune Conception en cours », its text, « Voir les Idées » → `/idees`.
  - Copy under `t('conceptions.*')`; the state words of an Étape in `t('design.stepState.*')`, shared with CONCEPTION-2.
- **Tests and scenarios**: `apps/server/src/testing/scenarios/conceptions.ts` (`conceptions` with the mockup's three Conceptions on « Process Crewdeck », `conceptions-vide`), `apps/web/e2e/conceptions.spec.ts`.

## Decisions already made

- Mockup: `conceptions`, `conceptions-vide` (pages `design/screens/crewdeck/conceptions.html`, `…/conceptions-vide.html`; captures `design/screens/crewdeck/conceptions-390.png`, `…-1280.png` and the same for the state). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The mockup's meta « revue croisée désactivée pour ce Projet » is not built (US-83 removed).
- The Étapes of a Conception are those of its **pinned** version, never the active one: a version activated after « Lancer la Conception » applies to the next Conception (ADR 0011).
- The button reads « Lancer la Conception », as the mockups and the PRD's journeys say; it is ADR 0011's « Démarrer la Conception ».
- A Conception's title is readable by the server only once its PRD's change exists (CONCEPTION-3); before that the page shows the Idée's title, decrypted in the browser.
- One Conception per Idée at the MVP (merged Idées point to their target).
- Starting a Conception is not an Action sensible (US-26's list): no confirmation.
- The Conception runs on the target Projet's code Source, GitHub or Local alike; a Conception for a Projet that does not exist yet waits for US-81 (`later`).

## Acceptance criteria

- [ ] « Lancer la Conception » on a retained Idée of a Projet on « Process Crewdeck » admits a PhaseRun of its « Conception » Phase pinned to the active version, its parent the Idée's PhaseRun, creates the Design, starts the PRD Étape, and opens `/conceptions/:id`.
- [ ] A second start on the same Idée is refused with `designs.already-started`; an Idée `analysed` with `designs.idea-not-retained`; « nouveau » with `designs.no-project`; a Projet whose Process has no `idea.retained` Phase with `designs.no-design-phase`; an Idée turned into a Ticket with `designs.idea-has-ticket`.
- [ ] `designSteps` and `designProgress` give « Étape 1 sur 4 » for « Process Crewdeck » at the PRD, « sur 3 » for a Phase without Maquettes, and ignore the gates and the Revues croisées in `n`.
- [ ] A version activated after the start does not change the Conception's steps.
- [ ] `/conceptions` lists the Conceptions in progress with their current Étape and « Étape k sur n »; « Terminées » lists the done and abandoned ones; the chips filter by Projet.
- [ ] « Sessions en cours » shows the running Étape and « Ouvrir » opens its Session panel.
- [ ] Route baseline (ADR 0008) for `POST /api/ideas/:id/design` and `GET /api/designs`: nominal, 400, 401, 404 for another Pilote's Idée, 409 stale `seq`, 422 for each rule; the Design, its PhaseRun and their events in one transaction.
- [ ] Playwright at 390 and 1280 px on `conceptions` and `conceptions-vide`, axe without violations.

## Verification

- `pnpm exec nx test server -- src/designs/`
- `pnpm exec nx test-integration server -- designs`
- `pnpm exec nx test skin-passerelle -- src/page-conceptions.spec.ts`
- `pnpm exec nx e2e web -- conceptions.spec.ts`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`
- `scripts/captures.sh conceptions conceptions-vide`.

## For prod

A Prisma migration (`designs`). Nothing else.

## Out of scope

- A Conception's own page: CONCEPTION-2.
- The Étapes' kind handlers: CONCEPTION-3 (PRD), CONCEPTION-5 (Maquettes), CONCEPTION-7 (Conception technique), CONCEPTION-8 (Revue croisée), CONCEPTION-9 (Découpage); the approval gates: CONCEPTION-4, CONCEPTION-6, CONCEPTION-10. Until they are merged, an Étape of an unregistered kind stays as the engine leaves it (PROCESS-4).
- The engine, lineage and Retours: PROCESS-4, PROCESS-5, PROCESS-6.

## Dependencies

- IDEE-3.
- RUNNER-12.
- PROCESS-5.
