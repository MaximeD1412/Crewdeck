---
id: RUNNER-10
title: "A GitHub token per Session: installation token restricted to the Projet's repository, renewed while the Session lives"
epic: RUNNER
type: feature
priority: P0
size: S
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-9]
adr: [0002, 0004]
risques: [SEC-6]
stories: [US-12, US-15, US-56]
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0002, « The Runner gets a token per Session »: an installation token restricted to the Projet's repository and to contents, issues, pull requests and workflows (read and write), valid 1 h, renewed by the Runner while the Session lives. Git pushes with it (`x-access-token`), PRs are opened by `crewdeck[bot]`; no `gh` sign-in is needed on the machine. A stolen token is worth one repository for at most an hour (risk SEC-6).

## Current state of the code

- Created by RUNNER-9: `apps/server/src/sessions/` (`AgentSession`), `apps/runner/internal/session/` with its `TokenSource` interface (tests use `file://` repositories), the Session folder and its control socket.
- Created by CORE-3: `apps/server/src/github/` (`GitHubClient` with installation tokens) and the fake GitHub `apps/server/test/fakes/github.ts`.
- Created by RUNNER-2: the Runner token and its Bearer authentication.
- Created by PROJET-2: `Project` with its repository and installation id.

## To do

- **Server**: `POST /api/runner/sessions/:id/github-token` (Bearer Runner token, no session cookie) → `200 { token, expiresAt }`. 404 for a Session that is not this Runner's Pilote's; 422 `sessions.ended` for an ended Session. Calls `GitHubClient.createInstallationToken({ installationId, repositories: [name], permissions: { contents: 'write', issues: 'write', pull_requests: 'write', workflows: 'write' } })`. The token is never stored nor logged (redaction list test).
- **Runner** `apps/runner/internal/github/`:
  - `TokenSource` implementation: fetches the token at Session start, caches it in memory only, renews it 10 min before `expiresAt` while the Session is not ended.
  - Git credentials: every git command of the Runner and of the Moteur's process in the Session gets `GIT_ASKPASS=<path of crewdeck-runner>` and `CREWDECK_ASKPASS_SESSION=<id>`; `crewdeck-runner` invoked as askpass (detected by that variable) answers `x-access-token` for the user name and the current token for the password, asked over the Session's control socket. `GIT_TERMINAL_PROMPT=0`. The clone's remote URL has no credential in it.
  - `gh`: the Session's `PATH` starts with `~/.crewdeck/sessions/<id>/bin/` holding a `gh` shim (`exec crewdeck-runner gh -- "$@"`); `crewdeck-runner gh` runs the real `gh` with `GH_TOKEN` set to the current token and `GH_HOST=github.com`; without `gh` installed it prints « gh n'est pas installé sur cette machine. » and exits 127.

## Decisions already made

- Four permissions, one repository, 1 h: never the Pilote's own token, never a broader installation token (ADR 0002).
- The token lives in the Runner's memory only; the askpass and the shim fetch it per call, so a renewal reaches long-running agents.
- `gh` stays optional on the machine; the official Skills (RUNNER-12) may call it, and `crewdeck-runner status` (RUNNER-8) is not required to report it.

## Acceptance criteria

- [ ] The route returns a token restricted to the Session's repository and the four permissions (asserted on the fake GitHub's recorded call); 404 for another Pilote's Session; 422 for an ended one; 401 without a Runner token.
- [ ] A Session clones and pushes through `GIT_ASKPASS` with no credential in any remote URL or file (Go test against a local HTTPS git server double checking the basic-auth header).
- [ ] The token is renewed before expiry (fake clock) and the next push uses the new one.
- [ ] `gh` inside a Session gets `GH_TOKEN`; without `gh` the shim exits 127 with its message.
- [ ] The server's log of the route contains no token.

## Verification

- `pnpm exec nx test server -- src/sessions/`
- `pnpm exec nx test-integration server -- sessions`
- `cd apps/runner && go test ./internal/github/ ./internal/session/`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the GitHub App's permissions are INFRA-11's).

## Out of scope

- The Skills that open PRs and create issues: RUNNER-12 and the Étape tickets.

## Dependencies

- RUNNER-9.
