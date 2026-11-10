---
id: CORE-8
title: "Measured latency: each event's source time, POST /api/metrics/latency, p95 of 7 days"
epic: CORE
type: feature
priority: P2
size: S
milestone: M1 Socle
blocked_by: [CORE-6]
adr: [0007, 0008]
risques: [OPS-5]
stories: [US-20]
screens: []
revue_visuelle: false
video: false
---

## Context

The PRD's success criterion: a change on GitHub or from an agent is visible in under 2 s (p95), measured from the event to the screen (US-20, risk OPS-5). ADR 0007: each event carries the time its source saw the change (webhook delivery, Runner report); the page reports the delay to `POST /api/metrics/latency` in batches; the statistics' health shows the p95 of the last 7 days (PILOTAGE-3 displays it).

## Current state of the code

- Created by CORE-5: `Event.sourceAt` (nullable), `EventsWriter.write(..., { sourceAt })`, `zEvent` with `sourceAt?`.
- Created by CORE-6: the store applying events (`apps/web/src/store/store.ts`), `apps/web/src/api/client.ts`.
- Sources that will pass `sourceAt`: PROJET-1 (the webhook's reception time), RUNNER-2 onward (the Runner's report time).

## To do

- Prisma: `LatencySample { id String @id @db.Uuid; pilotId String @db.Uuid; source String; delayMs Int; at DateTime @db.Timestamptz; @@index([pilotId, at]); @@map("latency_samples") }` (scoped). `source` is `github | runner | pilot | scheduler`, taken from the event (`zEvent.source`, added here: the writer's option `{ sourceAt, source }`).
- `packages/contracts/src/api/metrics.ts`: `zLatencyBatch` = `{ samples: { seq: zSeq, source, delayMs: int 0..600000, at: zInstant }[] }` (1 to 100 samples).
- `apps/server/src/metrics/`:
  - `POST /api/metrics/latency` → 204; drops samples whose `delayMs` exceeds 10 min (clock skew), writes the others; 400 on schema;
  - `LatencyService.p95(pilotId, { days: 7 }) → { p95Ms: number | null, count: number }` (PostgreSQL `percentile_cont(0.95)`), used by PILOTAGE-3;
  - a daily job deleting samples older than 30 days.
- `apps/web/src/store/latency.ts`: for each applied event (live, not replayed) with `sourceAt`, `delayMs = Date.now() - sourceAt`, pushed to a buffer flushed every 10 s or at 50 samples, and on `pagehide` with `navigator.sendBeacon`.
- No sample while the tab is hidden or during a replay (the delay would measure the Pilote's absence).

## Decisions already made

- The delay is measured by the browser's clock against the server's `sourceAt`; samples above 10 min are discarded rather than corrected.
- p95 over the Pilote's own samples; no global dashboard at the MVP.
- Samples are not events (no `events` row, no real-time update): PILOTAGE-3 reads the figure with the statistics.

## Acceptance criteria

- [ ] A live event with `sourceAt` 300 ms ago produces a sample of about 300 ms; a replayed event and an event received while hidden produce none.
- [ ] The buffer flushes at 50 samples or after 10 s, and on `pagehide` through `sendBeacon`.
- [ ] `POST /api/metrics/latency` → 204; 400 with `fields` on a negative delay; 401 without a session; a sample of 20 min is dropped.
- [ ] `p95` over samples 1..100 ms returns 95 (± 1); with no sample `p95Ms` is `null`.
- [ ] Samples of another Pilote are never counted.

## Verification

- `pnpm exec nx test web -- src/store/latency.spec.ts`
- `pnpm exec nx test server -- src/metrics/`
- `pnpm exec nx test-integration server -- metrics`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- Showing the p95 in the statistics' health: PILOTAGE-3.
- Filling `sourceAt` at each source: PROJET-1 (webhooks), RUNNER-2 and later Runner reports.

## Dependencies

- CORE-6.
