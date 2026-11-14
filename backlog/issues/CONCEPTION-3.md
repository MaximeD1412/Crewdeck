---
id: CONCEPTION-3
title: "PRD Étape: the prd kind handler, the official product-design Skill, its Contrat, and the life of a document on the code's Source"
epic: CONCEPTION
type: feature
priority: P0
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-1]
adr: [0002, 0004, 0005, 0007, 0011, 0012]
risques: [IA-6]
stories: [US-8, US-11, US-48]
screens: []
revue_visuelle: false
video: false
reprend: 78
---

## Context

The first agent Étape of a Conception in « Process Crewdeck »: an agent writes the PRD with the Pilote in a Session (US-8), checked against the PRD Contrat (ADR 0005, US-48), on a change of the code's Source the Pilote then reviews and approves (US-11, CONCEPTION-4). The refonte (PRD #169, ADRs 0011 and 0012) makes it the `prd` **kind handler** of PROCESS-4's engine: it starts when its Entrée (an Idée) is fed, its Rôle, Skill and Serveurs MCP are its Outils, and its Sortie is the PRD at the SHA its Contrat passed. The documents live on the **code's Source** (ADR 0012, « Which Source for what »): a GitHub PR, or on a Local Projet a branch of the Runner's clone pushed to the folder with its local change record; the agent writes both through `crewdeck-runner miroir pr create` (MIROIR-7), never a GitHub-only verb. A Retour (from the Revue croisée or the Pilote's gate) reruns this Étape on the same change, the Skill settling every remark. The Skill is ported from the dotfiles `product-design` skill (`MaximeD1412/dotfiles`, `agents/skills/product-design/SKILL.md` and `REFERENCE.md`). This ticket also writes what every document Étape shares (CONCEPTION-5, CONCEPTION-7): the document record, the change's life (a push voids the verdict, a close fails the Étape), the remarks' format and their check.

## Current state of the code

- `packages/contracts/src/contrats/define.ts` (`defineContrat`, rule kinds `file`, `sections`, `pattern`, `front-matter`, `json`, `pr`, `check`), `apps/runner/internal/contrat/` (`rules/pr.go`, `checks/registry.go`); `packages/contracts/src/runner/step.ts` has only `step.verdict`. No `prd` Contrat, no product-design Skill.
- Created by CONCEPTION-1: `Design` (`title`, `slug`, `prdPath`), `apps/server/src/designs/`, the Conception's PhaseRun.
- Created by PROCESS-4: `engine/kinds/`, StepRuns with `iteration` and `outputs`. By PROCESS-6: a Retour reruns the StepRuns from its target with `iteration` + 1.
- Created by RUNNER-12: agent Sessions of a StepRun in a worktree, `crewdeck-runner etape start|report|ask`, `step.report`, `registerStepReport`, the embedded Skills. By RUNNER-17: the Étape's Serveurs MCP mounted in its Session.
- Created by BOUCLE-1: `code_changes` (`source`, number, branch, head SHA, state, sealed title for Local) and its GitHub side; by SOURCE-3: the Local rows from `local.changed`. By SOURCE-2: the Runner's clone of a Local Projet (`~/.crewdeck/repos/local/<projectId>`, `origin` the folder).
- Created by MIROIR-6 / MIROIR-7: `miroir pr view|list` and `miroir pr create|comment` for both Sources (GitHub with the Session's token, Local writing the change record in `local.db`); the `pr` rule reading the change through the Miroir's view.

## To do

- **Kind handler** `apps/server/src/process/engine/kinds/prd.ts` (kind `prd`), the shared part in `apps/server/src/designs/documents.ts`:
  - `start(tx, stepRun)`: RUNNER-12's agent Session with the Étape's `role`, `skill` and `mcp` Outils and the Contrat `prd`, in a worktree of the integration branch on the code's Source; arguments `{ ideaId, iteration }`, and on `iteration` > 1 `{ changeNumber, branch }` of the document's change (the same change, settle mode).
  - On `passed` with `step.report { figures: { changeNumber, branch, path, headSha, hasScreens, storyCount, openQuestions } }` (validated with `registerStepReport`): the `design_documents` row upserted, `Design.prdPath`, `slug` and, for a GitHub change, `title` (its title without `docs(product): `; a Local change's title stays sealed on its `code_changes` row, which the page decrypts); the StepRun's output `{ portId: <its prd Sortie>, type: 'prd', id: <changeNumber>, sha: headSha }`; `design.upserted`.
- **Prisma** `DesignDocument` (`design_documents`: `pilotId`, `designId`, `type` `prd | mockups | technical-design`, unique `(designId, type)`, `changeNumber`, `branch`, `path?`, `headSha`, `verdictSha`, `approvedSha?`, `approvedAt?`, `figures Json`).
- **The document's change** (`apps/server/src/designs/document-changes.listener.ts`, on the `code_changes` upsert of a change held by a `design_documents` row, whatever its Source):
  - head ≠ `verdictSha`: the verdict is void (ADR 0002): the judging StepRuns of that document waiting in the PhaseRun get the signal `document-voided` (CONCEPTION-4 resolves its Décision), and `step.check { stepRunId, headSha }` (server → Runner, `packages/contracts/src/runner/step.ts`, with its Runner handler: `contrat.Check` on a worktree at that SHA, answering `step.verdict`) is sent; a passing re-check sets `headSha`, `verdictSha` and the output's `sha` to the new head and signals `document-refreshed`; a failing one makes the StepRun `incomplete` (ATOI-2's Décision).
  - closed without merge: the authoring StepRun `failed` with the reason `change-closed` (ATOI-2's « Étape échouée »; its rerun opens a new change). Merged: CONCEPTION-4.
  - Each change written with its events in one transaction.
- **Remarks** (shared by every document and by CONCEPTION-4, CONCEPTION-8): a remarks comment on the change starts with `<!-- crewdeck:remarks -->` then one `**R<n>** · Sur « <passage> »` block per remark (the passage optional) and its text; an answers comment starts with `<!-- crewdeck:answers -->` then one `**R<n>** · corrigée : <what changed>` or `**R<n>** · non retenue : <reason>` line per remark. `packages/contracts/src/design/remarks.ts` (`renderRemarks`, `parseAnswers`, used by the page) and its Go twin `apps/runner/internal/remarks/` (`Parse`, `Answers`), tested on the same fixtures.
- **Contrat** `packages/contracts/src/contrats/prd.ts`, version 1, ADR 0005's PRD row, `{path}` from the report (variable substitution in `apps/runner/internal/contrat/vars.go` if the interpreter has none):
  - `prd.file` (`file` `{path}`), « Le PRD est dans docs/product/ »;
  - `prd.sections` (`sections`): Problem, Users, Journeys, Scope, Success criteria, Constraints, Open questions (and Principles for `prd.md`), « Le PRD a ses sections »;
  - `prd.stories.shape` (`pattern` on `- **US-<n>**` lines, unique capture), « Chaque story a un identifiant unique »;
  - `prd.stories.stable` (`check` `prd-stories-stable`, `checks/prd_stories_stable.go`): no story id of the integration branch's `docs/product/` removed (other than crossed out) or reused, « Aucune story existante n'est supprimée ni réutilisée »;
  - `prd.stories.scoped` (`check` `prd-stories-scoped`): every story has a tag and appears in « Scope » (by id or range), « Chaque story est dans le Scope »;
  - `prd.glossary` (`file` `CONTEXT.md`), « Le glossaire CONTEXT.md existe »;
  - `prd.pr` (`pr`: base the integration branch, branch `docs/product-*`, label `conception`, read through the Miroir for either Source), « Le changement de conception vise la branche d'intégration avec le label conception »;
  - `prd.remarks.answered` (`check` `remarks-answered`, `checks/remarks_answered.go`, reused by CONCEPTION-5, CONCEPTION-7, CONCEPTION-9): every remark of the latest remarks comment on the change is answered in a later answers comment, « corrigée » or « non retenue » with a non-empty text; passes when there is none, « Chaque remarque est corrigée ou non retenue avec sa raison ».
  - One passing and one failing fixture per rule (`apps/runner/internal/contrat/testdata/prd/`), the `pr` and `remarks-answered` ones for a GitHub change and a Local one.
- **Skill** `apps/runner/skills/product-design/` (`SKILL.md`, `REFERENCE.md`), ported for a Conception of an existing Projet:
  - the Runner writes `.crewdeck/context.json` before the Session (the Idée's text and analysis decrypted, the Projet, the merged Idées' texts pointing to it);
  - inventory of the repository, closed question rounds with a recommendation through `AskUserQuestion` (answered in the Session panel, SESSION-3), the PRD written as decisions are made: `docs/product/prd.md` when the repository has none, else `docs/product/features/<slug>.md`; stories `- **US-<n>** (MVP|next|later) As a …` with the next free numbers across `docs/product/`; `CONTEXT.md` terms;
  - its own cross review step removed (CONCEPTION-8 is an Étape of the Process); the `ideas` and `design` commands replaced by `crewdeck-runner etape` and `crewdeck-runner miroir`;
  - the change: branch `docs/product-<slug>` pushed to `origin` (GitHub, or the Local folder), then `crewdeck-runner miroir pr create --base <integration> --head docs/product-<slug> --title "docs(product): <title>" --label conception --body-file …`; then `crewdeck-runner etape report`;
  - settle mode (`iteration` > 1): read the change's comments with `crewdeck-runner miroir pr view <n> --json comments`, fix or answer « non retenue » every remark of the latest remarks comment (the dotfiles' rules: never silently dropped, a remark kept only with a checkable reason), commit on the same branch, push, post the answers with `miroir pr comment`, report again.
- **Tests**: Go tests of the rules and checks; server tests of the handler, `documents.ts` and the listener on `code_changes` rows of both Sources, with the fake Runner.

## Decisions already made

- The PRD's path is the Skill's choice by the dotfiles rule (`prd.md` for a repository without one, else a feature file); the Contrat reads it from the report.
- The server never reads the PRD (ADR 0002, ADR 0012): it knows the path, the figures and the change's metadata; the Runner checks the content, in a worktree of either Source.
- The « Conception à relire » Décision is raised by the gate that reviews the document (CONCEPTION-4), not by this Étape: when the next Étape is a Revue croisée, the Pilote is asked only once it passed.
- A push to the change after its verdict voids every judgement waiting on it and re-checks the Contrat at the new head; approving is always bound to `verdictSha` (CONCEPTION-4).
- A Retour reruns this Étape on the same change and branch: one change per document and Conception, its history holding every pass.
- The question rounds go through the Moteur's own question tool held by the Runner (ADR 0004), so they reach « À toi » as « Question de l'agent » (SESSION-3).
- `prd.stories.stable` compares with the integration branch fetched in the worktree (`git show origin/<integration>:<file>`), so a feature PRD never renumbers the product's stories.

## Acceptance criteria

- [ ] With the fake Runner replaying a PRD Session on a GitHub Projet, a `passed` verdict passes the `prd` StepRun with its output at the head SHA, the `design_documents` row and the Conception's title and path set, and the next Étape's Entrée fed.
- [ ] The same on a Local Projet: the change is a local record and a branch of the folder; the output's `sha` is the branch's head; no GitHub call is made.
- [ ] A PRD whose story US-3 of the integration branch disappeared fails `prd.stories.stable`; a story out of « Scope » fails `prd.stories.scoped`; a change without the label fails `prd.pr`; a remark without its answer fails `prd.remarks.answered` (Go fixtures).
- [ ] A push to the change after the verdict signals `document-voided`, sends `step.check` at the new head, and a passing re-check moves the output's `sha` and signals `document-refreshed`.
- [ ] The change closed without merge fails the Étape with `change-closed` and « Relancer l'Étape » opens a new change.
- [ ] A rerun through a Retour starts the Session in settle mode on the same change, and its pass needs every remark answered.
- [ ] Every Étape change and its events are written in one transaction; no server log line contains a file's content, a comment or a change's body (only ids, numbers, SHAs).

## Verification

- `cd apps/runner && go test ./internal/contrat/... ./internal/remarks/ -run 'Prd|Remarks'`
- `pnpm exec nx test contracts -- src/contrats/prd.spec.ts src/design/remarks.spec.ts`
- `pnpm exec nx test server -- src/designs/documents.spec.ts src/process/engine/kinds/prd.spec.ts`
- `pnpm exec nx test-integration server -- designs`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

A Prisma migration (`design_documents`). The Skill ships in the Runner's release.

## Out of scope

- The review page, approving, the merge and « Demander des changements »: CONCEPTION-4.
- The Revue croisée: CONCEPTION-8.
- The agents' writes to either Source: MIROIR-7. The local change record and its merge: SOURCE-5.
- `product-design --amend` from a mockups change: not at the MVP.

## Dependencies

- CONCEPTION-1.
