#!/usr/bin/env bash
# The first step of the workflow `delivery`'s job `production` (ADR 0009,
# « Delivery »), in a checkout of `main` with HEAD's parents fetched:
#
#   DEV_SHA=$(infra/deploy/ci/production-sha.sh)
#
# `main` advances only by the merge commit of the `develop` → `main` PR, and
# production promotes the image staging ran for its second parent, HEAD^2, the
# `develop` commit. Prints that sha when HEAD is a merge commit with two
# parents whose tree is HEAD^2's; otherwise fails with a GitHub annotation,
# before the job checks the image or opens an SSH session.
set -euo pipefail

error() {
  echo "::error::$*" >&2
  exit 1
}

read -ra commits <<<"$(git rev-list --parents -n 1 HEAD)"
[ "${#commits[@]}" -eq 3 ] ||
  error "main doit avancer par un commit de merge de develop à deux parents ; ${commits[0]} en a $((${#commits[@]} - 1))"

dev_sha=$(git rev-parse HEAD^2)
[ "$(git rev-parse 'HEAD^{tree}')" = "$(git rev-parse 'HEAD^2^{tree}')" ] ||
  error "main contient autre chose que develop : l'arbre de ${commits[0]} diffère de celui de $dev_sha"

echo "$dev_sha"
