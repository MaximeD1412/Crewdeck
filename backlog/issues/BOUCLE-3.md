---
id: BOUCLE-3
title: "Code Étape: the Code Session, its official Skill and Contrat, and the step each agent is on"
epic: BOUCLE
type: feature
priority: P0
size: M
milestone: M4 Boucle
blocked_by: [BOUCLE-2, RUNNER-12, RUNNER-10]
adr: [0002, 0004, 0005, 0008]
risques: [IA-5]
stories: [US-14, US-15]
screens: []
revue_visuelle: false
video: false
---

## Context

The **Boucle** takes a ready **Ticket** (BOUCLE-2) and an agent in the « Code » **Rôle** implements it in a **Session** on the **Runner**, in its own worktree, then opens a draft PR as `crewdeck[bot]` (ADR 0002, ADR 0004). The output is checked against the Code **Contrat** (ADR 0005). US-14: the Pilote sees which Ticket each agent is on and at which step. This is the founder's `agent-loop` implementation step, moved into the product.

## Current state of the code

- No code in the repository: only the docs and `design/`.
- Created by BOUCLE-2: `apps/server/src/loops/` (`AgentLoop`, `LoopRecord`, `loop-scheduler.ts`, the `LoopWorker` interface with a test double), `/boucle` with `LoopCard` and its `AgentRow`s.
- Created by BOUCLE-1: `Ticket` (`loopStep`, `prNumber`, `headSha`, `labels`).
- Created by RUNNER-12: `apps/server/src/steps/` (`StepRun`, `StepsService.start`), `apps/runner/skills/` embedded with `go:embed`, `crewdeck-runner etape start|report|ask`.
- Created by RUNNER-11: the Contrat declarations `packages/contracts/src/contrats/` (rule kinds `file`, `sections`, `pattern`, `front-matter`, `json`, `pr`, `check`) and their Go interpreter `apps/runner/internal/contrat/`.
- Created by RUNNER-10: the per-Session GitHub token (installation token restricted to the repository, renewed). Created by RUNNER-9: Sessions in worktrees `~/.crewdeck/worktrees/<projet>/<branch>`, `setupCmd`/`dropCmd` of the Projet's `.process.json`.
- Created by ATOI-1: the « À toi » page with its « Boucles en cours » card. Created by ATOI-2: « Contrat incomplet » and « Étape échouée » for any StepRun.
- The founder's `agent-loop` (dotfiles repository `MaximeD1412/dotfiles`, `agents/tools/agent-loop/prompts/implement.md`, `scripts/branch-name.sh`) and the skills `agents/skills/red-green/` and `agents/skills/pick-issue/` (step 5) are the sources of the Skill.

## To do

- `packages/contracts/src/api/tickets.ts`: `zLoopStep` = `coding` | `fixing` | `in-review` | `waiting-checks` | `visual-review` | `blocked` | `interrupted` (this ticket sets `coding`, `in-review`; BOUCLE-4 `fixing`, `waiting-checks`; BOUCLE-5 `blocked`; BOUCLE-6 `visual-review`; BOUCLE-7 `interrupted`).
- `apps/server/src/loops/branch-name.ts`: pure `branchName(ticket)`: `fix/` when the label `type:fix`, `chore/` for `type:chore`, else `feat/`; then `<number>-<slug>`, the slug the title in lower-case ASCII (accents removed), words joined by `-`, at most 40 characters cut at a word.
- `apps/server/src/loops/code-worker.ts` implements `LoopWorker.take(ticket)`: `StepsService.start({ step: 'code', role: 'code', subjectType: 'ticket', subjectId, input: { issueNumber, branch, baseBranch, visualReview, mode: 'implement' } })` with the Moteur and model of the effective `roles.code` (PARAM-2/PARAM-3). `visualReview` = the label `revue-visuelle` and the Étape optionnelle `visual-review` on for the Projet.
- Runner (`apps/runner/internal/session/` and the Code Skill's start): before the Session starts, the Runner writes the issue's body and comments (read with the Session's token) to `.crewdeck/ticket.md` of the worktree, and puts `GH_TOKEN` and `GITHUB_TOKEN` in the Session's environment so that `git push` and `gh pr create` act as `crewdeck[bot]`. The worktree branches from `origin/<baseBranch>`, or reuses the branch when it exists (a resumption).
- Skill `apps/runner/skills/code/SKILL.md`, ported from `implement.md` and `red-green`: read `AGENTS.md` (or the conventions file the Projet's `.process.json` names) first; implement test-first; run the checks the conventions require; push; open the PR to `baseBranch` as a draft with « Closes #<n> », the criterion-to-test table and the decisions taken alone, in the language of the conventions file; for a Ticket with a visual review, its captures at 390 and 1280 px linked; never merge, never watch the CI; end with `crewdeck-runner etape report` giving the PR number. The section « Modes » keeps the headings `implement`, `fix-review`, `fix-ci`, `fix-conflict`, `visual-fix`, `answer` (filled by BOUCLE-4 to BOUCLE-6).
- Contrat `packages/contracts/src/contrats/code.ts` (ADR 0005's Code row), severity `bloquant`: `code.pr.branch` (`pr`: head `^(feat|fix|chore)/<n>-[a-z0-9-]+$`, base = `baseBranch`), `code.pr.closes` (`pr` body pattern `Closes #<n>`), `code.pr.criteria-table` (`pr` body pattern: a Markdown table whose header has « Critère » and « Test »), `code.pr.captures` (only when `visualReview`: the body links a `…-390.png` and a `…-1280.png` under `/blob/captures/<n>/`); French labels (« La PR part de la branche du Ticket vers la branche d'intégration », « La PR ferme le Ticket », « Chaque critère d'acceptation a son test », « Les captures à 390 et 1280 px sont liées »). Rule fixtures, one passing and one failing each.
- Server, on the Code StepRun's end: verdict `passed` → `loopStep: in-review` and `headSha` recorded on the StepRun's verdict (BOUCLE-4 takes it from there); `incomplete` or failed → the Ticket keeps `loopStep: coding`, ATOI-2's Décision offers « Relancer l'Étape », the Boucle takes no other Ticket meanwhile (one slot).
- US-14 on screen: a pure `agentStepLabel(ticket, session)` in `apps/web/src/views/agent-step.ts`: `coding` « code », `fixing` « corrections », `in-review` « en review », `waiting-checks` « checks », a Session `waiting` « attend ta réponse » / « attend ta permission » (tone `caution`); `AgentRow` data `{ projet, ticket: '#<n> <titre>', step, engine: '<Moteur>', since: 'depuis <durée>', tone }` used by `views/boucle.ts` and by the « Boucles en cours » card of `views/a-toi.ts`.
- t() keys under `boucle.step.*`.

## Decisions already made

- The Code Session runs with `--permission-mode bypassPermissions` (Codex: its full-auto equivalent) inside its worktree (ADR 0004); the Sessions the Pilote drives stay in `auto`.
- The PR is opened as a draft and leaves draft only after the Review passes (BOUCLE-4): Crewdeck's own CI skips drafts (ADR 0009).
- The branch name is computed by the server from the title (readable), never by the agent, so that BOUCLE-1's link by branch always holds.
- The server never sees the ticket's body: the Runner reads it from GitHub with the Session's token.
- A Code StepRun that ends without a PR and without a blocked report is « Étape échouée » (ATOI-2).

## Acceptance criteria

- [ ] A Ticket taken by the Boucle starts one Code StepRun with the branch of `branchName`, the Moteur and model of `roles.code`, and `visualReview` computed from the label and the Étape optionnelle.
- [ ] `branchName` gives `feat/42-connexion-github` for #42 « Connexion GitHub », `fix/…` with `type:fix`, cuts at 40 characters on a word, drops accents.
- [ ] The Code Contrat passes its passing fixture and fails each failing one with its rule id; `code.pr.captures` is not evaluated without `visualReview`.
- [ ] The Runner writes `.crewdeck/ticket.md` and gives the Session a token only for the Projet's repository (Go test with the fake server).
- [ ] A `passed` verdict moves the Ticket to `in-review` and records the head SHA; an `incomplete` one leaves it in `coding` with the Contrat Décision of ATOI-2.
- [ ] `/boucle` and « À toi » show the AgentRow « #44 Liste des Projets · code · Claude Code · depuis 18 min », updated from the events without reload (Playwright, 390 and 1280 px).

## Verification

- `pnpm exec nx test server -- src/loops/`
- `pnpm exec nx test contracts -- src/contrats/code.spec.ts`
- `cd apps/runner && go test ./internal/contrat/... ./internal/session/`
- `pnpm exec nx test web -- src/views/agent-step.spec.ts`
- `pnpm exec nx e2e web -- boucle.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

Nothing.

## Out of scope

- The Review Étape, the checks and the merge: BOUCLE-4.
- The blocked report and the `answer` mode: BOUCLE-5. The visual review and `visual-fix`: BOUCLE-6.
- Limits and interruptions during a Session: BOUCLE-7.

## Dependencies

- BOUCLE-2
- RUNNER-12
- RUNNER-10
