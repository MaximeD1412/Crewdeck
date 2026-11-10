---
id: CORE-6
title: "Web store, Resynchronisation and commands carrying their seq"
epic: CORE
type: feature
priority: P0
size: M
milestone: M1 Socle
blocked_by: [CORE-5, UI-3]
adr: [0006, 0007, 0008]
risques: []
stories: [US-20, US-21]
screens: [a-toi-resynchronisation]
revue_visuelle: true
video: false
---

## Context

US-21: « As a Pilote, I want to see « resynchronisation… » after a lost connection until the state is sure again, with the Actions sensibles unavailable until then, so that I never act on a stale state. » ADR 0007: until the snapshot or the replay is applied the page is in **Resynchronisation**, every Action sensible disabled with its reason; a REST command carrying an older `seq` than the resource's last change gets 409. ADR 0008 « Front data »: one store per Pilote in `apps/web/src/store/`, fed by the snapshot and the events; pages read it through their view function, never through a fetch of their own; commands are one client per resource, typed by the contracts, an error's `message` shown as is. Every page ticket from here on reads this store and sends commands through this client.

## Current state of the code

- Created by CORE-5: `/api/ws` (messages `hello`, `ping`, `visibility` / `event`, `snapshot-required`, `live`, `pong` in `packages/contracts/src/realtime/ws.ts`), `GET /api/state` (`zState`, slice `pilot`), `zEvent`, `withSeq`, 409 `realtime.stale`.
- Created by UI-1 to UI-3: the Skin runtime and the in-page bridge (data subscriptions in, actions out), the router, `t()`, `Banner`, the Cadre (`AppShell`) with its `banner` Emplacement and its status (`online | offline | resync`).
- Created by CORE-4: `apps/web/src/api/auth.ts`, the router guard.
- Created by INFRA-4: Playwright, scenarios, `scripts/captures.sh`.

## To do

- `apps/web/src/store/`:
  - `store.ts`: `createStore()` → `{ getState(), subscribe(fn), applySnapshot(state), applyEvent(event) }`; state `{ seq: bigint | null, connection: 'connecting' | 'resync' | 'live', lostAt: Date | null, slices }`. `registerSlice(resource, { shape: 'collection' | 'single' })`: a `collection` is a `Map<id, resource>` (`upserted` sets by `id`, `removed` deletes), a `single` is replaced. `applyEvent` ignores an event with `seq <= state.seq` and switches to `resync` on a gap (`seq > state.seq + 1`). This ticket registers `pilot` (single);
  - `connection.ts`: opens `/api/ws`, sends `hello { lastSeq }`; on `snapshot-required` fetches `GET /api/state`, `applySnapshot`, sends `hello` again with its `seq`; on `live` sets `connection = 'live'`; on close sets `connection = 'resync'` and `lostAt` (first loss only), reconnects with a backoff of 1, 2, 5 then 10 s, at once when the tab becomes visible; `ping` every 25 s; sends `visibility` after each `hello` and on every `visibilitychange` (consumed by ATOI-4);
  - `sensitive.ts`: `sensitiveBlockedReason(state): string | null` → `t('resync.sensitiveUnavailable')` while `connection !== 'live'`, else `null`. Every view that renders an Action sensible passes it to the Composant as its disabled reason (DESIGN.md « Interactive states »); CORE-7's dispatcher refuses the action with the same rule.
- `apps/web/src/api/client.ts`: `query<T>(path, schema)` and `command<T>(method, path, body, schema)`; `command` adds `seq: String(store.seq)` to the body, parses the error envelope into `ApiError { status, code, message, fields }`. An `ApiError` a caller does not handle is shown by the core as a `Banner` of tone `halt` in the Cadre's `banner` Emplacement, its `message` as is, until the next navigation. A 409 `realtime.stale` also triggers a `hello` so the store catches up.
- `apps/web/src/views/cadre.ts`: pure function `(state) → AppShell data`: `status` is `resync` while `connection !== 'live'`, else the Runner's presence once RUNNER-2 registers the `runner` slice (until then `offline`); the Décisions count once ATOI-1 registers the `decision` slice.
- The Resynchronisation banner: while `connection !== 'live'` the core puts in the Cadre's `banner` Emplacement a `Banner` of tone `caution`, icon `refresh`: title `resync.title` « Resynchronisation… », text `resync.body` « La connexion a été perdue à {time}. Crewdeck reconstruit l'état ; en attendant, ce que tu vois peut être en retard et les Actions sensibles (merger, démarrer la Boucle, approuver une Conception) sont indisponibles. » (`{time}` = `lostAt` with the SDK's hour formatter); `resync.sensitiveUnavailable` « Indisponible pendant la resynchronisation ». Removed as soon as `live`.
- Store tests in Vitest (`apps/web/src/store/store.spec.ts`, `connection.spec.ts` with a mock WebSocket).
- Scenario `apps/server/src/testing/scenarios/resynchronisation.ts` and Playwright `apps/web/e2e/resynchronisation.spec.ts`: it cuts the socket (`page.routeWebSocket` closing it), asserts the banner and the Cadre's status, lets it reconnect, asserts both are gone (ADR 0007's consequence).

## Decisions already made

- Mockup: `a-toi-resynchronisation` (page `design/screens/crewdeck/a-toi-resynchronisation.html`; captures `design/screens/crewdeck/a-toi-resynchronisation-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. This ticket builds the banner and the Cadre's « Resynchronisation… » status only; the « À toi » page under it, its « à vérifier » count and its cards' « État d'avant la coupure » notes are ATOI-1's.
- The page keeps showing the state it had before the loss, text colours unchanged (DESIGN.md: never lower a text's opacity for a stale state).
- `seq` travels as a decimal string in JSON (BigInt-safe); the contracts' `zSeq` accepts it.
- No page fetches its data: a page with nothing in the store shows its empty state, never a spinner of its own.

## Acceptance criteria

- [ ] `applyEvent` applies `seq = n + 1`, ignores `seq <= n`, and on `seq = n + 2` switches to `resync` and reconnects.
- [ ] At boot the store goes `connecting` → snapshot → `live`, and the `pilot` slice holds `/api/me`'s data without any page fetching it.
- [ ] Cutting the socket shows the banner with the time of the loss and the Cadre's « Resynchronisation… » status at 390 and 1280 px; reconnecting replays the missed events and removes both.
- [ ] `sensitiveBlockedReason` is the French reason during the Resynchronisation and `null` once `live`.
- [ ] A command answered 409 `realtime.stale` shows its `message` in a halt banner and triggers a catch-up.
- [ ] Every command body sent by `client.ts` carries the store's `seq`.
- [ ] Playwright with axe: no violation in both states.

## Verification

- `pnpm exec nx test web -- src/store/`
- `pnpm exec nx test web -- src/api/client.spec.ts`
- `pnpm exec nx e2e web -- resynchronisation.spec.ts`
- `scripts/captures.sh apps/web/e2e/resynchronisation.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The confirmation dialog and the dispatcher's refusal of an Action sensible: CORE-7.
- The « À toi » page: ATOI-1. The Runner's presence: RUNNER-2.
- Push notifications from the visibility messages: ATOI-4.
- Content read from GitHub through `@tanstack/query-core`: the first ticket that reads it (CONCEPTION-4, PROJET-5).

## Dependencies

- CORE-5.
- UI-3.
