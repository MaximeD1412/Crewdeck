#!/usr/bin/env bash
# The nightly backup of production's database (ADR 0009, « Backups »), run as
# root by crewdeck-backup.service (crewdeck-backup.timer, 01:30 UTC):
#
#   backup.sh
#
#   1. pg_dump -Fc of `crewdeck` in the `db` service of `crewdeck-prod`,
#      streamed into a restic snapshot tagged `prod`, file crewdeck-prod.dump;
#      restic runs the dump itself (--stdin-from-command): a dump that fails
#      leaves no snapshot, never a truncated one;
#   2. the retention: 7 daily, 4 weekly, 6 monthly, pruned;
#   3. the instant of the success, ISO 8601 in UTC, in
#      /opt/crewdeck/backup/status/last-success, which production's server
#      reports in /api/health (backup.lastSuccessAt) and GitHub watches
#      (.github/workflows/backup-watch.yml).
#
# Any failure exits non-zero (the unit fails) and leaves last-success as it
# was. Configuration: /opt/crewdeck/backup/restic.env (mode 600), see
# restic.env.example. Staging is never backed up.
set -euo pipefail

: "${CREWDECK_ROOT:=/opt/crewdeck}"
backup_dir="$CREWDECK_ROOT/backup"
env_file="$backup_dir/restic.env"
status_dir="$backup_dir/status"

log() {
  printf '[sauvegarde] %s\n' "$*"
}

fail() {
  log "ÉCHEC : $*" >&2
  exit 1
}

[ -r "$env_file" ] || fail "$env_file illisible : voir restic.env.example (INFRA-13)"
set -a
# shellcheck source=/dev/null
. "$env_file"
set +a
[ -n "${RESTIC_REPOSITORY-}" ] || fail "RESTIC_REPOSITORY manquant dans $env_file"
[ -r "${RESTIC_PASSWORD_FILE-}" ] || fail "RESTIC_PASSWORD_FILE manquant ou illisible dans $env_file"

log "pg_dump de crewdeck-prod vers $RESTIC_REPOSITORY"
restic backup --retry-lock 10m --tag prod --stdin-filename crewdeck-prod.dump \
  --stdin-from-command -- docker compose -p crewdeck-prod exec -T db pg_dump -U crewdeck -Fc crewdeck ||
  fail "la sauvegarde n'a pas été enregistrée"

log "rétention : 7 jours, 4 semaines, 6 mois"
restic forget --retry-lock 10m --tag prod --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune ||
  fail "la rétention a échoué (la sauvegarde de cette nuit est enregistrée)"

# Renamed into place: the server, which sees status/ through a read-only bind
# mount of the directory, never reads a half-written file.
mkdir -p "$status_dir"
chmod 755 "$status_dir"
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp=$(mktemp "$status_dir/.last-success.XXXXXX")
printf '%s\n' "$now" >"$tmp"
chmod 644 "$tmp"
mv -f "$tmp" "$status_dir/last-success"
log "sauvegarde terminée à $now"
