---
id: ATOI-5
title: "« Depuis ta dernière visite »: the last visit of « À toi » across Appareils and the summary per Projet"
epic: ATOI
type: feature
priority: P1
size: M
milestone: M4 Boucle
blocked_by: [RUNNER-23, BOUCLE-4, BOUCLE-5]
adr: [0003, 0007, 0008]
risques: []
stories: [US-114]
screens: [a-toi-depuis-derniere-visite]
revue_visuelle: true
video: false
---

## Context

US-114: when « À toi » has been visible on none of the Pilote's **Appareils** for more than an hour, its top says per **Projet** what happened meanwhile: the **Tickets** merged and blocked, the **Décisions** raised and settled, the spend, each figure a link, the block closable. The Pilote then knows in seconds what the **Boucle** did overnight. The figures come from the tables (merges, Décisions, `Spend` rows of RUNNER-23), never from the events, which are purged after 7 days (ADR 0007). The server reads only numbers, ids and dates: titles are completed by the page from its store, a Local Projet's decrypted (ADR 0003).

## Current state of the code

- `apps/web/src/routes.ts` (`/a-toi`, `aToiRoute` line 34 gives `/a-toi?projet=<id>`), `apps/web/src/views/a-toi.ts` (`aToiView`: the `PageAToi` data from the store), `packages/contracts/src/composants/page-a-toi.ts` (`cd-page-a-toi`: `total`, `projects`, `decisions`, `canNoteIdea`; slots `loops`, `ai-accounts`; actions `filter`, `open`, `act`, `note-idea`), its skin in `packages/skin-passerelle/src/`.
- `apps/web/src/store/connection.ts`: `sendVisibility` sends `{ type: 'visibility', visible }` on each `visibilitychange`; the server's `apps/server/src/realtime/tab-presence.ts` keeps it in memory, per Pilote, lost on restart: it says nothing of the route nor of the past hour. `Device.lastSeenAt` is touched hourly: not presence.
- `apps/web/src/store/index.ts`: slices, `shape: 'single'` for `settings`; `apps/server/src/settings/settings.controller.ts` `SettingsState`: a `StateContributor` of a single slice.
- `apps/server/prisma/schema.prisma`: `CodeChange` (~972: `projectId`, `ticketNumber`, `mergedAt`, `mergedBy`, `mergeSha`), `Decision` (~481: `kind`, `projectId`, `subjectType`, `subjectId`, `link`, `state`, `outcome`, `createdAt`, `resolvedAt`; resolved ones are kept), `Spend` (~611, RUNNER-23 adds `kind`, `windowPermille`); `apps/server/src/realtime/events.writer.ts`, `apps/server/src/realtime/retention.job.ts` (events purged after 7 days); `packages/contracts/src/events/index.ts` (the event types).
- `packages/contracts/src/api/decisions.ts`: `ticket-blocked` in `DECISION_KINDS`.
- Created by BOUCLE-4: the merge of the Boucle (`CodeChange.mergedAt`, `mergedBy: loop`); BOUCLE-5: `ticket-blocked` raised (subject the Ticket), the Ticket's page `/projets/:id/tickets/:number`; RUNNER-23: the `Spend` rows per Session with `kind`, `costUsdMicros`, `windowPermille`, `projectId`, and `sumSpend` (`apps/server/src/usage/spend-sum.ts`).
- Design: `design/screens/crewdeck/a-toi-depuis-derniere-visite.html`, components `ui-away-summary`, `ui-away-row` in `design/components.js`.

## To do

- Prisma `AToiVisit` (`a_toi_visits`): `pilotId @id`, `lastSeenAt`, `awayFrom?`, `awayTo?`, `closedAt?`; one migration; on the scope's tables (`apps/server/src/scope/scope.models.ts`).
- Contract `packages/contracts/src/api/a-toi.ts`: `zAToiSummary` `{ from, to, projects: [{ projectId, merged: [{ number, link }], blocked: [{ number, link }], decisionsRaised, decisionsSettled, links: { raised?, settled? }, spend: [{ engine, kind, eurCents?, windowPermille? }] }] }`; event `a-toi-visit.upserted` `{ awayFrom, awayTo, closedAt }` (`packages/contracts/src/events/a-toi-visit.ts`, registered in `index.ts`), slice `aToiVisit` of `GET /api/state` (`shape: 'single'`).
- `apps/server/src/a-toi/` (module, controller, service, errors in French in `apps/server/src/errors/messages.ts`):
  - `POST /api/a-toi/seen` → 204, no body. In one transaction: no row → create it with `lastSeenAt = now`, no window (a first visit shows nothing); `now − lastSeenAt > 60 min` → `awayFrom = lastSeenAt`, `awayTo = now`, `closedAt = null`; then `lastSeenAt = now`; `a-toi-visit.upserted` written only when the window changed. Pure `visitAfter(previous, now): AToiVisit` (the 60-minute rule), the clock injected (`RunnerClock`).
  - `GET /api/a-toi/summary` → `AToiSummary | null`: `null` without a window or when `closedAt` is set; else, per Projet of the Pilote, computed from the tables over `[awayFrom, awayTo)`: `CodeChange.mergedAt` in the period (merged: its Ticket number, its link `/projets/:id/tickets/:number`); Décisions `ticket-blocked` created in the period (blocked: the Ticket's number and link); `decisionsRaised` = Décisions created in the period, `decisionsSettled` = Décisions with `resolvedAt` in the period (each count includes `ticket-blocked`); `spend` = `sumSpend` of the Projet's `Spend` rows with `measuredAt` in the period. A Projet with all its figures at zero is left out; no Projet left → `null`. Never reads `events`. `links.raised` / `links.settled`: the Décision's own `link` when its count is 1, absent otherwise. 404 `a-toi.not-found` never (a null answer); 401 without a session.
  - `POST /api/a-toi/summary/close` → 204, sets `closedAt = now` when a window exists and is open, writes the event in the same transaction; idempotent.
  - `StateContributor` of key `aToiVisit`.
- Composant `packages/contracts/src/composants/away-summary.ts` (`cd-away-summary`, in `COMPOSANTS`, an `examples` entry from the mockup) and its skin `packages/skin-passerelle/src/away-summary.ts` (shadow DOM, `--cd-*` tokens): data `{ since, rows: [{ projectName, merged: { count, href? }, blocked, raised, settled, spend: [{ text }] }] }` (texts already written by the view), action `close`; each non-zero figure a link (`cd-action` `open` with its `href`), zero shown plain; `since` « depuis 23:40 · il y a 9 h ». It is placed above the Projet filter, under the page's header, as a new `summary` Emplacement of `cd-page-a-toi` rather than a field of its data: the page's data stays the Décisions' (like `loops` and `ai-accounts`) and a Skin may reshape the block alone; absent when the Emplacement is empty.
- Web:
  - `apps/web/src/api/a-toi.ts`: `seen()`, `summary()` (a query, not the store), `closeSummary()`.
  - `apps/web/src/a-toi-visit.ts`: while `/a-toi` is the route and the tab is visible (`document.visibilityState`), `seen()` on arrival and every 5 minutes; stops on hidden or route change, starts again on visible. Fails silently (a lost ping only delays the window).
  - `apps/web/src/views/away-summary.ts` (pure): `awaySummaryData(summary, store, now)` completes the row: Projet name (a Local one decrypted), the links, the spend written with its Compte IA: euros `2,40 € de Codex` for `api-key` (`eurCents`, ECB rate already applied: shown as an estimate), `1,2 fenêtre de Claude` for `subscription` (`windowPermille / 1000`, one decimal, comma), « 0,2 fenêtre » never rounded to 0 while the share is positive; the figures' link: count 1 → the item's link, else the Projet's `/a-toi?projet=<id>` for « levées » and its page `/projets/:id` for the others. t() keys `aToi.away.*` (« Depuis ta dernière visite », « Projet », « Tickets mergés », « Tickets bloqués », « Décisions levées », « Décisions réglées », « Dépense », « Fermer « Depuis ta dernière visite » », « depuis {heure} · il y a {durée} »), the duration through the SDK's formatter.
  - The page loads the summary when the `aToiVisit` slice shows an open window, once per window; « Fermer » calls `closeSummary()` and hides the block at once; the event then hides it on every other Appareil.
- Test scenario `apps/server/src/testing/scenarios/a-toi-depuis-derniere-visite.ts` (id of the screen: four Projets, one Local; merges, a blocked Ticket, Décisions raised and settled, an API-key and a subscription spend, a window of 9 h), Playwright `apps/web/e2e/a-toi-depuis-derniere-visite.spec.ts`.

## Decisions already made

- Mockup: `a-toi-depuis-derniere-visite` (page `design/screens/crewdeck/a-toi-depuis-derniere-visite.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The Décisions' rows of the mockup (« Session sans progrès », « Repris hors Crewdeck ») are SESSION-4's and SESSION-5's.
- The last visit is the Pilote's, across Appareils, kept on the server in a table: the tab presence is in memory and lost on a restart, and `Device.lastSeenAt` is hourly. A visit is « À toi » visible, on any Appareil.
- The window is fixed when the Pilote comes back (`awayFrom = lastSeenAt`, `awayTo = now`) and stays until closed or replaced by the next absence; reloading shows the same figures, which stay computable because they read tables, not events.
- A first visit (no row) shows nothing; nothing new since the last visit shows nothing at all, not an empty block (nothing is happening to report; a Projet with all zeros is left out).
- Spend is written with its Compte IA (« 2,40 € de Codex », « 1,2 fenêtre de Claude »): a Projet may use both. Euros are an estimate (BIZ-4), the ECB rate of the spend's day (ADR 0008).
- The summary carries numbers and ids only (ADR 0003); a Ticket's title is never in the response.
- Merges counted are those of the Boucle and of the Pilote at the Source: what changed on the Projet while away.

## Acceptance criteria

- [ ] `visitAfter`: no row → no window; a gap of 59 min → no window; 61 min → the window `[lastSeenAt, now)`, `closedAt` null; a visit 10 min later keeps it (unit tests, clock injected).
- [ ] `POST /api/a-toi/seen` from one Appareil, then the same 90 min later from another: the second opens the window, the event `a-toi-visit.upserted` is written in the same transaction; a ping of a visible tab every 5 min never opens one.
- [ ] `GET /api/a-toi/summary` returns, for a Projet with 3 merges, 1 blocked Ticket, 5 Décisions raised, 1 settled, a Codex API-key spend of 2,40 € and 1 200 permille of Claude, exactly those figures with links; `Spend` rows and Décisions outside `[from, to)` are not counted; a purged event changes nothing.
- [ ] A Projet with nothing is absent; nothing at all, or a closed window, or no window: `null`, and the page shows no block.
- [ ] « Fermer » hides the block on the tab and, through the event, on another Appareil; the next absence opens a new window and shows it again.
- [ ] No response of `/api/a-toi/*` holds a title; the page names a Local Projet and its Tickets from the decrypted store.
- [ ] Another Pilote's merges, Décisions and spend never count (integration test); 401 without a session.
- [ ] The spend reads « 2,40 € de Codex » and « 1,2 fenêtre de Claude »; a Projet with no spend shows an empty cell.
- [ ] `/a-toi` with the block matches `a-toi-depuis-derniere-visite` at 390 and 1280 px (Playwright against the fake Runner and the fake GitHub, axe without violations); the captures come from those tests.

## Verification

- `pnpm exec nx test server -- src/a-toi/`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- a-toi`
- `pnpm exec nx test contracts`, `pnpm exec nx test skin-passerelle -- src/away-summary.spec.ts`
- `pnpm exec nx test web -- src/views/away-summary.spec.ts src/a-toi-visit.spec.ts`
- `pnpm exec nx e2e web -- a-toi-depuis-derniere-visite.spec.ts`
- `scripts/captures.sh a-toi-depuis-derniere-visite`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

A migration (`a_toi_visits`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- The spend rows and their units: RUNNER-23. The statistics' spend: PILOTAGE-4.
- The Décisions shown below the block (« Session sans progrès », « Repris hors Crewdeck »): SESSION-4, SESSION-5.
- The push of a Décision when away: ATOI-4.
- A summary for a client or a weekly report (Bêta).

## Dependencies

- RUNNER-23
- BOUCLE-4
- BOUCLE-5
