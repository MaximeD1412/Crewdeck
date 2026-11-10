---
id: PROJET-4
title: "Inventaire of an existing repository: drafted by the Rôle Conception on crewdeck/inventaire, checked against its Contrat"
epic: PROJET
type: feature
priority: P1
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PROJET-2, RUNNER-12, RUNNER-10, ATOI-1]
adr: [0002, 0003, 0005, 0004]
risques: []
stories: [US-68]
screens: []
revue_visuelle: false
video: false
---

## Context

US-68: a repository that already has code is brought in, the product drafting its glossary, its technical choices and an inventory, which a Décision in « À toi » asks the Pilote to approve at once or to send back with their changes, so that an existing project gets the same Process as a new one. The glossary: the **Inventaire** is what the product drafts when a Dépôt GitHub that already has code becomes a Projet (its glossary, its « choix techniques », the list of what exists), approved or sent back before the Process starts. ADR 0002: it is drafted by the Runner's Session on the branch `crewdeck/inventaire`, read by the browser from GitHub; the server never sees the files. The Rôle that drafts it is **Conception** (the founder's choice). Approving or sending it back is PROJET-5.

## Current state of the code

- Only documents: `CONTEXT.md` (the glossary format this repository uses), `docs/adr/` (the ADR format, status line `> **Status:** accepted, <date>.`).
- Created by PROJET-2: `Project` (`hasCode`, `inventoryState` `pending` for a repository with code, `releaseBranch`, `integrationBranch`), `ProjectsService.follow`.
- Created by RUNNER-11: `defineContrat`, the rule kinds, `apps/runner/internal/contrat/` and `checks/registry.go`, `zVerdict` (`headSha?`).
- Created by RUNNER-12: `STEPS` (`inventory` → Rôle `design`, Skill `inventory`, subject `project`), `StepRun`, `StepsService.start(tx, { projectId, step, subjectId, title, branch, base })`, the hook `step-run.finished(stepRun)`, `registerStepReport(step, schema, handler)`, `crewdeck-runner etape start|report|ask`, `apps/runner/skills/` embedded.
- Created by RUNNER-10: the per-Session GitHub token (the agent pushes with it).
- Created by ATOI-1: `DecisionsService.raise`, the kind `inventory-review`, the kinds views registry.
- The source of the Skill: the dotfiles repository (`MaximeD1412/dotfiles`), `agents/skills/technical-design/` (its « Inventory before asking » step and its glossary rules).

## To do

- **Skill** `apps/runner/skills/inventory/SKILL.md` (and `REFERENCE.md` for the formats), ported from technical-design's inventory step: read the code, its docs, its CI and its tests (never run them); write
  - `CONTEXT.md`: the domain glossary in this repository's format (`## Language`, `**Term** (`CodeIdentifier`):` then the definition and `_Avoid_:`), completed when it exists, never with a term removed;
  - `docs/adr/NNNN-<slug>.md`: one ADR per « choix technique » already made by the code (framework, database, hosting, branch conventions, tests…), numbered after the last existing one, each with `> **Status:** accepted, recorded from the code, <YYYY-MM-DD>.` and the sections `## Context`, `## Decision`, `## Consequences`; existing ADRs are kept as they are;
  - `docs/inventory.md`: `# Inventory`, then `## Apps`, `## Routes and screens`, `## Tests and CI`;
  - commit `docs(crewdeck) : inventaire` on `crewdeck/inventaire`, push, then `crewdeck-runner etape report` with the figures `{ glossaryTerms, technicalChoices, apps, screens }` (counts only);
  - when `crewdeck/inventaire` already holds an inventory (a send-back, PROJET-5), start from it, wait for the Pilote's first message (the changes asked), apply it, commit `docs(crewdeck) : inventaire revu`, push and report again;
  - ask the Pilote only what the code cannot say, through `crewdeck-runner etape ask`.
- **Contrat** `packages/contracts/src/contrats/inventory.ts` (id `inventory`, version 1), every rule `bloquant`:
  - `inventory.glossary.file` (`file` `CONTEXT.md`) « Le glossaire CONTEXT.md existe »;
  - `inventory.glossary.terms` (`pattern` on `CONTEXT.md`, regex `^\*\*([^*]+)\*\* \(`, `unique`, `min: 1`) « Chaque terme du glossaire n'apparaît qu'une fois »;
  - `inventory.choices.file` (`file`, glob `docs/adr/[0-9][0-9][0-9][0-9]-*.md`, `min: 1`) « Au moins un choix technique est écrit »;
  - `inventory.choices.status` (`check` `each-file-has-line`, params `{ glob: 'docs/adr/[0-9][0-9][0-9][0-9]-*.md', regex: '^> \\*\\*Status:\\*\\* ' }`) « Chaque choix technique a sa ligne de statut »;
  - `inventory.list.sections` (`sections` on `docs/inventory.md`, level 2, `Apps`, `Routes and screens`, `Tests and CI`) « L'inventaire liste les apps, les écrans, les tests et la CI »;
  - `inventory.branch.pushed` (`check` `branch-pushed`, params `{ branch: 'crewdeck/inventaire' }`) « L'inventaire est poussé sur la branche crewdeck/inventaire ».
- **Go checks** `apps/runner/internal/contrat/checks/each_file_has_line.go` and `branch_pushed.go` (the worktree's `HEAD` equals `origin/<branch>` after a fetch), with their tests; when the Étape has no PR, `contrat.Check` sets the verdict's `headSha` to the worktree's `HEAD` (added there if RUNNER-11 sets it only from a PR). Fixtures: one passing and one failing folder per rule in `packages/contracts/fixtures/contrats/inventory/`.
- **Server** `apps/server/src/projects/inventory/`:
  - `InventoryService.startFor(tx, project)`: `StepsService.start(tx, { projectId, step: 'inventory', subjectId: project.id, title: « Inventaire · <displayName> », branch: 'crewdeck/inventaire', base: project.releaseBranch })`, `inventoryState: 'drafting'`; called by `ProjectsService.follow` for a Projet with `hasCode`, and at boot for every Projet still `pending`.
  - `registerStepReport('inventory', zInventoryReport, …)`: `zInventoryReport = { glossaryTerms, technicalChoices, apps, screens }` (non-negative integers) stored in `projects.inventory_figures` (JSON).
  - On `step-run.finished` for `inventory`: `passed` → `inventoryState: 'to-approve'`, `inventoryHeadSha` = the verdict's `headSha`, `DecisionsService.raise` kind `inventory-review` (`subjectType: 'project'`, `subjectId` the Projet's id, tone accent, `label` the `displayName`, `metaParts` « <displayName> », « Projet existant », `link` `/projets/:id`), `project.upserted`; `incomplete` or `failed` → stays `drafting` (ATOI-2 raises its Décision; its rerun calls `StepsService.start` again and lands here).
  - Prisma: `projects.inventory_head_sha`, `projects.inventory_figures`.
- **Page**: `apps/web/src/views/decisions/inventory-review.ts`: context « Glossaire, choix techniques et inventaire rédigés depuis le code : à approuver avant le Process. », action « Relire » → `/projets/:id`.

## Decisions already made

- The « choix techniques » are ADRs in `docs/adr/`, and the list of what exists is `docs/inventory.md`: the same files a Conception's technical design (CONCEPTION-7) reads and extends, and US-4's allowlisted checks look for (`CONTEXT.md`, `docs/adr/`).
- The Session branches from the release branch (the code is there); the integration branch may not exist yet (PROJET-3 creates it), approving needs it (PROJET-5).
- The Session runs in `auto` (ADR 0004): its permission requests and questions go to the Pilote (SESSION-3).
- The server stores only the counts and the head SHA; it reads no file of the Inventaire (ADR 0002).

## Acceptance criteria

- [ ] Following a repository with code starts one `inventory` StepRun on `crewdeck/inventaire` in the Rôle Conception's Moteur and model, `inventoryState: 'drafting'`.
- [ ] A fixture worktree with the three files and the branch pushed passes the Contrat; each failing fixture fails with its rule's id.
- [ ] The fake Runner's report and `passed` verdict make the Projet `to-approve` with its head SHA and figures, and raise « Inventaire à approuver · <Projet> » in « À toi ».
- [ ] An `incomplete` verdict keeps the Projet `drafting` and raises no `inventory-review`.
- [ ] A Projet followed while this ticket was not deployed (`pending`) gets its StepRun at the next boot.
- [ ] No server table holds any text of the Inventaire (test on the stored rows).

## Verification

- `pnpm exec nx test contracts -- src/contrats/inventory.spec.ts`
- `cd apps/runner && go test ./internal/contrat/... -run 'TestInventory|TestEachFileHasLine|TestBranchPushed'`
- `pnpm exec nx test server -- src/projects/inventory/inventory.service.spec.ts`
- `pnpm exec nx test-integration server -- inventory`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (`projects.inventory_head_sha`, `projects.inventory_figures`), run by the deploy. The Skill ships inside the Runner's release.

## Out of scope

- Reading, approving, sending back: PROJET-5. The readiness row « Inventaire approuvé »: PROJET-3.

## Dependencies

- PROJET-2
- RUNNER-12
- RUNNER-10
- ATOI-1
