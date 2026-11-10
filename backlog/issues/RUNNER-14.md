---
id: RUNNER-14
title: "Nightly smoke test of the compiled Runner on linux and darwin: link, a Session on the fake Moteur, a Contrat check"
epic: RUNNER
type: chore
priority: P2
size: S
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-9, RUNNER-11, INFRA-9]
adr: [0009, 0004]
risques: [IA-3, AGT-3]
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0009: the nightly runs the full scope plus « the compiled Runner's smoke test (link, a Session against the fake Moteur, the Contrat check) on linux and darwin ». Unit tests run the Go code; only the compiled binary on each platform proves the static build, the embedded Contrats and Skills, the service-less foreground run and the protocol against the server of the same commit. The repository is private: macOS minutes count ten times, so the darwin job stays short (risk OPS-6).

## Current state of the code

- Created by INFRA-9: `.github/workflows/nightly.yml` (03:30 UTC on `develop`, full scope) and `actions-minutes.yml`.
- Created by RUNNER-3: `crewdeck-runner link`, `runner:dist`; RUNNER-9: Sessions (`--fake` engines are test-only so far); RUNNER-11: `crewdeck-runner contrat check` and the example Contrat fixtures.
- Created by RUNNER-2: `apps/server/src/testing/` scenarios (`CREWDECK_FAKES=1`).

## To do

- `apps/runner/cmd/crewdeck-runner/`: a hidden flag `--engine-fake <stream.jsonl>` honoured only when the binary is built with the tag `smoke` (`//go:build smoke`), registering the fake Engine for every Moteur; the release build (`runner:dist`) never has the tag (a test of `runner:dist`'s output checks the flag is unknown).
- `apps/runner/smoke/smoke.sh`: given `SERVER_URL` and a link code from the scenario `smoke` (`POST /api/testing/scenarios/smoke` returns `{ code, confirmToken }`), runs `crewdeck-runner link <code> --server $SERVER_URL` with `CREWDECK_HOME=$(mktemp -d)` and `--no-service`, confirms through the scenario's helper, runs `crewdeck-runner run` in the background, asks the server (scenario helper) to start a Session on a local bare repository with the fake stream, waits for `ended`/`ok` (60 s timeout), then runs `crewdeck-runner contrat check example --dir packages/contracts/fixtures/contrats/example/pass` and checks `passed`.
- `apps/server/src/testing/scenarios/smoke.ts`: a Pilote, a Projet on a `file://` bare repository, the confirm helper; mounted only outside production like every scenario.
- `crewdeck-runner link --no-service`: links without installing the service (used by the smoke test and CI only, documented in `--help`).
- `nightly.yml`, job `runner-smoke`:
  - `ubuntu-latest`: PostgreSQL service, build the server and the Runner with `-tags smoke`, start the server with `CREWDECK_FAKES=1`, run `smoke.sh`.
  - `macos-latest`: build the darwin binary with `-tags smoke`, run the same steps against a Go test server instead of the real one: `apps/runner/smoke/fakeserver/` (an `httptest`-based binary speaking the link routes and the protocol with fixtures from `packages/contracts/fixtures/runner/`), `timeout-minutes: 5`.
  - A failure fails the nightly (a red nightly is fixed first, AGENTS.md).
  - `nightly.yml` gets a `workflow_dispatch` trigger if INFRA-9 did not add one, so the job can be run on a branch.

## Decisions already made

- The fake Moteur is never in a shipped binary: build tag `smoke` only.
- darwin runs against a Go fake server to stay under 5 minutes; linux proves the real server end to end.
- Nothing calls a real Moteur, GitHub or the VPS (AGENTS.md).

## Acceptance criteria

- [ ] The nightly's `runner-smoke` job passes on linux against the real server and on darwin against the fake server.
- [ ] A broken embedded Contrat (e.g. a removed `go:embed` file) makes the job fail.
- [ ] The release binary rejects `--engine-fake`.
- [ ] The darwin job takes less than 5 minutes.

## Verification

- `cd apps/runner && go build -tags smoke ./cmd/crewdeck-runner && go test ./smoke/...`
- `pnpm exec nx run runner:dist` then `dist/runner/*/linux-amd64/crewdeck-runner run --engine-fake x` fails with an unknown flag.
- `act -j runner-smoke -W .github/workflows/nightly.yml` locally if available; otherwise the workflow run on the PR's branch through `workflow_dispatch`.

## For prod

Nothing.

## Out of scope

- The full-scope nightly itself: INFRA-9.

## Dependencies

- RUNNER-9.
- RUNNER-11.
- INFRA-9.
