---
id: CORE-3
title: "Server GitHub client with its read allowlist, and the fake GitHub"
epic: CORE
type: chore
priority: P0
size: M
milestone: M1 Socle
blocked_by: [CORE-1]
adr: [0002, 0003, 0008]
risques: []
stories: [US-60]
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0002: the server talks to GitHub only as the « Crewdeck » GitHub App, acts on metadata only (labels, branches, merges bound to a SHA, the one file `.process.json`), and never reads a file nor a diff outside an allowlist of the Process's own files; content is read by the browser with the Pilote's user token. That is what keeps US-60's promise that code never sits on our servers. No test ever calls GitHub: everything runs against a fake. This ticket writes the client every GitHub-touching ticket uses (CORE-4 sign-in, PROJET-1 webhooks, PROJET-2 installations, PROJET-3 fixes, RUNNER-10 Session tokens, BOUCLE-4 merges) and the fake they test against.

## Current state of the code

- Created by INFRA-1: `apps/server` (NestJS 11), its Vitest setup.
- Created by CORE-1: `apps/server/src/errors/` (`AppError`), value shapes in `packages/contracts/src/values.ts`.
- No GitHub code, no environment schema for GitHub.

## To do

- Dependencies: `@octokit/core`, `@octokit/auth-app`, `@octokit/plugin-retry`, `@octokit/plugin-throttling` (exact versions).
- Environment (`apps/server/src/config/env.ts`, a zod schema validated at boot; create the file if INFRA-1 did not): `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM), `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG`, optional `GITHUB_API_URL` (default `https://api.github.com`), `GITHUB_WEB_URL` (default `https://github.com`), `CREWDECK_FAKES` (`1` only outside production; the boot refuses `CREWDECK_FAKES=1` with `NODE_ENV=production`). Add them to `.env.example`.
- `apps/server/src/github/github.client.ts`: the interface `GitHubClient` (injection token `GITHUB_CLIENT`) with only these methods, typed by `packages/contracts/src/github/` schemas (`zRepoRef = { owner, name, id }`):
  - user authorization (used by CORE-4): `authorizeUrl(state, redirectUri)`, `exchangeCode(code, redirectUri) → { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt }`, `refreshUserToken(refreshToken) → same`, `getAuthenticatedUser(accessToken) → { id, login, avatarUrl }`;
  - installations: `installationToken(installationId, { repositoryIds?, permissions? }) → { token, expiresAt }`, `listInstallationRepositories(installationId) → RepoRef[]`;
  - metadata reads: `listLabels(repo)`, `getBranch(repo, name) → { name, sha, protected } | null`, `getDefaultBranch(repo)`, `listIssues(repo, { state, since?, cursor? })`, `getPullRequest(repo, number)`, `listCheckRuns(repo, sha)`, `getCombinedStatus(repo, sha)`, `listSubIssues(repo, number)`, `listIssueDependencies(repo, number)` (blocked-by) — each mapped to a contract type **without** `body` fields;
  - allowlisted content reads: `readProcessJson(repo, ref) → unknown | null`, `pathExists(repo, ref, path: 'CONTEXT.md' | 'docs/adr') → boolean`;
  - writes: `ensureLabel(repo, { name, color, description })`, `createBranch(repo, name, fromSha)`, `commitProcessJson(repo, branch, content: string, message: string) → { sha }`, `createPullRequest(repo, { head, base, title, draft })`, `mergePullRequest(repo, number, { sha, method: 'squash' | 'merge' }) → { sha }`, `mergeBranch(repo, { base, headSha, message }) → { sha }` (the merges API), `addLabels(repo, number, labels)`, `removeLabel(repo, number, label)`, `createIssueComment(repo, number, body)`.
- `apps/server/src/github/octokit.client.ts`: the real implementation on `@octokit/core` with `createAppAuth`, retry and throttling plugins, `baseUrl` from `GITHUB_API_URL`.
- `apps/server/src/github/read-guard.ts`: a request hook on that Octokit instance that throws `GitHubReadForbiddenError` for any `GET` of `/repos/{o}/{r}/contents/{path}` whose path is not `.process.json`, `CONTEXT.md` or `docs/adr`, any `/pulls/{n}/files`, `/compare/`, `/git/blobs/`, `/git/trees/`, `/readme`, `/tarball/`, `/zipball/`, and any request whose `accept` asks for `diff`, `patch` or `raw`.
- GitHub errors mapped to `AppError`: a merge refused because the head moved (405/409 « Head branch was modified ») → 409 `github.head-moved`, « La PR a changé depuis la dernière vérification. »; a write refused by a branch protection → 422 `github.branch-protected`, « Une protection de branche refuse cette écriture. »; anything else → 500 `github.unavailable` (ADR 0008 has no 502), « GitHub ne répond pas, réessaie dans un instant. », logged with the GitHub request id only.
- `apps/server/src/testing/fake-github.ts`: `FakeGitHub implements GitHubClient`, in memory: users, installations and their repositories, labels, branches (with SHAs, a `protected` flag), issues (number, title, state, labels, milestone, sub-issues, dependencies), PRs (head SHA, base, draft, merged), check runs and statuses, file contents per ref for the allowlisted paths and for the page's reads. Helpers: `seedRepo(...)`, `pushCommit(repo, branch) → sha` (moves a head, to test `github.head-moved`), `protectBranch(repo, name)`, `calls` (every call recorded with its method and arguments).
- `apps/server/test/fakes/github.ts`: re-exports `FakeGitHub` with test helpers (`expectCalled(method, args)`).
- When `CREWDECK_FAKES=1`, `GitHubModule` binds `GITHUB_CLIENT` to a `FakeGitHub` seeded by `apps/server/src/testing/` scenarios, and mounts `apps/server/src/testing/fake-github.controller.ts` under `/fake-github` serving what the **page** reads from GitHub (ADR 0002): `GET /fake-github/repos/:owner/:repo/contents/*path?ref=` (JSON with base64 `content`), `GET /fake-github/repos/:owner/:repo/pulls/:n` and `/pulls/:n/files`, `GET /fake-github/raw/:owner/:repo/:ref/*path` (captures), and `GET /fake-github/login/oauth/authorize` which redirects at once to the given `redirect_uri` with `code=fake-code&state=<state>` (CORE-4's e2e).
- `GET /api/config` (`@Public()`): `{ githubApiUrl, githubWebUrl, appSlug }` — `https://api.github.com` in production, `<origin>/fake-github` with fakes. Its schema in `packages/contracts/src/api/config.ts`.

## Decisions already made

- The interface has no method that reads an issue's or PR's body, a diff or a file outside the allowlist: what is not in the interface cannot be called. The read guard is the second fence, for a future method.
- Merges always pass the `sha` the gate judged (ADR 0002); there is no merge method without it.
- The server never commits any file other than `.process.json` (ADR 0002); `commitProcessJson` hard-codes the path.
- The fake lives under `src/testing/` because `pnpm dev` and the e2e tests need it in the running server; `src/testing/` is never imported when `CREWDECK_FAKES` is unset (a test asserts the production module graph does not contain it).

## Acceptance criteria

- [ ] The read guard throws for `GET /repos/o/r/contents/src/main.ts`, `/pulls/3/files`, an `accept: application/vnd.github.diff` request and `/git/blobs/abc`; it lets through `contents/.process.json`, `contents/CONTEXT.md` and `contents/docs/adr`.
- [ ] Every mapped issue and PR type has no `body` (a test compares the contract's keys).
- [ ] `FakeGitHub.mergePullRequest` with a stale `sha` throws `github.head-moved`; on a protected branch `commitProcessJson` throws `github.branch-protected`.
- [ ] The octokit implementation is exercised against a local `msw` (or `nock`) interceptor for one call of each group (token, labels, merge), never against GitHub.
- [ ] With `CREWDECK_FAKES=1`, `GET /api/config` returns the `/fake-github` URL and `GET /fake-github/repos/o/r/contents/docs/product/prd.md?ref=<sha>` returns the seeded content; without it, `/fake-github/*` is 404 and the app refuses to boot with `CREWDECK_FAKES=1` in production.

## Verification

- `pnpm exec nx test server -- src/github/`
- `pnpm exec nx test server -- src/testing/fake-github.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

The variables `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG` in the server's `.env` of staging and production (values from INFRA-11, set by INFRA-12): one element in `docs/pilotage/mep.json`.

## Out of scope

- The OAuth flow and token storage: CORE-4.
- Webhooks and their signature: PROJET-1.
- The per-Session installation token handed to the Runner: RUNNER-10.
- What the page reads from GitHub and how it caches it (`@tanstack/query-core`): the tickets of the screens that read content (CONCEPTION-4, PROJET-5, BOUCLE-6).

## Dependencies

- CORE-1.
