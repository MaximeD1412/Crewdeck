---
id: PROJET-7
title: "No more .process.json: the server neither reads nor writes it, a Projet's name and branches come from its repository"
epic: PROJET
type: chore
priority: P1
size: S
milestone: M3 Sessions and preparing Projets
blocked_by: [PROJET-2]
adr: [0011, 0002]
risques: []
stories: []
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0011, « No more `.process.json` »: the Process lives in Crewdeck, versioned, never in a file of the repository. The server stops reading and writing `.process.json` (`readProcessJson` and `commitProcessJson` leave `apps/server/src/github/`, the path leaves `ALLOWLISTED_PATHS`); the integration and release branches are Paramètres of the Projet (PARAM-3), the worktree's preparation and cleaning its two Commandes (RUNNER-20). ADR 0002's allowlist shrinks to `CONTEXT.md` and `docs/adr` (read for US-4's checks), and the server writes no file at all. This repository keeps its own `.process.json` for the dotfiles' tools (`scripts/worktree.sh`, `scripts/captures.sh`).

## Current state of the code

- `apps/server/src/github/github.client.ts`: `GitHubClient.readProcessJson(repo, ref)`, `pathExists(repo, ref, path: Exclude<AllowlistedPath, '.process.json'>)`, `commitProcessJson(repo, branch, content, message)` (« the only file the server writes »); no production caller of `commitProcessJson`.
- `apps/server/src/github/octokit.client.ts`: both methods on `contents(…)`; `octokit.client.spec.ts` (« reads .process.json at a ref… », « commits .process.json over its current version », the read-guard table with `readProcessJson`).
- `apps/server/src/github/read-guard.ts`: `forbiddenReason` lets a `GET` of `ALLOWLISTED_PATHS` and a write of `.process.json` only; `read-guard.spec.ts`.
- `packages/contracts/src/github/index.ts:181`: `ALLOWLISTED_PATHS = ['.process.json', 'CONTEXT.md', 'docs/adr']`.
- `apps/server/src/github/github.errors.ts` `processJsonInvalid()`, `apps/server/src/errors/messages.ts` `github.process-json-invalid`.
- `apps/server/src/testing/fake-github.ts`: `readProcessJson`, `commitProcessJson`; `fake-github.spec.ts` (« .process.json, the only file the server writes », and the `github.head-moved` test that commits `.process.json` on a PR's head).
- Created by PROJET-2: `apps/server/src/projects/process-json.ts` (`projectNamesOf(processJson, repository)`, `DEFAULT_INTEGRATION_BRANCH = 'develop'`), `Projects.follow` reading `.process.json` of the default branch before its transaction (`processJson`, catching `github.process-json-invalid`); `apps/server/src/testing/scenarios/projets.ts` and `apps/server/test/integration/projects.spec.ts` seeding a `.process.json`; `zProject`'s comment « Its name and branches come from the `.process.json`… »; t() keys `demarrage.projects.lead`, `projets.empty.text`, `projets.picker.lead` ending in « … labels, branches et fichier .process.json ».
- The repository's own `.process.json`, read by `scripts/worktree.sh` and `scripts/captures.sh` (`scripts/test/captures.spec.ts`).

## To do

- `packages/contracts/src/github/index.ts`: `ALLOWLISTED_PATHS = ['CONTEXT.md', 'docs/adr']`.
- `GitHubClient`, the Octokit client and `FakeGitHub`: remove `readProcessJson` and `commitProcessJson`; `pathExists(repo, ref, path: AllowlistedPath)`; the interface's comment says the server reads only `CONTEXT.md` and `docs/adr` and writes no file.
- `read-guard.ts`: any non-`GET` on `contents/` is refused (« a write of a file »), a `GET` only for `ALLOWLISTED_PATHS`; `read-guard.spec.ts`: a `GET` and a `PUT` of `.process.json` are both refused.
- Remove `processJsonInvalid` and `github.process-json-invalid` (its message too).
- `apps/server/src/projects/process-json.ts` → `apps/server/src/projects/project-names.ts`: `projectNamesOf(repository: { name, defaultBranch }) → { displayName: name, integrationBranch: DEFAULT_INTEGRATION_BRANCH, releaseBranch: defaultBranch }`; `Projects.follow` reads nothing from GitHub before its transaction.
- Tests: `octokit.client.spec.ts` and `fake-github.spec.ts` lose the `.process.json` cases; the `github.head-moved` case pushes its commit with `FakeGitHub.pushCommit`; `projects.spec.ts` (integration): following a repository that has a `.process.json` names it after the repository and `develop`, the file ignored; `scenarios/projets.ts` seeds no `.process.json`.
- Copy: the three t() keys end with « … préparé pour le Process : labels et branches. » (and `projets.empty.text` « … (labels, branches). »); `zProject`'s comment updated.
- Docs: `docs/adr/0002-github-app.md` is not edited (ADR 0011 amends it); `grep -rn 'process.json\|processJson' apps packages` finds nothing once done.

## Decisions already made

- A repository's existing `.process.json` is left as it is: Crewdeck neither reads nor deletes it (it may be the Pilote's own tooling, as here).
- The integration branch of a newly followed Projet is `develop`, its release branch the repository's default branch; the Pilote changes them in the Projet's Paramètres (PARAM-3).
- The scripts of this repository keep reading its own `.process.json` (ADR 0011); nothing under `scripts/` changes.
- No migration: no column held anything of the file.

## Acceptance criteria

- [ ] `GitHubClient` has no method touching `.process.json`; a request of the Octokit client to `GET` or `PUT /repos/o/r/contents/.process.json` throws `GitHubReadForbiddenError` before leaving the server.
- [ ] `GET contents/CONTEXT.md` and `contents/docs/adr` still pass the guard; any `PUT` or `DELETE` on `contents/` is refused.
- [ ] Following a Dépôt GitHub that has a `.process.json` makes a Projet named after the repository, integration branch `develop`, release branch its default branch; the fake GitHub records no read of `.process.json`.
- [ ] `github.process-json-invalid` exists nowhere in `apps/` and `packages/`; the page's copy no longer mentions `.process.json`.
- [ ] `scripts/test/captures.spec.ts` still passes on this repository's `.process.json`.

## Verification

- `pnpm exec nx test server -- src/github/ src/testing/fake-github.spec.ts src/errors/messages.spec.ts`
- `pnpm exec nx test-integration server -- projects`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

Nothing.

## Out of scope

- The Projet's branches and its worktree Commandes in its Paramètres: PARAM-3, RUNNER-20. The readiness checks that read `CONTEXT.md` and `docs/adr`: PROJET-3. Local Projets: PROJET-6.

## Dependencies

- PROJET-2.
