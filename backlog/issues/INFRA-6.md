---
id: INFRA-6
title: "Pushed CD: image published on every push to develop, staging deployed through a restricted key, production promoting staging's image"
epic: INFRA
type: chore
priority: P1
size: M
milestone: M0 Skeleton and delivery
blocked_by: [INFRA-5]
adr: [0009]
risques: [AGT-2, OPS-3]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

Agents merge without a human code review, so every merge to `develop` is deployed to staging at once, and the deploy's result is the workflow's, visible to the agents (ADR 0009, « Delivery », from personal-os's ADR 0032). Production is deployed on every push to `main` (the `develop` → `main` PR is opened by hand and merged with a merge commit) by promoting the image already built and deployed on staging for the merge's second parent; it never rebuilds, and a `main` tree that differs from that commit's tree fails.

## Current state of the code

- Created by INFRA-5: `apps/server/Dockerfile` (build arg `CREWDECK_COMMIT`, entrypoint `serve` | `migrate`), `infra/deploy/docker-compose.yml` and `docker-compose.staging.yml`, the env templates, `/api/health` returning the commit.
- Created by INFRA-3: `.github/workflows/ci.yml` and `verify.yml`.
- No deploy script, no delivery workflow.

## To do

- **`.github/workflows/delivery.yml`**:
  - `on: push` to `develop` and `main`; `concurrency: delivery-${{ github.ref }}` (no cancel).
  - Job `staging` (on `develop`, `environment: staging`, `permissions: contents: read, packages: write`): build the image with `CREWDECK_COMMIT=${{ github.sha }}` and push `ghcr.io/maximed1412/crewdeck-server:<sha>` (`docker/build-push-action`, GitHub Actions cache); then `ssh -i <key> deploy@${{ vars.DEPLOY_HOST }} deploy staging <sha>` (key `secrets.DEPLOY_SSH_KEY`, `vars.DEPLOY_KNOWN_HOSTS` as `known_hosts`, `StrictHostKeyChecking=yes`); on success, tag the image `staged-<sha>` (`docker buildx imagetools create`). Skipped (success, with a notice « VPS pas encore configuré ») while `vars.DEPLOY_HOST` is empty.
  - Job `production` (on `main`, `environment: production`, `permissions: contents: read, packages: write`): fail unless `HEAD` is a merge commit with two parents; `DEV_SHA=$(git rev-parse HEAD^2)`; fail unless `git rev-parse HEAD^{tree}` equals `git rev-parse HEAD^2^{tree}` (« main contient autre chose que develop ») ; fail unless the tag `staged-<DEV_SHA>` exists (`docker buildx imagetools inspect`) (« cette image n'a pas été déployée sur le staging ») ; then `ssh … deploy production <DEV_SHA>`.
- **`infra/deploy/bin/deploy-trigger <env>`** (the forced command of a key): reads `SSH_ORIGINAL_COMMAND`, accepts only `deploy <env> <40 lowercase hex>` where `<env>` equals its argument, else prints « commande refusée » and exits 1; runs `deploy.sh <env> <sha>`.
- **`infra/deploy/bin/deploy.sh <env> <sha>`**: `flock -n /run/lock/crewdeck-deploy-<env>.lock` (« déploiement déjà en cours » exit 1); `docker login ghcr.io` with `/opt/crewdeck/deploy/ghcr.env`; `docker pull` the image; for `production` only, run the hook `/opt/crewdeck/deploy/bin/rehearse.sh <sha>` when it exists (INFRA-8 installs it), abort on failure; write `CREWDECK_SHA=<sha>` into `/opt/crewdeck/<env>/.env`; `docker compose … run --rm server migrate`; `docker compose … up -d`; poll `http://<project>-server:3000/api/health` through `docker compose exec` (60 s) until it returns `status: ok` and `commit: <sha>`; on failure, write back the previous sha (`/opt/crewdeck/<env>/current-sha`), `up -d` again and exit 1 (« déploiement de <sha> échoué, retour à <previous> ») ; on success, write `current-sha`. Logs to stdout (the workflow shows them) and to `journald` (`logger -t crewdeck-deploy`).
- **`infra/deploy/bin/install-access.sh`** (run once as root by INFRA-12): creates the user `deploy` (`/usr/sbin/nologin`, member of `docker`), copies `infra/deploy/bin/` to `/opt/crewdeck/deploy/bin/`, writes `~deploy/.ssh/authorized_keys` with one line per environment `command="/opt/crewdeck/deploy/bin/deploy-trigger <env>",restrict <public key>`, the keys given as `--staging-key <file> --production-key <file>`; idempotent.
- **Tests** (`infra/deploy/src/*.spec.ts`, Vitest, Nx project `deploy` with target `test`): `deploy-trigger` refuses `deploy production <sha>` under the staging key, a short sha, extra arguments, `;` injections; `deploy.sh` with a `PATH` of stubs (`docker`, `flock`, `curl`) migrates before `up`, rolls back when the health returns another commit, refuses a second concurrent run, calls `rehearse.sh` only for production.
- `infra/deploy/README.md`: « Livraison » section (the flow, how to redeploy by hand: rerun the workflow; never `docker compose up` with another sha by hand except a rollback).

## Decisions already made

- The deploy is pushed by GitHub over SSH, with keys that can only run `deploy <env> <sha>` (`restrict` forbids forwarding, PTY and X11); no webhook listener on the VPS.
- Migrations are always compatible with the previous version (expand then contract across two releases), so a rollback restarts the previous image without migrating down.
- The `staged-<sha>` tag is the proof that staging ran that image; production trusts nothing else.
- Personal-os's `infra/deploy/bin/` (repository `MaximeD1412/personal-os`) is the model.

## Acceptance criteria

- [ ] A push to `develop` publishes `crewdeck-server:<sha>`, deploys it on staging and tags it `staged-<sha>`; staging's `/api/health` then returns `<sha>`.
- [ ] A failing health after `up` rolls staging back to the previous sha and turns the workflow red.
- [ ] A push to `main` whose tree equals its second parent's deploys that parent's image to production without building; one whose tree differs fails before any SSH call.
- [ ] The staging key cannot deploy production (spec of `deploy-trigger`).
- [ ] Two deploys of the same environment at once: the second exits « déploiement déjà en cours ».
- [ ] With `DEPLOY_HOST` unset, the workflow passes with a notice.

## Verification

- `pnpm exec nx test deploy`
- `actionlint .github/workflows/delivery.yml`
- `shellcheck infra/deploy/bin/*`

## For prod

In `docs/pilotage/mep.json`: GitHub environments `staging` (deployment branch `develop`) and `production` (`main`) with the secret `DEPLOY_SSH_KEY` and the variables `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`; `/opt/crewdeck/deploy/ghcr.env` with a read-only packages token; `install-access.sh` run once. All done by INFRA-12.

## Out of scope

- The migration rehearsal on the latest backup: INFRA-8 (this ticket calls its hook). Provisioning: INFRA-7. Filling the secrets: INFRA-12.

## Dependencies

- INFRA-5.
