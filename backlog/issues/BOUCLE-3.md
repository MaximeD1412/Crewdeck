---
id: BOUCLE-3
title: "The code kind: the Code Session, its official Skill and Contrat, and the Étape each agent is on"
epic: BOUCLE
type: feature
priority: P0
size: M
milestone: M4 Boucle
blocked_by: [BOUCLE-2, RUNNER-12, RUNNER-10, MIROIR-7]
adr: [0002, 0004, 0005, 0008, 0011]
risques: [IA-5]
stories: [US-14, US-15]
screens: []
revue_visuelle: false
video: false
reprend: 64
---

## Context

The **Boucle** admits a ready **Ticket** into the Projet's « pour chaque Ticket prêt » **Phase** (BOUCLE-2); its **Étape** of kind `code` (« Code » in « Process Crewdeck ») has an agent in the Étape's **Rôle** implement it in a **Session** on the **Runner**, in its own worktree, and deliver a **Changement de code**: a PR on GitHub, a local change record on a Local Projet (US-15). Per ADR 0011 this is a kind handler of PROCESS-4's engine; the agent reads and writes only through `crewdeck-runner miroir` (MIROIR-6, MIROIR-7), so one Skill and one **Contrat** (ADR 0005) serve both **Sources**. US-14: the Pilote sees which Ticket each agent is on and at which Étape. Source of the Skill: the founder's `agent-loop` implementation step.

## Current state of the code

- `packages/contracts/src/contrats/define.ts`: `STEP_IDS` (with `code`), `RULE_KINDS` (`file`, `sections`, `pattern`, `front-matter`, `json`, `pr`, `check`), `zPrRule` (`base`, `branch`, `body`, `labels`), `zVerdict` (`headSha?`). `apps/runner/internal/contrat/` interprets them (`rules/pr.go`, `checks/registry.go`). `packages/contracts/src/runner/step.ts`: `step.verdict`.
- No `apps/runner/skills/`, no Code Contrat, no `apps/server/src/process/`.
- Created by PROCESS-1: `catalogue.ts` (kind `code`: family agent, Entrée `ticket`, Sortie `code-change`, default Rôle `code`, Skill `code`, Contrat `code`); PROCESS-4: `apps/server/src/process/engine/kinds/` (`StepKindHandler { kind, start, onSignal }`), `step_runs` (`iteration`, `outputs`, `verdict`, `sessionId`), the feeding of Entrées; PROCESS-6: Retours (`iteration + 1`, the StepRun whose Verdict sent it back).
- Created by BOUCLE-2: `apps/server/src/loops/` (`AgentLoop`, `LoopRecord`, the slot, `loop-scheduler.ts`), `/boucle` with `LoopCard` and its `AgentRow`s. Created by BOUCLE-1: `Ticket` (`source`; readable labels: all on GitHub, only `priority:*`, `size:*`, `ready-for-agent`, `needs-human` on Local, the others in `labelsSealed`), `CodeChange` (`number`, `ticketNumber`, `headRef`, `baseRef`, `headSha`, `state`) fed from GitHub's webhooks and, for Local, SOURCE-3's `local.changed`; `ticketNumberOfBranch` in `change-link.ts`.
- Created by RUNNER-12: `apps/server/src/process/engine/kinds/agent.ts` (`defineAgentKind`: the Session started from the Étape's `role` and `skill` Outils, the Moteur and model from `SettingsService.effective`, the resolved Entrées in `session.start`, the Contrat's verdict on `step_runs.verdict`, `registerStepReport(kind, schema, handler)`, `StepRunHooks.onFinished`), `crewdeck-runner etape start|report`, `apps/runner/skills/` embedded. Created by RUNNER-9: worktrees `~/.crewdeck/worktrees/<projet>/<branch>` (`apps/runner/internal/session/`). Created by RUNNER-10: the GitHub Projet's Session token. Created by SOURCE-2: the Local clone `~/.crewdeck/repos/local/<projectId>` with the folder as `origin`.
- Created by MIROIR-6: `crewdeck-runner miroir issue|pr view|list` for both Sources; MIROIR-7: `miroir pr create|edit|comment`, `miroir issue comment`.
- Created by ATOI-1: « À toi » and its « Boucles en cours » card; ATOI-2: « Contrat incomplet » and « Étape échouée » for any StepRun.

## To do

- Server `apps/server/src/process/engine/kinds/code.ts`, the `code` kind, defined with RUNNER-12's `defineAgentKind`:
  - Its input: the Ticket from the Étape's `ticket` Entrée; `mode` = `implement` on iteration 1, else from the Étape that sent the Retour (PROCESS-6): `review` → `fix-review`, `visual-review` → `visual-fix`, any other judging kind → `fix-review`; BOUCLE-4 adds `fix-conflict`, BOUCLE-5 `answer`. The Session's input `{ ticketNumber, baseBranch, visualReviewStep, mode, fromStepRunId? }`: `baseBranch` the Projet's integration branch (PARAM-3); `visualReviewStep` = the pinned Phase has a `visual-review` Étape fed by this Étape's Sortie.
  - `outputs(ctx)`, on a `passed` verdict with the report's `changeNumber` and `headSha`: once BOUCLE-1's `CodeChange` of that number has `ticketNumber` = the Ticket's, `{ portId, type: 'code-change', id: codeChange.id, sha: headSha }` (the engine feeds the Étapes downstream); `incomplete`, or a Session that ended without a report → RUNNER-12's failed StepRun, ATOI-2's Décision, the PhaseRun `waiting`.
- Report schema (`registerStepReport('code', …)`): `{ changeNumber: int, headSha: 40 hex, branch, visualReview: bool }` (figures only; `visualReview` is the Runner's: `visualReviewStep` and the label `revue-visuelle`, which it reads on both Sources).
- Runner:
  - `apps/runner/internal/session/branch.go`: `BranchName(labels, number, title)`: `<prefix>/<n>-<slug>`, the prefix `fix` with the label `type:fix`, `chore` with `type:chore`, else `feat`, the slug the title in lower-case ASCII (accents removed), words joined by `-`, at most 40 characters cut at a word; a shared fixture table `packages/contracts/src/loops/fixtures/branch-names.json` read by the Go test. The Runner computes it because it reads a Local Ticket's title and labels, which the server cannot; the server knows the branch from the report.
  - The worktree branches from `origin/<baseBranch>` (GitHub's remote, or the Local folder), or reuses an existing `<prefix>/<n>-*` branch (a resumption or a Retour).
  - `crewdeck-runner etape start` prints, beside the Entrées, `branch` and `visualReview` as the Runner computed them, for the Skill.
  - `GH_TOKEN` and `GITHUB_TOKEN` only in a GitHub Projet's Session (RUNNER-10); a Local Session's `git push` goes to the folder.
- Skill `apps/runner/skills/code/SKILL.md`, from `implement.md` and `red-green`: read the Ticket with `crewdeck-runner miroir issue view <n> --json title,body,labels,comments`; read the Projet's conventions file (`AGENTS.md`, else `CLAUDE.md`) first; implement test-first; run the checks it requires; `git push origin <branch>`; open the change with `crewdeck-runner miroir pr create --base <base> --head <branch> --title … --body-file …` (not a draft), body with « Closes #<n> », the criterion-to-test table and the decisions taken alone, in the conventions file's language; with `visualReview`, the captures (BOUCLE-6) named in the body; never merge, never watch the CI; on a Retour, `miroir pr edit`, never a second change; end with `crewdeck-runner etape report` (`changeNumber`, `headSha`, `branch`, `visualReview`). Section « Modes » with the headings `implement`, `fix-review`, `fix-conflict`, `visual-fix`, `answer` (the last three filled by BOUCLE-4 to BOUCLE-6); `fix-review` here: read the remarks of the Verdict that sent the Retour (`miroir pr view <n> --json reviews,comments,statusCheckRollup`), fix or answer each one as a reply.
- Contrat `packages/contracts/src/contrats/code.ts`, severity `bloquant`: `code.pr.branch` (`pr`: branch `^(feat|fix|chore)/<n>-[a-z0-9-]+$`, base `integration`), `code.pr.closes` (`pr` body `Closes #<n>`), `code.pr.criteria-table` (`pr` body: a Markdown table whose header has « Critère » and « Test »), `code.pr.captures` (only when the report's `visualReview` is true: the body names a `captures/<n>/…-390.png` and a `…-1280.png`); French labels (« La PR part de la branche du Ticket vers la branche d'intégration », « La PR ferme le Ticket », « Chaque critère d'acceptation a son test », « Les captures à 390 et 1280 px sont liées »). Rule fixtures, one passing and one failing each, a GitHub PR and a local change.
- `apps/runner/internal/contrat/rules/pr.go` reads the change through the Miroir's `pr view` shape, so the same rule judges a PR and a local change; if it still calls GitHub directly, move it.
- US-14 on screen: pure `agentStepLabel(stepRun, step, session)` in `apps/web/src/views/agent-step.ts`: the running StepRun's Étape name as the pinned version names it (« Code », « Checks », « Review », « Revue visuelle »), « · passage <k> » from iteration 2; a Session `waiting` « attend ta réponse » / « attend ta permission » (tone `caution`). `AgentRow` data `{ projet, ticket: '#<n> <titre>', step, engine: '<Moteur>', since: 'depuis <durée>', tone }`, used by `views/boucle.ts` and by the « Boucles en cours » card of `views/a-toi.ts`; t() keys under `boucle.step.*`.

## Decisions already made

- The Code Session runs with `--permission-mode bypassPermissions` (Codex: its full-auto equivalent) inside its worktree (ADR 0004); the Sessions the Pilote drives stay in `auto`.
- The change is opened ready, not as a draft: in the Process the checks follow the Code and precede the Review, and a CI that skips drafts would never judge it.
- The branch's slug is the Runner's, never the agent's; the server links by `ticketNumberOfBranch`, which reads only the number.
- The server never sees the Ticket's body: the agent reads it through the Miroir (for a taken Ticket, SOURCE-6 makes it answer the snapshot).
- A Code StepRun that ends without a report and without a blocked report is « Étape échouée » (ATOI-2).
- Nothing in this handler assumes « Process Crewdeck »: the Étape's name, the Étapes it feeds and whether a Revue visuelle follows come from the pinned version.

## Acceptance criteria

- [ ] An admitted Ticket starts one Code StepRun with the Rôle of its Étape's `role` Outil, `mode: implement`, the Projet's integration branch as base; its report's `visualReview` is true only when the Ticket carries `revue-visuelle` (a readable label on GitHub, a sealed one on Local) and a `visual-review` Étape is fed by this Étape.
- [ ] `BranchName` gives `feat/42-connexion-github` for #42 « Connexion GitHub », `fix/…` with `type:fix`, cuts at 40 characters on a word, drops accents (Go test on the shared fixtures).
- [ ] On a Local Projet (a temporary git repository as its folder), the Session pushes its branch to the folder and `miroir pr create` writes the local change; the same Contrat passes (Go test with the fake server).
- [ ] The Code Contrat passes its passing fixtures and fails each failing one with its rule id; `code.pr.captures` is not evaluated without `visualReview`.
- [ ] A `passed` verdict gives the StepRun its `code-change` output at the reported SHA and the engine starts the Étapes it feeds; an `incomplete` one raises ATOI-2's Décision and the PhaseRun waits.
- [ ] A Retour from a `review` Étape starts the Code StepRun of iteration 2 in `fix-review` on the same branch.
- [ ] `/boucle` and « À toi » show the AgentRow « #44 Liste des Projets · Code · Claude Code · depuis 18 min », then « Review » when the next StepRun starts, updated from the events without reload (Playwright, 390 and 1280 px).

## Verification

- `pnpm exec nx test server -- src/process/engine/kinds/code.spec.ts`
- `pnpm exec nx test contracts -- src/contrats/code.spec.ts`
- `cd apps/runner && go test ./internal/contrat/... ./internal/session/`
- `pnpm exec nx test web -- src/views/agent-step.spec.ts`
- `pnpm exec nx e2e web -- boucle.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

Nothing.

## Out of scope

- The `review` and `merge` kinds, the conflict with the base: BOUCLE-4. The `checks` kind: BOUCLE-9.
- Retours, their iteration and maximum: PROCESS-6.
- The blocked report and the `answer` mode: BOUCLE-5. The captures and `visual-fix`: BOUCLE-6.
- Limits and interruptions during a Session: BOUCLE-7. A Ticket changed at its Source while it is coded: SOURCE-6.

## Dependencies

- BOUCLE-2
- RUNNER-12
- RUNNER-10
- MIROIR-7
