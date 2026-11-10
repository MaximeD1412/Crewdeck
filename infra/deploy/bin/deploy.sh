#!/usr/bin/env bash
# Deploys one commit's image on one environment of the VPS (ADR 0009,
# « Delivery »):
#
#   deploy.sh <staging|production> <40-hex sha>
#
# Run by deploy-trigger, the forced command of the deploy keys, as the user
# `deploy` (member of `docker`), while the workflow `delivery` waits on the SSH
# session: its output is the job's log, its exit code the job's result.
#
#   1. one deploy per environment at a time (flock, without waiting);
#   2. docker login ghcr.io with /opt/crewdeck/deploy/ghcr.env, docker pull;
#   3. production only: the migration rehearsal on the latest backup,
#      /opt/crewdeck/deploy/bin/rehearse.sh <sha> (INFRA-8), when installed;
#   4. CREWDECK_SHA=<sha> in /opt/crewdeck/<env>/.env, `migrate`, `up -d`;
#   5. /api/health at <project>-server:3000, the address Caddy uses, until it
#      answers `ok` with this commit and its database (HEALTH_TIMEOUT s);
#   6. on failure, back to the sha of /opt/crewdeck/<env>/current-sha, without
#      migrating down (migrations stay compatible with the previous version),
#      and exit 1; on success, current-sha is the new sha.
#
# Logs on stdout and in the journal (`journalctl -t crewdeck-deploy`).
set -euo pipefail

: "${CREWDECK_ROOT:=/opt/crewdeck}"
: "${DEPLOY_LOCK_DIR:=/run/lock}"
: "${HEALTH_TIMEOUT:=60}"
: "${HEALTH_INTERVAL:=2}"
IMAGE=ghcr.io/maximed1412/crewdeck-server

env="${1-}"
sha="${2-}"

log() {
  printf '[%s] %s\n' "${env:-deploy}" "$*"
  logger -t crewdeck-deploy -- "[${env:-deploy}] $*" 2>/dev/null || true
}

fail() {
  log "ÉCHEC : $*"
  exit 1
}

[ $# -eq 2 ] || fail "usage : deploy.sh <staging|production> <sha>"
case "$env" in
  staging)
    project=crewdeck-staging
    env_dir="$CREWDECK_ROOT/staging"
    overrides=(-f "$CREWDECK_ROOT/deploy/docker-compose.staging.yml")
    ;;
  production)
    project=crewdeck-prod
    env_dir="$CREWDECK_ROOT/prod"
    overrides=()
    ;;
  *) fail "environnement inconnu « $env » : staging ou production" ;;
esac
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "le sha doit tenir en 40 caractères hexadécimaux minuscules : « $sha »"

env_file="$env_dir/.env"
current_file="$env_dir/current-sha"
health_url="http://$project-server:3000/api/health"

compose() {
  docker compose -p "$project" --env-file "$env_file" \
    -f "$CREWDECK_ROOT/deploy/docker-compose.yml" "${overrides[@]}" "$@"
}

# Replaces CREWDECK_SHA in the env file, or adds it; every other line is kept.
# mktemp's file is mode 600, like the env file it replaces.
write_sha() {
  local tmp
  tmp=$(mktemp "$env_dir/.env.XXXXXX")
  awk -v sha="$1" '
    /^CREWDECK_SHA=/ { if (!done) print "CREWDECK_SHA=" sha; done = 1; next }
    { print }
    END { if (!done) print "CREWDECK_SHA=" sha }
  ' "$env_file" >"$tmp"
  mv -f "$tmp" "$env_file"
}

# Prints `<http status> <status> <commit> <db>`, from inside the server's
# container: nothing is published on the host.
PROBE='const response = await fetch(process.env.HEALTH_URL, { signal: AbortSignal.timeout(5000) });
const body = await response.json();
console.log(response.status, body.status, body.commit, body.db);'

healthy() {
  local want="$1" got="" deadline=$((SECONDS + HEALTH_TIMEOUT))
  while :; do
    got=$(compose exec -T -e "HEALTH_URL=$health_url" server node --input-type=module -e "$PROBE" 2>/dev/null || true)
    [ "$got" = "200 ok $want ok" ] && return 0
    [ "$SECONDS" -lt "$deadline" ] || break
    sleep "$HEALTH_INTERVAL"
  done
  log "santé de $health_url : ${got:-pas de réponse} (attendu « 200 ok $want ok »)"
  return 1
}

# --- 1. One deploy at a time ----------------------------------------------

mkdir -p "$DEPLOY_LOCK_DIR"
exec 9>"$DEPLOY_LOCK_DIR/crewdeck-deploy-$env.lock"
flock -n 9 || fail "déploiement déjà en cours"

[ -w "$env_file" ] || fail "$env_file absent ou non modifiable"
previous=$(cat "$current_file" 2>/dev/null || true)
before=$(sed -n 's/^CREWDECK_SHA=//p' "$env_file" | tail -1)
log "déploiement de $sha (en place : ${previous:-aucun})"

# --- 2. The image -----------------------------------------------------------

ghcr_env="$CREWDECK_ROOT/deploy/ghcr.env"
[ -r "$ghcr_env" ] || fail "$ghcr_env illisible"
ghcr_user=$(sed -n 's/^GHCR_USERNAME=//p' "$ghcr_env" | tail -1)
ghcr_token=$(sed -n 's/^GHCR_TOKEN=//p' "$ghcr_env" | tail -1)
[ -n "$ghcr_user" ] && [ -n "$ghcr_token" ] || fail "GHCR_USERNAME ou GHCR_TOKEN manquant dans $ghcr_env"
printf '%s' "$ghcr_token" | docker login ghcr.io --username "$ghcr_user" --password-stdin >/dev/null ||
  fail "connexion à ghcr.io refusée"
unset ghcr_token

log "récupération de $IMAGE:$sha"
docker pull --quiet "$IMAGE:$sha" || fail "image $IMAGE:$sha introuvable"

# --- 3. The rehearsal, production only ------------------------------------

if [ "$env" = production ]; then
  rehearse="$CREWDECK_ROOT/deploy/bin/rehearse.sh"
  if [ -x "$rehearse" ]; then
    log "répétition de la migration sur la dernière sauvegarde"
    "$rehearse" "$sha" || fail "la répétition de la migration a échoué : la production reste sur ${previous:-aucun}"
  else
    log "rehearse.sh absent : pas de répétition de la migration (INFRA-8)"
  fi
fi

# --- 4. Migrate, start ------------------------------------------------------

write_sha "$sha"
log "migration"
if ! compose run --rm server migrate; then
  write_sha "$before"
  fail "la migration de $sha a échoué : $env reste sur ${previous:-aucun}"
fi

log "démarrage de $sha"
compose up -d

# --- 5. Health, 6. rollback -------------------------------------------------

if healthy "$sha"; then
  printf '%s\n' "$sha" >"$current_file"
  log "$env déployé sur $sha"
  exit 0
fi

if [ -z "$previous" ]; then
  write_sha "$before"
  fail "déploiement de $sha échoué, aucune version précédente vers laquelle revenir"
fi

log "déploiement de $sha échoué, retour à $previous"
write_sha "$previous"
compose up -d
healthy "$previous" || fail "$previous ne répond pas non plus : intervention nécessaire"
fail "déploiement de $sha échoué, retour à $previous"
