---
id: INFRA-2
title: "scripts/worktree.sh setup and drop, wired as the setupCmd and dropCmd of .process.json"
epic: INFRA
type: chore
priority: P0
size: S
milestone: M0 Skeleton and delivery
blocked_by: [INFRA-1]
adr: [0009]
risques: [AGT-5]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

Several agent sessions work on Crewdeck at once, each in its own worktree (`../Crewdeck-<branch>`, AGENTS.md « Working beside other sessions »). ADR 0009 (« Working on the repository ») defines what preparing and cleaning a worktree does; `agent-loop` and the future Runner run it through `.process.json`'s `agentLoop.setupCmd` and `dropCmd`. The design journal says these keys stay out of `.process.json` until the script exists: this ticket creates it and adds them.

## Current state of the code

- `.process.json`: `projectName`, `repo`, `branches` (`develop`, `main`), `agentLoop.conventionsFile`; no `setupCmd`, no `dropCmd`.
- Created by INFRA-1: `.mise.toml`, `docker-compose.yml` (service `db`, port `DB_PORT` of `.env`), `.env.example`, the Prisma schema in `apps/server/prisma/`, `apps/runner/go.mod`, the integration helper `apps/server/test/integration/database.ts` naming its databases `crewdeck_it_<worktree slug>_<8 hex>`.
- No `scripts/` folder.

## To do

- `scripts/worktree.sh` (bash, `set -euo pipefail`, messages in French), two commands:
  - `setup`, run inside the worktree:
    1. find the main checkout (first entry of `git worktree list --porcelain`); copy its untracked `.env*` files (`git -C <main> ls-files --others --exclude-standard -- '.env*'`, and ignored ones via `--ignored`) that the worktree lacks, never overwriting;
    2. `mise install`;
    3. `env -u NODE_ENV pnpm install --frozen-lockfile --prefer-offline`;
    4. `pnpm exec prisma generate --schema apps/server/prisma/schema.prisma`;
    5. `(cd apps/runner && go mod download)`;
    6. check the shared PostgreSQL on `DB_PORT` of `.env` (default 5432) with `pg_isready` through `docker compose exec db` and a TCP connect from the host; when the container runs but the host port does not answer (WSL's port forwarding cut it), `docker compose restart db` and wait (`--wait`), at most once; when the container is absent, `docker compose up -d --wait db`.
  - `drop`, run inside the worktree before `git worktree remove`: `pnpm exec nx daemon --stop || true`; remove `dist/`, `.nx/cache`, `test-results/`, `playwright-report/`; drop the databases named `crewdeck_it_<this worktree's slug>_*` left by an interrupted integration run (`psql` through `docker compose exec db`).
  - `help` and an unknown command print the usage and exit 2.
- `.process.json`: `"agentLoop": { "conventionsFile": "AGENTS.md", "setupCmd": "scripts/worktree.sh setup", "dropCmd": "scripts/worktree.sh drop" }`.
- Tests in TypeScript: `scripts/test/worktree.spec.ts` (Vitest, a small Nx project `scripts` with target `test`) that runs the script with a `PATH` of stubs (`docker`, `mise`, `pnpm`, `go`, `pg_isready`) recording their calls in a temporary git repository with a worktree.
- AGENTS.md « The repo » already lists `scripts/worktree.sh`: add under « Working beside other sessions » the one-line usage (`scripts/worktree.sh setup` after `git worktree add`, `scripts/worktree.sh drop` before `git worktree remove`) if the wording differs.

## Decisions already made

- No database per worktree: integration runs create and drop their own (ADR 0009).
- The script never edits the main checkout and never copies a tracked file.
- `NODE_ENV` is unset for the install (devDependencies are needed), as in personal-os's `scripts/worktree.sh` (repository `MaximeD1412/personal-os`), which this ports.

## Acceptance criteria

- [ ] `setup` in a fresh worktree copies `.env` from the main checkout, never overwrites an existing `.env`, and calls `mise install`, `pnpm install --frozen-lockfile --prefer-offline` without `NODE_ENV`, `prisma generate` and `go mod download` in that order.
- [ ] When the `db` container runs but the host port is closed, `setup` restarts it once and succeeds; when it stays closed, it fails with « PostgreSQL ne répond pas sur le port <n> ».
- [ ] `drop` drops only `crewdeck_it_<slug>_*` databases of this worktree and removes `dist/` and `.nx/cache`.
- [ ] `.process.json` carries `setupCmd` and `dropCmd`; `agent-loop` prepares a worktree with it (run once by hand: `git worktree add ../Crewdeck-test -b test/worktree && cd ../Crewdeck-test && scripts/worktree.sh setup && pnpm exec nx test server`).

## Verification

- `pnpm exec nx test scripts`
- `shellcheck scripts/worktree.sh`

## For prod

Nothing.

## Out of scope

- `scripts/captures.sh`: INFRA-4.

## Dependencies

- INFRA-1.
