---
id: BOUCLE-8
title: "Planification of the Boucle: at a time, every night, or when a Compte IA's window resets"
epic: BOUCLE
type: feature
priority: P1
size: M
milestone: M4 Boucle
blocked_by: [BOUCLE-2, RUNNER-13]
adr: [0007, 0008]
risques: [IA-4]
stories: [US-62, US-82, US-26]
screens: [boucle, boucle-planification, boucle-reprise-planification, parametres, parametres-projet]
revue_visuelle: true
video: false
---

## Context

US-62: the Pilote schedules the **Boucle** of a **Projet** at a time, every night, or when a **Compte IA**'s window resets, so that agents work when their limits allow it (risk IA-4). Creating the **Planification**, or resuming it after a pause, is confirmed like starting the Boucle and covers each scheduled start and its merges until it is paused or deleted (an **Action sensible**, glossary); stopping one run leaves the next ones planned. « Every night » is computed in the Pilote's time zone (ADR 0008). The Planifications are listed on `/boucle` and in the Paramètres (US-82).

## Current state of the code

- No code in the repository: only the docs and `design/`.
- Created by BOUCLE-2: `apps/server/src/loops/` (`AgentLoop` with `scheduleId` and `stoppedBy: run-end`, `loop-scheduler.ts`), `/boucle` with `PageBoucle` and `LoopCard`, the Rôles shown in the start confirmation.
- Created by RUNNER-13: the usage of each Compte IA with its windows and `resetAt`, the `usage` store slice, `UsageMeter` data.
- Created by CORE-7: `@SensitiveAction('schedule.create')`, `@SensitiveAction('schedule.resume')`, `crewdeck-confirm`.
- Created by PARAM-1: `/parametres` and `pilot.timeZone`; PARAM-3: `/projets/:id/parametres`.
- Created by UI-4, UI-6: `Radio`, `Select`, `ListRow`, `UsageMeter`.

## To do

- Prisma `Schedule` (scoped): `id`, `pilotId`, `projectId`, `kind` (`at` | `nightly` | `window-reset`), `at?` (`timestamptz`, for `at`), `time?` (`HH:MM`, for `nightly`), `engine?` and `window?` (for `window-reset`: `claude-code` or `codex`, `5h` or `week`), `state` (`active` | `paused` | `done`), `pausedAt?`, `nextRunAt?`, `lastRunAt?`, `createdAt`. Several per Projet.
- Contracts `packages/contracts/src/api/schedules.ts` (`zSchedule`, create input with a discriminated union on `kind`, `{ seq }`), event `schedule.upserted` / `schedule.removed`.
- `apps/server/src/schedules/`:
  - `next-run.ts`: pure `nextRunAt(schedule, now, timeZone, usage)`: `at` its instant (null once run); `nightly` the next `time` in `timeZone` after `now`, correct across daylight-saving changes (`date-fns` with `@date-fns/tz`); `window-reset` the `resetAt` of that Compte IA's window, or `now` when the window is not at its limit.
  - `schedules.controller.ts`: `POST /api/schedules` (`@SensitiveAction('schedule.create')`), `GET /api/schedules?projectId=`, `POST /api/schedules/:id/pause`, `POST /api/schedules/:id/resume` (`@SensitiveAction('schedule.resume')`), `DELETE /api/schedules/:id` (204). Errors: 404 `schedule.not-found`; 422 `schedule.at-in-past`, `schedule.engine-unknown` (no such Compte IA on the Runner), `schedule.not-paused`, `schedule.done`; 409 stale; 400 with `fields`.
  - `schedule-runner.ts`: every minute (`@nestjs/schedule`), for each active Schedule with `nextRunAt <= now`, in its Pilote's scope: if the Projet's Boucle is not running, start it with `scheduleId` (no confirmation: the Planification covers it), `lastRunAt`, then recompute `nextRunAt` (`at` → `done`). A Boucle already running skips the run. With the Runner offline the Boucle is `waiting-runner` (ATOI-3's Décision).
  - A run started by a Schedule stops itself when no ready Ticket is left and nothing is in flight (`stoppedBy: run-end`); a stop by the Pilote ends that run only, the Schedule stays `active`.
  - `nextRunAt` of `window-reset` Schedules is recomputed on each `usage` report.
  - `schedules.state.ts`: `StateContributor` key `schedules`.
- Web:
  - `apps/web/src/api/schedules.ts`; `apps/web/src/views/schedules.ts` (pure: the list's titles « Chaque nuit à 01:00 », « Quand la fenêtre de Claude se réinitialise », « Le 12 nov. à 22:00 », and metas « Personal OS · prochaine cette nuit », « active · prochaine à 16:40 », « en pause depuis hier »).
  - Composant `ScheduleList` (`packages/contracts/src/composants/schedule-list.ts`, `packages/skin-passerelle/src/schedule-list.ts`), actions `add`, `pause`, `resume` (`sensitive: true`), `remove`; placed in `PageBoucle` (card « Planifications », or « Planification » with one Projet selected), in `/parametres` (card « Planifications » with « Ajouter ») and in `/projets/:id/parametres` (card « Planifications »).
  - The « Planifier » button of the `/boucle` header and « Ajouter »: the core's `crewdeck-confirm` « Planifier la Boucle de <Projet> », action « Créer la Planification », with its form section (Radio « À une heure », « Chaque nuit à l'heure choisie », « Quand la fenêtre d'un Compte IA se réinitialise »; the time or the Select « Compte IA »; a Select « Projet » when opened from `/parametres`) and the consequences of the mockup (background work « Code sur <Moteur>, Review sur <Moteur> », the merges by the Boucle, « Arrêter une exécution laisse les suivantes prévues. »). `crewdeck-confirm` gets an optional form section built by the core, never by the Skin.
  - « Reprendre »: `crewdeck-confirm` « Reprendre la Planification de <Projet> ? », action « Reprendre la Planification », with its schedule and the same consequences.
  - The « Comptes IA » card of `/boucle` (UsageMeters of RUNNER-13's usage, « Claude · 5 h », « Claude · semaine »).
- Test scenarios `apps/server/src/testing/scenarios/boucle-planification.ts`, Playwright `apps/web/e2e/boucle-planification.spec.ts` and the `parametres` spec's Planifications card.

## Decisions already made

- Mockup: `boucle`, `boucle-planification`, `boucle-reprise-planification`, `parametres`, `parametres-projet` (pages `design/screens/crewdeck/boucle.html`, `…/boucle-planification.html`, `…/boucle-reprise-planification.html`, `…/parametres.html`, `…/parametres-projet.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. On `parametres` and `parametres-projet`, only the « Planifications » card is this ticket's.
- Pause and delete need no confirmation (they stop work); « Supprimer » is the `danger` button.
- A `window-reset` Schedule starts « dès que la limite le permet »: at `resetAt`, or at once when the window has room.
- Times are stored as UTC instants; `time` of `nightly` is the Pilote's wall-clock time, recomputed when `pilot.timeZone` changes.

## Acceptance criteria

- [ ] Creating a Planification asks the core's confirmation with the form and the consequences; confirmed, it is `active` with its `nextRunAt`, and its event reaches the tab.
- [ ] `nextRunAt` for « chaque nuit à 02:00 » in `Europe/Paris` is right on the nights of the daylight-saving changes (unit tests).
- [ ] At `nextRunAt` the Boucle starts with `scheduleId`, without a confirmation; when no ready Ticket is left it stops with `stoppedBy: run-end`.
- [ ] Stopping a scheduled run leaves the Schedule `active` with its next run.
- [ ] A paused Schedule never starts; resuming it asks the confirmation again.
- [ ] A `window-reset` Schedule follows the `resetAt` of the reported usage.
- [ ] Routes: 422 for each business rule above, 409 stale `seq`, 404 for another Pilote's Schedule, 401, 400 with `fields`.
- [ ] `/boucle` (Planifications and Comptes IA cards, the two dialogs) and the Planifications cards of the Paramètres match the mockups at 390 and 1280 px (Playwright, axe without violations); the captures come from those tests.

## Verification

- `pnpm exec nx test server -- src/schedules/`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- schedules`
- `pnpm exec nx test skin-passerelle -- src/schedule-list.spec.ts`
- `pnpm exec nx e2e web -- boucle-planification.spec.ts`
- `scripts/captures.sh apps/web/e2e/boucle-planification.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

A migration (table `schedules`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- Several Boucles at once: US-54 (Lancement).
- The limits' Décisions: BOUCLE-7. The usage meters' data: RUNNER-13.

## Dependencies

- BOUCLE-2
- RUNNER-13
