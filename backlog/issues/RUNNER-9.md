---
id: RUNNER-9
title: "Sessions: the Runner's clones and worktrees, local log, resume after a restart; the server's AgentSession"
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
---

## Context

Every Étape runs in a Session (glossary): one conversation of an agent in one Rôle, on the Runner, with one Moteur. The server decides what runs and asks the Runner to start it; the Runner keeps no Process state and asks, once restarted, what it was doing (ADR 0001). Agents work in the Runner's own clones, one worktree per Session, never in the Pilote's checkout (ADR 0004, risk AGT-1); the Session's content stays on the Runner, in its local log, replayed to a browser that opens it (ADR 0007). A Session stays « interrompue » while the Runner is offline until the Pilote resumes it (US-60). This ticket is the lifecycle; the content's encrypted relay is SESSION-1, the per-Session GitHub token RUNNER-10, the Skills RUNNER-12.

## Current state of the code

- Created by RUNNER-4: `apps/runner/internal/engine/` (`Engine`, `Run`, `StartOptions` with `PermissionMode`, `Registry`, the fake Engine); RUNNER-5/RUNNER-6: the adapters.
- Created by RUNNER-2: the protocol (`packages/contracts/src/runner/`, `hello` with `sessions` to add), `RunnerCommands.send`, the handler registry, presence hooks `onOnline`/`onOffline`, `apps/server/src/testing/fake-runner.ts`.
- Created by RUNNER-7: `internal/accounts/` (API keys for the adapters' env).
- Created by PROJET-2: `apps/server/src/projects/` (`Project` with its repository's owner, name and installation).
- Created by CORE-5: `EventsWriter`, `StateContributor`.
- No `AgentSession`, no `internal/session/`.

## To do

- **Contracts** `packages/contracts/src/runner/session.ts` (the « first file to imitate » of ADR 0001 for a protocol message):
  - server → Runner `session.start` `{ sessionId, projectId, repository: { owner, name }, branch, base, engine, model, role, permissionMode: 'auto'|'bypass', prompt: { kind: 'step', step, stepRunId } | { kind: 'none' }, title }`; `session.stop` `{ sessionId }`; `session.resume` `{ sessionId }`.
  - Runner → server `session.state` `{ sessionId, state: 'starting'|'active'|'waiting'|'stopped'|'interrupted'|'ended', outcome?: 'ok'|'error', error?: 'setup-failed'|'branch-busy'|'engine-failed'|'clone-failed', engineSessionId? }`.
  - `hello` gains `sessions: [{ sessionId, alive: boolean }]` (the Sessions the Runner knows).
  - `packages/contracts/src/api/sessions.ts`: `zAgentSession` `{ id, projectId, role, engine, model, title, state, outcome?, error?, stepRunId?, branch, startedAt, endedAt? }`.
- **Server** `apps/server/src/sessions/`:
  - Prisma `AgentSession` (`agent_sessions`): the fields above plus `pilotId`, `engineSessionId?`, `interruptedReason?` (`runner-offline`|`runner-restarted`); index (`pilotId`, `projectId`, `startedAt`).
  - `SessionsService.start(tx, { projectId, role, engine, model, title, branch, base, prompt, stepRunId? })`: creates the row `starting`, writes `agent-session.upserted`, and after commit sends `session.start` (Runner offline: the row stays `starting` and is sent when the Runner comes online, through `onOnline`). Permission mode from the Rôle: `code` and `review` → `bypass`, `idea` and `design` → `auto` (ADR 0004).
  - Handler of `session.state`: updates the row (state, outcome, error, `engineSessionId`, `endedAt`), event in the same transaction; emits an in-process `session.ended` hook for RUNNER-12 and the Boucle.
  - On the Runner's offline: every `starting`/`active`/`waiting` Session becomes `interrupted` (`runner-offline`). On `hello`: the others among `active`/`waiting` become `interrupted` (`runner-restarted`), and every `interrupted` Session stays so (US-60): the server sends `session.stop` for the ones the Runner reports `alive`, which keeps their resume id, and only `POST /api/sessions/:id/resume` continues them. This ticket owns these transitions (`SessionsService.interruptAll(tx, pilotId)` on `RunnerPresenceService.onOffline`); SESSION-2 only shows them.
  - Routes: `GET /api/sessions?projectId=…&cursor=…` (cursor, 50), `GET /api/sessions/:id`; `POST /api/sessions/:id/stop` body `{ seq }` (422 `sessions.not-running` if not `starting|active|waiting`); `POST /api/sessions/:id/resume` body `{ seq }` (422 `sessions.not-resumable` unless `stopped|interrupted`, 422 `runner.offline` when the Runner is offline). `StateContributor` key `sessions`: the Sessions not `ended`, and those ended in the last 24 h.
- **Runner** `apps/runner/internal/session/`:
  - `manager.go`: one goroutine per Session; handles `session.start|stop|resume`; reports `session.state`.
  - Clones `~/.crewdeck/repos/<owner>/<name>` (`git clone --filter=blob:none`, then `git fetch origin` before each Session) through a `TokenSource` interface (RUNNER-10 provides the real one; tests use local bare repositories over `file://`).
  - Worktree `~/.crewdeck/worktrees/<projectId>/<branch, "/" replaced by "__">`: `git worktree add -B <branch> <path> origin/<branch>` if the remote branch exists, else from `origin/<base>`. A live Session already on that worktree → `ended`/`error: 'branch-busy'`.
  - Reads `.process.json` of the worktree: runs `agentLoop.setupCmd` (`sh -c`, 15 min timeout, output to `~/.crewdeck/sessions/<id>/setup.log`) before the Moteur (failure → `setup-failed`), and `agentLoop.dropCmd` then `git worktree remove` when the Session ends; a stopped or interrupted Session keeps its worktree for the resume.
  - Session folder `~/.crewdeck/sessions/<id>/` (mode 700): `session.json` (engine, model, role, worktree, branch, `engineSessionId`, state), `log.jsonl` (each normalised event, with its `seq`, mode 600), the control socket of RUNNER-5.
  - `prompt.kind: 'step'`: the initial prompt is built by the Runner from the embedded template `apps/runner/internal/session/prompts/step.md` (« Run the Skill of the Étape <step> for the StepRun <stepRunId>. ») — RUNNER-12 completes it; `none` starts without a prompt.
  - Resume: `Engine.Resume` with the kept `engineSessionId`; the log continues with the next `seq`.
  - At start (`crewdeck-runner run`), the manager reads `~/.crewdeck/sessions/*/session.json` and reports them in `hello.sessions` (`alive: false` after a restart, since their processes died).
  - `log.go`: `Replay(sessionID, fromSeq) iter` for SESSION-1.
- **Fake Runner**: `apps/server/src/testing/fake-runner.ts` answers `session.start` with `active` then, per scenario, `ended`, and honours stop and resume.

## Decisions already made

- A Session's content (messages, tool calls, diffs) never goes to the server in this ticket: the log stays local; SESSION-1 relays it encrypted.
- No limit on concurrent Sessions in the Runner at the MVP, but one live Session per worktree (branch).
- The worktree is removed when the Session ends; the branch stays on the remote. A later Session on the same branch recreates it.
- The Session's title is readable (a Ticket's or Conception's title from GitHub, ADR 0003's table); nothing else free-form is in `session.start`.

## Acceptance criteria

- [ ] `SessionsService.start` writes the row and its event in one transaction and the Runner receives `session.start`; Runner offline, it is sent when the Runner connects.
- [ ] The Runner clones once, creates the worktree from the base branch (or the remote branch), runs `setupCmd`, starts the Moteur with the Rôle's permission mode, and reports `active` then `ended`; `dropCmd` runs and the worktree is removed (Go test with a bare repository and the fake Engine).
- [ ] `setupCmd` failing ends the Session with `setup-failed`; a second Session on a live branch ends with `branch-busy`.
- [ ] Stop then resume continues the same Moteur session (`Resume` called with the kept id) and the log's `seq` continues.
- [ ] The Runner going offline makes live Sessions `interrupted`; after a Runner restart, `hello` makes them `interrupted` (`runner-restarted`) and `resume` restarts them.
- [ ] Routes: nominal cases match `zAgentSession`; 400 with `fields`; 401; 404 for another Pilote's Session; 409 on a stale `seq`; 422 for `sessions.not-running`, `sessions.not-resumable`, `runner.offline`.
- [ ] Every new protocol message has its fixture, valid in TypeScript and Go.

## Verification

- `pnpm exec nx test contracts -- src/runner/`
- `pnpm exec nx test server -- src/sessions/`
- `pnpm exec nx test-integration server -- sessions`
- `cd apps/runner && go test ./internal/session/ -run .`
- `pnpm exec nx run contracts:generate` then `git diff --exit-code`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- Relaying a Session's content to the tabs, encrypted: SESSION-1. The Session panel: SESSION-2. Questions and permissions answered from the page: SESSION-3.
- The GitHub token used to clone and push: RUNNER-10. Mounting Skills and `crewdeck-runner etape`: RUNNER-12.
- The Décision « Ticket interrompu »: BOUCLE-7.

## Dependencies

- RUNNER-4.
- PROJET-2.
