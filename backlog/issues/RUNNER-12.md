---
id: RUNNER-12
title: "Official Skills embedded in the Runner, crewdeck-runner etape, and the agent Étapes' Sessions with their Contrat verdict on the StepRun"
epic: RUNNER
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-9, RUNNER-10, MIROIR-6, ATOI-3, PROCESS-4]
adr: [0004, 0005, 0003, 0007, 0010, 0011]
risques: [IA-6, AGT-7]
stories: [US-48]
screens: []
revue_visuelle: false
video: false
reprend: 50
---

## Context

Each agent Étape of a Projet's Process is done by a Skill, the official one at the MVP, in the `SKILL.md` format Claude Code and Codex read; the Skills ship inside the Runner's release (`go:embed`) so that a Skill and the checker of its Contrat always share the Runner's version (ADR 0004). The commands the dotfiles Skills call (`design`, `ideas`, `agent-loop`) become `crewdeck-runner etape <verb>`, which talk to the server. This ticket builds that mechanism once for every agent Étape; each Étape ticket ports its Skill from the founder's dotfiles repository (`MaximeD1412/dotfiles`, `agents/skills/<name>/`), writes its Contrat and registers its kind.

The refonte (PRD #169, ADR 0011) changes where a run of an Étape lives: the server interprets the Projet's pinned version, and a pass of an Étape is a row of PROCESS-4's `step_runs` (its PhaseRun, `stepId`, `kind`, `iteration`, state, outputs, verdict, `sessionId`), started by the kind handler of its `kind`. This ticket no longer creates a StepRun table nor a `STEPS` list (the catalogue of PROCESS-1 gives each kind its default Rôle, Skill and Contrat); it gives the agent kinds one way to start their Session from the Étape's Outils, to carry its Entrées to the Skill, and to write the Contrat's verdict on the StepRun. The agents read the state of the work through the Miroir (`mirror`, the Session's shim of RUNNER-10, in `gh`'s shapes, MIROIR-6) and, for every Source, write through it (`miroir issue|pr …`, MIROIR-7, ADR 0012): no Skill reads nor writes GitHub with `gh`.

## Current state of the code

- `packages/contracts/src/contrats/` (RUNNER-11, merged): `define.ts` (`defineContrat`, `STEP_IDS`, `zStepId`, `zContrat`, `zRule`, `zVerdict` `{ contractId, version, status, failedRuleIds, warningRuleIds, headSha? }`), `index.ts` (the registry), `checks/`, `rules/`; `apps/runner/internal/contrat/` (`Check(ctx, Contrat, Target)`, `Target` with `PR *PullRequest` read from GitHub by `internal/github/pulls.go`); the `step.verdict` message `{ stepRunId, verdict }` (`packages/contracts/src/runner/step.ts`), which no server code handles yet.
- `apps/runner/internal/keys/` (E2E-2, merged): the Runner's vault, which seals a report's content.
- `apps/runner/internal/engine/claude/` (RUNNER-5, merged): `StartOptions.SkillsDir`; by RUNNER-6, the Codex adapter.
- Created by RUNNER-9: `apps/server/src/sessions/` (`AgentSession` with a plain `stepRunId`, `SessionsService.start` with `prompt: { kind: 'step', stepRunId, stepKind }`, `SessionHooks.onEnded`), `apps/runner/internal/session/` (clone, worktree, `Hooks`, Session folder, control socket, `prompts/step.md`).
- Created by RUNNER-10: the Session's `gh` and `mirror` shims, `CREWDECK_SESSION_ID`, the Miroir's refresh after a write; by MIROIR-6: `crewdeck-runner miroir` (`issue|pr view|list`, `ready`, `search`, `sql`) and `runner.sock` (`mirror.fetch`).
- Created by PROCESS-1: `packages/contracts/src/process/catalogue.ts` (each kind's family, ports, capabilities, judges, default Rôle, Skill and Contrat), `STEP_IDS` taken from it; `definition.ts` (an Étape's `tools`: `{ kind: 'role', roleId }`, `{ kind: 'skill', skillId }`, …).
- Created by PROCESS-4: `apps/server/src/process/engine/` (`step_runs`, the registry `engine/kinds/` of `StepKindHandler { kind, start, onSignal }`, the Entrées resolved for a StepRun, the events `phase-run`, `step-run`).
- Created by PARAM-1 and PARAM-2: `SettingsService.effective(pilotId, projectId?)` with each Rôle's Moteur and model; by ATOI-3: `apps/server/src/runners/waiting-work.ts` (`RunnerWaitingWork`).
- No `apps/runner/skills/`, no `crewdeck-runner etape`.

## To do

- **Contracts**:
  - `packages/contracts/src/runner/session.ts` (RUNNER-9's): the `step` prompt gains `skill`, `contractId: string | null` and `inputs: [{ portId, type: ArtifactType, ref: { id, number?, sha? } | null }]` (`null`: the Entrée « absente », ADR 0011); references only, never content. `session.start` gains `mcpServers: string[]` (the names of the Étape's `mcp` Outils, `[]` when none; RUNNER-17 mounts them, this ticket only carries them).
  - `packages/contracts/src/runner/step.ts`: `step.started` `{ stepRunId }`; `step.report` `{ stepRunId, figures: object, sealed?: string }` (`figures` readable, validated by the server against the report schema its kind registers; `sealed` an opaque ciphertext made by the Runner's vault, stored by the kind's module when it needs it); `step.ask` is a normalised `question` event in the Session's stream (no new message). Fixtures for both in `packages/contracts/fixtures/runner/`.
- **Server** `apps/server/src/process/engine/kinds/agent.ts`:
  - `defineAgentKind({ kind, title(ctx), branch(ctx), outputs(ctx): ArtifactRef[] })` returns a `StepKindHandler` for PROCESS-4's registry; the Étape tickets (IDEE-2, PROJET-4, BOUCLE-3, BOUCLE-4, CONCEPTION-3, 5, 7, 8, 9) each call it for their kind.
  - Its `start(tx, ctx)`: the Rôle from the Étape's `role` Outil of the pinned definition, the Skill from its `skill` Outil else the catalogue's default, the Contrat id from the catalogue; the Moteur and model from `SettingsService.effective(pilotId, projectId).roles[role]`; then `SessionsService.start({ …, mcpServers, prompt: { kind: 'step', stepRunId, stepKind, skill, contractId, inputs } })` (`mcpServers` the `name` of each `{ kind: 'mcp' }` Outil of the Étape, in its order; the Entrées PROCESS-4 resolved), `SessionsService.start` gaining `mcpServers: string[]` and passing it in `session.start` and `base` the Projet's integration branch; writes the Session's id on the StepRun.
  - Signals given to `onSignal`: `step.started` or the Session's `active` → the StepRun running; `step.report` → `registerStepReport`'s handler; `step.verdict` → the Contrat's verdict written to PROCESS-4's `step_runs.contratVerdict` with its `step-run.upserted` event in the transaction; the Session's end (`SessionHooks.onEnded`).
  - The outcome, once the Session ended: a verdict `passed` → the StepRun passes with `outputs(ctx)`; a verdict `incomplete` → `{ state: 'failed', failure: 'contract-incomplete' }`, `contratVerdict` saying which rules; `outcome: 'error'` → `failure: 'session-error'`; stopped by the Runner → `failure: 'session-stopped'`; `ok` with `contractId: null` → it passes. The handler returns that `StepResult` from `onSignal` and PROCESS-4's engine writes it (`state`, `failure`, `outputs`) and feeds the next Entrées; the Session's id goes to PROCESS-4's `step_runs.sessionId`. No column is added: `failure`, `contratVerdict` and `sessionId` are PROCESS-4's. In the same transaction it calls `StepRunHooks.onFinished(tx, stepRun, { status: 'passed'|'incomplete'|'failed', verdict?, failure? })` for ATOI-2.
  - `registerStepReport(kind, zodSchema, handler)`: the kind's module validates `figures` and stores them (and `sealed`) with its own model; an invalid report fails the StepRun as `incomplete` with the rule id `report.schema`.
  - A `RunnerWaitingWork` provider `step-runs`: the Projets with an agent StepRun whose Session is `starting` (the Runner offline).
- **Runner**:
  - `apps/runner/skills/` with `embed.go` (`//go:embed */SKILL.md */**`), `README.md` (one folder per Skill, named as the catalogue's Skill ids; how a Skill calls `crewdeck-runner etape`; the rule « read and write through `mirror` »: `mirror issue view <n> --json …`, `mirror pr view`, `mirror ready`, `mirror search` for the Tickets, changes of code, checks and documents of any Source; `mirror issue|pr create|edit|comment|close|reopen|review` for every write; a direct `gh` call is never used); a test Skill `apps/runner/internal/skills/testdata/crewdeck-test/SKILL.md` for the tests only, which reads its Ticket with `mirror issue view <n> --json title,body,labels` and reports with `crewdeck-runner etape report`.
  - `apps/runner/skills/skills_test.go`: no embedded `SKILL.md` calls `gh` (outside `mirror`), nor `mirror gh issue|pr create|edit|comment|close|reopen|review` (MIROIR-7's commands cover them).
  - `apps/runner/internal/skills/mount.go`: per Session, Claude: write `~/.crewdeck/sessions/<id>/plugin/.claude-plugin/plugin.json` (`{ "name": "crewdeck", "version": "<runner version>" }`) and `plugin/skills/<skill>/…`, passed as `--plugin-dir`; Codex: `~/.crewdeck/sessions/<id>/codex-home/skills/<skill>/…` and the `config.toml` the spike recorded, passed as `CODEX_HOME`. Only the Skill of the Session's Étape is mounted; an unknown Skill id ends the Session `ended`/`error: 'setup-failed'`.
  - `prompts/step.md` completed: « Use the Skill `<skill>`. Your StepRun is `<stepRunId>`; start with `crewdeck-runner etape start`. »
  - `crewdeck-runner etape start` (inside a Session, found through `CREWDECK_SESSION_ID` and the control socket): sends `step.started` and prints the Étape's context as JSON (`stepRunId`, `stepKind`, `skill`, `contractId`, `projectId`, `origin`, `branch`, `base`, `inputs`).
  - `crewdeck-runner etape report [--file <path>|-]`: reads `{ figures, content? }`, seals `content` with the vault into `sealed`, sends `step.report`.
  - `crewdeck-runner etape ask --question <json>`: emits a normalised `question` in the Session's stream and blocks until its answer arrives on the control socket (SESSION-3 answers it from the page).
  - At the Session's end, before RUNNER-9's `Clean` hook and the worktree's removal, if the prompt has a `contractId`: `contrat.Check` on the worktree and the Session's change of code, read from the Miroir (`mirror.fetch` of the change on the Session's branch, then its row) instead of `pulls.go`'s REST read, so that one Contrat reads any Source; then `step.verdict`.

## Decisions already made

- Skill names are the catalogue's default Skill per kind (PROCESS-1), identical: `idea-analysis`, `inventory`, `product-design` (prd), `visual-design` (mockups), `technical-design`, `cross-review`, `plan-backlog` (split), `code`, `review`; each Étape ticket creates `apps/runner/skills/<skill>/` with that name, and a test checks that every `skill` of `CATALOGUE` has its embedded folder once the Étape tickets have landed (a missing one is listed, not failed, until then). An Étape's `skill` Outil may name another embedded Skill; the Pilote's own Skills are not at the MVP.
- Only the Session's own Skill is mounted, so an agent cannot wander into another Étape's method.
- A report's `figures` are what the server may read (ADR 0003's left column: ids, states, figures); any free text goes in `content`, sealed. The Étape's ticket decides which is which.
- The Entrées reach the Skill as references (ids, numbers, SHAs); the Skill reads their content through `mirror` at that SHA. An Entrée `null` is « absente »: the Skill and the Contrat say what it means.
- `incomplete` and `failed` are both a failed StepRun for the engine (no Retour is taken: only a Verdict « changements » takes one, PROCESS-6); ATOI-2 tells them apart through `failure` and `contratVerdict`. `step_runs.verdict` (`passed|changes|failed`) is the judging Étape's Verdict (PROCESS-4, PROCESS-6), never the Contrat's.
- Rerunning a StepRun (« Relancer l'Étape ») is ATOI-2's.
- The Skills read and write through `mirror` only: one channel for the agents, for every Source (ADRs 0010, 0012); the guard is a test on the embedded files, so an Étape ticket that ports a Skill cannot bring back a `gh` call.

## Acceptance criteria

- [ ] A StepRun of a kind defined with `defineAgentKind` starts its Session with the Rôle of the Étape's `role` Outil and the Moteur and model of the effective Paramètres; a `skill` Outil overrides the catalogue's Skill; the Session's id is on the StepRun, the event in the same transaction.
- [ ] `session.start` carries the StepRun's resolved Entrées, an absent one as `null`, and `etape start` prints them; an Étape with the Outils `mcp` « stitch » and « figma » sends `mcpServers: ['stitch', 'figma']`, one without sends `[]`.
- [ ] A Session with the test Skill mounts it (Claude `--plugin-dir`, Codex `CODEX_HOME`: asserted on the fake binary's argv and env), and only it.
- [ ] `etape start` makes the StepRun running; `etape report` sends figures and a sealed content that the browser's vault opens (vector test); an invalid report makes the StepRun `incomplete` with `report.schema`.
- [ ] At the Session's end the Contrat is checked (the change read from the Miroir) and `step.verdict` writes `step_runs.contratVerdict`: `passed` finishes the StepRun with its outputs and the engine feeds the next Étape; `incomplete` fails it with the failed rule ids; a Session ending in error fails it with `session-error`; each case calls `StepRunHooks.onFinished` once.
- [ ] A Session start with the Runner offline is listed by the `step-runs` waiting-work provider.
- [ ] The test Skill's Session reads its Ticket through `mirror` (the fake `runner.sock` records the read, no `gh` call is made).
- [ ] `skills_test.go` fails on an embedded `SKILL.md` that contains `gh issue view` or `mirror gh issue comment`.

## Verification

- `pnpm exec nx test contracts -- src/runner/`
- `pnpm exec nx test server -- src/process/engine/kinds/`
- `pnpm exec nx test-integration server -- process`
- `cd apps/runner && go test ./internal/skills/ ./internal/session/ ./internal/contrat/ ./skills/ ./cmd/crewdeck-runner/`
- `pnpm exec nx run contracts:generate` then `git diff --exit-code`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the tables are PROCESS-4's; the Skills ship inside the Runner's release).

## Out of scope

- The `step_runs` table, the kind registry, the Entrées' resolution and the version pinned: PROCESS-4. Retours: PROCESS-6.
- The Skills, Contrats and kinds of the Étapes: IDEE-2 (idea-analysis), PROJET-4 (inventory), BOUCLE-3 (code), BOUCLE-4 (review), CONCEPTION-3 (prd), CONCEPTION-5 (mockups), CONCEPTION-7 (technical-design), CONCEPTION-8 (cross-review), CONCEPTION-9 (split).
- The Décisions raised from a StepRun and « Relancer l'Étape »: ATOI-2. Answering `etape ask` from the page: SESSION-3.
- The Miroir's reads: MIROIR-1 to MIROIR-6; its writes: MIROIR-7; the shims: RUNNER-10. The Serveurs MCP of the Étape: RUNNER-17.

## Dependencies

- RUNNER-9.
- RUNNER-10 (the `gh` and `mirror` shims).
- MIROIR-6 (the `mirror` commands).
- ATOI-3 (the `RunnerWaitingWork` registry).
- PROCESS-4 (`step_runs` and the kind registry).
