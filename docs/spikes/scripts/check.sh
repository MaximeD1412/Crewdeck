#!/usr/bin/env bash
# Throwaway: the verification of RUNNER-1, from the repository's root. Prints
# nothing and exits 0 when the committed recordings are clean.
set -uo pipefail
status=0
# the ticket's pattern, built in two pieces so that this file does not match it
key='s''k-'
home='/ho''me/'
if grep -rnP "$key"'|@[a-z0-9.-]+\.[a-z]{2,}|'"$home"'(?!pilote)' apps/runner/internal/engine/*/testdata/ docs/spikes/; then
  status=1
fi
for f in apps/runner/internal/engine/*/testdata/*.jsonl; do
  jq -c . "$f" >/dev/null || { echo "does not parse: $f"; status=1; }
done
# beyond the ticket's grep: the user, host and private names of this machine
if grep -rlinE "$(whoami)|$(hostname)|/tmp/crewdeck-spike|${SPIKE_PRIVATE:-DCCM}" apps/runner/internal/engine/*/testdata/; then
  status=1
fi
# CI's secret scan on the same files (gitleaks of verify.yml), when Docker is there
if command -v docker >/dev/null; then
  docker run --rm -v "$PWD:/repo:ro" -w /repo ghcr.io/gitleaks/gitleaks:v8.30.1 \
    dir --config .gitleaks.toml --no-banner --redact --log-level error \
    apps/runner/internal/engine docs/spikes || status=1
fi
exit $status
