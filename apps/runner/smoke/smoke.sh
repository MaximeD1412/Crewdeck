#!/bin/sh
# The smoke test of the compiled Runner (RUNNER-14, ADR 0009): a binary built
# with `-tags smoke` is linked to SERVER_URL through the scenario `smoke`,
# runs a Session on the fake Moteur against a local bare repository, then
# checks the example Contrat with its embedded rules.
#
# SERVER_URL the real server with CREWDECK_FAKES=1 (linux) or
#            apps/runner/smoke/fakeserver (darwin), RUNNER the binary, STREAM
#            the fake Moteur's stream; run from the repository's root.
#
#	SERVER_URL=http://127.0.0.1:3000 RUNNER=dist/smoke/crewdeck-runner sh apps/runner/smoke/smoke.sh
set -eu

: "${SERVER_URL:?SERVER_URL is the Crewdeck server}"
: "${RUNNER:?RUNNER is the binary built with -tags smoke}"
STREAM=${STREAM:-apps/runner/smoke/testdata/session.jsonl}
CONTRAT_DIR=${CONTRAT_DIR:-packages/contracts/fixtures/contrats/example/pass}
# How long the Session may take to end, in seconds.
SESSION_TIMEOUT=${SESSION_TIMEOUT:-60}

case $RUNNER in /*) ;; *) RUNNER=$(pwd)/$RUNNER ;; esac
case $STREAM in /*) ;; *) STREAM=$(pwd)/$STREAM ;; esac

work=$(mktemp -d)
runner_pid=
cleanup() {
	status=$?
	if [ -n "$runner_pid" ]; then kill "$runner_pid" 2>/dev/null || true; wait "$runner_pid" 2>/dev/null || true; fi
	if [ "$status" -ne 0 ]; then
		for log in "$work"/*.log; do
			[ -f "$log" ] || continue
			echo "--- $log" >&2
			cat "$log" >&2
		done
	fi
	rm -rf "$work"
	exit "$status"
}
trap cleanup EXIT
trap 'exit 1' INT TERM

say() { echo "smoke: $*" >&2; }
fail() { say "$*"; exit 1; }

export CREWDECK_HOME="$work/home"
mkdir -p "$CREWDECK_HOME"

# The Projet's repository, `smoke/depot` as the scenario names it: a bare
# repository with one commit on main, where the Session clones from.
seed="$work/seed"
git init -q -b main "$seed"
echo "# Dépôt du smoke test" >"$seed/README.md"
git -C "$seed" add README.md
git -C "$seed" -c user.name=smoke -c user.email=smoke@example.invalid commit -q -m "premier commit"
mkdir -p "$work/github/smoke"
git clone -q --bare "$seed" "$work/github/smoke/depot.git"

# The scenario: a Pilote, the Projet, a link code drawn by the page.
scenario=$(curl -fsS -X POST "$SERVER_URL/api/testing/scenarios/smoke")
code=$(echo "$scenario" | jq -er .runnerLink.code)
confirm_token=$(echo "$scenario" | jq -er .runnerLink.confirmToken)
cookie=$(echo "$scenario" | jq -er .sessionCookie)
say "scenario smoke: link code ${code%%-*}-…"

# link: the binary sends its key and proof, the page (the helper) confirms.
"$RUNNER" link "$code" --server "$SERVER_URL" --no-service --engine-fake "$STREAM" >"$work/link.log" 2>&1 &
link_pid=$!
confirmed=
i=0
while [ "$i" -lt 60 ]; do
	status=$(curl -sS -o "$work/confirm.json" -w '%{http_code}' -X POST "$SERVER_URL/api/testing/smoke/confirm" \
		-H 'Content-Type: application/json' -d "{\"confirmToken\":\"$confirm_token\"}")
	if [ "$status" = 204 ]; then confirmed=1; break; fi
	[ "$status" = 409 ] || fail "confirm answered $status: $(cat "$work/confirm.json")"
	kill -0 "$link_pid" 2>/dev/null || break
	sleep 1
	i=$((i + 1))
done
[ -n "$confirmed" ] || fail "the link was never pending"
wait "$link_pid" || fail "link failed"
say "linked"

# run: the foreground Runner, connected to the server.
"$RUNNER" run --server "$SERVER_URL" --engine-fake "$STREAM" --github-url "file://$work/github" >"$work/run.log" 2>&1 &
runner_pid=$!

# A Session on the fake Moteur, on the Projet.
started=$(curl -fsS -X POST "$SERVER_URL/api/testing/smoke/sessions" \
	-H 'Content-Type: application/json' -d "{\"confirmToken\":\"$confirm_token\"}")
session_id=$(echo "$started" | jq -er .id)
say "session $session_id started"
deadline=$(($(date +%s) + SESSION_TIMEOUT))
while :; do
	kill -0 "$runner_pid" 2>/dev/null || fail "the Runner stopped"
	view=$(curl -fsS -H "Cookie: $cookie" "$SERVER_URL/api/sessions/$session_id")
	state=$(echo "$view" | jq -r .state)
	[ "$state" = ended ] && break
	[ "$(date +%s)" -lt "$deadline" ] || fail "the Session is still $state after ${SESSION_TIMEOUT}s"
	sleep 1
done
outcome=$(echo "$view" | jq -r .outcome)
[ "$outcome" = ok ] || fail "the Session ended $outcome: $view"
say "session ended ok"

# The example Contrat, its rules embedded in the binary, its PR on the fake GitHub.
if ! GH_TOKEN=smoke "$RUNNER" contrat check example --dir "$CONTRAT_DIR" --pr 1 --repo smoke/depot \
	--integration main --github-api "$SERVER_URL/fake-github" >"$work/contrat.json" 2>"$work/contrat.log"; then
	cat "$work/contrat.json" >&2
	fail "contrat check failed"
fi
[ "$(jq -r .status "$work/contrat.json")" = passed ] || fail "contrat check: $(cat "$work/contrat.json")"
say "contrat example passed"
