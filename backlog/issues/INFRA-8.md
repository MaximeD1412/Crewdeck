---
id: INFRA-8
title: "Backups: nightly restic of production's database, migration rehearsal on the latest backup, backup age watched, monthly restore check"
epic: INFRA
type: chore
priority: P1
size: M
milestone: M0 Skeleton and delivery
blocked_by: [INFRA-5]
adr: [0009]
risques: [OPS-2]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0009 (« Backups »): restic, nightly, to another provider than OVH; the repository's password and credentials live on the VPS and in the founder's password manager, never in GitHub, so losing the VPS does not lose the backups. A monthly check restores the latest backup from a machine other than the VPS, and the production deploy rehearses each migration on the latest backup restored into a throwaway container before migrating (risk OPS-2). Only production is backed up: staging is disposable.

## Current state of the code

- Created by INFRA-5: `infra/deploy/docker-compose.yml` (project `crewdeck-prod`, service `db`, volume `db-data`), the image's `migrate` command, `/api/health` (`zHealth` in `packages/contracts/src/api/health.ts`).
- Created by INFRA-6: `infra/deploy/bin/deploy.sh`, which calls `/opt/crewdeck/deploy/bin/rehearse.sh <sha>` for production when it exists.
- No `infra/backup/`.

## To do

- **`infra/backup/bin/backup.sh`**: `docker compose -p crewdeck-prod exec -T db pg_dump -U crewdeck -Fc crewdeck` streamed to `restic backup --stdin --stdin-filename crewdeck-prod.dump --tag prod`; then `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune`; on success writes the instant (ISO 8601 UTC) to `/opt/crewdeck/backup/last-success`. Configuration from `/opt/crewdeck/backup/restic.env` (mode 600: `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE`, the provider's `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` for an S3-compatible bucket).
- **systemd** (`infra/backup/systemd/`): `crewdeck-backup.service` (oneshot) and `crewdeck-backup.timer` (`OnCalendar=*-*-* 01:30:00 UTC`, `Persistent=true`, `RandomizedDelaySec=10m`); `infra/backup/bin/install.sh` copies the scripts to `/opt/crewdeck/backup/bin/` and the units, enables the timer, installs `rehearse.sh` into `/opt/crewdeck/deploy/bin/`; idempotent.
- **`infra/backup/bin/rehearse.sh <sha>`**: restores the latest `prod` snapshot (`restic dump latest crewdeck-prod.dump --tag prod`) into a throwaway `postgres:18` container on a throwaway network, runs the image `crewdeck-server:<sha>` with `migrate` against it, removes both whatever happens (`trap`); exits non-zero on a failed restore or migration (« la migration échoue sur la dernière sauvegarde »). With no snapshot yet, prints « aucune sauvegarde : répétition sautée » and exits 0.
- **`infra/backup/bin/restore-check.sh`** (run from the founder's machine, not the VPS): reads `RESTIC_*` from a local env file given as `--env <file>`, restores the latest snapshot into a local throwaway `postgres:18`, runs `pg_restore` then `SELECT count(*) FROM _prisma_migrations`, prints the snapshot's date and the count, exits non-zero when the snapshot is older than 26 h or the restore fails.
- **Health**: `zHealth` gains `backup: z.object({ lastSuccessAt: zInstant.nullable() }).optional()` (`zInstant` of CORE-1's `packages/contracts/src/values.ts`; if CORE-1 is not merged yet, `z.iso.datetime()` in place, which is the same shape); the server reads `BACKUP_STATUS_FILE` (env, optional; mounted read-only in `crewdeck-prod` as `/run/backup/last-success`, added to `infra/deploy/docker-compose.yml` with an env-driven bind mount) and reports it; absent when the variable is unset (staging, development). `pnpm exec nx run contracts:generate` after the change.
- **`.github/workflows/backup-watch.yml`**: daily at 07:00 UTC, `curl https://${{ vars.CREWDECK_DOMAIN }}/api/health`; fails (GitHub emails the founder) when `backup.lastSuccessAt` is null or older than 26 h; skipped with a notice while `vars.CREWDECK_DOMAIN` is unset.
- **Tests** (`infra/backup/src/*.spec.ts`, Vitest, Nx project `backup`): `backup.sh` with stubs for `docker` and `restic` (writes `last-success` only on success, runs `forget` after `backup`), `rehearse.sh` (cleans its containers on a failed migration; skips without snapshot); the server's health with and without `BACKUP_STATUS_FILE` (`apps/server/src/health/health.controller.spec.ts`).
- `infra/backup/README.md` (French): what is backed up, the retention, the monthly restore check from the founder's machine, the restore procedure after losing the VPS.

## Decisions already made

- The backup is a logical dump (`pg_dump -Fc`), not the volume: restorable on any PostgreSQL 18.
- No alert channel on the VPS (no mail): the backup's age is public in `/api/health` (no secret) and watched by GitHub, which emails a red workflow.
- The monthly restore check is a gesture of the founder (listed in `docs/pilotage/mep.json`), since the restic credentials never go to GitHub.
- Personal-os's `infra/backup/` (repository `MaximeD1412/personal-os`) is the model for the scripts and units.

## Acceptance criteria

- [ ] `backup.sh` with a reachable repository creates a snapshot tagged `prod`, prunes with the retention, and writes `last-success`; when `restic` fails, `last-success` is unchanged and the unit fails.
- [ ] A production deploy whose migration fails on the latest backup stops before migrating production (`deploy.sh` exits 1 with the rehearsal's message) and leaves no container behind.
- [ ] `GET /api/health` in production includes `backup.lastSuccessAt`; in staging there is no `backup` key.
- [ ] `backup-watch.yml` fails when the last success is 27 h old and passes at 2 h (unit test of its script `.github/scripts/backup-watch.mjs` with a fake response).
- [ ] `restore-check.sh` restores the latest snapshot locally and prints its date.

## Verification

- `pnpm exec nx test backup`
- `pnpm exec nx test server -- src/health/health.controller.spec.ts`
- `shellcheck infra/backup/bin/*`
- `actionlint .github/workflows/backup-watch.yml`

## For prod

In `docs/pilotage/mep.json`: `install.sh` run on the VPS once the restic repository exists (INFRA-13), the repository variable `CREWDECK_DOMAIN`, and the monthly gesture « restore-check.sh depuis ta machine ».

## Out of scope

- Creating the restic repository and storing its password: INFRA-13. Staging backups: none.

## Dependencies

- INFRA-5.
