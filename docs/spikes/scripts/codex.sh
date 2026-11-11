#!/usr/bin/env bash
# Throwaway: runs one Codex scenario of the RUNNER-1 spike through drive.mjs.
# Not part of the Runner.
#
#   codex.sh <scenario> '<steps json>'|<steps file> app-server|exec [codex args…]
#
# CODEX_HOME is $SPIKE_ROOT/codex-home (signed in with `codex login
# --with-api-key`, holding the Skill), HOME a fake one so the Pilote's own
# ~/.agents/skills stay out. With app-server, the Moteur's requests
# (approvals, questions) are held in rec-codex/<scenario>/pending until
# answered (answer.mjs).
set -euo pipefail
scenario=$1
steps=$2
mode=$3
shift 3
here=$(cd "$(dirname "$0")" && pwd)
root=${SPIKE_ROOT:-/tmp/crewdeck-spike}
dir=$root/rec-codex/$scenario
mkdir -p "$dir" "$root/home-codex"
rm -rf "$dir/pending" "$dir/answers"
env_json=${SPIKE_ENV:-"{\"CODEX_HOME\":\"$root/codex-home\",\"HOME\":\"$root/home-codex\"}"}
if [[ $mode == app-server ]]; then
  cmd=(codex app-server "$@")
  requests=on
else
  cmd=(codex exec --json "$@")
  requests=off
fi
exec node "$here/drive.mjs" --dir "$dir" --name "${SPIKE_NAME:-$scenario}" --cwd "${SPIKE_CWD:-$root/spike}" \
  --steps "$steps" --env "$env_json" --serverRequests "$requests" -- "${cmd[@]}"
