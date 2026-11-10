---
id: CORE-5
title: "Real time on the server: events written in the transaction, /api/ws, replay, snapshot"
epic: CORE
type: feature
priority: P0
size: M
milestone: M1 Socle
blocked_by: [CORE-4]
adr: [0001, 0003, 0007, 0008]
risques: []
stories: [US-20]
screens: []
revue_visuelle: false
video: false
---

## Context

US-20: a change on GitHub or from an agent is on screen in under 2 s, without reloading; pages never poll. ADR 0007: one WebSocket per client at `/api/ws`; every change of the Process's state writes an `events` row (`pilotId`, `seq`, `type`, `payload`, `at`) in the same transaction as the change, `seq` taken from a counter on the Pilote's row; the payload is the changed resource as the API returns it; events kept 7 days; a client sends the last `seq` it applied and gets the replay, or a snapshot (`GET /api/state`) when the server no longer has it; a REST command carrying an older `seq` than the resource's last change gets 409. One server process at the MVP: fan-out in memory (ADR 0001). Every module from here on writes its events with this ticket's writer; CORE-6 is the page's side; RUNNER-2 and SESSION-1 reuse the gateway.

## Current state of the code

- Created by CORE-2: `Pilot.seq` (BigInt, default 0), the scope (`runInPilotScope`, the Prisma extension, `GLOBAL_MODELS`, the ESLint rule on `prisma.unscoped`).
- Created by CORE-4: the session cookie and `session.middleware.ts` resolving it to `req.principal`; `GET /api/me` (`zMe`).
- Created by CORE-1: the error envelope, `zSeq`, `zInstant`, the logger's redaction list.
- No events, no WebSocket.

## To do

- Prisma: `Event { pilotId String @db.Uuid; seq BigInt; type String; payload Json; at DateTime @default(now()) @db.Timestamptz; sourceAt DateTime? @map("source_at") @db.Timestamptz; @@id([pilotId, seq]); @@index([at]); @@map("events") }` (scoped).
- `packages/contracts/src/events/`:
  - `index.ts`: `zEventType` = `` `${Resource}.upserted` | `${Resource}.removed` `` with `Resource` in: pilot, settings, runner, ai-account, device, project, repository, ticket, agent-loop, schedule, agent-session, step-run, decision, idea, design, usage; `registerEventPayload(resource, schema)` and `zEvent` = `{ seq, type, payload, at, sourceAt? }`; a `removed` payload is `{ id: zId }`;
  - `pilot.ts`: the `pilot` payload (`zMe`) — the first resource; each module's ticket registers its own payload schema next to its API schema.
- `packages/contracts/src/realtime/ws.ts`: the socket messages.
  - Client → server: `hello { lastSeq: zSeq | null }`, `ping`, `visibility { visible: boolean }` (stored for ATOI-4), plus the `relay` message SESSION-1 adds.
  - Server → client: `event { event: zEvent }`, `snapshot-required`, `live` (replay done), `pong`.
- `apps/server/src/realtime/`:
  - `transactions.ts`: `Transactions.run(fn: (tx) => Promise<T>)` wraps `prisma.$transaction`, collects the events written in it and publishes them to the bus **after** commit (nothing published on rollback);
  - `events.writer.ts`: `EventsWriter.write(tx, pilotId, type, payload, { sourceAt? }) → Promise<bigint>`: validates `payload` against the registered schema (throws on mismatch), `UPDATE pilots SET seq = seq + 1 WHERE id = $1 RETURNING seq`, inserts the row, buffers it for the post-commit publish, returns the `seq`. Calling it outside `Transactions.run` throws;
  - `freshness.ts`: `assertFresh(lastSeq: bigint, commandSeq: bigint)` → 409 `realtime.stale`, « L'état a changé depuis ton dernier affichage : vérifie avant de recommencer. », and `withSeq(schema)` in `packages/contracts/src/api/commands.ts` adding `seq: zSeq` to a command body. Convention written in the module's README comment: every table a command acts on has `lastSeq BigInt @map("last_seq")`, set to the `seq` its event got;
  - `events.bus.ts`: in-memory pub/sub per `pilotId`;
  - `realtime.gateway.ts`: `@nestjs/platform-ws` (`WsAdapter`) at `/api/ws`. Authentication on upgrade through the multi-provider `WS_AUTHENTICATORS` (`(req) => principal | null`): this ticket registers the cookie one (reusing CORE-4's session lookup); RUNNER-2 adds the Runner's token. No principal → close 4401. On `hello`: if `lastSeq` is null or older than the oldest kept event of the Pilote (with a gap) → `snapshot-required`; else replay every event `> lastSeq` in order, then `live`, live events arriving meanwhile queued for that socket and sent after. Ping/pong every 25 s from the client; a socket silent 60 s is closed;
  - `tab-presence.ts`: per Pilote, its open tab sockets and their last `visibility` with its time (read by ATOI-4);
  - `state.controller.ts`: `GET /api/state` → `{ seq, ...slices }`, the `seq` and the slices read in one `REPEATABLE READ` transaction; slices from the multi-provider `STATE_CONTRIBUTORS` (`{ key, schema, snapshot(tx, pilotId) }`); this ticket registers `pilot`. `packages/contracts/src/api/state.ts` composes `zState` from the registered keys;
  - `retention.job.ts`: `@nestjs/schedule`, daily at 04:00 UTC, deletes events older than 7 days (unscoped: add `src/realtime/retention.job.ts` to CORE-2's ESLint exceptions).
- Logging: a socket message is logged by its `type` and byte size only; never its payload.
- `apps/server/test/fakes/ws-client.ts`: a fake client (`connect({ cookie | token })`, `send`, `next(type)`, `collect()`), used by every real-time test from here on.

## Decisions already made

- Events tell clients what changed; the tables are the truth (no event sourcing, ADR 0007).
- The client fetches the snapshot itself after `snapshot-required` then sends `hello` again with the snapshot's `seq`: replay then covers what happened during the fetch, events being kept 7 days.
- Commands are REST; the socket never carries a command that changes state (ADR 0007).
- One server process: no `LISTEN/NOTIFY` at the MVP.

## Acceptance criteria

- [ ] A change and its event are written in one transaction: a rollback after `write` leaves no row and publishes nothing; a commit publishes exactly once.
- [ ] Two concurrent transactions of the same Pilote get consecutive `seq` values with no duplicate.
- [ ] A payload that does not match its registered schema makes `write` throw.
- [ ] `hello { lastSeq: n }` replays every event after `n` in order, then `live`; an event committed during the replay arrives once, after it.
- [ ] `hello { lastSeq: null }` and a `lastSeq` older than the kept window get `snapshot-required`.
- [ ] `GET /api/state` returns `{ seq, pilot }` matching `zState`; 401 without a session.
- [ ] `assertFresh(5n, 4n)` throws 409 `realtime.stale`; `assertFresh(5n, 5n)` passes.
- [ ] A socket without cookie is closed with 4401; a Pilote's socket never receives another Pilote's event.
- [ ] The retention job deletes an event of 8 days and keeps one of 6 days.

## Verification

- `pnpm exec nx test server -- src/realtime/`
- `pnpm exec nx test-integration server -- realtime`
- `pnpm exec nx test contracts -- src/events/`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`; `pnpm exec nx run contracts:generate` with no diff.

## For prod

Nothing (the `events` migration runs with the deploy; Caddy already proxies WebSocket upgrades, INFRA-5).

## Out of scope

- The page's store, the Resynchronisation and the disabled Actions sensibles: CORE-6.
- `sourceAt` filled by the sources and the latency measure: CORE-8.
- The Runner's authentication and protocol on the socket: RUNNER-2; the encrypted relay: SESSION-1.
- Push notifications reading `tab-presence`: ATOI-4.

## Dependencies

- CORE-4.
