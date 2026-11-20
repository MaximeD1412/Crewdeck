---
id: RUNNER-23
title: "Spend of each Session: the API cost and, for a subscription, its share of the 5-hour window"
epic: RUNNER
type: feature
priority: P0
size: M
milestone: M4 Boucle
blocked_by: []
adr: [0003, 0004, 0008]
risques: [BIZ-4]
stories: [US-114, US-115]
screens: []
revue_visuelle: false
video: false
---

## Context

US-114 (« Depuis ta dernière visite », ATOI-5) and US-115 (the spend per Étape, PILOTAGE-4) both write the spend with its **Compte IA**: euros for an API key, a share of the 5-hour window for a subscription. PILOTAGE-3's cost per **Ticket** needs the same figures. Today only an API key has a spend: the Runner sends `spend { sessionId, costUsdMicros }` in its `usage` message and the server drops the spend of a subscription (`UsageService.record`). A subscription only has windows (`usedPercent`), measured per Moteur, not per Session. This ticket gives every Session a spend row of either kind, so that the three consumers sum rows and never reconstruct anything (risk BIZ-4: an estimate, always labelled so). Figures only, never content (ADR 0003, 0004).

## Current state of the code

- `packages/contracts/src/runner/usage.ts`: `zUsage` (`engine`, `accountKind`, `windows`, `spend: { sessionId?, costUsdMicros }`, `measuredAt`), `zUsageAck`, `USAGE_EVERY_SECONDS = 600`; the doc comment says the server ignores a subscription's spend.
- `packages/contracts/src/runner/events.ts`: the normalised `usage` event (`windows`, `costUsdMicros`, `inputTokens`, `outputTokens`) and `result` (`costUsdMicros`, cumulative per Session).
- `apps/runner/internal/accounts/usage.go`: `observeUsage` (the events of a run → a usage message: windows, or a spend from a `result`'s cost, delta of the Session's cost so far), `spendMessage`, `usageKind`, `UsageEvery`, `FlushUsage`, `UsageAcked`; `spent.go`: the file of costs (`SpentPath`), pending spends kept until `usage.ack`, unpriced ones kept until the capabilities name the Compte IA; `watch.go` line 60 calls `observeUsage` for each event of a run. No token counting, no window delta.
- `apps/server/src/usage/usage.service.ts`: `record` stores `UsageMeasure` rows and, for `accountKind === 'api-key'` only, a `Spend` row under the message's id (`skipDuplicates`), with `projectId`, `sessionId`, `stepRunId` read from the Pilote's `AgentSession`; `convertPending` fills `costEurCents`; `usage.view.ts` builds `monthSpend` from `Spend`.
- `apps/server/prisma/schema.prisma` (`model Spend`, ~611): `engine`, `projectId?`, `sessionId?`, `stepRunId?`, `day`, `costUsdMicros BigInt` (not null), `costEurCents?`, `measuredAt`; index `[pilotId, engine, day]`. `UsageMeasure` (~590): `window`, `usedPercent`, `resetsAt`.
- `apps/server/src/usage/fx.ts`: `toEurCents`; `calendar.ts`: `dayIn`.
- `apps/runner/internal/session/manager.go`: `runSession` loops over `run.Events()`; the Session's end is where the Runner knows it is over.
- Created by RUNNER-13 (merged) what is above; Created by RUNNER-6 (open): the Codex adapter, whose `usage` events carry tokens.

## To do

- Protocol `packages/contracts/src/runner/usage.ts`: one message per Compte IA and Session as today; its `spend` becomes `{ sessionId?, kind: 'api-key' | 'subscription', costUsdMicros?, windowPermille? }` (an `api-key` spend has `costUsdMicros`, a `subscription` one `windowPermille`, an integer 1..1000; a refine requires the one matching `kind`; `engine` is the message's own). The message `id` stays the idempotency key (the server stores a spend once by that `id`). Update the doc comment (the server no longer ignores a subscription's spend) and the fixture shared with Go, then `pnpm exec nx run contracts:generate` and commit what it writes.
- Runner, `apps/runner/internal/accounts/share.go` (new), clock injected, pure core `splitShare(deltaPermille int, tokens map[sessionID]int) map[sessionID]int`: split between the Sessions by their tokens (input + output) over the interval, in integers, the rounding remainder to the largest share (ties: the smallest session id); no tokens at all → nothing attributed.
- Runner, subscription share: per Moteur on a subscription, keep the `five-hour` window's last `usedPercent` and `resetsAt` as measured, and per live Session of that Moteur the tokens its `usage` events reported since the previous tick (a Moteur whose events carry no tokens counts each live Session as one share). At each usage tick (`UsageEvery`, 600 s) and at a Session's end (`result` ending the Session, `Stop`): `delta = (usedPercent − previous) × 10` permille; after a reset (`resetsAt` changed or `usedPercent` lower) the previous is 0; the delta is split by `splitShare` between the Sessions of that Moteur live during the interval; no live Session during the interval → not attributed (the window moved for another use of the Moteur). One `usage` message per Session with a positive share, `kind: 'subscription'`, `windowPermille`, kept pending until `usage.ack` like an API-key spend (`spent.go`), the delta already given to a Session never given twice.
- Runner, API key: unchanged, now with `kind: 'api-key'` in its message.
- Prisma `Spend`: `kind` enum `api_key | subscription` (default `api_key`, so existing rows stay valid), `costUsdMicros BigInt?` (nullable), `windowPermille Int?`; a check that a row holds the one matching its `kind`. One migration. The model comment says what a row is.
- Server `UsageService.record`: store a `subscription` spend too (`windowPermille`, no euros, `costEurCents` null for good, so `convertPending` skips it: it selects only `kind = api_key` rows); `projectId` and `stepRunId` read from the AgentSession as today (already so for an API key: keep, covered by a test for both kinds). `usage.upserted` published for the Moteur as today. `usage.view.ts`: `monthSpend` sums `api_key` rows only; a subscription's rows never reach the month's euro figure.
- Pure `apps/server/src/usage/spend-sum.ts`: `sumSpend(rows): { engine, kind, costUsdMicros, costEurCents?, windowPermille }[]` (per Moteur and kind: the sum of the rows; `costEurCents` null if one row is still unconverted), the one function PILOTAGE-3, PILOTAGE-4 and ATOI-5 call.
- Test scenario: extend `apps/server/src/testing/scenarios/usage.ts` with one subscription spend and one API-key spend tied to a StepRun.

## Decisions already made

- The server never computes a share: the Runner holds the Moteur's measures and the Sessions' tokens; the server stores integers per Session (ADR 0004, figures only).
- Permille, integers: 1.2 windows = 1200 permille; the UI divides at display (ATOI-5, PILOTAGE-4 write « 1,2 fenêtre »; PILOTAGE-3 writes % = permille / 10).
- A share is an estimate: it is attributed pro rata of tokens, not measured per Session by the Moteur. A window used elsewhere (the Pilote's own use of the Moteur on the same account) while no Session is live is not attributed; while one is live it is shared with it. This is the most conservative choice and is stated in PILOTAGE-4's legend (« estimé »).
- A resume (`--resume`) continues the same Session: its later shares are new rows of the same `sessionId`.
- A subscription's `costUsdMicros` (list price from the `result` event) is never stored on a `subscription` row: the euro figure of a subscription would be misleading.
- Existing `Spend` rows are API-key ones by construction: the default `api_key` makes the migration data-safe.

## Acceptance criteria

- [ ] `splitShare(10, { a: 3, b: 1 })` gives `{ a: 8, b: 2 }`; `splitShare(10, { a: 1, b: 1, c: 1 })` gives `4, 3, 3` with the remainder to the smallest id; no tokens → `{}` (unit tests).
- [ ] Two Claude Sessions live over a tick where `five-hour` goes from 20 % to 26 % with 300 and 100 tokens: the messages carry `windowPermille` 45 and 15, `kind: 'subscription'`; a tick with no live Session sends none; after a reset the delta counts from 0 (Go tests, injected clock).
- [ ] A Session's end sends the share since the last tick; a spend not acked is sent again with its id after a Runner restart and stored once.
- [ ] An API-key `result` still sends `costUsdMicros` with `kind: 'api-key'`; `monthSpend` of `GET /api/usage` is unchanged by a subscription row.
- [ ] A subscription spend is stored with the Session's `projectId` and `stepRunId`; a Session of another Pilote is tied to nothing (`projectId` null); the second delivery of an id stores nothing (integration test).
- [ ] The migration keeps the existing rows as `api_key`; a row with both `costUsdMicros` and `windowPermille`, or neither, is refused by the database.
- [ ] The shared fixture of the `usage` message is valid in TypeScript and in Go; `contracts:generate` leaves no diff.

## Verification

- `pnpm exec nx test contracts -- src/runner/usage.spec.ts`
- `pnpm exec nx test server -- src/usage/`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- usage`
- `cd apps/runner && go test ./internal/accounts/ ./internal/protocol/`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

A migration (`spends.kind`, `spends.window_permille`, `spends.cost_usd_micros` nullable, the check). Mirrored in `docs/pilotage/mep.json`. The Runner must be updated with the server: an old Runner sends the old `spend` shape, which the server keeps accepting as `api-key` for one release.

## Out of scope

- Showing a spend: ATOI-5 (« Depuis ta dernière visite »), PILOTAGE-4 (per Étape), PILOTAGE-3 (cost per Ticket).
- The usage meters, the month's spend card and the euro conversion: RUNNER-13 (merged).
- A Moteur's per-Session measure when a provider gives one: not at the MVP.

## Dependencies

- Nothing (RUNNER-6's Codex adapter feeds tokens when it lands; until then a Moteur without tokens counts one share per live Session).
