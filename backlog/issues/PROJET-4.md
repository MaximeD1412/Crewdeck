---
id: PROJET-4
title: "Inventaire of an existing code base: drafted by the Rôle Conception on crewdeck/inventaire, for a GitHub repository or a Local folder, checked against its Contrat"
epic: PROJET
type: feature
priority: P1
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PROJET-2, RUNNER-12, RUNNER-10, ATOI-1, SOURCE-2, PROCESS-5]
adr: [0002, 0003, 0005, 0004, 0011, 0012]
risques: []
stories: [US-68]
screens: []
revue_visuelle: false
video: false
reprend: 108
---

## Context

US-68: a folder or a repository that already has code is brought in, the product drafting its glossary, its technical choices and an inventory, which a Décision in « À toi » asks the Pilote to approve at once or to send back with their changes, what they approve being written to the Source of its documents (its folder, or its repository visibly on GitHub). The glossary: the **Inventaire** is what the product drafts when a folder or a Dépôt GitHub that already has code becomes a Projet, approved or sent back before the Process starts. The Rôle that drafts it is **Conception** (the founder's choice). Approving or sending it back is PROJET-5.

The refonte (PRD #169, ADRs 0011 and 0012) changes how it runs. The Inventaire is an agent kind of the catalogue (`inventory`, PROCESS-1) that « Process Crewdeck » does not hold: the Projet's preparation runs it, before its Process starts. So it runs on the engine like any agent Étape (its StepRun, its Session through RUNNER-12's `defineAgentKind`, its Contrat verdict, ATOI-2's Décisions and « Relancer l'Étape »), in a PhaseRun of a definition shipped with the release, « Préparation », as PROCESS-5 runs an Idée without a Projet on the release's « Process Crewdeck ». And the code may be on GitHub or in a Local folder: the Session works in the Runner's clone of either (RUNNER-9, SOURCE-2) and pushes `crewdeck/inventaire` to its origin, the repository or the folder; the server reads no file of it in both cases (ADRs 0002, 0003).

## Current state of the code

- `packages/contracts/src/contrats/` (RUNNER-11, merged): `defineContrat`, the rule kinds, `zVerdict` (`headSha?`); `apps/runner/internal/contrat/` (`Check`, `checks/registry.go`).
- `packages/contracts/src/api/decisions.ts`: the kind `inventory-review` is in `DECISION_KINDS`; `apps/server/src/decisions/decisions.service.ts` (`raise`, `resolve`); `apps/web/src/views/decisions/registry.ts` (`registerDecisionView`).
- `CONTEXT.md` and `docs/adr/` of this repository: the glossary and ADR formats the Skill writes.
- Created by PROJET-2: `Project` (`hasCode`, `inventoryState` `not-needed|pending|drafting|to-approve|awaiting-merge|approved`, `releaseBranch`), `Projects.follow`. By PROJET-6: a Local Projet with `hasCode` gets `inventoryState: 'pending'`; `folderState` (`pending|present|missing`), its `projects.folders` handler; `projectName: null` on a Local Projet's Décisions (the page names it).
- Created by PROCESS-1: `CATALOGUE.inventory` (agent, Rôle `design`, Skill `inventory`, no Entrée, the Sortie `inventaire` of type `inventory`), `BUILTIN_TEMPLATES`. By PROCESS-4: `Engine` (`admit`, `signal`, `retry`), `step_runs` (`contratVerdict`, `failure`, `sessionId`), `kinds/handler.ts`. By PROCESS-5: `phase_runs.builtinTemplate` (`'process-crewdeck'` for an Idée without a Projet), `projectId` and `processVersionId` nullable with their checks.
- Created by RUNNER-12: `defineAgentKind({ kind, title, branch, outputs })` (base: the integration branch), `registerStepReport(kind, schema, handler)`, `StepRunHooks.onFinished(tx, stepRun, { status, verdict?, failure? })`, `crewdeck-runner etape start|report|ask`, `apps/runner/skills/` embedded. By RUNNER-10: the Session's token for a GitHub push. By SOURCE-2: the Local origin of `session.start` (the clone `~/.crewdeck/repos/local/<projectId>` whose `origin` is the folder).
- The source of the Skill: the dotfiles repository (`MaximeD1412/dotfiles`), `agents/skills/technical-design/` (its « Inventory before asking » step and its glossary rules).

## To do

- **The « Préparation » definition** `packages/contracts/src/process/templates/preparation.ts`: `PREPARATION`, a `ProcessDefinition` with one Phase `ph-preparation` « Préparation » (`forEach: null`) holding one Étape `st-inventory` (`defaultStep('inventory', …)`: Rôle `design`, Skill `inventory`), no arrow; added to `BUILTIN_TEMPLATES` as `preparation`, never listed as a Modèle de process (`BUILTIN_TEMPLATES`' Modèles are filtered on `process-crewdeck` where they are offered).
- **Engine** (PROCESS-5's columns): `zPhaseRun.builtinTemplate` gains `'preparation'`; the checks become `(process_version_id IS NULL) = (builtin_template IS NOT NULL)` and `project_id IS NULL` only with `builtin_template = 'process-crewdeck'` (migration); `Engine.admit(tx, { projectId, phaseId, item, builtinTemplate? })`: `builtinTemplate: 'preparation'` reads that definition, its item `{ type: 'project', id: projectId }`; any other builtin with a Projet is an `EngineInputError`.
- **Skill** `apps/runner/skills/inventory/SKILL.md` (and `REFERENCE.md` for the formats), ported from technical-design's inventory step: read the code, its docs, its CI and its tests (never run them); write
  - `CONTEXT.md`: the domain glossary in this repository's format (`## Language`, `**Term** (`CodeIdentifier`):` then the definition and `_Avoid_:`), completed when it exists, never with a term removed;
  - `docs/adr/NNNN-<slug>.md`: one ADR per « choix technique » already made by the code (framework, database, hosting, branch conventions, tests…), numbered after the last existing one, each with `> **Status:** accepted, recorded from the code, <YYYY-MM-DD>.` and the sections `## Context`, `## Decision`, `## Consequences`; existing ADRs are kept as they are;
  - `docs/inventory.md`: `# Inventory`, a first list linking each ADR this pass added (`- [NNNN <title>](adr/NNNN-<slug>.md)`, the page reads the ADRs from it, PROJET-5, so that it never lists a directory), then `## Apps`, `## Routes and screens`, `## Tests and CI`;
  - commit `docs(crewdeck) : inventaire` on `crewdeck/inventaire`, `git push origin crewdeck/inventaire` (the repository or the folder, whichever the clone's origin is), then `crewdeck-runner etape report` with the figures `{ glossaryTerms, technicalChoices, apps, screens }` (counts only);
  - when `crewdeck/inventaire` already holds an inventory (a send-back, PROJET-5), start from it, wait for the Pilote's first message (the changes asked), apply it, commit `docs(crewdeck) : inventaire revu`, push and report again;
  - ask the Pilote only what the code cannot say, through `crewdeck-runner etape ask`; read the state of the work, when it needs any, through `mirror` only (RUNNER-12's rule).
- **Contrat** `packages/contracts/src/contrats/inventory.ts` (id `inventory`, version 1), every rule `bloquant`:
  - `inventory.glossary.file` (`file` `CONTEXT.md`) « Le glossaire CONTEXT.md existe »;
  - `inventory.glossary.terms` (`pattern` on `CONTEXT.md`, regex `^\*\*([^*]+)\*\* \(`, `unique`, `min: 1`) « Chaque terme du glossaire n'apparaît qu'une fois »;
  - `inventory.choices.file` (`file`, glob `docs/adr/[0-9][0-9][0-9][0-9]-*.md`, `min: 1`) « Au moins un choix technique est écrit »;
  - `inventory.choices.status` (`check` `each-file-has-line`, params `{ glob: 'docs/adr/[0-9][0-9][0-9][0-9]-*.md', regex: '^> \\*\\*Status:\\*\\* ' }`) « Chaque choix technique a sa ligne de statut »;
  - `inventory.list.sections` (`sections` on `docs/inventory.md`, level 2, `Apps`, `Routes and screens`, `Tests and CI`) « L'inventaire liste les apps, les écrans, les tests et la CI »;
  - `inventory.branch.pushed` (`check` `branch-pushed`, params `{ branch: 'crewdeck/inventaire' }`) « L'inventaire est poussé sur la branche crewdeck/inventaire ».
- **Go checks** `apps/runner/internal/contrat/checks/each_file_has_line.go` and `branch_pushed.go` (the worktree's `HEAD` equals `origin/<branch>` after a `git fetch origin`, the same for a GitHub clone and a Local one), with their tests; when the Étape has no change of code, `contrat.Check` sets the verdict's `headSha` to the worktree's `HEAD` (added there if RUNNER-11 sets it only from a PR). Fixtures: one passing and one failing folder per rule in `packages/contracts/fixtures/contrats/inventory/`.
- **Server** `apps/server/src/projects/inventory/`:
  - `inventory.kind.ts`: `defineAgentKind({ kind: 'inventory', title: () => 'Inventaire', branch: () => 'crewdeck/inventaire', base: (ctx) => ctx.project.releaseBranch, outputs: (ctx) => [{ portId: 'inventaire', type: 'inventory', id: ctx.project.id, sha: ctx.contratVerdict.headSha }] })`; `defineAgentKind` gains the optional `base(ctx)` (the integration branch by default).
  - `InventoryService.startFor(tx, project)`: `Engine.admit(tx, { projectId, phaseId: 'ph-preparation', item: { type: 'project', id }, builtinTemplate: 'preparation' })`, `inventoryState: 'drafting'`, `project.upserted`; called by `Projects.follow` for a GitHub Projet with `hasCode`, by PROJET-6's `projects.folders` handler when a Local Projet with `inventoryState: 'pending'` becomes `present`, and at boot for every Projet still `pending` (a Local one only when `present`).
  - `registerStepReport('inventory', zInventoryReport, …)`: `zInventoryReport = { glossaryTerms, technicalChoices, apps, screens }` (non-negative integers) stored in `projects.inventory_figures` (jsonb).
  - `StepRunHooks.onFinished` for `inventory`: `passed` → `inventoryState: 'to-approve'`, `inventoryHeadSha` = the verdict's `headSha`, `DecisionsService.raise` kind `inventory-review` (`subjectType: 'project'`, `subjectId` the Projet's id, tone accent, `label` the `displayName` or « Inventaire » for a Local Projet, `projectName` as PROJET-6 sets it, `metaParts` « Projet existant », `link` `/projets/:id`), `project.upserted`; `incomplete` or `failed` → stays `drafting` (ATOI-2 raises its Décision; its rerun lands here again).
  - Prisma: `projects.inventory_head_sha`, `projects.inventory_figures` (one migration with the engine's checks).
- **Page**: `apps/web/src/views/decisions/inventory-review.ts`: context « Glossaire, choix techniques et inventaire rédigés depuis le code : à approuver avant le Process. », action « Relire » → `/projets/:id`.

## Decisions already made

- The « choix techniques » are ADRs in `docs/adr/`, and the list of what exists is `docs/inventory.md`: the same files a Conception's technical design (CONCEPTION-7) reads and extends. They are files of the code's Source (ADR 0012: documents have the code's Source), on GitHub or in the folder.
- The Inventaire runs in the release's « Préparation » definition, not in the Projet's Process: its Process starts once the Inventaire is approved, and the Pilote's canvas never shows it (PROCESS-1: « Inventaire » is in the catalogue, not in « Process Crewdeck »). Each pass (first drafting, send-back) is its own PhaseRun; a rerun after a failure is ATOI-2's `Engine.retry`.
- The Session branches from the release branch (the code is there); the integration branch may not exist yet (PROJET-3 creates it), approving needs it (PROJET-5). On a Local Projet the push lands in the folder as a branch the Pilote sees; nothing is committed on their checked-out branch (ADR 0012).
- The Session runs in `auto` (ADR 0004): its permission requests and questions go to the Pilote (SESSION-3).
- The server stores only the counts and the head SHA; it reads no file of the Inventaire (ADRs 0002, 0003).

## Acceptance criteria

- [ ] Following a repository with code admits one « Préparation » PhaseRun (`builtinTemplate: 'preparation'`, no Version) whose `st-inventory` StepRun starts a Session on `crewdeck/inventaire` based on the release branch, in the Rôle Conception's Moteur and model; `inventoryState: 'drafting'`.
- [ ] A Local Projet with code gets the same PhaseRun when its folder becomes `present`, its Session on the Local origin; a Local Projet whose folder is `pending` gets none yet.
- [ ] A fixture worktree with the three files and the branch pushed passes the Contrat, for a clone of a bare repository and for a clone whose origin is a plain folder; each failing fixture fails with its rule's id.
- [ ] The fake Runner's report and `passed` verdict make the Projet `to-approve` with its head SHA and figures, and raise « Inventaire à approuver » in « À toi ».
- [ ] An `incomplete` verdict keeps the Projet `drafting` and raises no `inventory-review`.
- [ ] A Projet still `pending` at boot gets its PhaseRun; `PREPARATION` is not offered as a Modèle de process.
- [ ] No server table holds any text of the Inventaire (test on the stored rows).

## Verification

- `pnpm exec nx test contracts -- src/contrats/inventory.spec.ts src/process/`
- `cd apps/runner && go test ./internal/contrat/... -run 'TestInventory|TestEachFileHasLine|TestBranchPushed'`
- `pnpm exec nx test server -- src/projects/inventory/`
- `pnpm exec nx test-integration server -- inventory`
- `pnpm exec nx test-integration server -- process-engine`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (`projects.inventory_head_sha`, `projects.inventory_figures`, the `phase_runs` checks), run by the deploy. The Skill ships inside the Runner's release.

## Out of scope

- Reading, approving, sending back: PROJET-5. The readiness row « Inventaire approuvé »: PROJET-3.
- The Décisions of a failed or incomplete StepRun and « Relancer l'Étape »: ATOI-2. The Local origin and its clone: SOURCE-2.

## Dependencies

- PROJET-2
- RUNNER-12
- RUNNER-10
- ATOI-1
- SOURCE-2
- PROCESS-5
