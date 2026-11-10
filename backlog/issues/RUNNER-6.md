---
id: RUNNER-6
title: "Codex adapter: app-server for the Sessions the Pilote drives, exec --json for the Boucle"
epic: RUNNER
type: feature
priority: P1
size: M
milestone: M2 Runner and Projets
blocked_by: [RUNNER-4]
adr: [0004]
risques: [IA-2, IA-3]
stories: [US-9, US-38, US-39, US-40, US-55]
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0004, « Codex »: `codex app-server` for the Sessions the Pilote drives (Rôles Idée and Conception), `codex exec --json` for the Boucle (Code, Review). Compte IA: an API key at the MVP; a ChatGPT plan only through « Sign in with ChatGPT », once OpenAI grants it (risk IA-2). The Review uses another Moteur than the Code by default (US-39), so Codex is the usual Review Moteur when the Code runs on Claude Code.

## Current state of the code

- Created by RUNNER-4: `apps/runner/internal/engine/engine.go`, the fake binary, `enginetest.Replay`, the normalised events and capabilities in `packages/contracts/src/runner/`.
- Created by RUNNER-1: `docs/spikes/engines.md` (Codex sections) and `apps/runner/internal/engine/codex/testdata/*.jsonl`.
- No `internal/engine/codex/`.

## To do

- `apps/runner/internal/engine/codex/codex.go`: `Engine` with `ID() = "codex"`, `BinaryPath` (default `codex`), `KnownVersions`.
  - `Start` chooses the transport from `StartOptions.Role`: `idea` and `design` → `appserver.go`; `code` and `review` → `exec.go`.
  - `appserver.go`: runs `codex app-server` with `CODEX_HOME=<SkillsDir's codex home>` and `OPENAI_API_KEY` in the environment; JSON-RPC 2.0 over stdio as the spike recorded (initialize, new thread with the model and the working directory, send a turn, receive item and approval notifications); command and file-change approval requests → `permission-request`, answered through `Answer`; agent messages → `message`; tool and command items → `tool-call` / `tool-result`; token usage → `usage`; turn completion → `result` with the thread id as `engineSessionId`. `Send` starts a new turn; `Interrupt` sends the interrupt request; `Resume` resumes the thread by id.
  - `exec.go`: runs `codex exec --json --model <m> <full-auto flag of the spike> -C <Dir> <InitialPrompt>`; parses its JSON lines the same way; `Send` is not supported (`features.interrupt` true, `questions` false, `permissions` false) and returns `engine.unsupported`; `Resume` uses `codex exec resume <id>` if the spike validated it, else returns `engine.unsupported` (the Boucle restarts the Ticket instead).
- `Capabilities`: `codex --version`; account `api-key` when `OPENAI_API_KEY` is provided by the Runner (RUNNER-7), else `none` with `login-required`; models as the spike found them (listed by app-server's model list request, or the spike's list).
- `codex_test.go`: `enginetest.Replay` for each recording; approval allow and deny on app-server; an `exec` run to its `result`; interrupt; a limit event.

## Decisions already made

- API key only at the MVP: a ChatGPT sign-in is never offered nor detected as usable (`account.kind` is `api-key` or `none`).
- `CODEX_HOME` is per Session (prepared by RUNNER-12 with the Skills); the adapter never touches `~/.codex`.
- The Boucle's Sessions never ask the Pilote (ADR 0004, permissions): `exec` runs in full-auto inside its worktree.

## Acceptance criteria

- [ ] Every Codex recording replays to its golden.
- [ ] An app-server approval request becomes a `permission-request`; allow and deny reach Codex (checked on the fake binary's stdin).
- [ ] An `exec` run in a Code Session ends with `result` and its usage.
- [ ] `Send` on an `exec` run returns `engine.unsupported`.
- [ ] Without an API key, `Capabilities` says `login-required` and every model `usable: false, reason: 'login-required'`.
- [ ] The API key appears in no argument of the command line.

## Verification

- `cd apps/runner && go test ./internal/engine/codex/...`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- Storing the API key (`crewdeck-runner login codex`): RUNNER-7. Skills in `CODEX_HOME`: RUNNER-12. Sessions: RUNNER-9.
- « Sign in with ChatGPT »: after OpenAI's answer (BIZ-3, risk IA-2).

## Dependencies

- RUNNER-4.
