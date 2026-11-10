---
id: INFRA-3
title: "CI: ci.yml and the reusable verify.yml (gitleaks, affected checks, integration, end to end), draft PRs skipped"
epic: INFRA
type: chore
priority: P0
size: M
milestone: M0 Skeleton and delivery
blocked_by: [INFRA-1]
adr: [0001, 0009]
risques: [AGT-2, AGT-3, OPS-6]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

The Boucle merges Tickets without a human code review (US-15): CI is the gate the Boucle reads from GitHub, and it must stay inside the Actions minutes (ADR 0009, « CI »). The Boucle opens PRs as drafts and marks them ready after its review: a draft runs nothing. AGENTS.md « Checking » says what « Before the PR » means; CI runs the same, plus the integration and end-to-end suites of what changed.

## Current state of the code

- No `.github/` folder.
- Created by INFRA-1: the Nx workspace with targets `lint`, `typecheck`, `test`, `build` on every project, `test-integration` on `server` (needs a PostgreSQL in `DATABASE_URL`), `contracts:generate` (committed outputs), `.mise.toml` (Node, pnpm, Go).

## To do

- `.github/workflows/verify.yml`, `on: workflow_call` with input `scope` (`affected` | `full`, default `affected`) and `base` (default `origin/develop`). Jobs, in parallel, each `timeout-minutes: 20`, `permissions: contents: read`:
  - `secrets`: `gitleaks/gitleaks-action@v2` on the PR's commit range (`fetch-depth: 0`), config `.gitleaks.toml` extending the defaults with an allowlist for `packages/contracts/fixtures/crypto/` (test vectors, E2E-1).
  - `checks`: checkout (`fetch-depth: 0`), `jdx/mise-action` (Node, pnpm, Go from `.mise.toml`), pnpm store and Go build caches, `pnpm install --frozen-lockfile`, `nrwl/nx-set-shas` (main branch `develop`), then `pnpm exec nx affected -t lint typecheck test build` (scope `affected`) or `pnpm exec nx run-many -t lint typecheck test build` (scope `full`), then `pnpm exec nx run contracts:generate && git diff --exit-code` (message « Contrats générés pas à jour : lance pnpm exec nx run contracts:generate »).
  - `integration`: service `postgres:18` (user/password `crewdeck`), `DATABASE_URL` pointing at it, `nx affected -t test-integration` (or `run-many`).
  - `e2e`: Playwright browsers cached (`~/.cache/ms-playwright`, keyed by the Playwright version), `nx affected -t e2e` (or `run-many`), uploading `apps/web/test-results/` as an artifact on failure (7 days). Until INFRA-4 adds the `e2e` target, the command runs nothing and passes.
- `.github/workflows/ci.yml`:
  - `on: pull_request` (types `opened`, `synchronize`, `reopened`, `ready_for_review`; branches `develop`, `main`) and `push` (branch `develop`);
  - one job `gate` that calls `verify.yml` with `if: github.event_name == 'push' || github.event.pull_request.draft == false`, `scope: full` when the PR's base is `main`, else `affected`;
  - `concurrency: ci-${{ github.ref }}`, `cancel-in-progress: true` for PRs only;
  - a final job `ci` (`needs: gate`, `if: always()`) that fails when `gate` failed or was cancelled: the one required status check, named « ci ».
- `docs/ci.md` (English): what each job runs, how to reproduce it locally (the commands of AGENTS.md « Checking »), the required check « ci ».

## Decisions already made

- A skipped draft reports nothing; when the PR is marked ready, `ready_for_review` runs CI: the Boucle reads the result on the head SHA (BOUCLE-4).
- One required check « ci »: branch protection names a single job whatever the matrix becomes.
- No Nx Cloud, no remote cache: the minutes are counted (INFRA-9), caches are GitHub's.
- Personal-os's `verify.yml` and `ci.yml` (repository `MaximeD1412/personal-os`) are the model; Jest becomes Vitest and the Docker image jobs are INFRA-5's.

## Acceptance criteria

- [ ] A draft PR to `develop` runs no job of `verify.yml`; marking it ready runs them.
- [ ] A PR that changes only `apps/runner/**/*.go` runs the runner's `lint`, `test` and `build` and not the web's.
- [ ] A PR that changes a schema of `packages/contracts` without regenerating fails `checks` with the French message.
- [ ] A PR to `main` runs the full scope.
- [ ] A committed fake secret (`ghp_` followed by 36 characters) in a PR fails `secrets`.
- [ ] The check « ci » is red when any job of `verify.yml` is red, green when all are.

## Verification

- `actionlint .github/workflows/*.yml`
- Open a draft PR, then mark it ready; push a commit that breaks `contracts:generate` and see `checks` fail; revert.

## For prod

In `docs/pilotage/mep.json`: branch protection of `develop` and `main` requiring the check « ci » (Settings > Branches), done by the founder.

## Out of scope

- The nightly and the Actions minutes: INFRA-9. Image build and deploy: INFRA-5, INFRA-6. Playwright configuration: INFRA-4.

## Dependencies

- INFRA-1.
