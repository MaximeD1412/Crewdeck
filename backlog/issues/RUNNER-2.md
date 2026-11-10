---
id: RUNNER-2
title: "Runner protocol over one WebSocket: hello, heartbeat, presence and version negotiation"
epic: RUNNER
type: feature
priority: P0
size: M
milestone: M2 Runner and Projets
blocked_by: [CORE-5]
adr: [0001, 0004, 0007, 0008]
risques: [AGT-3]
stories: [US-19, US-20]
screens: []
revue_visuelle: false
video: false
---

## Context

The Runner talks to the server through one WebSocket (ADR 0004, ADR 0007), with messages defined once in `packages/contracts/src/runner/` and generated as Go types (ADR 0001). The server must know at every moment whether the Pilote's Runner is online, so that « Runner hors ligne » (ATOI-3, US-19) and the Boucle (BOUCLE-2) can act on it. Every later Runner ticket adds its messages to this protocol: linking (RUNNER-3), capabilities (RUNNER-7), Sessions (RUNNER-9), the relay (SESSION-1), verdicts (RUNNER-11), usage (RUNNER-13).

## Current state of the code

- Created by INFRA-1: the Nx monorepo, `apps/runner/` (Go module, `project.json` targets `test`, `lint`, `build`), `packages/contracts/` with `contracts:generate` (zod → JSON Schema → Go types in `apps/runner/internal/contracts/`), shared fixtures in `packages/contracts/fixtures/` validated by the TypeScript and Go tests.
- Created by CORE-1: `apps/server/src/errors/` (AppError, envelope), the value shapes (`zId`, `zInstant`); by CORE-2: `apps/server/src/scope/`; by CORE-5: `apps/server/src/realtime/` (the `/api/ws` gateway authenticated by the session cookie, `EventsWriter`, `StateContributor`, `GET /api/state`) and the fake socket client `apps/server/test/fakes/ws-client.ts`.
- No `runners` table, no Runner command, no protocol schema.

## To do

- **Contracts** `packages/contracts/src/runner/`:
  - `protocol.ts`: `PROTOCOL_VERSION = 1` and the envelope `{ type: string, id: zId, at: zInstant }`; `RunnerToServer` and `ServerToRunner` discriminated unions on `type`.
  - `hello.ts`: `hello` (runner → server) `{ protocolVersion: int, runnerVersion: string, machine: string, os: 'linux'|'darwin', arch: 'amd64'|'arm64', wsl: boolean }`; `hello.accepted` (server → runner) `{ runnerId, protocolVersion }`; `hello.rejected` `{ reason: 'update-required'|'revoked'|'unknown-token', latestVersion?: string }`.
  - `heartbeat.ts`: `heartbeat` `{}` every 15 s; `heartbeat.ack` `{}`.
  - one fixture per message in `packages/contracts/fixtures/runner/<type>.json`, validated by `packages/contracts/src/runner/protocol.spec.ts` and by `apps/runner/internal/protocol/fixtures_test.go`.
- **Server** `apps/server/src/runners/`:
  - Prisma model `Runner` (`runners`): `id` UUIDv7, `pilotId` (unique while `revokedAt` is null), `tokenHash` (SHA-256 hex of the token, unique), `machine`, `os`, `arch`, `wsl`, `runnerVersion`, `protocolVersion`, `state` (`online`|`offline`), `lastSeenAt`, `linkedAt`, `revokedAt?`. RUNNER-3 creates the rows; this ticket adds the model and a test helper `createLinkedRunner(pilotId)` returning `{ runner, token }`.
  - `runners.gateway.ts`: `/api/ws?client=runner` accepts `Authorization: Bearer <token>`; looks the token up by hash, opens the Pilote's scope (ADR 0008), rejects unknown or revoked tokens with `hello.rejected` then closes (code 4401). Accepts `protocolVersion` equal to `PROTOCOL_VERSION` or `PROTOCOL_VERSION - 1`; older gets `hello.rejected { reason: 'update-required', latestVersion }` (RUNNER-8 makes the Runner update itself). One socket per Runner: a second connection with the same token closes the first (code 4409).
  - `runner-presence.service.ts`: online on an accepted `hello`, `lastSeenAt` on each heartbeat, `offline` when no heartbeat for 45 s (a sweep every 5 s, testable with a fake clock) or when the socket closes. Each change writes `runner.upserted` in the same transaction (`EventsWriter`). Exposes `isOnline(pilotId)` and `onOnline(pilotId, handler)` / `onOffline(...)` hooks for ATOI-3, RUNNER-9 and RUNNER-12.
  - `runner-commands.service.ts`: `RunnerCommands.send(pilotId, message)` validates against `ServerToRunner` and sends to the connected socket; throws `AppError(422, 'runner.offline', 'Le Runner est hors ligne.')` when there is none.
  - A dispatcher: handlers registered per `type` (`registerRunnerHandler(type, fn)`), each message validated against `RunnerToServer` (an invalid one is logged by type only, never its payload, and answered `error { code: 'protocol.invalid' }`).
  - `GET /api/runner` returns the Pilote's current Runner `{ id, machine, os, arch, wsl, runnerVersion, state, lastSeenAt, linkedAt }` or 404 `runner.not-linked`; a `StateContributor` key `runner` (the same object or `null`).
  - Contract `packages/contracts/src/api/runner.ts` (`zRunner`), event schema `runner.upserted` in `packages/contracts/src/events/`.
  - The server's logger never logs a protocol payload (extend CORE-1's redaction test with a `relay` message).
- **Runner** (Go):
  - `apps/runner/internal/protocol/`: client on `github.com/coder/websocket`: dial `<server>/api/ws?client=runner` with the token, send `hello`, heartbeat every 15 s, reconnect with backoff (1 s doubling to 30 s, jitter), typed send/receive from the generated types, handler registry per `type`.
  - `apps/runner/internal/state/`: `~/.crewdeck/` (mode 700) and `runner.json` (mode 600: `server`, `runnerId`, `token`); `CREWDECK_HOME` overrides the folder (tests).
  - `apps/runner/cmd/crewdeck-runner/` on `github.com/spf13/cobra`: the root command and `run` (foreground: load state, connect, stay connected; SIGINT/SIGTERM close cleanly). Version from `-ldflags "-X main.version=…"`, printed by `--version`.
- **Fakes**:
  - `apps/server/test/fakes/runner.ts`: `FakeRunnerClient` (connect with a token, `hello`, `heartbeat`, `expect(type)`, `send(message)`), for server tests.
  - `apps/server/src/testing/fake-runner.ts`: started by `pnpm dev` and the e2e run when `CREWDECK_FAKES=1`, it connects as the Runner of the scenario's Pilote (token from the scenario) and keeps heartbeating; later tickets add behaviours to it (capabilities, Sessions).

## Decisions already made

- Commands from the page stay REST; the socket carries events, heartbeats and the relay (ADR 0007). The Runner never calls REST except the link (RUNNER-3), its GitHub token (RUNNER-10) and approving an Appareil from the machine (E2E-3), all with its Bearer token except the link.
- The token is 32 random bytes, base64url; only its SHA-256 is stored. No expiry: linking a new Runner revokes it (RUNNER-3).
- Presence timings are constants in `packages/contracts/src/runner/protocol.ts`: `HEARTBEAT_SECONDS = 15`, `OFFLINE_AFTER_SECONDS = 45`, so the Go side reads the same values.
- Close codes: 4401 unknown or revoked token, 4409 replaced by a newer connection, 4426 update required.

## Acceptance criteria

- [ ] A Runner with a valid token connects, sends `hello`, gets `hello.accepted`; the Runner's state becomes `online` and a `runner.upserted` event is written in the same transaction.
- [ ] Without a heartbeat for 45 s (fake clock) the Runner becomes `offline` with its event; a heartbeat after that brings it back `online`.
- [ ] Protocol version N-1 is accepted; N-2 gets `hello.rejected { reason: 'update-required' }` and code 4426; an unknown token gets code 4401.
- [ ] A second connection with the same token closes the first with 4409.
- [ ] `RunnerCommands.send` to an offline Runner throws `runner.offline` (422).
- [ ] `GET /api/runner`: nominal case matches `zRunner`; 401 without a session; 404 `runner.not-linked` without a Runner; another Pilote's Runner is never returned.
- [ ] Every protocol fixture is valid in TypeScript and in Go; `contracts:generate` leaves no diff.
- [ ] The Go client reconnects after the server drops the socket and resends `hello`.

## Verification

- `pnpm exec nx test contracts -- src/runner/protocol.spec.ts`
- `pnpm exec nx test server -- src/runners/`
- `pnpm exec nx test-integration server -- runners`
- `cd apps/runner && go test ./internal/protocol/ ./internal/state/`
- `pnpm exec nx run contracts:generate` then `git diff --exit-code`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the migration of `runners` runs with the deploy).

## Out of scope

- Creating a Runner (link codes, install script, `link` command, service): RUNNER-3.
- The key exchange: E2E-2. Self-update: RUNNER-8.
- The « Runner hors ligne » Décision and banner: ATOI-3.

## Dependencies

- CORE-5.
