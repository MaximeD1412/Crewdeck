---
id: INFRA-4
title: "Playwright harness at 390 and 1280 px with axe, test scenarios seeded on the server, scripts/captures.sh"
epic: INFRA
type: chore
priority: P0
size: M
milestone: M0 Skeleton and delivery
blocked_by: [INFRA-1]
adr: [0008, 0009]
risques: [AGT-2]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

Every screen is proven by a Playwright test at 390 and 1280 px against the fake Runner and the fake GitHub, axe without violations, and the captures of a visual review come from the same tests (ADR 0008 « Test baseline », ADR 0009 « Visual review »). A ticket with `revue_visuelle: true` runs `scripts/captures.sh` and links the captures from the orphan branch `captures/<n>` in its PR (AGENTS.md « Delivering a ticket »). This ticket builds the harness and the seeding mechanism every screen ticket uses: a screen ticket adds a scenario and a spec, nothing else.

## Current state of the code

- Created by INFRA-1: `apps/web` (Vite on 4200, proxy `/api` to 3000), `apps/server` (NestJS, `src/config/env.ts`, `/api/health`), `pnpm dev` (sets `CREWDECK_FAKES=1`).
- No Playwright, no `apps/server/src/testing/`, no `scripts/captures.sh`.

## To do

- **Server, `apps/server/src/testing/`**: `testing.module.ts` imported by `AppModule` only when `NODE_ENV` is `test` or `development` (a `TestingModule.forEnvironment(env)` returning an empty module otherwise); `testing.controller.ts`: `POST /api/testing/scenarios/:name` (body `{}`) → runs the scenario, returns `{ name, path, sessionCookie: string | null }`, 404 `testing.unknown-scenario` for an unknown name; `scenarios/index.ts`: the registry, `defineScenario({ name, path, seed })` where `seed(ctx)` gets `{ prisma, fakes }` and returns `{ sessionCookie?: string }`; `ctx.fakes` is an object other tickets extend (the fake GitHub of CORE-3, the fake Runner of RUNNER-2). Each scenario first resets the database's data tables (`TRUNCATE … CASCADE` on every model except the migration table) and the fakes. One scenario now, `scenarios/blank.ts` (`name: 'blank'`, `path: '/'`).
- **Web, Playwright** (`@playwright/test`, `@axe-core/playwright`): `apps/web/playwright.config.ts` with two projects `phone` (`viewport: { width: 390, height: 844 }`, `isMobile: true`, `hasTouch: true`, Chromium) and `desktop` (`1280 × 800`); `webServer`: `pnpm dev` (reuse an existing server locally, not in CI), `baseURL` `http://localhost:4200`; target `e2e` in `apps/web/project.json` (`nx e2e web -- <spec>` runs one spec).
- `apps/web/e2e/fixtures.ts`: `test` extended with `scenario(name)` (POST to the testing route, sets the returned cookie on the context, navigates to its `path`), `expectAccessible(page)` (axe, tags `wcag2a`, `wcag2aa`, `wcag21aa`, no violation, its report attached on failure), `capture(page, screenId)` (when `CAPTURES_DIR` is set: full-page PNG `<CAPTURES_DIR>/<screenId>-<390|1280>.png`, the width from the project; else nothing).
- `apps/web/e2e/smoke.spec.ts`: scenario `blank`, the page shows « Crewdeck », `expectAccessible`.
- `apps/web/e2e/captures.spec.ts`: reads `CAPTURES_SCENARIOS` (comma-separated scenario names), for each one runs `scenario(name)`, waits for `networkidle`, `capture(page, name)`.
- **`scripts/captures.sh <scenario>…`** (bash): refuses to run without a scenario name (usage, exit 2) and when `NODE_ENV=production`; finds the ticket number `<n>` from the branch (`feat/<n>-…`, `fix/<n>-…`, `chore/<n>-…`, else `--ticket <n>`); runs `CAPTURES_DIR=<tmp> CAPTURES_SCENARIOS=<names> pnpm exec nx e2e web -- captures.spec.ts`; then in a temporary worktree of the orphan branch `captures/<n>` (created with `git switch --orphan` when absent, fetched from `origin` otherwise) replaces the files of these scenarios, commits « captures(#<n>) : <names> », pushes `origin captures/<n>`, removes the worktree, and prints one Markdown line per capture: `![<scenario> 390](https://github.com/MaximeD1412/Crewdeck/blob/captures/<n>/<scenario>-390.png?raw=true)` (the repository from `.process.json`'s `repo`).
- AGENTS.md « Delivering a ticket »: replace « `scripts/captures.sh` for each screen it changes » with « `scripts/captures.sh <scenario>…` with the scenarios of each screen and state it changes (their names are the ids of `design/screens.json`, `<id>` or `<id>-<state>`) ».

## Decisions already made

- A scenario's name is the id of the screen or state it shows in `design/screens.json` (`a-toi`, `a-toi-vide`): the captures line up with the mockups' captures of the same name.
- The testing module never exists in production: `NODE_ENV=production` gives a 404 for `/api/testing/*` and the module is not even imported.
- Captures are Chromium only; one browser keeps them stable between runs.
- The orphan branch holds only captures, never code; it is never merged.
- Personal-os's `scripts/captures.sh` (repository `MaximeD1412/personal-os`) is the model for the branch handling; Crewdeck's captures come from Playwright, not from a running stack with a demo session.

## Acceptance criteria

- [ ] `pnpm exec nx e2e web -- smoke.spec.ts` passes in both projects with no axe violation.
- [ ] `POST /api/testing/scenarios/blank` returns `{ name: 'blank', path: '/', sessionCookie: null }` in development; an unknown name gives 404 with code `testing.unknown-scenario`; with `NODE_ENV=production` the route gives 404 (integration test of the server booted in production mode).
- [ ] `scripts/captures.sh blank` on a branch `chore/12-x` pushes `blank-390.png` and `blank-1280.png` (390 and 1280 px wide) to `captures/12` and prints their two Markdown lines; run again, it replaces them in a new commit.
- [ ] Without a scenario name, `scripts/captures.sh` prints its usage and exits 2.

## Verification

- `pnpm exec nx e2e web -- smoke.spec.ts`
- `pnpm exec nx test server -- src/testing/testing.controller.spec.ts`
- `shellcheck scripts/captures.sh`

## For prod

Nothing.

## Out of scope

- The fake GitHub: CORE-3. The fake Runner: RUNNER-2. Signing a Pilote in from a scenario: CORE-4. The CI job that runs `e2e`: INFRA-3.

## Dependencies

- INFRA-1.
