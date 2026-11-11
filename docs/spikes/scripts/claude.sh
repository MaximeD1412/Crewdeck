#!/usr/bin/env bash
# Throwaway: runs one Claude Code scenario of the RUNNER-1 spike through
# drive.mjs, with the permission tool (perm-mcp.mjs) and the AskUserQuestion
# hook (question-hook.mjs) wired in. Not part of the Runner.
#
#   claude.sh <scenario> '<steps json>'|<steps file> [extra claude args…]
#
# SPIKE_ROOT (default /tmp/crewdeck-spike) holds the throwaway repository
# (spike/) and the recordings (rec/<scenario>/). SPIKE_ENV is a JSON object of
# variables given to the Moteur (e.g. an empty HOME), SPIKE_NAME the
# recording's name when a scenario has several.
set -euo pipefail
scenario=$1
steps=$2
[[ -f $steps ]] && steps=$(cat "$steps")
shift 2
here=$(cd "$(dirname "$0")" && pwd)
root=${SPIKE_ROOT:-/tmp/crewdeck-spike}
dir=$root/rec/$scenario
env_json=${SPIKE_ENV:-"{}"}
mkdir -p "$dir"
rm -rf "$dir/pending" "$dir/answers"

cat >"$dir/mcp.json" <<EOF
{"mcpServers":{"spike":{"command":"node","args":["$here/perm-mcp.mjs"],"env":{"SPIKE_DIR":"$dir","SPIKE_PROGRESS_MS":"${SPIKE_PROGRESS_MS:-0}"}}}}
EOF
cat >"$dir/settings.json" <<EOF
{"hooks":{"PreToolUse":[{"matcher":"AskUserQuestion","hooks":[{"type":"command","command":"SPIKE_DIR=$dir node $here/question-hook.mjs","timeout":10800}]}]}}
EOF

exec node "$here/drive.mjs" --dir "$dir" --name "${SPIKE_NAME:-$scenario}" --cwd "${SPIKE_CWD:-$root/spike}" --steps "$steps" \
  --env "$env_json" -- \
  claude -p --input-format stream-json --output-format stream-json --verbose \
  --setting-sources project --strict-mcp-config \
  --mcp-config "$dir/mcp.json" --settings "$dir/settings.json" \
  --permission-prompt-tool mcp__spike__permission_prompt \
  "$@"
