---
id: SOURCE-7
title: "Moving a Type d'artefact to another Source: the Action sensible source.migrate, source_migrations, draining, the switch in one transaction, the Sources panel"
epic: SOURCE
type: feature
priority: P1
size: M
milestone: M7 Statistics and switchover
blocked_by: [SOURCE-1, PROCESS-7, PROCESS-5]
adr: [0012, 0007]
risques: [OPS-8]
stories: [US-102, US-26]
screens: [process-migration-source, process-migration-en-cours]
revue_visuelle: true
video: false
---

## Context

US-102: the Pilote moves a Type d'artefact to another **Source** as an **Action sensible** (US-26): no new work of that type starts meanwhile, the work in progress finishes on the old Source, then everything moves at once and the old place is archived, frozen; its end is noted and shown in the Sources, its failure raises a Décision, nothing is switched until everything is moved, so that a type never has two Sources, not even for a moment (risk OPS-8). ADR 0012 (« Moving a Source ») sets the states `draining | copying | verifying | switched | done | failed` and the switch as one server transaction, the point of no return. This ticket is the server's state machine, the protocol with the Runner, the engine's draining and the page; the Runner's copy is SOURCE-8 (`ticket`) and SOURCE-9 (`code`, and picking a new place). A change of a group that holds nothing goes through the same migration, which then finishes at once.

## Current state of the code

- `packages/contracts/src/api/sensitive-actions.ts`: `SENSITIVE_ACTION_IDS` without `source.migrate`; `apps/server/src/sensitive-actions/` (`@SensitiveAction(id)`, `withSeq`, `SensitiveActionsService.assertFresh(lastSeq, seq)`, 409 `sensitive-action.stale`); `apps/web/src/dialogs/confirm.ts` (`confirmSensitiveAction({ action, title, confirmLabel, icon, tone, consequences: { lead, items: [{ strong, text }], note } })`).
- `packages/contracts/src/api/decisions.ts` (`DECISION_KINDS`), `apps/server/src/decisions/decisions.service.ts` (`raise`, `resolve`).
- `packages/contracts/src/events/index.ts` (`RESOURCES`, `registerEventPayload`); `apps/server/src/realtime/` (`Transactions.run`, `EventsWriter.write`, `STATE_CONTRIBUTORS`).
- `packages/contracts/src/runner/hello.ts` (`zHello`: protocol and Runner versions, machine), `protocol.ts` (the unions); `apps/server/src/runners/runner-commands.service.ts`, `runner-dispatcher.ts`.
- Composants `Select`, `StatusBadge`, `Banner`, `ListRow` in `packages/skin-passerelle/src/`.
- Created by PROJET-2: `Project` (`repositoryId`, `hasCode`, `lastSeq`). Created by PROJET-6: a Local Projet's folder kept on the Runner (`projects` of its state), the server knowing only that it exists.
- Created by PROCESS-2: `packages/contracts/src/process/sources.ts` (`SOURCE_GROUPS`, `SOURCE_KINDS`, `TYPE_SOURCE`: each Type d'artefact's group, `crewdeck` or `none`). Created by SOURCE-1: `artifact_sources` (`projectId`, `group` `ticket | code`, `source` `local | github`, `since`), `apps/server/src/process/sources/`, the Sources in the process view.
- Created by PROCESS-4 and PROCESS-5: `phase_runs` (`state`, `waitingOn` of `PHASE_RUN_WAITING_ON` `queue | project | decision`, `processVersionId`), `Engine.admit`, `advance`, the start of a non-repeated Phase's PhaseRuns in order. Created by PROCESS-7: the Sources tab of the Gestion du process, read only, and the phone's Sources card. Created by BOUCLE-1: `tickets`, `code_changes` per Projet.

## To do

- **Contracts** `packages/contracts/src/api/source-migrations.ts`: `SOURCE_MIGRATION_STATES` (`draining`, `copying`, `verifying`, `switched`, `done`, `failed`), `zSourceMigration { id, projectId, group, from, to, state, total, copied, waitingItems: [{ itemType, number? }], errorCode, attempt, createdAt, switchedAt, endedAt }`, registered as the event resource `source-migration`; `source.migrate` added to `SENSITIVE_ACTION_IDS`; `source-migration.failed` (« Migration de Source échouée ») and `source-migration.unfinished` (« Migration de Source inachevée ») to `DECISION_KINDS`.
- **Protocol** `packages/contracts/src/runner/migration.ts` (fixtures valid in TypeScript and Go): server → Runner `migration.copy { migrationId, projectId, group, from, to, repository?: { owner, name } }` (also resent after each `hello` while `copying` or `verifying`) and `migration.finish { migrationId, fingerprints }`; Runner → server `migration.progress { migrationId, total, copied, state: 'copying' | 'verifying' }`, `migration.switch { migrationId, fingerprints: [{ key, state, contentHash }], renumbering: [{ from, to }] }`, `migration.finished { migrationId }`, `migration.failed { migrationId, stage: 'copy' | 'finish', code }`. `zHello` gains `migrations?: ('ticket' | 'code')[]`, the groups the Runner can copy, kept with its connection.
- **Prisma** `SourceMigration` (`source_migrations`): `id`, `pilotId`, `projectId`, `group`, `from`, `to`, `state`, `total` (int, 0), `copied` (int, 0), `attempt` (int, 1), `fingerprints` (jsonb, content-free), `errorCode?`, `finishTries` (int, 0), `createdAt`, `switchedAt?`, `endedAt?`; a partial unique index: one migration per Projet in `draining | copying | verifying | switched`.
- **Server** `apps/server/src/process/sources/migrations/`:
  - `POST /api/projects/:id/sources/:group/migrate { to, seq }`, `@SensitiveAction('source.migrate')`, freshness on `Project.lastSeq`: 201 with the migration and its event; 400 with `fields`; 404 (another Pilote's Projet); 409 `sensitive-action.stale`; 422 `source.same` (already there), `source.migration-running` (one at a time per Projet), `source.target-missing` (to `github` without `repositoryId`, to `local` without a folder: SOURCE-9 lets the Pilote pick one), `source.runner-cannot-migrate` (the Runner online without the group in `hello.migrations`).
  - **Draining**: `drainingGroups(tx, projectId)`; a PhaseRun admitted or started while its Phase reads or writes a migrating group (a pure `groupsOfPhase(definition, phaseId)` in `packages/contracts/src/process/migration.ts`, from `TYPE_SOURCE` of its Étapes' Entrées and Sorties) is created `waiting` with `waitingOn: 'source-migration'` (added to `PHASE_RUN_WAITING_ON`), and `advance`d when the migration is `done` or `failed`. The other PhaseRuns `running` or `waiting` that touch the group are `waitingItems`; when none is left, `copying`.
  - **Holds nothing** (`ticket`: no `tickets` row of the Projet; `code`: `hasCode` false and no `code_changes` row): no copy, the switch and `done` in the same transaction as the end of draining.
  - Otherwise `migration.copy` to the Runner; `migration.progress` updates the counts; `migration.switch` runs **the switch**, one transaction: `artifact_sources` (`source`, `since`), `state: switched`, `switchedAt`, `fingerprints`, the group's switch hooks (`registerSwitchHook(group, fn(tx, migration, message))`, for SOURCE-8 and SOURCE-9), the events of the migration, the Projet and every row a hook touched; then `migration.finish`. `migration.finished`: `done`, `endedAt`, the `unfinished` Décision resolved.
  - **Failure before the switch** (`migration.failed` stage `copy`, or the Runner unable): `failed`, `errorCode`, `endedAt`, the Décision `source-migration.failed` (halt, label « <Type> de <Projet> », meta « <Projet> · Sources », params `{ migrationId, group, from, to, code }`), held items released: the old Source stays the Source and the work resumes on it. `POST /api/source-migrations/:id/retry { seq }` (« Réessayer »): `copying`, `attempt + 1`, `migration.copy` again (the copy reuses what it finds); 422 `source-migration.not-failed`, 409 stale, 404.
  - **Failure after the switch** (stage `finish`): stays `switched`; `migration.finish` resent after 1, 5, 15, then every 60 minutes; at the third failure, the Décision `source-migration.unfinished` (caution, its meta naming the old place: « tickets/ pas encore archivé », « issues pas encore archivées »), never a way back.
  - `StateContributor` key `sourceMigrations` (those not `done`, and the last `done` of each group); `GET /api/projects/:id/source-migrations?state=` (50 per page).
- **Web**, the Sources tab of the Gestion du process (PROCESS-7's), at 1280:
  - PROCESS-7's lead gains « Changer de Source migre tout ce qu'elle tient. » and the repository's `fullName` when there is one; its rows « Ticket » and « Changement de code » get a `Select` (Local, GitHub) in place of their value; the documents, the Verdict, the Idée and the Livraison keep PROCESS-7's read rows.
  - choosing another Source opens `confirmSensitiveAction` (`source.migrate`, icon of the target): title « Passer les <Tickets | changements de code> de <Projet> sur <GitHub | Local> ? », confirm « Migrer les <…> », lead « <De> → <Vers>, <dépôt ou dossier>. », items « Aucun nouveau <…> ne démarre pendant la migration ; les <n> en cours finissent sur <De>. », « Puis les <n> Tickets … deviennent <n> issues, d'un coup, avec leur état et leur historique. » (the group's sentence, SOURCE-8 and SOURCE-9 write theirs), « <L'ancienne place> est archivée, figée : plus rien ne s'y écrit. », note « Un Type d'artefact n'a jamais deux Sources, même un instant. »; for a group that holds nothing, the second item is « Rien à copier : la Source change tout de suite. ». Cancel puts the Select back.
  - while a migration runs: the Select replaced by a caution StatusBadge « <De> → <Vers> » with « migration en cours · <n> à finir sur <De> » (draining), « copie : <copied> sur <total> », « vérification », « bascule faite, on archive l'ancienne place » (switched); a caution Banner « Migration des <…> vers <Vers> » in the panel (« Aucun nouveau Ticket ne démarre. #12 et #14 finissent sur Local, puis les 30 Tickets passent sur GitHub d'un coup. »), and on the phone above the list, the Sources card's row with the same badge and meta. The other Select is disabled meanwhile.
  - after `done`: the row's meta « depuis le <date> (migré de <De>) ».
  - « À toi »: views of both Décisions (link `/projets/:id/process?onglet=sources`), « Réessayer » (`needsRunner`) for `failed`, « Ouvrir » for both.
- t() keys under `process.sources.migration.*` and `decision.kind.source-migration.*`. Scenarios `apps/server/src/testing/scenarios/process-migration.ts` (`process-migration-source`, `process-migration-en-cours`: a GitHub Projet « Site mairie » whose Tickets are Local, two of them running); the fake Runner scripts `migration.*`. Playwright `apps/web/e2e/process-migration.spec.ts`.
- `docs/pilotage/risques.json`: OPS-8's draining and switch solutions ticked.

## Decisions already made

- Mockup: `process-migration-source`, `process-migration-en-cours` (pages `design/screens/gestion-du-process/process-migration-source.html`, `…/process-migration-en-cours.html`; captures `…-1280.png`, and `process-migration-en-cours-390.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The mockups draw a Select per Type d'artefact; ADR 0012 has two groups (`ticket`, `code` with the documents) and the Idée in Crewdeck: two Selects, the documents and the Verdict listed under the code's (the Verdict lives where the Changement de code lives).
- The phone shows the migration, never starts one (editing stays on the PC, PROCESS-11): `process-migration-source` is captured at 1280 only.
- A migration is not a version of the Process: activating a draft during a migration is allowed and changes nothing of it.
- Draining waits for every `running` and `waiting` item of the group, the ones waiting on the Pilote included: the panel names them, the Pilote answers or stops them. No timeout.
- One migration per Projet at once, whatever the group: both groups share the Projet's one repository and folder.
- A `failed` migration does not block a new one; starting one resolves the failed one's Décision (`outcome: replaced`).
- The fingerprints are content-free (`contentHash`, states, ref SHAs) and stay on the row after `done`: they are the proof of what was moved.
- Retry delays of `migration.finish` are fixed (1, 5, 15, then 60 minutes): the new Source already wins, finishing only freezes the old place.

## Acceptance criteria

- [ ] `migrate` answers 201 and writes the migration and its event in one transaction; 400, 401, 404 for another Pilote's Projet, 409 with an older `seq`, and 422 for each of `source.same`, `source.migration-running`, `source.target-missing`, `source.runner-cannot-migrate`.
- [ ] While the `ticket` group drains, the Boucle admits no Ticket and the running ones finish; the migration goes to `copying` when the last one ends; an Idée's Phase is not held.
- [ ] A group that holds nothing switches and is `done` at once, with no message to the Runner.
- [ ] The switch writes the Source, the state and the events in one transaction; a hook throwing rolls it back whole, then the migration is `failed` (`switch-failed`) on the old Source.
- [ ] `migration.failed` before the switch gives `failed`, the Décision with « Réessayer », and the held items start on the old Source; « Réessayer » sends `migration.copy` again with `attempt` 2.
- [ ] Three failures of finishing raise `source-migration.unfinished` and keep the new Source; `migration.finished` resolves it.
- [ ] A Runner reconnecting during `copying` gets `migration.copy` again.
- [ ] Changing the Tickets' Select opens the product's dialog; « Annuler » changes nothing; « Migrer les Tickets » shows the migration in progress, live, without reloading.
- [ ] `process-migration-source` (1280) and `process-migration-en-cours` (390 and 1280) match their mockups (Playwright against the fake Runner and the fake GitHub, axe without violations); the captures come from those tests.

## Verification

- `pnpm exec nx test contracts -- src/process/migration.spec.ts src/runner/migration.spec.ts`
- `pnpm exec nx test server -- src/process/sources/migrations/`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- source-migrations`
- `pnpm exec nx e2e web -- process-migration.spec.ts`; `scripts/captures.sh process-migration-source process-migration-en-cours` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (table `source_migrations`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- Copying, verifying and freezing the Tickets, their new numbers: SOURCE-8. The code and the documents, picking a repository or a folder: SOURCE-9.
- Choosing a Source at Projet creation: SOURCE-1, PROJET-6. Keeping the old place as a Copie: the Bêta, no ticket yet.

## Dependencies

- SOURCE-1
- PROCESS-7
- PROCESS-5
