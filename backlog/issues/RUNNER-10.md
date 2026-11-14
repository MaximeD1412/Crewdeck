---
id: RUNNER-10
title: "A GitHub token per Session, renewed while it lives, and the Session's gh and mirror shims that keep the Miroir fresh after a write"
epic: RUNNER
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-9, MIROIR-6]
adr: [0002, 0004, 0010]
risques: [SEC-6, AGT-7]
stories: [US-12, US-15, US-56]
screens: []
revue_visuelle: false
video: false
reprend: 63
---

## Context

ADR 0002, « The Runner gets a token per Session »: an installation token restricted to the Projet's repository and to contents, issues, pull requests and workflows (read and write), valid 1 h, renewed by the Runner while the Session lives. Git pushes with it (`x-access-token`), PRs are opened by `crewdeck[bot]`; no `gh` sign-in is needed on the machine. A stolen token is worth one repository for at most an hour (risk SEC-6).

ADR 0010 amends it: the agents read through the **Miroir** (`crewdeck-runner miroir`, MIROIR-6) and write through `gh`. The Session's `PATH` holds a `mirror` shim beside its `gh` shim, so that a Skill derived from a dotfiles skill keeps its commands as they are; `mirror gh <args>` and the `gh` shim both run `crewdeck-runner gh`, which, once the real `gh` answered, refreshes in the copy what the command changed, so that the agent's next read is not stale (risk AGT-7).

## Current state of the code

- `apps/server/src/github/github.client.ts`: `GitHubClient.installationToken(installationId, { repositories, permissions })`, implemented by `octokit.client.ts` and the fake GitHub `apps/server/src/testing/fake-github.ts` (which records the calls).
- `apps/server/src/auth/runner-tokens.ts`: the Runner token and its Bearer authentication (`bearerOf`, `RunnerTokens.find`).
- `apps/runner/internal/github/pulls.go`: the `TokenSource` interface (`Token(ctx)`), used by the Contrats' `pr` rules.
- Created by RUNNER-9: `apps/server/src/sessions/` (`AgentSession`), `apps/runner/internal/session/` with its `TokenSource` for the clones (tests use `file://` repositories), the Session folder `~/.crewdeck/sessions/<id>/` and its control socket.
- Created by PROJET-2 (PR #157): `Project` with its repository and installation id.
- Created by MIROIR-6: `crewdeck-runner miroir`, the Runner's socket `runner.sock` (`internal/localsock/`) with the ops `mirror.fetch { repository, number }` and `mirror.sync { repository, openOnly }`.

## To do

- **Server**: `POST /api/runner/sessions/:id/github-token` (Bearer Runner token, no session cookie) → `200 { token, expiresAt }`. 404 for a Session that is not this Runner's Pilote's; 422 `sessions.ended` for an ended Session. Calls `GitHubClient.createInstallationToken({ installationId, repositories: [name], permissions: { contents: 'write', issues: 'write', pull_requests: 'write', workflows: 'write' } })`. The token is never stored nor logged (redaction list test).
- **Runner** `apps/runner/internal/github/`:
  - `TokenSource` implementation: fetches the token at Session start, caches it in memory only, renews it 10 min before `expiresAt` while the Session is not ended.
  - Git credentials: every git command of the Runner and of the Moteur's process in the Session gets `GIT_ASKPASS=<path of crewdeck-runner>` and `CREWDECK_ASKPASS_SESSION=<id>`; `crewdeck-runner` invoked as askpass (detected by that variable) answers `x-access-token` for the user name and the current token for the password, asked over the Session's control socket. `GIT_TERMINAL_PROMPT=0`. The clone's remote URL has no credential in it.
  - `gh`: the Session's `PATH` starts with `~/.crewdeck/sessions/<id>/bin/` holding a `gh` shim (`exec crewdeck-runner gh -- "$@"`); `crewdeck-runner gh` runs the real `gh` with `GH_TOKEN` set to the current token and `GH_HOST=github.com`; without `gh` installed it prints « gh n'est pas installé sur cette machine. » and exits 127.
  - `mirror`: beside it, a `mirror` shim (`exec crewdeck-runner miroir "$@"`); `crewdeck-runner miroir gh <args>` is `crewdeck-runner gh -- <args>`.
  - The Miroir's refresh (`apps/runner/internal/github/ghrefresh.go`, pure `Named(args []string, stdout string) Refresh` with `Refresh{ Number int, Branch string, All bool, None bool }`): once the real `gh` exited 0 and if the command writes, `crewdeck-runner gh` asks `runner.sock` for `mirror.fetch` of the issue or PR it named, or `mirror.sync { openOnly: true }` when it names none, then exits with `gh`'s code. Writes: `issue` and `pr` `create`, `edit`, `close`, `reopen`, `comment`, `merge`, `ready`, `review`, `delete`, `lock`, `unlock`, `transfer`, `develop`; `label` `create`, `edit`, `delete` (→ `mirror.sync`); `api` with `-X`/`--method` other than `GET`, or `api graphql` whose query is a `mutation`. The number comes from the arguments (`<n>`, `#<n>`, an issue or PR URL, `repos/<o>/<r>/issues/<n>/…`, `…/pulls/<n>/…`), else from the URL `gh issue create` and `gh pr create` print last; a PR named by its branch is looked up in the copy by `headRefName`. Read commands (`view`, `list`, `status`, `checks`, `diff`, `api` GET) refresh nothing.
  - The refresh waits for its answer (30 s at most); its failure prints nothing and never changes `gh`'s exit code: the next `mirror` read says the copy is late.

## Decisions already made

- Four permissions, one repository, 1 h: never the Pilote's own token, never a broader installation token (ADR 0002).
- The token lives in the Runner's memory only; the askpass and the shim fetch it per call, so a renewal reaches long-running agents.
- `gh` stays optional on the machine; the official Skills (RUNNER-12) write with it (`mirror gh` or `gh`) and read with `mirror`, and `crewdeck-runner status` (RUNNER-8) is not required to report it.
- The refresh is synchronous so that an agent that writes then reads sees its own write (ADR 0010, AGT-7); it targets the one object named rather than a reconciliation whenever it can.

## Acceptance criteria

- [ ] The route returns a token restricted to the Session's repository and the four permissions (asserted on the fake GitHub's recorded call); 404 for another Pilote's Session; 422 for an ended one; 401 without a Runner token.
- [ ] A Session clones and pushes through `GIT_ASKPASS` with no credential in any remote URL or file (Go test against a local HTTPS git server double checking the basic-auth header).
- [ ] The token is renewed before expiry (fake clock) and the next push uses the new one.
- [ ] `gh` inside a Session gets `GH_TOKEN`; without `gh` the shim exits 127 with its message.
- [ ] The server's log of the route contains no token.
- [ ] `mirror issue view 12 --json title` inside a Session runs `crewdeck-runner miroir`; `mirror gh issue comment 12 --body x` runs the real `gh` with the Session's token, then the copy has issue 12 refreshed before the command returns (fake `gh` on `PATH`, fake `runner.sock`).
- [ ] `Named` gives the number for `issue close 12`, `pr merge https://github.com/o/r/pull/7`, `api -X POST repos/o/r/issues/5/labels`, the URL printed by `issue create`, the branch for `pr ready feat/3-x`, `All` for `api graphql -f query='mutation …'`, and `None` for `issue view 12`, `pr list` and `api repos/o/r/pulls` (table test).
- [ ] A failed refresh leaves `gh`'s output and exit code unchanged.

## Verification

- `pnpm exec nx test server -- src/sessions/`
- `pnpm exec nx test-integration server -- sessions`
- `cd apps/runner && go test ./internal/github/ ./internal/session/ ./cmd/crewdeck-runner/`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the GitHub App's permissions are INFRA-11's).

## Out of scope

- The Skills that open PRs and create issues: RUNNER-12 and the Étape tickets.
- The Miroir's own read-only token and its commands: MIROIR-2, MIROIR-6.

## Dependencies

- RUNNER-9, MIROIR-6.
