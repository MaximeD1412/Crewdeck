# Infra and delivery: a dedicated VPS, staging on every merge, pushed CD, lean CI

> **Status:** accepted, 2026-11-10.

## Context

Agents merge without a human code review (the **Boucle**, US-15), so the
project needs what personal-os learnt it needs: a staging deployed on every
merge (its ADR 0031 replaced « no staging » for this reason), a deploy
whose result the agents see (ADR 0032 replaced a pulled deploy), CI that
stays inside the Actions minutes, and idempotent provisioning. Crewdeck's
server holds the GitHub App's private key and outside testers' data from
the Bêta: it shares no machine with the founder's personal data.

## Decision

### Hosting

- **One OVH VPS for Crewdeck** (EU), ordered by hand (ticket `externe`),
  running two Docker Compose projects, `crewdeck-prod` and
  `crewdeck-staging`, each with its server and its PostgreSQL 18, behind a
  Caddy edge (TLS by ACME). Staging has capped resources, refuses to start
  with prod's URL or secrets, and uses the « Crewdeck staging » GitHub App.
- **Provisioning**: `infra/provision/provision.sh`, idempotent (run again,
  it changes nothing and says so), from personal-os's: key-only SSH,
  fail2ban, ufw 22/80/443, a `DOCKER-USER` chain, unattended upgrades,
  Docker CE. Tested in CI on throwaway containers twice (idempotence), when
  `infra/provision/` changes.
- **Backups**: restic, nightly, to another provider; the key never leaves
  the VPS; the deploy rehearses each migration on the latest backup restored
  into a throwaway container before migrating.
- **Secrets**: `.env.example` templates committed, values never; GitHub
  environments `staging` (readable from `develop` only) and `production`
  (from `main` only).

### Delivery

- **Images**: `ghcr.io/maximed1412/crewdeck-server:<sha>`, the web build
  and the Runner binaries of the same commit inside
  ([ADR 0004](0004-the-runner.md)).
- **Staging** is deployed on every push to `develop`; **production** on
  every push to `main` (the `develop` → `main` PR is opened by hand; the
  release stays in the founder's console until the Lancement, PRD).
  Production promotes the image already built for that commit, never
  rebuilds.
- **Pushed CD through a restricted key** (personal-os's ADR 0032): a
  `deploy` user without a shell, one key per environment with
  `command="/opt/crewdeck/deploy/bin/deploy-trigger <env>",restrict`,
  accepting only `deploy <env> <40-hex sha>`; flock per environment; the
  script migrates (always compatible with the previous version), restarts,
  checks `/api/health` and rolls back on failure. The workflow's result is
  the deploy's.

### CI (`.github/workflows/`)

- `ci.yml` on PRs and on pushes to `develop`, skipped while a PR is a
  draft (TGR's gating; the Boucle opens PRs as drafts and marks them ready
  after its review). A reusable `verify.yml` with a `scope` input
  (`affected` on PRs to `develop`, `full` on PRs to `main`), parallel jobs:
  - secrets: gitleaks on the PR's range;
  - `nx affected -t lint test build typecheck`, plus `contracts:generate`
    with no diff;
  - integration against a PostgreSQL service;
  - end to end: Playwright on the affected screens, against the fake Runner
    and the fake GitHub.
- `nightly.yml` at 03:30 UTC on `develop`, full scope plus the compiled
  Runner's smoke test (link, a Session against the fake Moteur, the Contrat
  check) on linux and darwin. A red nightly is fixed first.
- `actions-minutes.yml` daily: fails at 80 % of the month's quota or when
  the month's projection exceeds it.
- `provision.yml` when `infra/provision/` changes.

### Working on the repository

- `scripts/worktree.sh setup` (the `.process.json`'s `agentLoop.setupCmd`,
  added by the ticket that creates the script):
  copies the untracked `.env*` from the main checkout, `mise install`,
  `pnpm install --frozen-lockfile --prefer-offline` with `NODE_ENV` unset,
  `prisma generate`, `go mod download`, checks the shared PostgreSQL of
  `docker-compose.yml` on the port of `.env` (restarting it when WSL's port
  forwarding cut it). No database per worktree: each integration run
  creates its own and drops it.
- `scripts/worktree.sh drop`: `nx daemon --stop`, removes `dist/`,
  `.nx/cache` and the run's leftover databases.
- **Visual review**: a Ticket with `revue_visuelle: true` gets the label
  `revue-visuelle`; `scripts/captures.sh <path>…` writes the captures at 390
  × 844 and 1280 × 800 from the Playwright fixtures and pushes them to the
  orphan branch `captures/<n>`, linked in the PR as
  `…/blob/captures/<n>/<file>?raw=true`.

## Options that lost

- **The personal-os VPS**: cheaper, but the GitHub App's key and outside
  testers' data beside the founder's personal data.
- **A PaaS** (Fly, Railway): less to provision, but another deploy model
  than the one the agents and the founder already run.
- **A gate after 5 merges without a full green run** (TGR's D-078): added
  if a nightly turns red after a series of merges.

## Consequences

- `externe` tickets: order the VPS and run the provisioning; buy the domain
  (after the name check, PRD « Open questions ») and its DNS; create the
  two GitHub Apps; generate the VAPID keys; fill the GitHub environments and
  the server's `.env`; configure the restic repository.
- `docs/pilotage/architecture.json` (by `setup-pilotage`) draws the VPS
  with its two Compose projects, the Runner on the Pilote's machine, GitHub
  and the push services.
