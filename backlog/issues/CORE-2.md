---
id: CORE-2
title: "Pilote scope: guard, Prisma extension, global-tables allowlist"
epic: CORE
type: chore
priority: P0
size: S
milestone: M1 Socle
blocked_by: [CORE-1]
adr: [0008]
risques: [SEC-1]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

Crewdeck hosts several Pilotes; the worst fault is one Pilote seeing another's data (risk SEC-1). ADR 0008 « Scope of a Pilote »: a guard opens the scope for each request, a Prisma client extension adds `pilotId` to every query of a scoped model and throws outside a scope, global tables are an explicit allowlist checked by a test that walks the Prisma models. Every module from CORE-4 on runs inside this scope.

## Current state of the code

- Created by INFRA-1: `apps/server` with Prisma 7 (`apps/server/prisma/schema.prisma`, no business model yet), PostgreSQL 18 through `pnpm db:up`, integration tests on a throwaway database per run.
- Created by CORE-1: `apps/server/src/errors/` (`AppError`, envelope), `apps/server/test/route-baseline.ts`.
- No `Pilot` model, no scope, no guard.

## To do

- `apps/server/prisma/schema.prisma`: `model Pilot { id String @id @db.Uuid; githubUserId BigInt @unique @map("github_user_id"); login String; timeZone String @map("time_zone"); seq BigInt @default(0); createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz; @@map("pilots") }` (CORE-4 adds the token columns, CORE-5 uses `seq`). UUIDv7 ids are generated in code (`apps/server/src/ids.ts`, `newId()` with the `uuid` package's `v7`).
- `apps/server/src/scope/`:
  - `scope.context.ts`: an `AsyncLocalStorage<{ pilotId: string }>`; `runInPilotScope(pilotId, fn)` for webhooks and scheduler jobs (ADR 0008: they open the scope of the Pilote they concern); `currentPilotId()` throws `ScopeMissingError` when outside a scope;
  - `scope.guard.ts`: `ScopeGuard`, a global guard that reads the authenticated principal set on the request by the auth layer (`req.principal = { kind: 'pilot' | 'runner', pilotId }`, set by CORE-4 for the cookie and RUNNER-2 for the Runner's token) and runs the handler inside `runInPilotScope`; routes decorated `@Public()` (health, auth callback, webhooks, install script) skip it; any other route without a principal is 401 `auth.required`, message « Connecte-toi pour continuer. »;
  - `prisma-scope.extension.ts`: a `$extends` query extension on every model of `SCOPED_MODELS`: adds `where.pilotId = currentPilotId()` on find/count/update/delete/upsert/aggregate/groupBy, sets `data.pilotId` on create/createMany, and throws when `data.pilotId` or `where.pilotId` is given with another value;
  - `scope.models.ts`: `GLOBAL_MODELS` (the allowlist: `Pilot`, and later `FxRate`, `GithubInstallation`, `WebhookDelivery`), every other model is scoped;
  - `PrismaService` (`apps/server/src/prisma/prisma.service.ts`) exposes the extended client as `prisma.scoped` and the raw one as `prisma.unscoped`, the raw one only importable from `src/scope/`, `src/auth/` and `src/github/webhooks/` (an ESLint `no-restricted-imports` rule with these exceptions).
- `apps/server/src/scope/scope.models.spec.ts`: walks `Prisma.dmmf.datamodel.models` and fails when a model is neither in `GLOBAL_MODELS` nor has a `pilotId` field with an index starting with `pilotId`.
- No scoped business table is added here: see « Decisions already made » for how the extension is tested.

## Decisions already made

- The extension is tested with a pure unit test that feeds it fake query arguments (`extension.query.$allModels.findMany({ model: 'Ticket', args, query })`) and asserts the rewritten `args`; no real scoped table is needed in this ticket. The first real scoped table (CORE-4's `WebSession`) gets the integration test « another Pilote's row is invisible ».
- 404, never 403, for another Pilote's resource (ADR 0008): a scoped `findFirst` returns `null`, the service throws `notFound`.
- Scheduler jobs and webhooks call `runInPilotScope` before touching a scoped model; calling a scoped model outside a scope is a bug and throws `ScopeMissingError` (500).

## Acceptance criteria

- [ ] A `findMany` on a scoped model inside `runInPilotScope('p1')` is rewritten with `where.pilotId = 'p1'`; a `create` gets `data.pilotId = 'p1'`.
- [ ] A scoped query outside any scope throws `ScopeMissingError`; a query passing another `pilotId` throws.
- [ ] A global model (`Pilot`) is not rewritten.
- [ ] The models walk fails when a model lacks `pilotId` and is not allowlisted (proved by running the check on a hand-built DMMF fixture).
- [ ] A route without `@Public()` and without principal answers 401 `auth.required` with the envelope.
- [ ] ESLint refuses an import of `prisma.unscoped` from a module outside the allowed folders.

## Verification

- `pnpm exec nx test server -- src/scope/`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the `pilots` migration runs with the deploy).

## Out of scope

- How the principal is authenticated: CORE-4 (session cookie), RUNNER-2 (Runner token).
- The route baseline's 404-between-Pilotes test of each route: written by each module's ticket with `route-baseline.ts`.

## Dependencies

- CORE-1.
