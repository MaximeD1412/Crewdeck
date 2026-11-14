---
id: RUNNER-9
title: "Sessions: the Runner's clones and worktrees of a GitHub Projet, local log, resume after a restart; the server's AgentSession"
epic: RUNNER
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-4, PROJET-2]
adr: [0001, 0004, 0007, 0008]
risques: [AGT-1]
stories: [US-9, US-60]
screens: []
revue_visuelle: false
video: false
reprend: 47
---

## Context

Every agent Étape runs in a Session (glossary): one conversation of an agent in one Rôle, on the Runner, with one Moteur. The server decides what runs and asks the Runner to start it; the Runner keeps no Process state and asks, once restarted, what it was doing (ADR 0001). Agents work in the Runner's own clones, one worktree per Session, never in the Pilote's checkout (ADR 0004, risk AGT-1); the Session's content stays on the Runner, in its local log, replayed to a browser that opens it (ADR 0007). A Session stays « interrompue » while the Runner is offline until the Pilote resumes it (US-60). This ticket is the lifecycle; the content's encrypted relay is SESSION-1, the per-Session GitHub token RUNNER-10, the Skills and the StepRun's verdict RUNNER-12.

The refonte (PRD #169, ADRs 0011 to 0014) changes two things here. There is no `.process.json` any more: the worktree's preparation and cleaning are the Projet's Commandes « Préparer le worktree » and « Nettoyer le worktree », sealed in its Paramètres (PARAM-3) and run by RUNNER-20 through the hooks this ticket leaves around each worktree. And a Projet's code may live on GitHub or in a Local folder (ADR 0012): this ticket handles the GitHub origin only, with an `origin` that SOURCE-2 extends with the Local one (the clone `~/.crewdeck/repos/local/<projectId>` whose `origin` is the folder).

## Current state of the code

- `apps/runner/internal/engine/engine.go` (RUNNER-4, merged): `Engine` with `Start(ctx, StartOptions{ Dir, Model, Role, PermissionMode, Env, SkillsDir, InitialPrompt, SessionDir, BinaryPath })` and `Resume(ctx, ResumeOptions{ StartOptions, EngineSessionID })`, `Run` (`Events()`, `Send`, `Answer`, `Interrupt`), `registry.go`; `internal/engine/fake/` (the fake Moteur binary), `internal/engine/claude/` (RUNNER-5). No Codex adapter yet (RUNNER-6).
- `apps/runner/internal/github/pulls.go`: the `TokenSource` interface (`Token(ctx) (string, error)`), used by the Contrats' `pr` rules.
- `apps/runner/internal/state/`: `runner.json` (`Server`, `RunnerID`, `Token`), the keys; `apps/runner/cmd/crewdeck-runner/run.go`: the running Runner.
- `packages/contracts/src/runner/`: `protocol.ts` (`PROTOCOL_VERSION = 1`; Runner→server `hello`, `heartbeat`, `capabilities`, `step.verdict`; server→Runner `hello.accepted`, `hello.rejected`, `heartbeat.ack`, `error`), `hello.ts` (no `sessions`), `envelope.ts` (`runnerMessage`); fixtures in `packages/contracts/fixtures/runner/`.
- `apps/server/src/runners/`: `RunnerCommands.send(pilotId, msg)` (422 `runner.offline`), `RunnerDispatcher.registerRunnerHandler(type, h)`, `RunnerPresenceService.onOnline/onOffline(pilotId, handler)`; `apps/server/src/testing/fake-runner.ts` (`FakeRunner`).
- `apps/server/src/realtime/`: `Transactions.run`, `EventsWriter.write(tx, pilotId, type, payload, { sourceAt, source })`, `STATE_CONTRIBUTORS`; the event resource `agent-session` is already in `RESOURCES` (`packages/contracts/src/events/index.ts`).
- Created by PROJET-2: `Project` (`apps/server/src/projects/`) with `owner`, `name`, `fullName`, `integrationBranch`, `releaseBranch` and its `Repository`.
- Created by PARAM-1: `AGENT_ROLES` / `zAgentRole` (`idea`, `design`, `code`, `review`) in `packages/contracts/src/values.ts` (if PARAM-1 has not merged when this ticket starts, this ticket adds them there with these values).
- No `AgentSession`, no `apps/server/src/sessions/`, no `apps/runner/internal/session/`, no clone nor worktree code in the Runner.

## To do

- **Contracts** `packages/contracts/src/runner/session.ts`, added to the unions of `protocol.ts`, one fixture per message in `packages/contracts/fixtures/runner/`:
  - server → Runner `session.start` `{ sessionId, projectId, origin: { kind: 'github', owner, name }, branch, base, engine, model, role: string (a Rôle id: `idea`, `design`, `code`, `review` or one the Pilote added, `r-…`, PARAM-2), permissionMode: 'auto'|'bypass', prompt: { kind: 'step', stepRunId, stepKind: zStepId } | { kind: 'none' }, title }`; `origin` is a discriminated union of one member here (SOURCE-2 adds `{ kind: 'local' }`). `session.stop` `{ sessionId }`; `session.resume` `{ sessionId }`.
  - Runner → server `session.state` `{ sessionId, state: 'starting'|'active'|'waiting'|'stopped'|'interrupted'|'ended', outcome?: 'ok'|'error', error?: 'setup-failed'|'branch-busy'|'engine-failed'|'clone-failed', engineSessionId? }`.
  - `hello` gains `sessions: [{ sessionId, alive: boolean }]` (the Sessions the Runner knows), optional so a Runner of the previous version still connects.
  - `packages/contracts/src/api/sessions.ts`: `zAgentSession` `{ id, projectId, role, engine, model, title, state, outcome?, error?, stepRunId?, branch, startedAt, endedAt? }`, the list output `{ items, nextCursor }`, the bodies `{ seq }` of stop and resume; `packages/contracts/src/events/agent-session.ts` registers its payload (`registerEventPayload('agent-session', zAgentSession)`).
- **Server** `apps/server/src/sessions/`:
  - Prisma `AgentSession` (`agent_sessions`, one migration): the fields above plus `pilotId`, `engineSessionId?`, `interruptedReason?` (`runner-offline`|`runner-restarted`); `stepRunId` is a plain nullable uuid with no foreign key (`step_runs` is PROCESS-4's, which points at the Session by its own `sessionId`); index (`pilotId`, `projectId`, `startedAt`).
  - `SessionsService.start(tx, { projectId, role, engine, model, title, branch, base, prompt, stepRunId? })`: the Projet must have a repository (else 422 `sessions.no-origin`, « Ce Projet n'a pas de dépôt pour les Sessions. »: a Local Projet's origin comes with SOURCE-2); creates the row `starting`, writes `agent-session.upserted` in the transaction, and after commit sends `session.start` with `origin` from the Projet's `owner` and `name` (Runner offline: the row stays `starting` and is sent when the Runner comes online, through `onOnline`). Permission mode from the Étape's kind, since a Rôle the Pilote added can play any part: a `step` prompt whose `stepKind` is `code`, `review` or `cross-review` → `bypass` (ADR 0004's Code and Review), every other kind and `prompt: { kind: 'none' }` → `auto`.
  - Handler of `session.state`: updates the row (state, outcome, error, `engineSessionId`, `endedAt`), event in the same transaction; calls the in-process hook `SessionHooks.onEnded(tx, session)` (in that transaction) for RUNNER-12 and the engine.
  - On the Runner's offline: every `starting`/`active`/`waiting` Session becomes `interrupted` (`runner-offline`) through `SessionsService.interruptAll(tx, pilotId)` on `RunnerPresenceService.onOffline`. On `hello`: the `active`/`waiting` ones become `interrupted` (`runner-restarted`), every `interrupted` Session stays so (US-60), the server sends `session.stop` for the ones the Runner reports `alive` (which keeps their resume id), and only `POST /api/sessions/:id/resume` continues them. This ticket owns these transitions; SESSION-2 only shows them.
  - Routes (`sessions.controller.ts`): `GET /api/sessions?projectId=…&cursor=…` (cursor, 50, newest first), `GET /api/sessions/:id`; `POST /api/sessions/:id/stop` body `{ seq }` (422 `sessions.not-running` « Cette Session ne tourne pas. » unless `starting|active|waiting`); `POST /api/sessions/:id/resume` body `{ seq }` (422 `sessions.not-resumable` « Cette Session ne peut pas être reprise. » unless `stopped|interrupted`, 422 `runner.offline` when the Runner is offline). French messages in `apps/server/src/errors/messages.ts`. `StateContributor` key `sessions`: the Sessions not `ended`, and those ended in the last 24 h.
- **Runner** `apps/runner/internal/session/`:
  - `manager.go`: one goroutine per Session; handles `session.start|stop|resume`; reports `session.state`.
  - `clone.go`: the clone of a GitHub origin `~/.crewdeck/repos/github/<owner>/<name>` (`git clone --filter=blob:none`, then `git fetch origin` before each Session), authenticated through a `github.TokenSource` given to the manager (RUNNER-10 provides the real one; tests use local bare repositories over `file://` and a token source that returns nothing). The clone is chosen by an `Origin` interface (`Clone(ctx) (dir string, err error)`) with the GitHub implementation here; SOURCE-2 adds the Local one.
  - Worktree `~/.crewdeck/worktrees/<projectId>/<branch, "/" replaced by "__">`: `git worktree add -B <branch> <path> origin/<branch>` if the remote branch exists, else from `origin/<base>`. A live Session already on that worktree → `ended`/`error: 'branch-busy'`.
  - `hooks.go`: `Hooks{ Prepare func(ctx, Worktree) error; Clean func(ctx, Worktree) error }` given to the manager, both nil (no-op) in this ticket. `Prepare` runs after the worktree is made and before the Moteur starts; its error ends the Session `ended`/`error: 'setup-failed'`. `Clean` runs when the Session ends, before `git worktree remove`; its error is logged (its kind, no content) and the worktree is removed anyway. RUNNER-20 fills them with the Projet's two Commandes.
  - Session folder `~/.crewdeck/sessions/<id>/` (mode 700): `session.json` (engine, model, role, origin, worktree, branch, `engineSessionId`, state), `log.jsonl` (each normalised event, with its `seq`, mode 600), the control socket of RUNNER-5.
  - `prompt.kind: 'step'`: the initial prompt is built by the Runner from the embedded template `apps/runner/internal/session/prompts/step.md` (« Run the Étape <stepKind> for the StepRun <stepRunId>. ») — RUNNER-12 completes it; `none` starts without a prompt.
  - Resume: `Engine.Resume` with the kept `engineSessionId`; the log continues with the next `seq`.
  - At start (`crewdeck-runner run`), the manager reads `~/.crewdeck/sessions/*/session.json` and reports them in `hello.sessions` (`alive: false` after a restart, since their processes died).
  - `log.go`: `Replay(sessionID, fromSeq) iter` for SESSION-1.
- **Fake Runner**: `apps/server/src/testing/fake-runner.ts` answers `session.start` with `active` then, per scenario, `ended`, and honours stop and resume.

## Decisions already made

- No `.process.json` is read, by the Runner nor by the server: the worktree's Commandes are RUNNER-20's, through `Hooks` (ADR 0011, « No more `.process.json` »). Until then a worktree gets no preparation.
- The GitHub clones live under `~/.crewdeck/repos/github/<owner>/<name>` rather than ADR 0004's `repos/<owner>/<name>`, so that they never collide with SOURCE-2's `repos/local/<projectId>` (a GitHub owner may be called `local`).
- `base` is the Projet's `integrationBranch` unless the caller gives another; the server sends it, the Runner never guesses a branch.
- A Session's content (messages, tool calls, diffs) never goes to the server in this ticket: the log stays local; SESSION-1 relays it encrypted.
- No limit on concurrent Sessions in the Runner at the MVP, but one live Session per worktree (branch).
- The worktree is removed when the Session ends; a stopped or interrupted Session keeps it for the resume. The branch stays on the remote; a later Session on the same branch recreates the worktree.
- The Session's title is readable for a GitHub Projet (a Ticket's or Conception's title from GitHub, ADR 0003's table); nothing else free-form is in `session.start`. A Local Projet's sealed title comes with SOURCE-2.

## Acceptance criteria

- [ ] `SessionsService.start` writes the row and its event in one transaction and the Runner receives `session.start` with the Projet's `origin`; Runner offline, it is sent when the Runner connects.
- [ ] A Projet without a repository gets 422 `sessions.no-origin` and no row.
- [ ] The Runner clones once under `repos/github/<owner>/<name>`, fetches before the next Session, creates the worktree from the base branch (or from the remote branch when it exists), starts the Moteur with the Rôle's permission mode, and reports `active` then `ended`; the worktree is removed (Go test with a bare repository and the fake Engine).
- [ ] A `Prepare` hook that fails ends the Session with `setup-failed` and the Moteur never starts; a `Clean` hook runs before the removal; with nil hooks nothing runs (a worktree holding a `.process.json` runs none of its commands).
- [ ] A second Session on a live branch ends with `branch-busy`.
- [ ] Stop then resume continues the same Moteur session (`Resume` called with the kept id) and the log's `seq` continues.
- [ ] The Runner going offline makes live Sessions `interrupted` (`runner-offline`); after a Runner restart, `hello` makes them `interrupted` (`runner-restarted`), and only `resume` restarts them.
- [ ] Routes: nominal cases match `zAgentSession`; 400 with `fields`; 401; 404 for another Pilote's Session; 409 on a stale `seq`; 422 for `sessions.not-running`, `sessions.not-resumable`, `runner.offline`.
- [ ] Every new protocol message has its fixture, valid in TypeScript and Go; a `hello` without `sessions` is still accepted.

## Verification

- `pnpm exec nx test contracts -- src/runner/`
- `pnpm exec nx test server -- src/sessions/`
- `pnpm exec nx test-integration server -- sessions`
- `cd apps/runner && go test ./internal/session/ -run .`
- `pnpm exec nx run contracts:generate` then `git diff --exit-code`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

A migration (`agent_sessions`), run by the deploy.

## Out of scope

- The Local origin, its clone with the folder as `origin` and its sealed title: SOURCE-2.
- « Préparer le worktree » and « Nettoyer le worktree » run in `Hooks`: RUNNER-20. The Serveurs MCP mounted per Session: RUNNER-17.
- Relaying a Session's content to the tabs, encrypted: SESSION-1. The Session panel: SESSION-2. Questions and permissions answered from the page: SESSION-3.
- The GitHub token used to clone and push: RUNNER-10. Mounting Skills, `crewdeck-runner etape` and the Contrat's verdict on the StepRun: RUNNER-12. The StepRun itself: PROCESS-4.
- The Décision « Ticket interrompu »: BOUCLE-7.

## Dependencies

- RUNNER-4.
- PROJET-2.
