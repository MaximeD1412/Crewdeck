---
id: INFRA-5
title: "Server image with the web build and the Runner binaries, Compose projects crewdeck-prod and crewdeck-staging, Caddy edge"
epic: INFRA
type: chore
priority: P0
size: M
milestone: M0 Skeleton and delivery
blocked_by: [INFRA-1]
adr: [0004, 0009]
risques: [OPS-3, SEC-2]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0009 (« Hosting », « Delivery ») runs Crewdeck on one OVH VPS as two Docker Compose projects, `crewdeck-prod` and `crewdeck-staging`, each with its server and its PostgreSQL 18, behind a Caddy edge with ACME. One image per commit, `ghcr.io/maximed1412/crewdeck-server:<sha>`, carries the server, the web build and the Runner binaries of the same commit, which the server serves (ADR 0004, « Packaging »). Staging has capped resources and refuses to start with production's URL or secrets. This ticket makes the image and the Compose files; the pushed deploy is INFRA-6.

## Current state of the code

- Created by INFRA-1: `apps/server` (`src/config/env.ts` parsing `NODE_ENV`, `PORT`, `DATABASE_URL`, `CREWDECK_COMMIT`; `/api/health` returning the commit), `apps/web` (Vite build to `dist/apps/web`), `apps/runner` (`build` target, `-ldflags "-X main.version=<v>"`), the Prisma schema and `server:migrate`.
- No `Dockerfile`, no `infra/`.

## To do

- **`apps/server/Dockerfile`** (context: the repository root), multi-stage:
  - `build` (`node:24-bookworm-slim` + pnpm through corepack): `pnpm install --frozen-lockfile`, `pnpm exec nx run-many -t build -p server web`, `pnpm deploy --filter server --prod /out` (server and its production dependencies, Prisma client generated);
  - `runner` (`golang:<version of .mise.toml>`): builds `crewdeck-runner` for `linux/amd64`, `linux/arm64`, `darwin/amd64`, `darwin/arm64` with `CGO_ENABLED=0`, `-trimpath`, `-ldflags "-s -w -X main.version=${CREWDECK_COMMIT}"`, into `/runner/<CREWDECK_COMMIT>/<os>-<arch>` with a `.sha256` beside each;
  - final (`node:24-bookworm-slim`, user `node`): `/app/server`, `/app/web` (the static build), `/app/runner` (the binaries), `ENV CREWDECK_COMMIT`, `WEB_DIST_DIR=/app/web`, `RUNNER_DIST_DIR=/app/runner`, label `org.opencontainers.image.revision`, `HEALTHCHECK` on `http://localhost:3000/api/health`, entrypoint `/app/server/bin/entrypoint.sh` with two commands: `serve` (default, `node dist/main.js`) and `migrate` (`prisma migrate deploy`).
  - build arg `CREWDECK_COMMIT` (required; the build fails without it).
- **Server**: `apps/server/src/web/` serving `WEB_DIST_DIR` at `/` with the SPA fallback to `index.html` for every path not under `/api` or `/runner` (`@nestjs/serve-static`), only when `WEB_DIST_DIR` is set (in development Vite serves the page). `env.ts` gains `CREWDECK_ENV` (`production` | `staging` | `development` | `test`, required), `PUBLIC_URL` (required outside development and test), `WEB_DIST_DIR`, `RUNNER_DIST_DIR` (optional), and for staging `PROD_PUBLIC_URL` and `PROD_GITHUB_APP_ID` (required when `CREWDECK_ENV=staging`). **Staging guard** (`src/config/staging-guard.ts`, run at boot): with `CREWDECK_ENV=staging`, the process exits with « Staging refuse de démarrer avec la configuration de la production : <key> » when `PUBLIC_URL` equals `PROD_PUBLIC_URL`, when `GITHUB_APP_ID` (once set, CORE-3) equals `PROD_GITHUB_APP_ID`, or when `DATABASE_URL`'s host is `crewdeck-prod-db`.
- **`infra/deploy/`**:
  - `docker-compose.yml`: services `db` (`postgres:18`, named volume `db-data`, `POSTGRES_PASSWORD` from the env file, no published port) and `server` (`image: ghcr.io/maximed1412/crewdeck-server:${CREWDECK_SHA}`, `env_file`, depends on `db` healthy, `restart: unless-stopped`, joined to the external network `crewdeck-edge` with the alias `${COMPOSE_PROJECT_NAME}-server`), no `container_name`;
  - `docker-compose.staging.yml`: override with `deploy.resources.limits` (server 0.75 CPU / 768 MB, db 0.25 CPU / 256 MB);
  - `prod.env.example` and `staging.env.example`: every key, with a comment saying where its value comes from (INFRA-12): `CREWDECK_ENV`, `PUBLIC_URL`, `CREWDECK_SHA` (written by the deploy), `POSTGRES_PASSWORD`, `DATABASE_URL=postgresql://crewdeck:${POSTGRES_PASSWORD}@db:5432/crewdeck`, `SESSION_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (base64 of the PEM), `GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and in staging `PROD_PUBLIC_URL`, `PROD_GITHUB_APP_ID`. The tickets that read a key (CORE-3, CORE-4, ATOI-4) add it to `env.ts`; these templates are the list.
  - `README.md` (French): the layout on the VPS (`/opt/crewdeck/{deploy,prod,staging,edge,backup}`), how to run a project by hand (`docker compose -p crewdeck-staging --env-file /opt/crewdeck/staging/.env -f docker-compose.yml -f docker-compose.staging.yml up -d`).
- **`infra/edge/`**: `docker-compose.yml` (`caddy:2`, ports 80 and 443, volumes `caddy-data`, `caddy-config`, network `crewdeck-edge`), `Caddyfile`: `{$CREWDECK_DOMAIN}` → `reverse_proxy crewdeck-prod-server:3000`, `staging.{$CREWDECK_DOMAIN}` → `crewdeck-staging-server:3000`, `encode zstd gzip`, HSTS, ACME email `{$ACME_EMAIL}`; `edge.env.example` (`CREWDECK_DOMAIN`, `ACME_EMAIL`).
- **CI**: its own workflow `.github/workflows/image.yml` (`on: pull_request` to `develop` and `main`, `paths: apps/server/Dockerfile, infra/**, pnpm-lock.yaml, .dockerignore`, skipped for drafts like `ci.yml`), one job `image` that builds the image without pushing and runs `docker compose -f infra/deploy/docker-compose.yml config` and `caddy validate --config infra/edge/Caddyfile` (with dummy env values).
- `.dockerignore`: `node_modules`, `dist`, `.nx`, `design`, `docs`, `.git`.

## Decisions already made

- One image for both environments; staging differs only by its env file and its limits (ADR 0009).
- WebSockets (`/api/ws`, ADR 0007) go through Caddy's `reverse_proxy` without extra configuration.
- The Runner's download routes (`/runner/install.sh`, `/runner/<version>/<os>-<arch>`) are RUNNER-3's; this ticket only puts the binaries at `RUNNER_DIST_DIR`.
- The server never listens on a published port: only Caddy is reachable.

## Acceptance criteria

- [ ] `docker build --build-arg CREWDECK_COMMIT=$(git rev-parse HEAD) -f apps/server/Dockerfile .` produces an image whose `/app/runner/<sha>/` holds four binaries and four `.sha256` files that verify; `crewdeck-runner version` of the linux/amd64 binary prints the sha.
- [ ] The image started with a PostgreSQL answers `GET /api/health` with the commit, serves `index.html` at `/` and at `/a-toi`, and answers 404 JSON (not the page) at `/api/unknown`.
- [ ] `docker run <image> migrate` applies the migrations and exits 0.
- [ ] With `CREWDECK_ENV=staging` and `PUBLIC_URL` equal to `PROD_PUBLIC_URL`, the server exits non-zero with the French message (unit test of the guard, one case per key).
- [ ] The workflow `image` runs on a PR that changes the Dockerfile and not on one that changes only `apps/web/src`.

## Verification

- `pnpm exec nx test server -- src/config/staging-guard.spec.ts`
- `docker build --build-arg CREWDECK_COMMIT=test -f apps/server/Dockerfile .`
- `docker compose -f infra/deploy/docker-compose.yml -f infra/deploy/docker-compose.staging.yml --env-file infra/deploy/staging.env.example config`
- `actionlint .github/workflows/image.yml`

## For prod

In `docs/pilotage/mep.json`: the files `/opt/crewdeck/prod/.env` and `/opt/crewdeck/staging/.env` from the templates, the edge's `.env` and the network `crewdeck-edge` (INFRA-7 creates it, INFRA-12 fills the files).

## Out of scope

- Publishing the image and deploying it: INFRA-6. Provisioning the VPS: INFRA-7. Backups: INFRA-8.

## Dependencies

- INFRA-1.
