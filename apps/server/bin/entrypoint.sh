#!/bin/sh
# The image's entrypoint (apps/server/Dockerfile), two commands:
#   serve    the server (default)
#   migrate  `prisma migrate deploy`, run by the deploy before `serve` (ADR 0009)
set -eu
cd "$(dirname "$0")/.."

case "${1:-serve}" in
  serve) exec node --enable-source-maps dist/main.js ;;
  migrate) exec node_modules/.bin/prisma migrate deploy ;;
  *)
    echo "Commande inconnue « $1 » : serve ou migrate." >&2
    exit 64
    ;;
esac
