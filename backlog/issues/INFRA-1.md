---
id: INFRA-1
title: "Monorepo walking skeleton: Nx, three apps, three packages, contracts generated for TypeScript and Go, /api/health"
epic: INFRA
type: chore
priority: P0
size: M
milestone: M0 Skeleton and delivery
blocked_by: []
adr: [0001, 0006, 0008, 0009]
risques: [AGT-3]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0001 fixes the shape of Crewdeck: an Nx monorepo on pnpm (Node 24) with `apps/server` (NestJS), `apps/web` (Lit), `apps/runner` (Go) and `packages/contracts`, `packages/sdk`, `packages/skin-passerelle`, the contracts written once in zod and generated to JSON Schema and Go types. Every later ticket starts from this skeleton: it must build, lint, typecheck and test from the first commit, so `nx affected` and the CI (INFRA-3) have something to run. This ticket creates the files that need no sign-in; the conventions (CORE-1), the scope (CORE-2) and the Projets module (PROJET-2) are the next « first files to imitate ».

## Current state of the code

- Nothing but documents: `README.md`, `AGENTS.md` (repo layout, commands of « Checking »), `CLAUDE.md`, `CONTEXT.md`, `.process.json`, `.gitignore`, `docs/product/prd.md`, `docs/adr/0001` to `0009`, `docs/pilotage/risques.json`, `design/` (mockups, never imported).
- No `package.json`, no `nx.json`, no `.mise.toml`, no `docker-compose.yml`.

## To do

- **Toolchain**: `.mise.toml` pinning Node 24 (latest 24.x), pnpm (latest 10.x) and Go (latest stable 1.x), with `[settings] experimental = false`; `package.json` with `"packageManager": "pnpm@<same version>"`, `"engines": { "node": ">=24" }`; `pnpm-workspace.yaml` (`apps/*`, `packages/*`) with a `catalog:` for the shared versions (zod 4, vitest, lit 3, typescript).
- **Nx 23**: `nx.json` (named inputs `default`, `production`, `go` = `{projectRoot}/**/*.go`, `{projectRoot}/go.mod`, `{projectRoot}/go.sum`), plugins `@nx/js`, `@nx/vite`, `@nx/eslint`; targets `lint`, `typecheck`, `test`, `build` on every project, `test-integration` on `server`, `generate` on `contracts`. Cache on, daemon on.
- **`packages/contracts`** (tag `scope:contracts`): `src/index.ts`; `src/values.ts` with `zId` (UUIDv7 string) only (the other value shapes are CORE-1); `src/api/health.ts`: `zHealth = z.object({ status: z.literal('ok'), commit: z.string(), db: z.enum(['ok', 'down']) })` and its type. Target `generate` (`src/generate.ts`, run with `tsx`): walks an explicit registry `src/registry.ts` (`{ name, schema }[]`, `health` only for now), writes `dist-schemas/<name>.schema.json` with `z.toJSONSchema(schema, { target: 'draft-2020-12' })` into `packages/contracts/generated/json-schema/`, then runs `go-jsonschema` (`github.com/omissis/go-jsonschema`, version pinned with `go run <module>@<version>`) to write `apps/runner/internal/contracts/<name>.go` (package `contracts`). The generated files are committed. Fixture `packages/contracts/fixtures/api/health.json`.
- **`packages/sdk`** (tag `scope:sdk`): `src/index.ts` exporting `version` only; depends on `@crewdeck/contracts`.
- **`packages/skin-passerelle`** (tag `scope:skin`): `src/index.ts` empty Lit 3 entry; ESLint `no-restricted-imports` allowing only `@crewdeck/sdk`, `lit` and relative paths.
- **`apps/server`** (tag `scope:server`): NestJS 11, `src/main.ts` (global prefix `/api`, port `PORT` default 3000, `enableShutdownHooks`), `src/app.module.ts`, `src/config/env.ts` (zod schema of the environment, parsed once at boot, the process exits with the failed keys listed; keys now: `NODE_ENV`, `PORT`, `DATABASE_URL`, `CREWDECK_COMMIT` default `dev`), `src/prisma/prisma.service.ts` (Prisma 7 client, `prisma.config.ts`, schema `apps/server/prisma/schema.prisma` with the `postgresql` datasource and no model yet), `src/health/health.controller.ts` + `health.module.ts`: `GET /api/health` → `zHealth` (`db` from `SELECT 1`, `commit` from `CREWDECK_COMMIT`). Vitest with `unplugin-swc` (decorators); `vitest.config.ts` (unit, `src/**/*.spec.ts`) and `vitest.integration.config.ts` (`test/integration/**/*.spec.ts`); helper `test/integration/database.ts` that creates a database `crewdeck_it_<worktree slug>_<8 hex>` (slug: `basename` of the repository root, lower-cased, non-alphanumerics as `_`), runs `prisma migrate deploy` on it, and drops it after the run.
- **`apps/web`** (tag `scope:web`): Vite app, `index.html`, `src/main.ts` rendering a `<p>` « Crewdeck » (replaced by UI-1's router), dev server on 4200 proxying `/api` (HTTP and WebSocket) to `http://localhost:3000`.
- **`apps/runner`** (tag `scope:runner`): `go.mod` (`module github.com/maximed1412/crewdeck/apps/runner`), `cmd/crewdeck-runner/main.go` with a `github.com/spf13/cobra` root and one `version` command printing `version` (set by `-ldflags "-X main.version=<v>"`, default `dev`); `internal/contracts/` (generated) and `internal/contracts/health_test.go` decoding `packages/contracts/fixtures/api/health.json` into the generated type. `project.json` with `nx:run-commands` targets `test` (`go test ./...`), `lint` (`go vet ./...` and `test -z "$(gofmt -l .)"`), `build` (`go build -o ../../dist/apps/runner/crewdeck-runner ./cmd/crewdeck-runner`), inputs `go` and `^production`, `implicitDependencies: ["contracts"]`.
- **ESLint** flat config at the root with `@nx/enforce-module-boundaries`: `scope:skin` → `scope:sdk`; `scope:sdk` → `scope:contracts`; `scope:web` → `scope:sdk`, `scope:contracts`, `scope:skin`; `scope:server` → `scope:contracts`; nothing depends on `scope:server` or `scope:web`.
- **Local stack**: `docker-compose.yml` with one service `db` (`postgres:18`, user/password/db `crewdeck`, port `${DB_PORT:-5432}:5432`, named volume, healthcheck `pg_isready`); `.env.example` (`DB_PORT=5432`, `DATABASE_URL=postgresql://crewdeck:crewdeck@localhost:5432/crewdeck`, `PORT=3000`); root scripts `db:up` (`docker compose up -d --wait db && pnpm exec nx run server:migrate`), `dev` (`CREWDECK_FAKES=1 nx run-many -t serve -p server web`), `server:migrate` target running `prisma migrate deploy`.
- `README.md`: a « Développer » section (mise install, pnpm install, pnpm db:up, pnpm dev) in French.
- `.gitignore`: `dist/`, `.nx/`, `node_modules/`, `.env`, `coverage/`, `test-results/`, `playwright-report/`.

## Decisions already made

- Versions: Nx 23, NestJS 11, Prisma 7, PostgreSQL 18, Lit 3, zod 4, Vitest everywhere in TypeScript (ADR 0001, journal: not Jest). Exact versions in the catalogue, never `^` for the frameworks.
- `CREWDECK_FAKES=1` is the switch the fakes read (fake GitHub CORE-3, fake Runner RUNNER-2); this ticket only sets it in `pnpm dev`, nothing reads it yet.
- Generated files are committed and CI fails when `contracts:generate` leaves a diff (INFRA-3 adds the check); the generator is deterministic (sorted keys, stable file order).
- The health route is public (no session) and returns no secret, only the commit.
- No `setupCmd` in `.process.json` here: INFRA-2 adds it with the script.

## Acceptance criteria

- [ ] From a fresh clone: `mise install`, `pnpm install`, `pnpm db:up`, `pnpm dev` serve `http://localhost:4200` and `GET http://localhost:4200/api/health` returns `{"status":"ok","commit":"dev","db":"ok"}`.
- [ ] `pnpm exec nx run-many -t lint typecheck test build` passes on the six projects.
- [ ] `pnpm exec nx run contracts:generate` writes the JSON Schema and the Go type of `health` and leaves no diff when run twice.
- [ ] The fixture `health.json` is valid for the zod schema (Vitest in `contracts`) and decodes into the generated Go type (`go test` in `runner`); a fixture with `status: "ko"` fails both.
- [ ] An import of `@crewdeck/contracts` (or of `lit-html` internals of another package) from `packages/skin-passerelle` fails `nx lint skin-passerelle`.
- [ ] `nx test-integration server` creates its own database, checks `GET /api/health` against it, and drops it.
- [ ] `pnpm exec nx show projects --affected --base=HEAD~1` lists `runner` when only a `.go` file changed and when `packages/contracts` changed.

## Verification

- `pnpm exec nx run-many -t lint typecheck test build`
- `pnpm exec nx run contracts:generate && git diff --exit-code`
- `pnpm db:up && pnpm exec nx test-integration server -- health`
- `cd apps/runner && go test ./internal/contracts/`

## For prod

Nothing.

## Out of scope

- Error envelope, value shapes beyond `zId`, logger: CORE-1. Scope: CORE-2. Worktree script: INFRA-2. CI: INFRA-3. Playwright: INFRA-4. Image and Compose of the VPS: INFRA-5.

## Dependencies

None.
