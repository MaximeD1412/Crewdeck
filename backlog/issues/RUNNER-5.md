---
id: RUNNER-5
title: "Claude Code adapter: stream-json, permission prompt tool, AskUserQuestion hook, interrupt and resume"
epic: RUNNER
type: feature
priority: P0
size: M
milestone: M2 Runner and Projets
blocked_by: [RUNNER-4]
adr: [0004]
risques: [IA-1, IA-3]
stories: [US-9, US-38, US-40, US-55]
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0004, « Claude Code »: the unmodified `claude` binary driven with `-p --input-format stream-json --output-format stream-json --verbose`, `--model`, `--resume`; permission requests through `--permission-prompt-tool` on an MCP server the Runner serves to the Session; `AskUserQuestion` held by a `PreToolUse` hook and answered through the same channel. Compte IA: the Pilote's own sign-in to the binary, or an API key. No Agent SDK. The exact behaviours are those RUNNER-1 recorded in `docs/spikes/engines.md`.

## Current state of the code

- Created by RUNNER-4: `apps/runner/internal/engine/engine.go` (`Engine`, `Run`, `StartOptions`, `ResumeOptions`, `Answer`, `Registry`), the fake binary `internal/engine/fake/cmd/fake-engine`, `internal/engine/enginetest/replay.go`, `packages/contracts/src/runner/events.ts` and `engines.ts`.
- Created by RUNNER-1: `docs/spikes/engines.md` and `apps/runner/internal/engine/claude/testdata/*.jsonl` (one recording per scenario).
- No `internal/engine/claude/`.

## To do

- `apps/runner/internal/engine/claude/claude.go`: `Engine` with `ID() = "claude-code"`, `BinaryPath` (default `claude` on `PATH`), `KnownVersions` (the range of the version RUNNER-1 recorded).
  - `Start`: runs `claude -p --input-format stream-json --output-format stream-json --verbose --model <m> --permission-mode <mode> --plugin-dir <SkillsDir> --mcp-config <file> --permission-prompt-tool mcp__crewdeck__permission --settings <file>` in `Dir` with `Env` (an API key is passed as `ANTHROPIC_API_KEY` only when the Compte IA is an API key); the mode is `bypassPermissions` for `PermissionMode: 'bypass'` and the flag `docs/spikes/engines.md` gives for `auto`. Writes the initial prompt and each `Send` as a stream-json user message on stdin.
  - `Resume`: the same with `--resume <EngineSessionID>`.
  - Parser `parse.go`: each stdout line → zero or more normalised events following the spike's mapping (`system` init → nothing but the session id kept; `assistant` text → `message`; `tool_use` → `tool-call`; `tool_result` → `tool-result`; `result` → `usage` and `result` with `engineSessionId` and `costUsdMicros` from `total_cost_usd`; rate-limit and auth events → `limit-reached`, `auth-required`). `raw` holds the line.
  - `Interrupt`: the interrupt the spike validated (control message on stdin, else SIGINT), then `result { status: 'interrupted' }`.
- `apps/runner/internal/engine/claude/permission/`: the MCP server answering `permission` (stdio MCP, JSON-RPC 2.0, one tool `permission` with the schema Claude Code expects): `crewdeck-runner mcp permission --session <id>` (a hidden cobra command) forwards each request over the Session's control socket `~/.crewdeck/sessions/<id>/control.sock` to the adapter, which emits `permission-request` and waits, without timeout, for `Answer`; the reply is `{ behavior: 'allow', updatedInput }` or `{ behavior: 'deny', message }`.
- `apps/runner/internal/engine/claude/hook/`: `crewdeck-runner hook pre-tool-use --session <id>` (hidden): for `AskUserQuestion`, forwards the question over the control socket, the adapter emits `question`, and the hook prints the output the spike recorded so that Claude receives the Pilote's answer; for any other tool it exits 0 with no output.
- The adapter writes the Session's `mcp-config` and `settings` (with the hook) into `~/.crewdeck/sessions/<id>/claude/` (RUNNER-9 passes the folder; until then `StartOptions.Dir`'s parent temp folder in tests).
- `Capabilities`: `claude --version`; the account kind and state as the spike found them (subscription sign-in, `ANTHROPIC_API_KEY`, none); the models the binary lists or, if it lists none, the spike's list with a model marked `not-in-plan` when the binary refuses it; `features` all true.
- `claude_test.go`: `enginetest.Replay` on every recording of `testdata/` with its golden; a permission scenario answered allow and deny; a question answered; interrupt then resume; a limit event.

## Decisions already made

- Only the official binary, never modified, never the Agent SDK (ADR 0004, risk IA-1).
- The control socket is the one channel between the hidden commands and the adapter; it is created mode 600 inside the Session's folder.
- A permission request or a question waits as long as the Pilote needs (hours): no timeout on the adapter side.
- An API key given to `claude` only through the environment of its process; never written to its config.

## Acceptance criteria

- [ ] Every recording of `testdata/` replays to its golden.
- [ ] A `permission-request` answered allow lets the tool run; deny makes Claude receive the refusal (fake binary checks the stdin it got).
- [ ] An `AskUserQuestion` becomes a `question`, and the answer reaches the agent through the hook.
- [ ] `Interrupt` ends the run with `result { status: 'interrupted' }`; `Resume` passes `--resume` with the kept session id.
- [ ] `Capabilities` reports version, `knownVersion`, account and models for the three account states of the spike (fake binary).
- [ ] The API key appears in no argument of the command line (asserted on the fake binary's argv).

## Verification

- `cd apps/runner && go test ./internal/engine/claude/...`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- Codex: RUNNER-6. Storing the API key and `login`: RUNNER-7. The Session's worktree and folder: RUNNER-9. Mounting the official Skills: RUNNER-12.

## Dependencies

- RUNNER-4.
