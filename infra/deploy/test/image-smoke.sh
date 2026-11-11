#!/usr/bin/env bash
# Smoke test of a built server image (INFRA-5), run by the workflow `image`
# and by hand:
#
#   docker build --build-arg CREWDECK_COMMIT=$(git rev-parse HEAD) -t crewdeck-server:local -f apps/server/Dockerfile .
#   infra/deploy/test/image-smoke.sh crewdeck-server:local
#
# Against a throwaway PostgreSQL 18 on a network of its own, nothing published
# on the host: the Runner binaries and their checksums, `migrate`, then
# `serve` (health, the page at `/` and `/a-toi`, 404 JSON under `/api` and
# `/fake-github`, `/api/config` on GitHub.com), and the staging guard. The
# GitHub App's variables are dummies, the key generated here: nothing calls
# GitHub. Removes everything it started, whatever the outcome.
set -euo pipefail

image="${1:?usage: image-smoke.sh <image>}"
run="crewdeck-smoke-$$"
network="$run-net"
db="$run-db"
server="$run-server"
database_url="postgresql://crewdeck:crewdeck@$db:5432/crewdeck"
# The variables the server requires in production and staging, dummies: a key of its own, never an App's.
github_app=(
  -e GITHUB_APP_ID=1 -e GITHUB_APP_SLUG=crewdeck-smoke -e GITHUB_APP_CLIENT_ID=smoke -e GITHUB_APP_CLIENT_SECRET=smoke
  -e GITHUB_WEBHOOK_SECRET=smoke
  -e GITHUB_APP_PRIVATE_KEY="$(openssl genrsa 2048 2>/dev/null | base64 -w0)"
  -e GITHUB_TOKEN_KEY="$(openssl rand -base64 32)" -e SESSION_SECRET="$(openssl rand -base64 48)"
)

fail() {
  echo "ÉCHEC : $*" >&2
  exit 1
}

cleanup() {
  docker rm -f "$server" "$db" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

commit=$(docker image inspect "$image" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')
[ -n "$commit" ] || fail "l'image n'a pas de label org.opencontainers.image.revision"
echo "image $image, commit $commit"

echo "--- the Runner binaries"
docker run --rm --entrypoint sh -e COMMIT="$commit" "$image" -c '
  set -eu
  cd "$RUNNER_DIST_DIR/$COMMIT"
  for target in linux-amd64 linux-arm64 darwin-amd64 darwin-arm64; do
    [ -x "$target" ] || { echo "binaire absent : $target" >&2; exit 1; }
    sha256sum -c "$target.sha256"
  done
  [ "$(ls | wc -l)" -eq 8 ] || { echo "attendu 4 binaires et 4 .sha256 :" >&2; ls >&2; exit 1; }
  version=$(./linux-amd64 version)
  [ "$version" = "$COMMIT" ] || { echo "crewdeck-runner version : $version, attendu $COMMIT" >&2; exit 1; }
  echo "crewdeck-runner version: $version"
' || fail "binaires du Runner"

echo "--- PostgreSQL"
docker network create "$network" >/dev/null
docker run -d --name "$db" --network "$network" \
  -e POSTGRES_USER=crewdeck -e POSTGRES_PASSWORD=crewdeck -e POSTGRES_DB=crewdeck \
  postgres:18 >/dev/null
for _ in $(seq 60); do
  docker exec "$db" pg_isready -U crewdeck -d crewdeck -h 127.0.0.1 >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$db" pg_isready -U crewdeck -d crewdeck -h 127.0.0.1 >/dev/null || fail "PostgreSQL ne répond pas"

echo "--- migrate"
docker run --rm --network "$network" -e DATABASE_URL="$database_url" "$image" migrate || fail "migrate a échoué"

echo "--- serve"
docker run -d --name "$server" --network "$network" \
  -e CREWDECK_ENV=production -e PUBLIC_URL=https://crewdeck.invalid -e DATABASE_URL="$database_url" "${github_app[@]}" \
  "$image" >/dev/null
for _ in $(seq 60); do
  [ "$(docker inspect "$server" --format '{{ .State.Health.Status }}')" = healthy ] && break
  [ "$(docker inspect "$server" --format '{{ .State.Running }}')" = true ] || { docker logs "$server" >&2; fail "le serveur s'est arrêté"; }
  sleep 1
done
[ "$(docker inspect "$server" --format '{{ .State.Health.Status }}')" = healthy ] || { docker logs "$server" >&2; fail "le serveur n'est pas healthy"; }

# Prints `<status> <content-type>` then the body of GET <path>, from inside the container.
get() {
  docker exec -e TARGET="http://localhost:3000$1" "$server" node --input-type=module -e '
    const response = await fetch(process.env.TARGET);
    console.log(response.status, response.headers.get("content-type"));
    console.log(await response.text());
  '
}

health=$(get /api/health)
echo "$health"
echo "$health" | head -1 | grep -q '^200 application/json' || fail "/api/health : $health"
echo "$health" | tail -1 | grep -q "\"commit\":\"$commit\"" || fail "/api/health ne donne pas le commit $commit"
echo "$health" | tail -1 | grep -q '"db":"ok"' || fail "/api/health : base injoignable"

for path in / /a-toi; do
  page=$(get "$path")
  echo "$page" | head -1 | grep -q '^200 text/html' || fail "$path : $(echo "$page" | head -1)"
  echo "$page" | grep -qi '<!doctype html' || fail "$path ne sert pas index.html"
  echo "$path: $(echo "$page" | head -1)"
done

unknown=$(get /api/unknown)
echo "/api/unknown: $(echo "$unknown" | head -1)"
echo "$unknown" | head -1 | grep -q '^404 application/json' || fail "/api/unknown : $unknown"

fake=$(get /fake-github/repos/o/r/contents/README.md)
echo "/fake-github: $(echo "$fake" | head -1)"
echo "$fake" | head -1 | grep -q '^404 application/json' || fail "/fake-github sert en production : $fake"

config=$(get /api/config)
echo "/api/config: $(echo "$config" | tail -1)"
echo "$config" | tail -1 | grep -q '"githubApiUrl":"https://api.github.com"' || fail "/api/config : $config"

echo "--- the staging guard"
code=0
output=$(docker run --rm --network "$network" \
  -e CREWDECK_ENV=staging -e PUBLIC_URL=https://crewdeck.invalid -e PROD_PUBLIC_URL=https://crewdeck.invalid \
  -e PROD_GITHUB_APP_ID=2 -e DATABASE_URL="$database_url" "${github_app[@]}" "$image" 2>&1) || code=$?
echo "$output"
[ "$code" -ne 0 ] || fail "le staging a démarré avec l'URL de la production"
echo "$output" | grep -q 'Staging refuse de démarrer avec la configuration de la production : PUBLIC_URL' \
  || fail "message de la garde du staging absent"

echo "OK"
