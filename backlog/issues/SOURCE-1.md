---
id: SOURCE-1
title: "The Sources of a Projet: artifact_sources for the Tickets and the code, their defaults at creation, in the Process's view and its Manques"
epic: SOURCE
type: feature
priority: P0
size: S
milestone: M3 Sessions and preparing Projets
blocked_by: [PROCESS-3]
adr: [0012]
risques: []
stories: [US-88]
screens: []
revue_visuelle: false
video: false
---

## Context

US-88: the Pilote chooses on the canvas the Source of each Type d'artefact of a Projet, Local or GitHub at the MVP. ADR 0012, « Which Source for what »: a Projet holds two choices, `ticket` (the Tickets) and `code` (the Changement de code and the documents, PRD, Maquettes, Conception technique, Inventaire, which are files of the code's repository; the Verdict lives with them); the Idée's Source is « Crewdeck », the Livraison has none. This ticket stores the two choices, sets them when a Projet is created (a Dépôt GitHub: both on GitHub; a folder, PROJET-6: both Local), puts them in the Process's view and gives them to `findGaps`. The Sources panel reads them (PROCESS-7); changing one is a migration (SOURCE-7); a Local Projet's work reads them (PROJET-6, SOURCE-2, SOURCE-3); PROJET-3's preparation reads them.

## Current state of the code

- Created by PROJET-2: `Project` (`repositoryId` required, unique) and `Projects.write` creating each Projet in one `Transactions.run`; by PROCESS-3: `@@unique([pilotId, id])` on `Project`, `apps/server/src/process/` (`ProcessService.createInitialVersion(tx, projectId, …)` called by `Projects.write`, `toProjectProcess`, `zProjectProcess`, `process.upserted`, the slice `processes`).
- Created by PROCESS-2: `packages/contracts/src/process/sources.ts` (`SOURCE_GROUPS`, `SOURCE_KINDS`, `ProcessSources`, `TYPE_SOURCE`), `findGaps(definition, sources)`.
- No `artifact_sources` table, no `apps/server/src/process/sources/`.

## To do

- **Prisma** (migration `<date>_artifact_sources`): `ArtifactSource` (`artifact_sources`): `id`, `pilotId`, `projectId` (foreign key `[pilotId, projectId]` → `projects`, cascade), `group` enum `SourceGroup` (`ticket`, `code`), `source` enum `SourceKind` (`local`, `github`), `since` timestamptz; `@@unique([projectId, group])`, `@@index([pilotId, projectId])`. The migration inserts `github` for both groups of every existing Projet (each has a repository), `since` its `followedAt`.
- **Contracts**: `packages/contracts/src/api/process.ts`: `zProjectSource { source: zSourceKind, since }`; `zProjectProcess` gains `sources: { ticket: zProjectSource, code: zProjectSource }`; `processSourcesOf(view): ProcessSources` (the kinds alone, for `findGaps`).
- **Server** `apps/server/src/process/sources/`:
  - `sources.service.ts`, `SourcesService`:
    - `createDefaults(tx, projectId, kind: 'github' | 'local')`: both groups at `kind`, `since` now; called by `Projects.write` (PROJET-2's) with `github` before `ProcessService.createInitialVersion`, and by PROJET-6's Local creation with `local`;
    - `sourcesOf(tx, projectId): ProcessSources`, and the two rows for the view.
  - `toProjectProcess` reads the Sources: `GET /api/projects/:id/process`, `process.upserted` and the slice `processes` carry them.
  - `sources.module.ts`, exported for PROCESS-10 (activation's `findGaps`), PROJET-6, SOURCE-7.
- **Tests**:
  - `apps/server/test/integration/process.spec.ts` (extended): following a Dépôt GitHub gives both groups `github` and the view shows them in the first `process.upserted`; `createDefaults(…, 'local')` gives both `local`; a second `createDefaults` for the same Projet fails on the unique index; the migration's backfill gives an existing Projet its two rows.
  - `packages/contracts/src/api/process.spec.ts`: `processSourcesOf` and `findGaps` on « Process Crewdeck » with the view of a GitHub Projet (no Manque) and of a Local one (`capability.missing` on `st-checks`).

## Decisions already made

- Two groups, not one row per Type d'artefact: the documents follow the code (ADR 0012, « Options that lost »); the panel shows each type with its group's Source, the Idée « Crewdeck », the Livraison with none (PROCESS-7, from `TYPE_SOURCE`).
- A Projet always has both rows from its creation: `null` in `ProcessSources` exists only for `findGaps`'s `source.missing`, which a Projet never shows.
- No route changes a Source here: moving a group is the Action sensible `source.migrate` (SOURCE-7), which then updates `source` and `since` in its switch.
- The Sources sit in the Process's view rather than in the Projet's: the canvas, its Manques and the phone read them with the Process; their change writes `process.upserted`.
- `createDefaults` runs before `createInitialVersion` in the same transaction, so that the Projet's first `process.upserted` already holds its Sources.

## Acceptance criteria

- [ ] A Projet created from a Dépôt GitHub has `ticket` and `code` on GitHub, `since` its creation, in `GET /api/projects/:id/process` and in its first `process.upserted`.
- [ ] `createDefaults(tx, projectId, 'local')` gives both groups Local; the view shows them.
- [ ] A Projet followed before this ticket has both groups on GitHub after the migration.
- [ ] A Projet cannot hold two rows of one group.
- [ ] `findGaps(definition, processSourcesOf(view))` gives no Manque for « Process Crewdeck » on a GitHub Projet, and `capability.missing` on « Checks » on a Local one.

## Verification

- `pnpm exec nx test contracts -- src/api/process.spec.ts`
- `pnpm exec nx test server -- src/process/sources/`
- `pnpm exec nx test-integration server -- process`
- `pnpm exec nx run contracts:generate` then `git diff --exit-code`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the migration and its backfill run with the deploy).

## Out of scope

- The Sources panel: PROCESS-7. Moving a group (`source.migrate`, `source_migrations`): SOURCE-7 to SOURCE-9.
- A Local Projet's creation and folder: PROJET-6. The Runner's Local Source: SOURCE-2, SOURCE-3. The Source winning: SOURCE-6.

## Dependencies

- PROCESS-3.
