---
id: PROJET-3
title: "Readiness of a Projet: what the Process still misses, fixed in the repository on one click"
epic: PROJET
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PROJET-2, PARAM-2, CORE-7]
adr: [0002, 0007, 0008]
risques: []
stories: [US-4]
screens: [projet, projets]
revue_visuelle: true
video: false
---

## Context

US-4: for each Projet, the Pilote sees what is still missing to run the Process (the Runner linked, a usable Moteur for each Rôle, the labels, the integration and release branches, the Process's settings in the repository, and for an existing repository its approved inventory), the product fixing in the repository what it can on one click, each fix visible on GitHub. ADR 0002: the server writes labels and branches through the API and `.process.json` as one commit `chore(crewdeck) : <what>` generated from the Paramètres, straight to the integration branch; when a branch protection refuses a write, the same change goes as a PR and the page says so. The Boucle starts only on a ready Projet (BOUCLE-2 reads `readiness.ready`).

## Current state of the code

- Only documents: the mockups `design/screens/crewdeck/projet.html` and the badges of `projets.html`.
- Created by PROJET-2: `Project` (`releaseBranch`, `integrationBranch`, `hasCode`, `inventoryState`), `/projets`, `apps/server/src/projects/`, `apps/web/src/views/projets.ts`. PROJET-1: `GitHubEvents`, `ReconcileHooks`.
- Created by CORE-3: `GitHubClient` (`listLabels`, `ensureLabel`, `getBranch`, `createBranch`, `readProcessJson`, `commitProcessJson`, `createPullRequest`, errors `github.branch-protected`, `github.unavailable`). CORE-7: commands carrying `seq`, 409 on a stale state.
- Created by RUNNER-2: `Runner` and its presence. RUNNER-7: `AiAccount`. PARAM-2: `RolesService.check(pilotId, projectId)`.
- Created by UI-2: `Banner`, `Card`, `ListRow`, `StatusBadge`, `KeyValue`, `Button`, `PageHeader`.

## To do

- **Process labels** `packages/contracts/src/process/labels.ts`: `PROCESS_LABELS` `{ name, color, description }` for `ready-for-agent` (1d76db), `needs-human` (d93f0b), `revue-visuelle` (fbca04), `conception` (5319e7), `type:feature` (0e8a16), `type:fix` (d73a4a), `type:chore` (c5def5), `type:spike` (fbca04), `type:externe` (d4c5f9), `blocked:externe` (b60205), `priority:P0`, `priority:P1`, `priority:P2`, `size:S`, `size:M`, `size:L` (ededed; BOUCLE-1 orders the ready Tickets with them, the App cannot read a user's Project board), French descriptions; the Boucle's tickets add theirs to this list.
- **Generated `.process.json`** `apps/server/src/projects/process-json.ts`: `generate(project, existing)` keeps every key of `existing` and sets the keys Crewdeck owns: `projectName` (`displayName`), `repo` (`owner/name`), `branches { integration, release }`; `isUpToDate(existing, project)` compares only those keys. Pure, unit-tested.
- **Contract** `packages/contracts/src/api/projects.ts` gains `zReadiness = { ready: boolean, computedAt, checks: [{ id: 'runner-linked' | 'engines' | 'labels' | 'branches' | 'process-json' | 'inventory', state: 'ok' | 'missing' | 'pending', facts: Record<string, string | number | boolean>, fix: 'auto' | 'link' | null, prNumber?: int }] }` and `zProject.readiness`.
- **Server** `apps/server/src/projects/readiness/`:
  - `ReadinessService.recompute(pilotId, projectId, { github })`, stored in `projects.readiness` (JSON) with `project.upserted`:
    - `runner-linked`: a linked Runner (facts: `online`, `machine`); fix `link` (`/runner`);
    - `engines`: `RolesService.check` all usable (facts: each Rôle's Moteur); fix `link` (`/projets/:id/parametres`);
    - `labels`: every `PROCESS_LABELS` name present (`listLabels`); facts: the missing count; fix `auto`;
    - `branches`: `getBranch` of the release and the integration branches; integration missing → fix `auto` (created from the release branch's SHA); release missing → `missing`, fix `null` (facts: the name);
    - `process-json`: `readProcessJson(integration branch, else release)` present and `isUpToDate`; fix `auto` once the integration branch exists; a pending PR → `pending` with `prNumber`;
    - `inventory`: only when `hasCode`: `ok` when `inventoryState` is `approved`, `pending` when `drafting`, `to-approve` or `awaiting-merge`, else `missing`; fix `null` (PROJET-4/PROJET-5).
  - `github: true` on follow (PROJET-2's handler calls it), after each fix, on a `push` webhook to the release or integration branch, and in a `ReconcileHooks` hook `readiness` (every 15 min); `github: false` (only the local checks, from the stored GitHub facts) on `runner.upserted`, `ai-account.upserted`, `settings.upserted` and an `inventoryState` change.
  - `POST /api/projects/:id/fixes/:checkId { seq }` (`labels`, `branches`, `process-json`): `ensureLabel` for each missing label; `createBranch(integration, releaseSha)`; `commitProcessJson(integration, generate(...), 'chore(crewdeck) : paramètres du Process')`; on 422 `github.branch-protected` for `.process.json`, `createBranch('crewdeck/process-json', integrationSha)`, commit there and `createPullRequest(head 'crewdeck/process-json', base integration, title « Paramètres du Process de Crewdeck »)`, the check becomes `pending` with its `prNumber`. Then `recompute({ github: true })`, returns the Projet. Errors: 404 `project.not-found`, 409 stale `seq`, 422 `project.fix-unavailable` « Rien à corriger ici. » (check `ok` or without an `auto` fix), 422 `project.release-branch-missing` for `process-json` without any branch; GitHub's own as CORE-3 maps them.
- **Page** `/projets/:id` (Composant `PageProjet`, view `apps/web/src/views/projet.ts`): header `displayName`, back « Projets », count « <n> point(s) à régler » or « prêt pour le Process », the « Paramètres du Projet » button (→ `/projets/:id/parametres`, PARAM-3's page); not ready → the caution `Banner` « Le Process ne peut pas démarrer » naming the first missing check and what « Corriger » does; the Card « Ce dont le Process a besoin »: one `ListRow` per check (missing first), tone and meta from its state and facts (the mockup's wordings), a primary « Corriger » for `auto` fixes, a link for `link` fixes, a go `StatusBadge` « ok » when done, « PR #n à merger » when pending; the Card « Projet » (`KeyValue`: GitHub, « Suivi depuis »).
- **List** `/projets`: each row gains its badge (« prêt » go, « à régler » caution with meta « <n> point(s) à régler : <first> », « inventaire » accent when only the inventory is missing, with « Inventaire à approuver avant le Process »).
- t() keys `projet.readiness.*`.
- Scenarios `apps/server/src/testing/scenarios/projet.ts` (`projet`: integration branch missing) and `projets` extended; Playwright `apps/web/e2e/projet.spec.ts`.

## Decisions already made

- Mockup: `projet`, `projets` (pages `design/screens/crewdeck/projet.html`, `…/projets.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The « Boucle en cours » meta of the list is BOUCLE-2's; the « Paramètres » line of the Projet card (« hérités du compte, 3 modifiés ») is PARAM-3's.
- Crewdeck owns only `projectName`, `repo` and `branches` in `.process.json`; the Projet's own keys (`agentLoop.setupCmd`…) are never touched.
- Readiness is stored, not computed on each view: pages read the store (ADR 0008), GitHub is read on the triggers above only.
- A Runner « hors ligne » is still « relié »: the check is about the link; the offline state is ATOI-3's.

## Acceptance criteria

- [ ] A followed Projet without the integration branch shows « Le Process ne peut pas démarrer » and the branches row with « Corriger »; the click creates `develop` from `main` on GitHub (FakeGitHub records it) and the row turns « ok » without reload.
- [ ] « Corriger » on labels creates only the missing ones; on `.process.json` commits `chore(crewdeck) : paramètres du Process` to the integration branch, keeping the file's other keys.
- [ ] A protected integration branch makes the `.process.json` fix a PR from `crewdeck/process-json`, shown « PR #n à merger ».
- [ ] An unusable Moteur for a Rôle, a Runner not linked, an inventory not approved each show their row with the right state; when every check is `ok`, `readiness.ready` is true and the list shows « prêt ».
- [ ] The fix route follows the baseline: 404 for another Pilote's Projet, 409 stale `seq`, 422 `project.fix-unavailable`.
- [ ] Screens at 390 and 1280 match the mockups, axe without violations.

## Verification

- `pnpm exec nx test server -- src/projects/process-json.spec.ts`
- `pnpm exec nx test server -- src/projects/readiness/readiness.service.spec.ts`
- `pnpm exec nx test-integration server -- projects`
- `pnpm exec nx test web -- src/views/projet.spec.ts`
- `pnpm exec nx e2e web -- projet.spec.ts projets.spec.ts`; `scripts/captures.sh apps/web/e2e/projet.spec.ts apps/web/e2e/projets.spec.ts` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (`projects.readiness`), run by the deploy.

## Out of scope

- Drafting and approving the Inventaire: PROJET-4, PROJET-5. Starting the Boucle: BOUCLE-2.

## Dependencies

- PROJET-2
- PARAM-2
- CORE-7
