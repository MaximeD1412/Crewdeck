---
id: PROJET-2
title: "Dépôts GitHub become Projets: installing the App, choosing the repositories to follow, the Projets list"
epic: PROJET
type: feature
priority: P0
size: M
milestone: M2 Runner and Projets
blocked_by: [PROJET-1, CORE-6, UI-5, RUNNER-7]
adr: [0002, 0007, 0008]
risques: [SEC-1]
stories: [US-3]
screens: [projets, projets-vide, demarrage-projets]
revue_visuelle: true
video: false
---

## Context

US-3: the Pilote picks the GitHub repositories the product follows, so that each one is prepared for the Process without manual setup. ADR 0002: following a repository is installing the App on it; the installation's repositories are the **Dépôts GitHub** the Pilote can turn into **Projets** (glossary: a Dépôt GitHub is not followed yet; once brought in, it is a Projet). It is the last step of the getting started (« Runner, Comptes IA, Projets »). This ticket also creates the files ADR 0008 names as the « first files to imitate » for a resource: every later module copies them. Preparing the Projet (labels, branches, `.process.json`) is PROJET-3; the Inventaire of a repository with code is PROJET-4.

## Current state of the code

- Only documents: the mockups `design/screens/crewdeck/projets.html`, `projets-vide.html`, `demarrage-projets.html`.
- Created by PROJET-1: `POST /api/github/webhooks`, `GitHubEvents.on(...)`, `github_installations`, `ReconcileHooks`. CORE-3: `GitHubClient` (`listInstallationRepositories`, `getDefaultBranch`, `readProcessJson`, `FakeGitHub`), `GET /api/config` (`appSlug`, `githubWebUrl`). CORE-5/CORE-6: events, `StateContributor`, the store, the router.
- Created by RUNNER-3: `/demarrage` (`PageDemarrage`, `apps/web/src/views/demarrage.ts`, the ProcessTrack « Runner, Comptes IA, Projets »), `Pilot.gettingStartedStep` and `POST /api/me/getting-started/advance { from, seq }`. RUNNER-7: the `ai-accounts` step before this one.
- Created by UI-2: `Card`, `ListRow`, `Empty`, `Button`, `PageHeader`, `StatusBadge`; UI-4: `TextField`, `Checkbox`.
- No `repositories` nor `projects` table.

## To do

- **GitHub client** (`apps/server/src/github/`): add `countCommits(repo, branch, max) → int` (`GET /repos/{o}/{r}/commits?sha=&per_page=<max>`, only the count kept; an empty repository's 409 → 0) to `GitHubClient`, the Octokit client and `FakeGitHub`.
- **Contract** `packages/contracts/src/api/projects.ts` (the model resource of ADR 0008): `zRepository = { id, owner, name, fullName, private, defaultBranch, hasCode, followed }`; `zProject = { id, repositoryId, owner, name, fullName, displayName, releaseBranch, integrationBranch, hasCode, inventoryState: 'not-needed' | 'pending' | 'drafting' | 'to-approve' | 'awaiting-merge' | 'approved', accessLost, followedAt }`; `zFollowProjects = { repositoryIds: zId[] (1 to 20) }`; events `repository.upserted`, `repository.removed`, `project.upserted` in `packages/contracts/src/events/`.
- **Server** `apps/server/src/github/repositories/` and `apps/server/src/projects/` (controller, service, `projects.controller.spec.ts` with the whole route baseline):
  - Prisma `Repository` (`repositories`): `id`, `pilotId`, `installationId`, `githubId` (unique per Pilote), `owner`, `name`, `fullName`, `private`, `defaultBranch`, `hasCode`, `updatedAt`.
  - Handlers: `installation.created` and `installation_repositories.added` → `listInstallationRepositories` then, per repository, `getDefaultBranch` and `countCommits(defaultBranch, 2)`: `hasCode` = at least 2 commits; `installation_repositories.removed` and `installation.deleted` → `repository.removed`, and a Projet of that repository gets `accessLost: true`. A `ReconcileHooks` hook `repositories` does the same diff every 15 min.
  - Prisma `Project` (`projects`): `id`, `pilotId`, `repositoryId` (unique), `githubRepoId`, `owner`, `name`, `fullName`, `displayName`, `releaseBranch`, `integrationBranch`, `hasCode`, `inventoryState`, `accessLost`, `followedAt`.
  - `POST /api/projects` (`zFollowProjects`) → 201 `{ items: zProject[] }`: for each repository, `readProcessJson(defaultBranch)` gives `displayName` (`projectName`) and `integrationBranch` (`branches.integration`) when present; else `displayName` = the repository's name, `integrationBranch` = `develop`; `releaseBranch` = `branches.release` or the default branch; `inventoryState` = `pending` when `hasCode`, else `not-needed`. Errors: 404 `project.repository-not-found` (unknown or another Pilote's), 422 `project.already-followed` « Ce dépôt est déjà un Projet. ». One transaction, one `project.upserted` and one `repository.upserted` (followed) per Projet.
  - `GET /api/projects`, `GET /api/projects/:id` (404 `project.not-found` for another Pilote's).
  - `GET /api/github/setup?installation_id&setup_action&state` (the App's Setup URL, `@Public()` then the session): redirects to `/demarrage` when `state=demarrage`, else to `/projets/ajouter`; it records nothing (the webhook does).
  - `StateContributor` keys `projects` and `repositories` (the unfollowed ones, at most 500, by name).
- **Page** (`apps/web/src/api/projects.ts`, `apps/web/src/views/projets.ts`, Composants `PageProjets` and `RepositoryPicker` in `packages/contracts/src/composants/` and `packages/skin-passerelle/src/`):
  - `/projets`: header « Projets » with the count and the primary « Ajouter un Projet » (→ `/projets/ajouter`); the Card « Prêts pour le Process ? » with one `ListRow` per Projet (title `displayName`, meta `fullName`, link `/projets/:id`); none → the `Empty` « Aucun Projet suivi » with the mockup's sentence and « Ajouter un Projet ».
  - `RepositoryPicker` (on `/projets/ajouter` in the default Cadre, and as the `projects` step of `/demarrage`): the explanation sentence, a `TextField` « Chercher un dépôt GitHub » filtering the store's repositories in the page, the Card « Tes dépôts GitHub » with a `Checkbox` per repository and its meta « déjà du code · un inventaire sera proposé » or « vide », the primary « Suivre <n> Projets » (disabled at 0), the footnote on the inventory; a link « Choisir d'autres dépôts sur GitHub » → `<githubWebUrl>/apps/<appSlug>/installations/new?state=<demarrage|projets>`; no repository yet → the `Empty` « Installe Crewdeck sur tes dépôts GitHub » with that link as its primary action.
  - On `/demarrage`, following advances `projects` → `done` and lands on `/a-toi`; « Plus tard » (ghost) advances without following.
- t() keys `projets.*`, `demarrage.projects.*`.
- Scenarios `apps/server/src/testing/scenarios/projets.ts` (`projets`, `projets-vide`) and `demarrage.ts` (`demarrage-projets`); Playwright `apps/web/e2e/projets.spec.ts` and `demarrage.spec.ts`.

## Decisions already made

- Mockup: `projets`, `projets-vide`, `demarrage-projets` (pages `design/screens/crewdeck/projets.html`, `…/projets-vide.html`, `…/demarrage-projets.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The readiness badges and metas of the list (« prêt », « à régler », « inventaire ») are PROJET-3's.
- « Has code » = the default branch has at least 2 commits (an initial commit alone, typically a README, is a new repository); counting commits reads no file nor diff (ADR 0002).
- Unfollowing a Projet is not in the MVP.
- A Pilote with more than 500 repositories on their installations is out of the MVP (the founder's use).

## Acceptance criteria

- [ ] Installing the App on two repositories makes them Dépôts GitHub in the picker within 2 s of the webhook, with « déjà du code » or « vide ».
- [ ] Following them creates two Projets (`project.upserted`), with `inventoryState` `pending` for the one with code; `.process.json` names and branches are used when present.
- [ ] `POST /api/projects` follows the route baseline: schema, 400 with `fields`, 401, 404 for another Pilote's repository, 422 `project.already-followed`.
- [ ] A repository removed from the installation disappears from the picker, and its Projet is marked `accessLost`.
- [ ] On `/demarrage`, « Suivre 2 Projets » ends the getting started on « À toi »; « Plus tard » ends it without a Projet.
- [ ] `/projets` lists the Projets, or the empty state; screens at 390 and 1280 match the mockups, axe without violations.

## Verification

- `pnpm exec nx test server -- src/projects/projects.controller.spec.ts`
- `pnpm exec nx test-integration server -- projects`
- `pnpm exec nx test web -- src/views/projets.spec.ts`
- `pnpm exec nx e2e web -- projets.spec.ts demarrage.spec.ts`; `scripts/captures.sh apps/web/e2e/projets.spec.ts apps/web/e2e/demarrage.spec.ts` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

- The App's Setup URL `https://<domain>/api/github/setup` (and staging's), with « Redirect on update » checked: one entry in `docs/pilotage/mep.json`.
- A migration (`repositories`, `projects`).

## Out of scope

- Readiness, « Corriger » and the list's badges: PROJET-3. The Inventaire: PROJET-4, PROJET-5. The Projet's Paramètres: PARAM-3.

## Dependencies

- PROJET-1
- CORE-6
- UI-5
- RUNNER-7
