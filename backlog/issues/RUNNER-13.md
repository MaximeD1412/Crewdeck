---
id: RUNNER-13
title: "Usage of each Compte IA against its limits, projection at the current pace, and the month's estimated spend in euros"
epic: RUNNER
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-7, UI-6, ATOI-1]
adr: [0004, 0008, 0003]
risques: [IA-4, BIZ-4]
stories: [US-55]
screens: [runner, a-toi]
revue_visuelle: true
video: false
---

## Context

US-55: the Pilote sees the usage of each Compte IA against its limits (the 5-hour and weekly windows where the provider has them) and when it will run out at the current pace, and for an API key its estimated spend of the month, so that they start the Boucle when it can finish. The Runner reports usage as figures, never content (ADR 0004). A cost is stored as the provider bills it, in integer micro-dollars, and shown in euros as an estimate, converted at the ECB reference rate of the spend's day (ADR 0008, risk BIZ-4). The Boucle's limits (BOUCLE-7), the Planification at a window's reset (BOUCLE-8) and the statistics' cost per Ticket (PILOTAGE-3) read what this ticket stores.

## Current state of the code

- Created by RUNNER-7: `AiAccount` (`apps/server/src/runners/ai-accounts/`), the `capabilities` message, the page `/runner` (`PageRunner`, with an Emplacement `usage` at its top), `apps/server/src/testing/scenarios/runner.ts`.
- Created by RUNNER-4/RUNNER-5/RUNNER-6: the normalised `usage` and `limit-reached` events with `windows`, `costUsdMicros`, tokens.
- Created by ATOI-1: the page `/a-toi` (`PageAToi`), its view `apps/web/src/views/a-toi.ts` and its Décisions card.
- Created by UI-6: `UsageMeter` (`label`, `value`, `detail`, variants caution and halt), `Stat`; UI-2: Card, KeyValue.
- Created by CORE-1: `zUsdMicros`; PARAM-1: `pilot.timeZone`.
- No usage table, no `fx_rates`.

## To do

- **Protocol** `packages/contracts/src/runner/usage.ts`: `usage` (Runner → server) `{ engine, accountKind, windows: [{ id: 'five-hour'|'week', usedPercent: 0..100, resetsAt }], spend?: { sessionId?, costUsdMicros }, measuredAt }`, sent by the Runner whenever an adapter emits `usage` or `limit-reached` (windows), and at each Session's `result` (spend), and every 10 min while a Session runs. Fixture.
- **Server** `apps/server/src/usage/`:
  - Prisma `UsageMeasure` (`usage_measures`): `pilotId`, `engine`, `window`, `usedPercent`, `resetsAt`, `measuredAt`; kept 30 days.
  - Prisma `Spend` (`spends`): `id`, `pilotId`, `engine`, `projectId?`, `sessionId?`, `stepRunId?`, `day` (`zDay` in the Pilote's time zone), `costUsdMicros`, `costEurCents` (converted at write time), `measuredAt`. The `projectId`/`stepRunId` are taken from the Session.
  - Prisma `FxRate` (`fx_rates`, a global table on the scope allowlist): `day`, `usdPerEur` (decimal string, the ECB's rate: 1 EUR = x USD). A job daily at 16:30 Europe/Frankfurt fetches `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` through an injectable `FxSource` (a fake in tests: no test calls the ECB); a day without a rate uses the last known one.
  - `toEurCents(usdMicros, day)`: `round(usdMicros / 1e6 / usdPerEur * 100)`; pure, tested on rounding and a missing day.
  - Projection `projection.ts`: for a window, from the measures of the current window over the last 24 h (at least 2 measures spanning 30 min), a linear pace in % per hour; `exhaustsAt = now + (100 - used) / pace`; `null` when there is no pace or when `exhaustsAt` is after `resetsAt` (« tient jusqu'à la réinitialisation »). Pure, tested.
  - `GET /api/usage` → `{ accounts: [{ engine, kind, windows: [{ id, usedPercent, resetsAt, exhaustsAt?, measuredAt }], monthSpend?: { costUsdMicros, costEurCents }, measuredAt }] }` (`monthSpend` for an API-key account: the sum of the current calendar month in the Pilote's time zone). `StateContributor` key `usage`; `usage.upserted` written with each measure or spend.
  - Contract `packages/contracts/src/api/usage.ts`.
- **Web**:
  - `UsageCard` Composant (`packages/contracts/src/composants/usage-card.ts`, `packages/skin-passerelle/src/usage-card.ts`): per account a title (« Claude · abonnement », « Codex · clé API »), a `UsageMeter` per window (label « Fenêtre de 5 h » / « Semaine », value, detail the reset time or day; caution from 80 %, halt at 100 %) with the sentence under it (« Limite atteinte ; réinitialisation à 16:40. », « Réinitialisation lundi ; au rythme actuel, la semaine tient jusqu'à jeudi. »), a KeyValue « Dépense estimée du mois » for an API key; when the Runner is offline, the line « Dernière mesure à HH:MM, avant que le Runner se coupe. ».
  - Placed in `PageRunner`'s `usage` Emplacement (view `apps/web/src/views/runner.ts`).
  - « À toi »'s aside card « Comptes IA » (`PageAToi`'s aside, view `apps/web/src/views/a-toi.ts`): compact meters (« Claude · 5 h », « Claude · semaine ») with the projection sentence.
  - Copy keys `usage.*` (relative days and times through the SDK's formatters).
- **Runner**: send `usage` as above from the Session manager (RUNNER-9) or, if a Session is not running, from the last adapter report kept in memory.
- Scenarios: extend `scenarios/runner.ts` and `scenarios/a-toi.ts` with measures and spends.

## Decisions already made

- Mockup: `runner`, `a-toi` (pages `design/screens/crewdeck/runner.html`, `…/a-toi.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. Only the « Usage des Comptes IA » card of `runner` and the « Comptes IA » card of `a-toi` are this ticket's.
- Costs are stored in micro-dollars and converted once, at the spend's day rate (ADR 0008: the same Ticket's cost never changes); the euro figure is always labelled « estimé(e) ».
- A subscription has no spend: its cost per Ticket is a share of the window (PILOTAGE-3).
- The ECB fetch is the only outside call of the server besides GitHub and Web Push; it runs in the server, never the browser.

## Acceptance criteria

- [ ] A `usage` message stores its measures and spend with `usage.upserted`; `GET /api/usage` matches its schema; 401; another Pilote's usage is never returned.
- [ ] `toEurCents` uses the spend day's rate, or the last known one; the fetch job stores the day's rate from a fake ECB file.
- [ ] The projection says « tient jusqu'à jeudi » for a steady pace, nothing with one measure, and « jusqu'à la réinitialisation » when the window resets first.
- [ ] The month's spend sums the current month in the Pilote's time zone (a spend at 23:30 UTC on the last day of the month counts in the right month for `Europe/Paris`).
- [ ] `/runner` shows the usage card online and offline (« Dernière mesure à … »); « À toi » shows the « Comptes IA » card; both update without reload when a measure arrives.
- [ ] Both screens pass Playwright at 390 and 1280 px with axe.

## Verification

- `pnpm exec nx test server -- src/usage/`
- `pnpm exec nx test-integration server -- usage`
- `pnpm exec nx test skin-passerelle -- src/usage-card.spec.ts`
- `pnpm exec nx e2e web -- runner.spec.ts`
- `pnpm exec nx e2e web -- a-toi.spec.ts`
- `cd apps/runner && go test ./internal/session/`
- `scripts/captures.sh apps/web/e2e/runner.spec.ts apps/web/e2e/a-toi.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

- Outbound HTTPS from the server to `www.ecb.europa.eu` allowed (mirrored in `docs/pilotage/mep.json`).

## Out of scope

- The Décisions « Limite atteinte » and « Compte IA déconnecté »: BOUCLE-7. A Planification at a window's reset: BOUCLE-8.
- Cost per Ticket and the statistics: PILOTAGE-3. The « Plafond » of a Projet: Bêta (US-74).

## Dependencies

- RUNNER-7.
- UI-6.
- ATOI-1.
