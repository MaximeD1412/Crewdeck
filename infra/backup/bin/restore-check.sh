#!/usr/bin/env bash
# The monthly restore check (ADR 0009, « Backups »), a gesture of the founder,
# run from their own machine, never from the VPS: it proves the backups can be
# read without the VPS.
#
#   restore-check.sh --env <file>
#
#   <file>  the restic settings, copied from the password manager:
#           RESTIC_REPOSITORY, RESTIC_PASSWORD_FILE (or RESTIC_PASSWORD), and
#           the bucket's AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
#
#   1. the latest snapshot tagged `prod`, restored with pg_restore into a
#      local throwaway PostgreSQL 18 (nothing published, removed at the end);
#   2. SELECT count(*) FROM _prisma_migrations;
#   3. prints the snapshot's date and the count.
#
# Exits non-zero when there is no snapshot, the restore fails, or the
# snapshot is older than 26 h (the nightly backup stopped). Needs restic
# (>= 0.17), Docker and GNU date.
set -euo pipefail

: "${READY_TIMEOUT:=60}"
: "${READY_INTERVAL:=1}"
MAX_AGE_HOURS=26

fail() {
  printf 'ÉCHEC : %s\n' "$*" >&2
  exit 1
}

env_file=""
while [ $# -gt 0 ]; do
  case "$1" in
    --env)
      env_file="${2-}"
      shift
      ;;
    -h | --help)
      sed -n '2,21p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *) fail "argument inconnu : $1" ;;
  esac
  shift
done
[ -n "$env_file" ] || fail "usage : restore-check.sh --env <fichier>"
[ -r "$env_file" ] || fail "$env_file illisible"
set -a
# shellcheck source=/dev/null
. "$env_file"
set +a
[ -n "${RESTIC_REPOSITORY-}" ] || fail "RESTIC_REPOSITORY manquant dans $env_file"

snapshots=$(restic snapshots --tag prod --json latest) || fail "dépôt restic illisible"
[[ "$snapshots" == *'"id"'* ]] || fail "aucune sauvegarde tagguée prod dans $RESTIC_REPOSITORY"
time=$(sed -n 's/^\[{"time":"\([^"]*\)".*/\1/p' <<<"$snapshots")
id=$(sed -n 's/.*"short_id":"\([0-9a-f]*\)".*/\1/p' <<<"$snapshots")
[ -n "$time" ] && [ -n "$id" ] || fail "instantané illisible : $snapshots"
taken=$(date -u -d "$time" +%s) || fail "date de l'instantané illisible : $time"
taken_at=$(date -u -d "@$taken" +%Y-%m-%dT%H:%M:%SZ)
age_hours=$((($(date +%s) - taken) / 3600))

db="crewdeck-restore-check-$$"
# -v: postgres:18 declares a VOLUME, and the restored copy of production
# lives in that anonymous volume, which a plain rm keeps.
cleanup() {
  docker rm -fv "$db" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

echo "instantané $id du $taken_at, restauration dans $db"
docker run -d --name "$db" \
  -e POSTGRES_USER=crewdeck -e POSTGRES_PASSWORD=restore-check -e POSTGRES_DB=crewdeck \
  postgres:18 >/dev/null
deadline=$((SECONDS + READY_TIMEOUT))
until docker exec "$db" pg_isready -U crewdeck -d crewdeck -h 127.0.0.1 >/dev/null 2>&1; do
  [ "$SECONDS" -lt "$deadline" ] || fail "la PostgreSQL locale ne répond pas"
  sleep "$READY_INTERVAL"
done

restic dump "$id" /crewdeck-prod.dump |
  docker exec -i "$db" pg_restore -U crewdeck -d crewdeck --no-owner --exit-on-error --single-transaction ||
  fail "la restauration de l'instantané $id a échoué"
count=$(docker exec "$db" psql -U crewdeck -d crewdeck -tAc 'SELECT count(*) FROM _prisma_migrations') ||
  fail "la base restaurée n'a pas de table _prisma_migrations"

echo "sauvegarde du $taken_at restaurée : ${count} migrations appliquées"
[ "$age_hours" -lt "$MAX_AGE_HOURS" ] ||
  fail "la dernière sauvegarde date du $taken_at, il y a ${age_hours} h (plus de $MAX_AGE_HOURS h) : la sauvegarde de nuit ne tourne plus"
echo "OK"
