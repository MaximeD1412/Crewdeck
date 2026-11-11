#!/usr/bin/env bash
# Throwaway: run this when the Claude subscription has reached its 5-hour or
# weekly limit (scenario 6 of RUNNER-1). It sends one cheap turn and records
# what Claude Code answers in rec/06-limits-usage/06-b-limit-reached.*, then
# prints the events to look at. Costs nothing once the limit is reached.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=${SPIKE_ROOT:-/tmp/crewdeck-spike}
mkdir -p "$root/spike"
[[ -d $root/spike/.git ]] || git -C "$root/spike" init -q -b main
SPIKE_NAME=${SPIKE_NAME:-06-b-limit-reached} "$here/claude.sh" 06-limits-usage \
  '[{"send":"Réponds seulement « ok »."},{"untilType":"result","timeoutMs":120000},{"closeStdin":true},{"untilExit":true}]' \
  --model haiku
out=$root/rec/06-limits-usage/${SPIKE_NAME:-06-b-limit-reached}.stdout.jsonl
jq -c 'select(.type=="rate_limit_event" or .type=="result" or .error != null) | {type, error, rate_limit_info, result, api_error_status, terminal_reason}' "$out"
