---
id: RUNNER-22
title: "Handing a Session off on the Runner: its resume command per Moteur, the worktree kept, the command in the encrypted relay"
epic: RUNNER
type: feature
priority: P0
size: S
milestone: M4 Boucle
blocked_by: [RUNNER-6]
adr: [0003, 0004]
risques: [SEC-11]
stories: [US-113]
screens: []
revue_visuelle: false
video: false
---

## Context

US-113: « Continuer dans mon terminal » stops a **Session** and gives the **Pilote** the command that resumes it, in its worktree, on the **Runner**'s machine. This ticket is the Runner's half: each **Moteur** says how its Session resumes in a terminal, and the Runner hands a Session off (stops its Moteur, keeps the worktree, remembers the Session as handed off and relays the command). SESSION-5 is the server and the page; SESSION-6 gives the Session back.

The command is a line the Pilote pastes into their own shell. It holds the worktree's path, which is on the Pilote's machine: the server never sends it and never reads it (risk SEC-11, ADR 0003). The Runner builds it from its own record and sends it only through the encrypted relay of the Session (SESSION-1).

## Current state of the code

- `apps/runner/internal/engine/engine.go`: the `Engine` interface (`ID`, `Capabilities`, `Start`, `Resume`), `ResumeOptions{StartOptions, EngineSessionID}`; no notion of a terminal command. Claude's `Resume` in `apps/runner/internal/engine/claude/claude.go` runs `claude --resume <engineSessionId>` (spike: `docs/spikes/engines.md`, section 4). `engine/fake/fake.go` is the in-process Moteur of the fake Runner. `apps/runner/internal/engine/codex/` holds only recordings today.
- `apps/runner/internal/session/record.go`: `record` (`session.json`, mode 600) with `Worktree`, `EngineSessionID`, `Engine`, `State`. `manager.go`: `Stop` (interrupts the Moteur, the Session keeps its worktree and its Moteur's id), `halt`, `setState`, `report`, `Hello` (lists the Sessions not `ended`, `Alive` while their Moteur runs), `reviveLocked` (resumes a non-alive Session that is not `ended`), `end` and `finish` (Clean, worktree removed, `ended`); `step.go` `logEvent` writes an event in the Session's log and relays it sealed.
- `apps/runner/internal/protocol/machine.go`: `DescribeMachine` (`os.Hostname()`), the machine name the Runner already reports to the server.
- `packages/contracts/src/runner/session.ts`: `zSessionStop`, `zSessionResume`, `SESSION_STATES` (`starting`, `active`, `waiting`, `stopped`, `interrupted`, `ended`), `session.state`; `packages/contracts/src/runner/events.ts`: `zEngineEvent`, the discriminated union of the normalised events.
- Created by RUNNER-6: the Codex adapter (`apps/runner/internal/engine/codex/codex.go`). Created by RUNNER-20: the worktree's `Clean` hook, run before the worktree is removed.

## To do

- **Engine interface** (`apps/runner/internal/engine/engine.go`): `ResumeCommand(dir, engineSessionID string) (string, bool)`, a pure method: the shell line that resumes the Moteur's session in a terminal, `false` when the Moteur cannot (`no-terminal`). A shared helper `engine.ShellQuote(s string) string` (POSIX single quotes, a quote written `'\''`).
  - Claude: `cd '<dir>' && claude --resume <id>`; the id is checked against `^[A-Za-z0-9-]{1,64}$`, else `false`.
  - Codex (RUNNER-6's adapter): `cd '<dir>' && codex resume <id>`, same check. The form is confirmed at implementation against `codex resume --help` and the spike's notes (the spike did not run Codex): if it does not resume an `exec` thread, return `false` and say so in the PR.
  - The fake Moteur: a fixed `cd '<dir>' && fake-engine --resume <id>`; a flag on it (`NoTerminal`) makes it answer `false`, for the refusal's test.
  - A Moteur with no `engineSessionId` yet (the Session never produced a `result`): `false`.
- **Protocol** (`packages/contracts/src/runner/session.ts`, shared fixtures valid in TypeScript and Go, then `pnpm exec nx run contracts:generate` and commit what it writes):
  - server → Runner `session.hand-off { sessionId }` (`zSessionHandOff`);
  - Runner → server `session.hand-off.refused { sessionId, reason: 'no-terminal' | 'not-running' }`;
  - `SESSION_STATES` gains `handed-off`; `session.state` carries it (the server's `AgentSessionState` is SESSION-5's).
- **Normalised event** (`packages/contracts/src/runner/events.ts`): `handed-off { command: string, machine: string }` (with the common `seq`, `at`), added to `zEngineEvent` and its Go type. It is a Runner-made event, like the Étape's injected ones (`logEvent(..., injected: true)`).
- **Runner** `apps/runner/internal/session/handoff.go`, `Manager.HandOff(id string)`, registered next to `Stop` and `Resume` in `Register`:
  - unknown Session, or one `ended`: `session.hand-off.refused` `not-running`;
  - `cmd, ok := engine.ResumeCommand(record.Worktree, record.EngineSessionID)` on the Moteur of the record; `!ok`: `session.hand-off.refused` `no-terminal`, nothing stopped;
  - a Session whose Moteur runs: stopped as `Stop` does (interrupt, kill after `StopGrace`), waiting until `halt` ran; a resume still waiting for the worktree is cancelled as `Stop` does;
  - then record `State: handed-off` in `session.json` (mode 600, saved before anything is sent), append the `handed-off { command, machine }` event to the Session's log, relayed sealed like every event, then report `session.state` `handed-off` (with the `engineSessionId`). `machine` is `DescribeMachine`'s name.
  - A Session already `handed-off`: the event is not written again, the state is reported again, so a repeated message is harmless.
- **Never revived, never cleaned**: `reviveLocked` does nothing for a `handed-off` record, `Hello` lists it with `Alive: false`, and a restart of the Runner leaves it `handed-off`. RUNNER-20's cleanup and any removal of worktrees skip a worktree whose Session is `handed-off`: it is removed only when the Session ends (SESSION-6's `step.check` and `session.release`) or by an explicit `session.resume` (SESSION-6), which starts it again as a stopped Session. A `Stop` on a `handed-off` Session changes nothing.
- Tests: `engine/claude/claude_test.go` and `engine/codex/codex_test.go` (`ResumeCommand`: a path with a space and with a quote, an id with a shell metacharacter gives `false`), `session/handoff_test.go` on the fake Moteur (a running Session: Moteur stopped, record `handed-off`, one `handed-off` event in the log carrying the command and the machine, state reported; a Moteur with no terminal: refused, Session untouched, still running; a restart of the Manager over the same `Home`: still `handed-off`, not revived, in `Hello` as not alive; a repeated `session.hand-off`: one event).

## Decisions already made

- The command is built on the Runner and travels only inside the Session's encrypted log: the server's `session.hand-off` carries the Session's id and nothing else; the server stores no command, no path, and its `AgentSession` row has no worktree field (SEC-11: a compromised server cannot make the Pilote paste a command of its choosing, because it never provides one).
- The Moteur decides: `ResumeCommand` belongs to the adapter, not to a table in the session manager, so that a new Moteur brings its own line.
- A Session with no Moteur's id yet cannot be handed off: there is nothing for a terminal to resume. The Pilote stops it or waits for its first turn.
- Handed off is a state of the Session on the Runner, not a stop: it is not resumable by `session.resume`'s usual path and not revived after a restart, so that nothing works on the worktree while the Pilote does.
- The machine is named in the event (the Pilote may have several): the name the Runner already reports, never an address.

## Acceptance criteria

- [ ] `ResumeCommand` gives `cd '<dir>' && claude --resume <id>` for Claude and the confirmed Codex form, quoting a path with spaces and quotes; an id outside the allowed characters gives `false`.
- [ ] A running Session handed off: its Moteur stops, its worktree is untouched, `session.json` says `handed-off`, the log holds one `handed-off` event with the command and the machine name, and `session.state` `handed-off` reaches the server.
- [ ] A Moteur without a terminal, or a Session without a Moteur's id: `session.hand-off.refused` `no-terminal`, the Session keeps running.
- [ ] An `ended` or unknown Session: `session.hand-off.refused` `not-running`.
- [ ] After a Runner restart a `handed-off` Session stays so: not revived, its worktree still there, listed as not alive in the `hello`.
- [ ] The cleanup of RUNNER-20 and the worktree removal skip the worktree of a `handed-off` Session.
- [ ] The shared fixtures of `session.hand-off`, `session.hand-off.refused`, the `handed-off` event and `session.state` `handed-off` validate in TypeScript and Go.
- [ ] No message the server receives carries the command or the worktree's path (test on what `HandOff` sends: the state and the refusals only).

## Verification

- `cd apps/runner && go test ./internal/engine/... ./internal/session/ -run 'ResumeCommand|HandOff'`
- `cd apps/runner && go test ./internal/protocol/`
- `pnpm exec nx test contracts`, `pnpm exec nx run contracts:generate` with no diff
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The route, the server state `handed_off`, the Décision, the panel and the clipboard: SESSION-5.
- Giving the Session back (« Rendre la main », « Rendre à la Boucle »), the Contrat check on the kept worktree and releasing it: SESSION-6.
- The Runner's watchdog on a Session: RUNNER-21 (a handed-off Session is out of its sight).

## Dependencies

- RUNNER-6
