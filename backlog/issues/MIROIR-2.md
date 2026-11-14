---
id: MIROIR-2
title: "The « Miroir » token: a read-only installation token per installation, restricted to the Projets' repositories, 1 h"
epic: MIROIR
type: feature
priority: P0
size: S
milestone: M3 Sessions and preparing Projets
blocked_by: [MIROIR-1]
adr: [0010, 0002]
risques: [SEC-6]
stories: [US-60]
screens: []
revue_visuelle: false
video: false
reprend: 162
---

## Context

ADR 0010, « The « Miroir » token »: the Runner reads GitHub between Sessions to keep its **Miroir**, so the server mints, at its request, an installation token per App installation, restricted to the repositories of the **Pilote**'s **Projets** and to six permissions, read only, valid 1 h, renewed by the Runner 10 min before it expires while it is linked. A Session keeps its own token for its writes (RUNNER-10). A stolen « Miroir » token reads the Pilote's Projets for at most an hour and never writes (risk SEC-6). MIROIR-4 requests and renews it. The refonte (PRD #169, ADRs 0011–0014) leaves this ticket unchanged: the token reads GitHub only, so it covers the Projets that have a GitHub repository, and a Local Projet (PROJET-6), read from its folder on the machine, needs none.

## Current state of the code

- `apps/server/src/github/github.client.ts`: `GitHubClient.installationToken(installationId, options?: InstallationTokenOptions)` (`zInstallationTokenOptions`, `zInstallationToken` in `packages/contracts/src/github/index.ts`: repositories and permissions), implemented by `octokit.client.ts` and the fake GitHub (`apps/server/src/testing/fake-github.ts`, which records the calls).
- `apps/server/src/runners/runner-dispatcher.ts`: `registerRunnerHandler(type, handler)` with `context.reply`.
- Created by MIROIR-1: `packages/contracts/src/runner/mirror.ts` (`mirror.projects`, with each Projet's `installationId`), `apps/server/src/github/changes/`.
- Created by PROJET-2 (PR #157, open): `Project`, `Repository.installationId`.

## To do

- **Contracts** `packages/contracts/src/runner/mirror.ts`: Runner → server `mirror.token {}`; server → Runner `mirror.token.issued { tokens: [{ installationId: int, token: string, expiresAt: zInstant, repositories: string[] ('<owner>/<name>') }] }`, `mirror.token.failed { code: zErrorCode }` (`github.unavailable` when GitHub refused or did not answer). Fixtures, `contracts:generate`.
- **Server** `apps/server/src/github/changes/mirror-token.ts`: the handler of `mirror.token`: groups the Pilote's Projets that have a repository and are not `accessLost` by installation (a Projet without a repository, once PROJET-6 allows one, is skipped), and for each calls `installationToken(installationId, { repositories: [names], permissions: { metadata: 'read', contents: 'read', issues: 'read', pull_requests: 'read', checks: 'read', statuses: 'read' } })`; answers one `mirror.token.issued` with every token, or `mirror.token.failed` if any installation failed (the Runner retries the whole request). A Pilote with no Projet gets `tokens: []`.
- The tokens are never stored nor logged: the message is logged by its type and size only (as every Runner message); add `token` to the logger's redaction test if it is not covered.

## Decisions already made

- Six read permissions, the Projets' repositories only, 1 h (GitHub's maximum): never `write`, never the whole installation (ADR 0010, SEC-6).
- One request answers every installation at once: the Runner keeps a single renewal timer, 10 min before the earliest `expiresAt` (MIROIR-4).
- The Runner asks; the server never pushes a token. After a `mirror.projects` the Runner asks again (MIROIR-4), so a new Projet is in the next token.
- No rate limit on the route beyond the socket: a Runner asks about once per 50 min.

## Acceptance criteria

- [ ] `mirror.token` from a Runner whose Pilote has Projets on two installations gets two tokens, each restricted to its repositories and the six read permissions (asserted on the fake GitHub's recorded calls).
- [ ] An `accessLost` Projet is not in any token; a Pilote with no Projet gets `tokens: []`.
- [ ] GitHub refusing one installation answers `mirror.token.failed` with `github.unavailable`.
- [ ] Another Pilote's Projets are never in the tokens (two Pilotes, two Runners).
- [ ] The server's log of the exchange contains no token.

## Verification

- `pnpm exec nx test server -- src/github/changes/mirror-token`
- `pnpm exec nx test-integration server -- github-changes`
- `pnpm exec nx run contracts:generate`, then `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing (the App already has these permissions in read and write, INFRA-11).

## Out of scope

- The Session's token (four write permissions, one repository): RUNNER-10.
- Requesting and renewing the token on the Runner: MIROIR-4.

## Dependencies

- MIROIR-1.
