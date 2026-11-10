#!/usr/bin/env bash
# The migration rehearsal on the latest backup (ADR 0009, « Backups »; risk
# OPS-2), installed by install.sh as /opt/crewdeck/deploy/bin/rehearse.sh and
# run by deploy.sh, as `deploy`, before it migrates production:
#
#   rehearse.sh <40-hex sha>
#
#   1. the latest snapshot tagged `prod` (restic dump), restored with
#      pg_restore into a throwaway PostgreSQL 18, on a throwaway network,
#      nothing published on the host;
#   2. the image's `migrate` (ghcr.io/maximed1412/crewdeck-server:<sha>,
#      pulled by deploy.sh) against that database;
#   3. the container and the network removed, whatever happens.
#
# Exits non-zero when the repository cannot be read, the restore fails or the
# migration fails: deploy.sh then stops before touching production. With no
# snapshot yet, the rehearsal is skipped (exit 0).
set -euo pipefail

: "${CREWDECK_ROOT:=/opt/crewdeck}"
: "${READY_TIMEOUT:=60}"
: "${READY_INTERVAL:=1}"
IMAGE=ghcr.io/maximed1412/crewdeck-server
env_file="$CREWDECK_ROOT/backup/restic.env"

log() {
  printf '[répétition] %s\n' "$*"
}

fail() {
  log "ÉCHEC : $*"
  exit 1
}

sha="${1-}"
[ $# -eq 1 ] && [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "usage : rehearse.sh <sha de 40 caractères hexadécimaux>"

[ -r "$env_file" ] || fail "$env_file illisible pour $(id -un) : relancer infra/backup/bin/install.sh"
set -a
# shellcheck source=/dev/null
. "$env_file"
set +a

# `[]` when the repository has no snapshot yet; a repository that cannot be
# read fails the rehearsal rather than letting a migration through untried.
snapshots=$(restic snapshots --retry-lock 10m --tag prod --json latest) ||
  fail "dépôt restic illisible : la répétition n'a pas pu avoir lieu"
if [[ "$snapshots" != *'"id"'* ]]; then
  log "aucune sauvegarde : répétition sautée"
  exit 0
fi
taken=$(sed -n 's/^\[{"time":"\([^"]*\)".*/\1/p' <<<"$snapshots")

run="crewdeck-rehearsal-$$"
network="$run"
db="$run-db"
migrator="$run-migrate"
password=rehearsal

cleanup() {
  docker rm -f "$migrator" "$db" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
# The SSH session of the deploy may drop: the EXIT trap still runs.
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

log "restauration de la sauvegarde du ${taken:-?} dans $db"
docker network create "$network" >/dev/null
docker run -d --name "$db" --network "$network" \
  -e POSTGRES_USER=crewdeck -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB=crewdeck \
  postgres:18 >/dev/null

# The image's entrypoint first starts a server on its socket only: TCP on
# 127.0.0.1 answers once the final server is up.
deadline=$((SECONDS + READY_TIMEOUT))
until docker exec "$db" pg_isready -U crewdeck -d crewdeck -h 127.0.0.1 >/dev/null 2>&1; do
  [ "$SECONDS" -lt "$deadline" ] || fail "la PostgreSQL de la répétition ne répond pas"
  sleep "$READY_INTERVAL"
done

restic dump --retry-lock 10m --tag prod latest /crewdeck-prod.dump |
  docker exec -i "$db" pg_restore -U crewdeck -d crewdeck --no-owner --exit-on-error --single-transaction ||
  fail "la restauration de la dernière sauvegarde a échoué"

log "migration de $sha sur la sauvegarde restaurée"
docker run --rm --name "$migrator" --network "$network" \
  -e DATABASE_URL="postgresql://crewdeck:$password@$db:5432/crewdeck" \
  "$IMAGE:$sha" migrate ||
  fail "la migration échoue sur la dernière sauvegarde (du ${taken:-?})"

log "migration de $sha répétée avec succès sur la sauvegarde du ${taken:-?}"
