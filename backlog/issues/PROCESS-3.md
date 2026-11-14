---
id: PROCESS-3
title: "Versions and Brouillon of a Projet's Process: process_versions, process_drafts, the view and the draft saved on every change"
epic: PROCESS
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PROCESS-2, PROJET-2]
adr: [0011, 0007, 0008, 0003]
risques: []
stories: [US-96, US-97]
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0011, « A version is one immutable document » and « Drafts, activation, Modèles »: each Projet has numbered Versions of its Process, immutable once written, and at most one Brouillon, saved whole on every change of the canvas, refused when another tab saved first. Creating a Projet copies the Modèle it chose into version 1 (US-97: « Process Crewdeck » by default); the Projets followed before this ticket get theirs too. Activating the draft as the next Version (US-96) is PROCESS-10; this ticket gives it the tables, the draft and the view it reads. The engine (PROCESS-4) pins a Version; SOURCE-1 adds the Sources to the view; the canvas (PROCESS-7) and the phone (PROCESS-11) read the view from the store.

## Current state of the code

- Created by PROJET-2 (PR #157, open): Prisma `Repository` and `Project` (`apps/server/prisma/schema.prisma`, migration `20261119000000_projects`), `apps/server/src/projects/projects.ts` (`Projects.follow` then `write`: one `Transactions.run` creating each `Project` with its `project.upserted`, `ProjectsController` `POST|GET /api/projects`, `GET /api/projects/:id`, 404 `project.not-found`), `project.view.ts`, `process-json.ts`; `packages/contracts/src/api/projects.ts`, `events/project.ts`; the web's `apps/web/src/api/projects.ts`; the scenario `projets`.
- Created by PROCESS-1 and PROCESS-2: `packages/contracts/src/process/` (`zProcessDefinition`, `zSealedItem`, `PROCESS_CREWDECK`, `PROCESS_CREWDECK_NAME`, `BUILTIN_TEMPLATES`, `validateDefinition`), the fixtures `packages/contracts/fixtures/process/*.json`.
- `packages/contracts/src/events/index.ts`: `RESOURCES` (no `process`), `registerEventPayload`; `api/state.ts`: `STATE_SLICES` (`pilot`, `runner`, `runner-link`, `ai-account`, `devices`, `decisions`, and PROJET-2's `projects`).
- `apps/server/src/realtime/`: `Transactions.run`, `EventsWriter.write(tx, pilotId, type, payload)`, `STATE_CONTRIBUTORS` (`Registry<StateContributor>`); `scope/scope.context.ts`: `runInPilotScope`, `currentPilotId`; `scope/scope.models.ts`: a scoped model's foreign key to another scoped model must carry `pilotId` (no such composite key exists yet: `Project` has no `@@unique([pilotId, id])`).
- `apps/server/src/errors/messages.ts`, `app-error.ts` (`notFound`, `conflict`, `unprocessable(code, message, fields?)`).
- `apps/server/src/app.ts`: Nest's default JSON body limit (100 kB).
- `apps/web/src/store/store.ts`: `registerSlice(resource, { shape, snapshotKey })`.

## To do

- **Contracts** `packages/contracts/src/api/process.ts`:
  - `zProcessVersion { number, definition: zProcessDefinition, sealed: zSealedItem | null, activatedAt, activatedBy: 'creation' | 'pilot', templateName: string | null }`;
  - `zProcessDraft { definition, sealed, revision: int ≥ 1, baseVersion: int ≥ 1, updatedAt }`;
  - `zProjectProcess { id (the Projet's id), active: zProcessVersion, draft: zProcessDraft | null }`, the resource of `GET /api/projects/:id/process`, of `process.upserted` (`events/process.ts`, `registerEventPayload('process', …)`, `'process'` added to `RESOURCES`) and of the new slice `processes: z.array(zProjectProcess)` of `STATE_SLICES`;
  - `zProcessDraftInput { definition, sealed: zSealedItem | null, revision: int ≥ 0, baseVersion: int ≥ 1 }`, refined: `sealed` is required when `definition.commands` is not empty, absent otherwise.
- **Prisma** (migration `<date>_process`):
  - `Project`: `@@unique([pilotId, id])`, the target of the composite foreign keys below.
  - `ProcessVersion` (`process_versions`): `id`, `pilotId`, `projectId` (foreign key `[pilotId, projectId]` → `projects`, cascade), `number` int, `definition` jsonb, `sealed` jsonb null, `activatedAt` timestamptz, `activatedBy` enum `ProcessActivation` (`creation`, `pilot`), `templateName` text null; `@@unique([projectId, number])`, `@@index([pilotId, projectId])`. The migration adds a trigger refusing any `UPDATE` of a row.
  - `ProcessDraft` (`process_drafts`): `id`, `pilotId`, `projectId` unique (same composite key), `definition`, `sealed` null, `revision` int, `baseVersion` int, `updatedAt`.
- **Server** `apps/server/src/process/` (`process.module.ts`, imported by `ProjectsModule`):
  - `process.view.ts`: `toProjectProcess(version, draft)`.
  - `ProcessService.createInitialVersion(tx, projectId, from: { template: 'process-crewdeck' }, sources)`: when `findGaps(definition, sources)` is empty, version 1 with `BUILTIN_TEMPLATES[from.template]`, `sealed: null`, `activatedBy: 'creation'`, `templateName: PROCESS_CREWDECK_NAME`; otherwise no version at all and a draft of that copy (`revision: 1`, `baseVersion: 0`, « no active version »), activated as version 1 like any draft (PROCESS-10); then `process.upserted`. `sources` is `{ ticket: 'github', code: 'github' }` until SOURCE-1 stores them; a Projet whose code is Local (PROJET-6) gets the draft, « Checks » having no Commande. PROJET-2's `Projects.write` calls it right after creating each `Project`, in its transaction.
  - `ProcessService.saveDraft(projectId, input)`, in one `Transactions.run`: the Projet's row locked (`SELECT … FOR UPDATE`), then 409 `process.draft-stale` when `baseVersion` is not the active version's number, or `revision` is not the draft's (`0` when there is none); 422 `process.invalid` when `validateDefinition` returns refusals, `fields` mapping each refusal's `target` to its `label`; else the draft written with `revision + 1` and `updatedAt`, and `process.upserted`.
  - `ProcessController`: `GET /api/projects/:id/process` (404 `project.not-found` for an unknown id or another Pilote's), `PUT /api/projects/:id/process/draft` (`zProcessDraftInput` → `zProjectProcess`).
  - `ProcessState`, the contributor of `processes`: every Projet's view.
  - A `RoleUsage` provider (PARAM-2's, for 409 `roles.in-use`): the number of Étapes naming a Rôle in the Pilote's active versions and drafts (`tools` of kind `role`); registered here, or PARAM-2's interface added if it is not merged.
  - `process-backfill.ts`, `ProcessBackfill.onApplicationBootstrap`: each Projet without a version (one unscoped query of `(pilotId, projectId)`), in its Pilote's scope (`runInPilotScope`) and one `Transactions.run` each, `createInitialVersion`; idempotent (the unique `(projectId, number)` makes a second run a no-op).
  - `messages.ts`: `'process.draft-stale': 'Le brouillon a changé dans un autre onglet : recharge-le avant de continuer.'`, `'process.invalid': 'Ce Process ne peut pas être dessiné ainsi.'`.
  - `app.ts`: the JSON body limit raised to 512 kB (a definition at its bounds and its sealed part).
- **Web**: the slice `process` (collection, snapshot key `processes`) registered in `apps/web/src/store/`; `apps/web/src/api/process.ts` (`getProcess(projectId)`, `saveDraft(projectId, input)`), typed by the contracts.
- **Tests**:
  - `apps/server/src/process/process.service.spec.ts`: the draft rules (revision, baseVersion, refusals) on fakes.
  - `apps/server/test/integration/process.spec.ts`: the route baseline (ADR 0008): `GET` nominal matches `zProjectProcess`; 401 without a session; 404 for another Pilote's Projet; `PUT` 400 with `fields` (a bad id, `sealed` missing beside a Commande), 409 on a stale `revision` and on a stale `baseVersion`, 422 `process.invalid` for each refusal fixture of `packages/contracts/fixtures/process/` with its target in `fields`; a draft with a Manque is saved; the draft and its `process.upserted` written in one transaction, the payload valid; `POST /api/projects` writes version 1 equal to `PROCESS_CREWDECK` and its event; an `UPDATE` of a `process_versions` row fails; the backfill gives a pre-existing Projet its version 1, once.
  - `apps/web/src/store/` and `apps/web/src/api/process.spec.ts`: the slice follows the snapshot and `process.upserted`.

## Decisions already made

- The view is the whole Process of the Projet (active version and draft) and sits in `GET /api/state`: the page reads it from the store (ADR 0008, « Front data »), a Pilote has a handful of Projets, and an event carries the whole view anyway. Its `id` is the Projet's, so that the store keys it as every collection.
- The draft's first save sends `revision: 0`: the page based it on the active version, whose number it sends as `baseVersion`. A save while another tab saved first, or after an activation, is 409 and the page reloads the view (PROCESS-7).
- The Projet's row is locked for the save, so that two saves at once are ordered and the second one is 409.
- Version 1 has `sealed: null`: « Process Crewdeck » has no Commande. Copying a Pilote's Modèle, whose Commandes the browser re-seals for the Projet, is PROCESS-14's.
- An active version never has a Manque (feature PRD): a copy of the Modèle that has one (a Projet whose code is Local has « Checks » without a Commande, ADR 0012) becomes the Projet's draft, with no active version; nothing of its work starts until the Pilote fixes the Manques and activates it (PROCESS-10), and its readiness says so (PROJET-3). The Manques never forbid the creation of a Projet. `zProjectProcess.active` is nullable, `baseVersion: 0` naming « no version yet ».
- The sealed part is stored as received, never opened nor checked beyond its shape (ADR 0011, « What the server reads of a Process »); the definition, its names and its catalogue ids are configuration the server reads.
- The existing Projets get their version 1 at the server's start rather than in the SQL migration: the definition is TypeScript data of the release.
- `PUT …/process/draft` is the route ADR 0011 names, one level deeper than ADR 0008's rule.

## Acceptance criteria

- [ ] Following a Dépôt GitHub (`POST /api/projects`) gives the new Projet version 1, « Process Crewdeck », `activatedBy: 'creation'`, no draft; its `process.upserted` is in the same transaction and `GET /api/state` lists it under `processes`.
- [ ] A Projet followed before this ticket has its version 1 after the server starts, and only one after two starts.
- [ ] `createInitialVersion` with a definition and sources for which `findGaps` finds a Manque (a fixture with `code: 'local'`) writes no version and a draft (`baseVersion: 0`), and the view's `active` is null.
- [ ] `PUT …/process/draft` with `revision: 0` creates the draft (revision 1); again with `revision: 1` gives revision 2; again with `revision: 1` is 409 `process.draft-stale`; with a `baseVersion` other than the active one is 409.
- [ ] A draft with a refusal of a fixture is 422 `process.invalid`, `fields` naming its target; a draft with only Manques is saved.
- [ ] A definition with a Commande and no `sealed` is 400 with `fields`; a `sealed` is stored and returned as sent.
- [ ] `GET …/process` of another Pilote's Projet is 404; without a session 401.
- [ ] A `process_versions` row cannot be updated (the trigger's error).
- [ ] The page's store holds the view from the snapshot and replaces it on `process.upserted`.

## Verification

- `pnpm exec nx test contracts -- src/api/process.spec.ts`
- `pnpm exec nx test server -- src/process/`
- `pnpm exec nx test-integration server -- process`
- `pnpm exec nx test web -- src/store/ src/api/process.spec.ts`
- `pnpm exec nx run contracts:generate` then `git diff --exit-code`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the migration runs with the deploy; the existing Projets get their version 1 at the server's first start).

## Out of scope

- The Sources in the view and their defaults: SOURCE-1. The PhaseRuns and the work on each version: PROCESS-4.
- Activation, the diff and the Action sensible `process.activate`: PROCESS-10. The Pilote's Modèles and the choice of a Modèle at creation: PROCESS-14 and PROJET-6. A Local Projet's creation: PROJET-6.
- The canvas and the phone: PROCESS-7 to PROCESS-9, PROCESS-11. Removing `.process.json`: PROJET-7.

## Dependencies

- PROCESS-2.
- PROJET-2 (the `Project` table and its creation).
