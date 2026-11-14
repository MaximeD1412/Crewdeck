---
id: RUNNER-18
title: "Commandes on the Runner: command.run opened from the sealed part, run in the worktree or the Projet's place, exit code, 30 min timeout, output relayed encrypted"
epic: RUNNER
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-9, SESSION-1]
adr: [0013, 0011, 0003]
risques: [SEC-11]
stories: [US-104]
screens: []
revue_visuelle: false
video: false
---

## Context

US-104: an Étape Commande runs a command of the Pilote's choice on their Runner's machine, in the Projet's folder or the Ticket's worktree, its verdict being its exit code (and, if given, a health address: RUNNER-19), its output readable like a Session's. ADR 0013, « A Commande »: the text is sealed in the Process's version, with its place (`where`); the server sends `command.run { runId, projectId, commandId, sealed, ref }`, the Runner opens the sealed part, checks it names this Projet and this `commandId`, and runs only what it opened, where it says (ADR 0011, « What the server reads of a Process »: a compromised server cannot forge a Commande, risk SEC-11). It runs `$SHELL -lc` as the Pilote, in its own process group, one run per Projet and Commande; its output streams encrypted like a Session's and stays in `~/.crewdeck/commands/<runId>.log` for 30 days; the verdict carries figures only. This ticket is the Runner's execution and the protocol; the `command` kind handler, `command_runs`, the Décisions `command.failed` and `command.timeout` and the output's screen are PROCESS-12; the health address and services RUNNER-19; the worktree's preparation RUNNER-20; the `checks` Étape BOUCLE-9.

## Current state of the code

- `apps/runner/internal/keys/vault.go`: `Vault.OpenItem(SealedItem{ Key, Ciphertext }, aad)` (AES-256-GCM, the item key sealed under the vault key); `apps/runner/cmd/crewdeck-runner/vault.go`: `openVault(store)` from `runner.key` and `vault.wrap`.
- `apps/runner/internal/protocol/client.go`: `Client.Handle(type, handler)`, `protocol.On[T]`, `Client.Send`; `messages.go` the type constants.
- `apps/server/src/runners/runner-commands.service.ts`: `RunnerCommands.send(pilotId, message)` (422 `runner.offline`); `runner-dispatcher.ts`: `registerRunnerHandler(type, handler)`; `apps/server/src/testing/fake-runner.ts`.
- Created by RUNNER-9: `session.start`'s `origin` union (`{ kind: 'github', owner, name }`, in `packages/contracts/src/runner/session.ts`), the `Origin` interface and GitHub clones of `apps/runner/internal/session/clone.go`, the worktrees `~/.crewdeck/worktrees/<projectId>/<branch, "/" → "__">`, one live Session per worktree, the worktree `Hooks { Prepare, Clean }` (no-op).
- Created by SESSION-1: the Session relay (`packages/contracts/src/runner/relay.ts`: `session.open|close|replay`, `session.keys { wraps }`, `relay { seq, nonce, ciphertext }`, `session.error`), `SessionRelay` (`apps/server/src/sessions/relay/`), the Runner's `internal/session/relay.go` (a key per Session wrapped for each key holder of the authenticated list), the browser's `apps/web/src/sessions/relay.ts`.
- No `internal/command/`, no command execution anywhere in the Runner.

## To do

- **Contracts** `packages/contracts/src/runner/command.ts`, fixtures `packages/contracts/fixtures/runner/command/`, all in the protocol's unions, then `pnpm exec nx run contracts:generate`:
  - `zSealedCommands`, the plaintext of a version's sealed part (ADR 0011): `{ commands: Record<commandId, { run: string (1..10000), where: 'project'|'worktree', healthUrl?: url } > }` (PROCESS-12's page seals it, the Runner opens it).
  - server → Runner `command.run { runId, projectId, commandId, sealed: zSealedItem { key, ciphertext }, origin (RUNNER-9's union, moved to `packages/contracts/src/runner/origin.ts` and imported by both messages), integrationBranch, ref: { stepId, ticket: int|null, branch: string|null, sha: string|null } }`, `command.stop { runId }`.
  - Runner → server `command.started { runId }`, `command.verdict { runId, passed, exitCode: int|null, reason: 'exited'|'timeout'|'stopped'|'busy'|'sealed-invalid'|'place-unavailable'|'spawn-failed', durationMs }`.
  - The output, as SESSION-1's frames: tab → server `command.open { runId, fromSeq }`, `command.close { runId }`; server → Runner `command.replay { runId, tabId, fromSeq }`; Runner → server and server → tab `command.keys { runId, tabId?, wraps }`, `command.output { runId, tabId?, seq, nonce, ciphertext }`; server → tab `command.error { runId, code: 'command.not-found'|'command.runner-offline' }`. The plaintext of an output frame is `{ stream: 'stdout'|'stderr', text, at }`, additional data `command:<runId>:<seq>`.
- **Runner** `apps/runner/internal/command/`:
  - `sealed.go`: opens `sealed` with the vault, additional data `process:<projectId>` of the message's own `projectId`; a failure to open, a plaintext outside `zSealedCommands`, or no entry for `commandId` → verdict `sealed-invalid` and nothing runs. The `where` and the text used are the opened ones, never a field of the message.
  - `place.go`: `worktree` is the Ticket's worktree (`ref.branch`) at `ref.sha`, through RUNNER-9's `Origin` and worktree code: absent, it is created detached at `ref.sha` after a `git fetch origin` (its `Hooks` run as for a Session) and removed after the run as a Session's is; present with no live Session (a stopped Session's), it is used if its `HEAD` is `ref.sha`; held by a live Session, or at another SHA → `place-unavailable`. `project` is the origin's folder when it has one, else the checkout `~/.crewdeck/worktrees/<projectId>/integration` (created detached; before each run `git fetch origin`, `git checkout --detach --force <ref.sha or origin/<integrationBranch>>`, `git clean -fd`, so ignored files such as dependencies stay). An origin the Runner has no `Origin` for (Local before SOURCE-2) answers `place-unavailable`. A worktree is held by one Session or one run at a time.
  - `run.go`: `$SHELL -lc '<run>'` (`/bin/sh -lc` when `SHELL` is unset or empty), in the place, with the Runner's environment plus `CREWDECK_PROJECT` (projectId), `CREWDECK_STEP` (`ref.stepId`), `CREWDECK_TICKET`, `CREWDECK_BRANCH`, `CREWDECK_SHA` (empty when null); `Setpgid`, so the whole group is signalled; stdin `/dev/null`. One run per (`projectId`, `commandId`): a second `command.run` while one runs gets `busy` at once. Verdict `exited` with its `exitCode`, `passed` when 0. After 30 min, or on `command.stop`: SIGTERM to the group, SIGKILL after 10 s, verdict `timeout` (`exitCode` null) or `stopped`. A shell that cannot start → `spawn-failed`. `command.started` is sent once the process started.
  - `log.go`: `~/.crewdeck/commands/<runId>.log` (folder mode 700, file mode 600), one JSON line per chunk `{ seq, at, stream, text }` (a chunk is what a read gave, at most 16 KiB, lines never split across two streams' chunks); files older than 30 days removed at the Runner's start and every 24 h. `Replay(runId, fromSeq)`.
  - `relay.go`: the run's key, wrapped for each key holder as a Session's, each chunk sent live as `command.output`, `command.replay` answered with `command.keys` then the logged chunks from `fromSeq`; the code shared with `internal/session/relay.go` moves to `apps/runner/internal/relay/` (seal, wraps, replay) and both use it.
  - Wired in `cmd/crewdeck-runner/run.go` (`command.run`, `command.stop`, `command.replay` handlers).
- **Server** `apps/server/src/commands/`:
  - `CommandRuns.send(pilotId, run)` sending `command.run` through `RunnerCommands.send` (422 `runner.offline`), and `stop(pilotId, runId)`.
  - Handlers of `command.started` and `command.verdict` that emit the in-process hooks `command-run.started` and `command-run.finished` (`{ pilotId, runId, passed, exitCode, reason, durationMs }`): PROCESS-12 stores them; nothing is written here.
  - The relay of the output beside `SessionRelay` (the same in-memory tab registry, never written, never logged): `command.open` is accepted for a run the provider `COMMAND_RUN_OWNERS` (`owns(pilotId, runId)`) says is the Pilote's, else `command.error command.not-found`; its default implementation knows the runs `CommandRuns.send` sent since the process started, and PROCESS-12 binds it to `command_runs`. Runner offline → `command.runner-offline`.
- **Browser** `apps/web/src/commands/output.ts`: `openCommandOutput(runId)` decrypting the chunks into an ordered buffer as `apps/web/src/sessions/relay.ts` does (in memory only), `closeCommandOutput(runId)`.
- **Fake Runner** (`fake-runner.ts`): answers `command.run` with `command.started`, two output chunks and a verdict chosen by the scenario.
- `docs/security/e2e.md`: the « Commandes » section (the sealed part opened on the Runner only, the frames, the additional data); `docs/pilotage/risques.json`: SEC-11's solution « Le Runner n'exécute que ce qu'il a ouvert » ticked.

## Decisions already made

- The Runner trusts nothing of the message but the ids: the text and the place come from the sealed part it opened for this Projet (ADR 0011). Replaying a Commande of an older version of the same Projet stays possible and is accepted (ADR 0011).
- The Commande runs with the Pilote's own environment and secrets (their login shell, the folder's `.env` if their command reads it): the Runner adds only the `CREWDECK_*` variables and keeps no secret (ADR 0013).
- `busy` rather than a queue: the engine never asks a second run of the same Commande on the same Projet, so one arriving means a retry raced; it is refused, not run twice.
- The output is content: never in a server log, a table, an event nor the verdict (ADR 0003). The verdict's figures (exit code, reason, duration) are readable.
- The chunks follow the Session's relay to the letter (a key per run, wraps for the authenticated holders, additional data with the sequence), so that PROCESS-12 reads it with SESSION-2's panel.

## Acceptance criteria

- [ ] A `command.run` whose sealed part opens with `process:<projectId>` runs its text in a temporary git repository (`sh -c` exit 0 → `passed: true`, `exited`, `exitCode: 0`; `exit 3` → `passed: false`, `exitCode: 3`).
- [ ] The same sealed part sent with another `projectId`, a tampered ciphertext, or a `commandId` it does not hold → `sealed-invalid`, and no process is started (asserted on a marker file the command would write).
- [ ] `where: worktree` runs at `ref.sha` in the Ticket's worktree, created then removed; a live Session on that worktree → `place-unavailable`. `where: project` on a GitHub Projet runs in the integration checkout moved to `ref.sha`, an ignored file left in it kept between two runs.
- [ ] The environment holds the five `CREWDECK_*` variables; `SHELL` unset runs `/bin/sh -lc`.
- [ ] A command still running after the timeout (fake clock) has its whole group killed, a child process included, and gives `timeout`; `command.stop` gives `stopped`; a second run of the same Commande while one runs gives `busy`.
- [ ] The log file is mode 600, replays from `fromSeq`, and files older than 30 days are removed at start.
- [ ] A tab that sends `command.open` gets `command.keys` then the chunks, decrypted in the browser; a frame with another `seq` fails to decrypt; another Pilote's run gives `command.not-found`; the server writes nothing and logs no `ciphertext` while relaying.
- [ ] Every new message has its fixture, valid in TypeScript and Go.

## Verification

- `cd apps/runner && go test ./internal/command/ ./internal/relay/ ./internal/session/`
- `pnpm exec nx test contracts -- src/runner/`
- `pnpm exec nx test server -- src/commands/ src/sessions/relay/`
- `pnpm exec nx test web -- src/commands/`
- `pnpm exec nx run contracts:generate` with no diff, then `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The health address, the services and their stop: RUNNER-19. « Préparer le worktree » and « Nettoyer le worktree »: RUNNER-20.
- The page sealing a Commande, the `command` kind handler, `command_runs`, the Décisions `command.failed` and `command.timeout`, the output's screen: PROCESS-12. The `checks` Étape: BOUCLE-9.
- A Local Projet's clone and folder (the origin `local`): SOURCE-2.

## Dependencies

- RUNNER-9.
- SESSION-1.
