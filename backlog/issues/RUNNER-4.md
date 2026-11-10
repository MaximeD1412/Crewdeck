---
id: RUNNER-4
title: "Moteur interface, normalised events and the fake Moteur that replays recorded streams"
epic: RUNNER
type: feature
priority: P0
size: S
milestone: M2 Runner and Projets
blocked_by: [RUNNER-1, RUNNER-2]
adr: [0001, 0004, 0008]
risques: [IA-3, AGT-3]
stories: [US-9, US-38]
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0004: one adapter per Moteur behind one interface (start, send a message, answer a request, interrupt, resume, list models, report usage), each declaring its capabilities, the events normalised in `packages/contracts/src/runner/events.ts` with the provider's raw event kept beside them. Tests never run a real Moteur: they replay the recorded streams of RUNNER-1 through a fake binary. This ticket gives the interface and the harness that RUNNER-5 (Claude Code), RUNNER-6 (Codex), RUNNER-7 (Comptes IA) and RUNNER-9 (Sessions) build on.

## Current state of the code

- Created by RUNNER-1: `docs/spikes/engines.md` (the mapping raw → normalised event per Moteur), the recordings `apps/runner/internal/engine/claude/testdata/*.jsonl` and `apps/runner/internal/engine/codex/testdata/*.jsonl`.
- Created by RUNNER-2: `packages/contracts/src/runner/` (protocol envelope), the Go client `apps/runner/internal/protocol/`, `apps/runner/cmd/crewdeck-runner/`.
- Created by INFRA-1: `contracts:generate` writing Go types to `apps/runner/internal/contracts/`.
- No `internal/engine/`.

## To do

- `packages/contracts/src/runner/events.ts`: `zEngineEvent`, a discriminated union on `kind`, each with `seq` (int, per Session), `at`, `raw?` (the provider's event, JSON, kept on the Runner only):
  - `message` `{ from: 'agent', text, final: boolean }` (deltas then a final);
  - `tool-call` `{ callId, tool, target?, detail? }` and `tool-result` `{ callId, ok: boolean, detail? }`;
  - `question` `{ requestId, title, options: [{ label, detail? }], multiple: boolean }`;
  - `permission-request` `{ requestId, tool, command }`;
  - `usage` `{ windows?: [{ id: 'five-hour'|'week', usedPercent, resetsAt }], costUsdMicros?, inputTokens?, outputTokens? }`;
  - `limit-reached` `{ window: 'five-hour'|'week'|'unknown', resetsAt? }`;
  - `auth-required` `{ reason }`;
  - `result` `{ status: 'ok'|'error'|'interrupted', engineSessionId?, costUsdMicros? }`;
  - `error` `{ code, message }`;
  plus any event RUNNER-1 added. Fixtures `packages/contracts/fixtures/runner/events/<kind>.json`, valid in TypeScript and Go.
- `packages/contracts/src/runner/engines.ts`: `zEngineId` (`claude-code`|`codex`), `zEngineCapabilities` `{ engine, installed: boolean, version?, knownVersion: boolean, account: { kind: 'subscription'|'api-key'|'none', state: 'connected'|'login-required' }, models: [{ id, label, usable: boolean, reason?: 'login-required'|'quota-reached'|'not-in-plan' }], features: { interrupt, resume, questions, permissions } }`.
- `apps/runner/internal/engine/engine.go`:
  ```go
  type Engine interface {
      ID() contracts.EngineId
      Capabilities(ctx context.Context) (contracts.EngineCapabilities, error)
      Start(ctx context.Context, opts StartOptions) (Run, error)
      Resume(ctx context.Context, opts ResumeOptions) (Run, error)
  }
  type Run interface {
      Events() <-chan contracts.EngineEvent // closed when the run ends
      Send(ctx context.Context, text string) error
      Answer(ctx context.Context, requestID string, answer Answer) error
      Interrupt(ctx context.Context) error
      Wait() error
  }
  ```
  `StartOptions { Dir, Model, Role, PermissionMode ('auto'|'bypass'), Env []string, SkillsDir, InitialPrompt string }`, `ResumeOptions` adds `EngineSessionID`; `Answer { Allow *bool, Options []string, Text string }`. `Registry` (`Register(Engine)`, `Get(id)`, `All()`).
- `apps/runner/internal/engine/fake/`:
  - `cmd/fake-engine/main.go` (built by the tests): reads `FAKE_ENGINE_STREAM=<file.jsonl>` and writes its lines to stdout, pausing at lines `{"fake":"await-stdin"}` until a line arrives on stdin (so questions and permissions can be answered), exits with `FAKE_ENGINE_EXIT` (default 0).
  - `fake.go`: an in-process `Engine` that replays a list of normalised events, for the Session tests (RUNNER-9) and the fake Runner.
- `apps/runner/internal/engine/enginetest/replay.go`: `Replay(t, engine, stream string, golden string)` starts the adapter with the fake binary in place of the real one (adapters take their binary path from `StartOptions` or a field, `BinaryPath`), collects the normalised events (without `raw` and `at`) and compares them with `testdata/<stream>.golden.json`; `-update` rewrites the golden.
- A `version_test.go` example: an adapter declares `KnownVersions` (a list of ranges, e.g. `>=2.1 <2.3`), and `Capabilities` sets `knownVersion` by comparing with the installed one (risk IA-3: the Runner says so in its state).

## Decisions already made

- `raw` never leaves the Runner: the server's protocol schema for relayed events drops it (SESSION-1 encrypts what it relays); it stays in the local log for debugging.
- Normalised event names are those of `docs/spikes/engines.md`; if the spike added one, it is added here.
- Model ids are the provider's (`claude-opus-5-5`, `gpt-5.5`); labels come from the adapter.
- The fake binary is only built by tests (`go build -o $TMP/fake-engine ./internal/engine/fake/cmd/fake-engine`), never shipped.

## Acceptance criteria

- [ ] Every event fixture is valid in TypeScript and Go; `contracts:generate` leaves no diff.
- [ ] `Replay` drives a toy adapter (in `enginetest`'s own test) through the fake binary, answers an `await-stdin` pause, and matches a golden; `-update` rewrites it.
- [ ] The in-process fake Engine emits its events in order and honours `Interrupt` (emits `result { status: 'interrupted' }`).
- [ ] `knownVersion` is false for a version outside the declared ranges.

## Verification

- `pnpm exec nx test contracts -- src/runner/`
- `cd apps/runner && go test ./internal/engine/...`
- `pnpm exec nx run contracts:generate` then `git diff --exit-code`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The real adapters: RUNNER-5 (Claude Code), RUNNER-6 (Codex).
- Connecting a Compte IA and reporting capabilities to the server: RUNNER-7. Sessions: RUNNER-9.

## Dependencies

- RUNNER-1.
- RUNNER-2.
