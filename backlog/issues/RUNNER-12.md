---
id: RUNNER-12
title: "Official Skills embedded in the Runner, crewdeck-runner etape, and the server's StepRun"
epic: RUNNER
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-9, RUNNER-10, MIROIR-6, ATOI-3]
adr: [0004, 0005, 0003, 0007, 0010]
risques: [IA-6, AGT-7]
stories: [US-48]
screens: []
revue_visuelle: false
video: false
reprend: 50
---

## Context

Each Étape of the Process is done by a Skill, the official one at the MVP, in the `SKILL.md` format Claude Code and Codex read; the Skills ship inside the Runner's release (`go:embed`) so that a Skill and the checker of its Contrat always share the Runner's version (ADR 0004). The commands the dotfiles Skills call (`design`, `ideas`, `agent-loop`) become `crewdeck-runner etape <verb>`, which talk to the server. On the server, every run of an Étape is a `StepRun`: the Étape, its Rôle, its subject (an Idée, a Conception, a Ticket, a Projet), its Session, its status and its Contrat verdict, the object ATOI-2 raises Décisions from and every Étape ticket starts. This ticket builds the mechanism; each Étape ticket ports its Skill from the founder's dotfiles repository (`MaximeD1412/dotfiles`, `agents/skills/<name>/`) and writes its Contrat.

ADR 0010 amends it: the official Skills read the state of the work through the **Miroir** (`mirror`, the Session's shim of RUNNER-10, answering in `gh`'s shapes, MIROIR-6) and write with `mirror gh` (or `gh`), never reading GitHub through many `gh` calls; a dotfiles skill ported as it is keeps its `mirror` commands.

## Current state of the code

- Created by RUNNER-9: `apps/server/src/sessions/` (`AgentSession`, `SessionsService.start` with `prompt: { kind: 'step', step, stepRunId }`, the `session.ended` hook), `apps/runner/internal/session/` (worktree, Session folder, control socket, `prompts/step.md`).
- `packages/contracts/src/contrats/` (RUNNER-11, merged): `define.ts` (`defineContrat`, `STEP_IDS`, `zContrat`, `zRule`, `zVerdict`), `index.ts` (the registry), `checks/`, `rules/`; `apps/runner/internal/contrat/` (`Check`); the `step.verdict` message (`packages/contracts/src/runner/step.ts`).
- `apps/runner/internal/keys/vault.go` (E2E-2, merged): the Runner's vault, which seals a report's content.
- `apps/runner/internal/engine/claude/` (RUNNER-5, merged) and, by RUNNER-6, the Codex adapter (`StartOptions.SkillsDir`); by PARAM-1 and PARAM-2: `SettingsService.effective(pilotId, projectId?)` with each Rôle's Moteur and model; by ATOI-3: `apps/server/src/runners/waiting-work.ts`.
- Created by RUNNER-10: the Session's `gh` and `mirror` shims and the Miroir's refresh after a write; by MIROIR-6: `crewdeck-runner miroir` (`issue|pr view|list`, `ready`, `search`, `sql`).
- No `apps/runner/skills/`, no `steps` module.

## To do

- **Contracts**:
  - `packages/contracts/src/contrats/steps.ts`: `STEPS: Record<StepId, { role: AgentRole, skill: string, subjectType: 'idea'|'design'|'ticket'|'project', contrat: string | null }>`: `idea-analysis` → idea, `idea-analysis`, idea; `inventory` → design, `inventory`, project; `prd` → design, `product-design`, design; `mockups` → design, `visual-design`, design; `technical-design` → design, `technical-design`, design; `cross-review` → review, `cross-review`, design; `split` → design, `plan-backlog`, design; `code` → code, `code`, ticket; `review` → review, `review`, ticket. `contrat` is the Contrat's id once its ticket writes it (`null` until then: no check).
  - `packages/contracts/src/api/step-runs.ts`: `zStepRun` `{ id, projectId, step, role, subjectType, subjectId, sessionId?, status: 'queued'|'running'|'passed'|'incomplete'|'failed', verdict?: zVerdict, failure?: 'session-error'|'session-stopped', createdAt, endedAt? }`.
  - Protocol `packages/contracts/src/runner/step.ts`: `step.started` `{ stepRunId }`; `step.report` `{ stepRunId, figures: object, sealed?: string }` (`figures` readable, validated by the server against the Étape's report schema registered by its ticket; `sealed` an opaque ciphertext made by the Runner's vault, stored by the Étape's module when it needs it); `step.ask` is a normalised `question` event in the Session's stream (no new message).
- **Server** `apps/server/src/steps/`:
  - Prisma `StepRun` (`step_runs`) with the fields above plus `pilotId`; index (`pilotId`, `subjectType`, `subjectId`).
  - `StepsService.start(tx, { projectId, step, subjectId, title, branch, base })`: resolves the Rôle from `STEPS`, the Moteur and model from `SettingsService.effective`, creates the StepRun (`queued`) with `step-run.upserted`, then `SessionsService.start` with `prompt: { kind: 'step', step, stepRunId }`; status `running` on `step.started` or the Session's `active`.
  - On `step.verdict`: stores the verdict, status `passed` or `incomplete`, event; emits the in-process hook `step-run.finished(stepRun)` for the Étape's module.
  - On the Session's `session.ended`: `outcome: 'error'` → `failed` (`session-error`); a Session `stopped` by the Runner → `failed` (`session-stopped`); `ok` without a Contrat (`contrat: null`) → `passed`.
  - `registerStepReport(step, zodSchema, handler)`: the Étape's module validates `figures` and stores them (and `sealed`) with its own model; an invalid report fails the StepRun (`incomplete` with rule id `report.schema`).
  - `GET /api/step-runs?subjectType=…&subjectId=…` (bounded by the subject), `StateContributor` key `stepRuns` (the StepRuns not finished, and the last of each subject).
  - A `RunnerWaitingWork` provider `step-runs` listing the Projets of `queued` StepRuns (registry created by ATOI-3: `apps/server/src/runners/waiting-work.ts`).
- **Runner**:
  - `apps/runner/skills/` with `embed.go` (`//go:embed */SKILL.md */**`), `README.md` (one folder per Skill, named as `STEPS[*].skill`; how a Skill calls `crewdeck-runner etape`; the rule « read with `mirror`, write with `mirror gh` »: `mirror issue view <n> --json …`, `mirror pr view`, `mirror ready`, `mirror search` for the Tickets, PRs, checks and documents, `mirror gh` for every write; a direct `gh` read, `gh api` GET included, is not used); a test Skill `apps/runner/internal/skills/testdata/crewdeck-test/SKILL.md` for the tests only, which reads its Ticket with `mirror issue view <n> --json title,body,labels` and comments on it with `mirror gh issue comment`.
  - `apps/runner/skills/skills_test.go`: no embedded `SKILL.md` reads GitHub with `gh` (no `gh issue view|list`, `gh pr view|list|checks`, `gh api` without `-X`/`--method`, outside `mirror gh`).
  - `apps/runner/internal/skills/mount.go`: per Session, Claude: write `~/.crewdeck/sessions/<id>/plugin/.claude-plugin/plugin.json` (`{ "name": "crewdeck", "version": "<runner version>" }`) and `plugin/skills/<skill>/…`, passed as `--plugin-dir`; Codex: `~/.crewdeck/sessions/<id>/codex-home/skills/<skill>/…` and the `config.toml` the spike recorded, passed as `CODEX_HOME`. Only the Skill of the Session's Étape is mounted.
  - `prompts/step.md` completed: « Use the Skill `<skill>`. Your StepRun is `<stepRunId>`; start with `crewdeck-runner etape start`. »
  - `crewdeck-runner etape start` (inside a Session, found through `CREWDECK_SESSION_ID` and the control socket): sends `step.started` and prints the Étape's context as JSON (`stepRunId`, `step`, `subjectType`, `subjectId`, `projectId`, `repository`, `branch`, `base`).
  - `crewdeck-runner etape report [--file <path>|-]`: reads `{ figures, content? }`, seals `content` with the vault (E2E-2's `internal/keys/vault.go`) into `sealed`, sends `step.report`.
  - `crewdeck-runner etape ask --question <json>`: emits a normalised `question` in the Session's stream and blocks until its answer arrives on the control socket (SESSION-3 answers it from the page).
  - At the Session's end, if the Étape has a Contrat: run `contrat.Check` on the worktree and the Session's PR (if a PR was opened on the Session's branch) and send `step.verdict` before removing the worktree.

## Decisions already made

- Skill names are those of `STEPS`; each Étape ticket creates `apps/runner/skills/<skill>/` with that name.
- Only the Session's own Skill is mounted, so an agent cannot wander into another Étape's method.
- A report's `figures` are what the server may read (ADR 0003's left column: ids, states, figures); any free text goes in `content`, sealed. The Étape's ticket decides which is which.
- Rerunning a StepRun (« Relancer l'Étape ») creates a new StepRun for the same subject: ATOI-2.
- The Skills read through `mirror` and only write through `gh`: one channel for the agents (ADR 0010); the guard is a test on the embedded files, so an Étape ticket that ports a Skill cannot bring back a `gh` read.

## Acceptance criteria

- [ ] `StepsService.start` creates the StepRun and its Session with the Rôle's Moteur and model from the effective Paramètres; event in the same transaction.
- [ ] A Session with the test Skill mounts it (Claude `--plugin-dir`, Codex `CODEX_HOME`: asserted on the fake binary's argv and env), and only it.
- [ ] `etape start` makes the StepRun `running` and prints its context; `etape report` sends figures and a sealed content that the browser's vault opens (vector test); an invalid report makes the StepRun `incomplete` with `report.schema`.
- [ ] At the Session's end the Contrat is checked and the verdict stored (`passed`, `incomplete` with the failed ids); a Session ending in error makes it `failed`.
- [ ] `GET /api/step-runs`: nominal matches `zStepRun`; 400 without a subject; 401; 404 for another Pilote's subject.
- [ ] A queued StepRun with the Runner offline is listed by the `step-runs` waiting-work provider.
- [ ] The test Skill's Session reads its Ticket through `mirror` (the fake `runner.sock` records no GitHub read through `gh`) and its comment through `mirror gh` refreshes the copy.
- [ ] `skills_test.go` fails on an embedded `SKILL.md` that contains `gh issue view`.

## Verification

- `pnpm exec nx test contracts -- src/contrats/`
- `pnpm exec nx test server -- src/steps/`
- `pnpm exec nx test-integration server -- steps`
- `cd apps/runner && go test ./internal/skills/ ./internal/session/ ./skills/ ./cmd/crewdeck-runner/`
- `pnpm exec nx run contracts:generate` then `git diff --exit-code`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The Skills and Contrats of the Étapes: IDEE-2 (idea-analysis), PROJET-4 (inventory), BOUCLE-3 (code), BOUCLE-4 (review), CONCEPTION-3 (prd), CONCEPTION-5 (mockups), CONCEPTION-7 (technical-design), CONCEPTION-8 (cross-review), CONCEPTION-9 (split).
- The Décisions raised from a StepRun and « Relancer l'Étape »: ATOI-2. Answering `etape ask` from the page: SESSION-3.
- The Miroir and its commands: MIROIR-1 to MIROIR-6; the shims: RUNNER-10.

## Dependencies

- RUNNER-9.
- RUNNER-10 (the `gh` and `mirror` shims).
- MIROIR-6 (the `mirror` commands).
- ATOI-3 (the `RunnerWaitingWork` registry).
