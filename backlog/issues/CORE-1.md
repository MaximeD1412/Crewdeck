---
id: CORE-1
title: "API conventions: error envelope, zod pipe, value shapes, OpenAPI, logger redaction"
epic: CORE
type: chore
priority: P0
size: M
milestone: M1 Socle
blocked_by: [INFRA-2, INFRA-3]
adr: [0003, 0008]
risques: [SEC-7]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0008 settles every cross-cutting choice of the API once, so that each module copies it instead of inventing it: one error envelope, every input validated against a zod schema of `packages/contracts`, value shapes defined once, OpenAPI generated from the schemas. ADR 0003 adds that no payload of the Runner protocol and no Idée ciphertext ever reaches a server log (risk SEC-7). Every later server ticket (CORE-2 onward) builds on these files.

## Current state of the code

- Created by INFRA-1: the Nx monorepo, `apps/server` (NestJS 11, Prisma 7, `GET /api/health`), `packages/contracts` (zod 4, `nx run contracts:generate` writing JSON Schema and the Go types of `apps/runner/internal/contracts`), Vitest with `unplugin-swc` for the server.
- Created by INFRA-2 and INFRA-3: `scripts/worktree.sh`, `ci.yml` / `verify.yml`.
- No error handling, no validation pipe, no logger configuration, no value shapes.

## To do

- `packages/contracts/src/values.ts` (exported from the package's index), the only place these shapes are defined:
  - `zId`: a UUIDv7 string (`z.uuid({ version: 'v7' })`);
  - `zInstant`: ISO 8601 UTC with `Z` (`z.iso.datetime()`), kept a string;
  - `zDay`: `YYYY-MM-DD` (`z.iso.date()`), never converted to an instant;
  - `zUsdMicros`: a non-negative integer (a provider's cost in micro-dollars);
  - `zEurCents`: a non-negative integer;
  - `zSeq`: a non-negative integer (the real-time sequence number of ADR 0007);
  - `zCursorPage(item)`: `{ items: item[], nextCursor: string | null }`, and `zCursorQuery`: `{ cursor?: string, limit?: 1..100 = 50 }`.
- `packages/contracts/src/api/errors.ts`: `zErrorEnvelope` = `{ status: number, code: string, message: string, fields?: Record<string, string> }`, `code` matching `^[a-z0-9-]+\.[a-z0-9-]+$`.
- `apps/server/src/errors/`:
  - `app-error.ts`: `class AppError extends Error { constructor(status: 400|401|404|409|422, code: string, message: string, fields?: Record<string,string>) }` plus helpers `notFound(code, message)`, `conflict(code, message)`, `unprocessable(code, message, fields?)`;
  - `error.filter.ts`: a global exception filter that renders every error as the envelope: `AppError` as is; `ZodValidationException` (nestjs-zod) as 400 `validation.invalid`, message « Certaines valeurs ne sont pas valides. », `fields` mapping each issue's dotted path to its message; Nest's `NotFoundException` on an unknown route as 404 `http.not-found`; anything else as 500 `server.internal`, message « Une erreur inattendue est survenue. », logged with its stack (never the request body);
  - French messages live in `apps/server/src/errors/messages.ts` (one object, keys = codes), so a test can check every code has a message.
- `nestjs-zod`: `ZodValidationPipe` as `APP_PIPE`, `ZodSerializerInterceptor` as `APP_INTERCEPTOR` in `AppModule`; DTOs are `createZodDto(schema)` of a contract.
- OpenAPI: `@nestjs/swagger` with nestjs-zod's `cleanupOpenApiDoc`, served at `/api/docs` and `/api/docs.json` when `NODE_ENV !== 'production'`; absent (404) in production.
- Logger: `nestjs-pino` (pino) as the app's logger, JSON in production, pretty in development. `apps/server/src/logging/redact.ts` exports `REDACT_PATHS`: `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`, `req.body`, `*.ciphertext`, `*.wrappedKey`, `*.payload` (the Runner protocol's and the relay's), `*.token`, `*.accessToken`, `*.refreshToken`, `*.code` of the auth callback query (`req.query.code`, `req.query.state`); censor `[redacted]`. The HTTP auto-logging never logs bodies; WebSocket messages are never logged (only their `type` and size).
- `GET /api/health` (INFRA-1's) keeps its shape; its schema moves to `packages/contracts/src/api/health.ts` if not already there.
- `apps/server/test/route-baseline.ts`: helpers the route tests of every module reuse: `expectEnvelope(res, status, code)`, `expectFields(res, paths[])`.

## Decisions already made

- No RFC 9457: the envelope above, nothing more (ADR 0008).
- No 403 anywhere; another Pilote's resource is a 404 (CORE-2 enforces it).
- `message` is French and shown as is by the page; `code` is English, `<module>.<case>`.
- Exact versions pinned in the root `package.json` (or the pnpm catalog INFRA-1 set up).
- Value shapes are never redefined in a module: a review that finds `z.string().uuid()` elsewhere asks for `zId`.

## Acceptance criteria

- [ ] A test route with a zod DTO answers 400 `validation.invalid` with `fields` naming each invalid path.
- [ ] An `AppError(422, 'test.rule', '…')` is rendered as `{ status: 422, code: 'test.rule', message: '…' }`; an unexpected throw is a 500 `server.internal` whose body has no stack.
- [ ] `zId` accepts a UUIDv7 and refuses a UUIDv4; `zInstant` refuses an offset other than `Z`; `zDay` refuses `2026-02-30`; `zUsdMicros` refuses `-1` and `1.5`.
- [ ] `/api/docs.json` is served in development and is 404 when `NODE_ENV=production`.
- [ ] A redaction test logs a request carrying an `authorization` header, a cookie, a body with `ciphertext` and `payload`, and asserts none of their values appear in the captured output (SEC-7).
- [ ] Every code in `messages.ts` matches the code pattern; every `AppError` code used in `src/` has a message (a test greps the codes).

## Verification

- `pnpm exec nx test contracts -- src/values.spec.ts`
- `pnpm exec nx test server -- src/errors/error.filter.spec.ts src/logging/redact.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`; `pnpm exec nx run contracts:generate` with no diff.

## For prod

Nothing.

## Out of scope

- The Pilote scope and the 404 between Pilotes: CORE-2.
- The 409 of a stale `seq`: CORE-5 (`realtime.stale`) and CORE-7 (`sensitive-action.stale`).
- The page's handling of an error's `message`: CORE-6 (`apps/web/src/api/`).

## Dependencies

- INFRA-2.
- INFRA-3.
