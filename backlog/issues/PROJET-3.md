---
id: PROJET-3
title: "Readiness of a Projet: what its Process still misses, for GitHub and for a Local folder, fixed on one click where it is made"
epic: PROJET
type: feature
priority: P1
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PROJET-2, PARAM-2, CORE-7, PROCESS-3, SOURCE-1, RUNNER-16, PROJET-6]
adr: [0002, 0007, 0008, 0011, 0012, 0013]
risques: []
stories: [US-4]
screens: [projet, projets, projet-local]
revue_visuelle: true
video: false
reprend: 61
---

## Context

US-4: for each Projet, the Pilote sees what is still missing to run its Process (the Runner linked, a usable Moteur for each Rôle its Étapes use, the Connecteurs, Serveurs MCP and Commandes it names ready, the Manques of its canvas, for GitHub the labels and the integration and release branches, and for an existing code base its approved inventory), the product fixing what it can on one click, each fix visible where it is made. The Boucle starts only on a ready Projet (BOUCLE-2 reads `readiness.ready`).

The refonte (PRD #169, ADRs 0011 to 0013) rewrites this ticket. The Process lives in Crewdeck, versioned, never in a file of the repository: the `.process.json` check and its fix are gone. What a repository lacks (its labels, its branches) is a point of preparation, not a Manque (feature PRD); an active version never has a Manque, so the « Process » row says which version runs. A Serveur MCP an Étape names that the Runner does not declare is a point of preparation too (ADR 0013). And a Projet may be Local (ADR 0012): its rows are the folder's — present on this Runner, a git repository (« git init » and a first commit in one click, through the Runner), its integration branch — while the GitHub rows (labels, branches on GitHub) appear only for the groups whose Source is GitHub. PROJET-6 creates the Local Projet and the page's header and « Projet » Card; this ticket owns the readiness Card, the list's badges and the Local rows.

## Current state of the code

- `apps/server/src/github/github.client.ts`: `GitHubClient.listLabels`, `ensureLabel`, `getBranch`, `createBranch`, `getDefaultBranch` (and `readProcessJson`, `commitProcessJson`, which this ticket does not use: PROJET-7 removes them); errors in `github.errors.ts`; the fake GitHub `apps/server/src/testing/fake-github.ts`. `webhooks/dispatcher.ts` (`GitHubEvents.on`), `reconciliation/reconciliation.service.ts` (`register({ key, reconcile })`, every 15 min).
- `apps/server/src/runners/`: `RunnerCommands.send(pilotId, msg)` (422 `runner.offline`), `RunnerDispatcher.registerRunnerHandler(type, h)`, `RunnerPresence`; `ai-accounts/` (RUNNER-7). `@SensitiveAction`, `withSeq`, 409 `realtime.stale` (CORE-7).
- Skin: `Banner`, `Card`, `ListRow`, `StatusBadge`, `KeyValue`, `Button`, `PageHeader` exist in `packages/skin-passerelle/src/`.
- Created by PROJET-2 (PR #157): `Project` (`releaseBranch`, `integrationBranch`, `hasCode`, `inventoryState`, `accessLost`), `apps/server/src/projects/` (`projects.ts`, `project.view.ts`), `/projets` (`PageProjets`), `project.upserted`.
- Created by PROJET-6: Local Projets (`repositoryId` null, `nameSealed`, `folderState` `pending|present|missing`, set by the Runner's `projects.folders`), the Décision `project.folder-missing`, `/projets/ajouter?projet=<id>` (choose the folder again), `PageProjet` at `/projets/:id` with its header and its « Projet » Card, `PageProjets` v2, `projectName(project)` in `apps/web/src/projects.ts`, the Runner's `state.Projects` (projectId → path) and `internal/folders/`.
- Created by PARAM-2: `RolesService.check(pilotId, { projectId?, roleIds? })` → `zRoleCheck[]`. By PROCESS-3: `GET /api/projects/:id/process` (`zProjectProcess { active: { number, definition, templateName }, draft }`), `process.upserted`, the `processes` slice. By SOURCE-1: `SourcesService.sourcesOf(tx, projectId)` (`ticket`, `code`: `local|github`). By RUNNER-16: `mcp_servers` (`name`, `state` `ready|failed`), `mcp-server.upserted|removed`, the `mcp-server` slice.

## To do

- **Process labels** `packages/contracts/src/process/labels.ts` (beside PROCESS-1's files): `PROCESS_LABELS` `{ name, color, description }` for `ready-for-agent` (1d76db), `needs-human` (d93f0b), `revue-visuelle` (fbca04), `type:feature` (0e8a16), `type:fix` (d73a4a), `type:chore` (c5def5), `type:spike` (fbca04), `type:externe` (d4c5f9), `blocked:externe` (b60205), `priority:P0`, `priority:P1`, `priority:P2`, `size:S`, `size:M`, `size:L` (ededed), French descriptions.
- **Contract** `packages/contracts/src/api/projects.ts` gains `zReadiness = { ready: boolean, computedAt, checks: [{ id: 'runner-linked' | 'folder' | 'engines' | 'tools' | 'process' | 'labels' | 'branches' | 'inventory', state: 'ok' | 'missing' | 'pending', facts: Record<string, string | number | boolean | null>, fix: 'auto' | 'link' | null }] }` (only the checks that apply) and `zProject.readiness`.
- **Runner protocol** `packages/contracts/src/runner/folders.ts` (PROJET-6's file; fixtures in `packages/contracts/fixtures/runner/`): server → Runner `project.folder.status { projectId }` and `project.folder.prepare { requestId, projectId, releaseBranch, integrationBranch }`; Runner → server `project.folder.state { projectId, present, isGit, hasCommits, releaseBranch: boolean, integrationBranch: boolean }` (figures only, never the path) and `project.folder.prepared { requestId, projectId, ok, error?: 'folder-missing' | 'git-identity-missing' | 'git-failed' }`.
- **Runner** `apps/runner/internal/folders/prepare.go`: `Status(path, release, integration)` (`git rev-parse`, `git rev-list --count HEAD`, `git show-ref --verify refs/heads/<b>`); `Prepare(path, release, integration)`: not a git repository → `git init -b <release>`; no commit → `git add -A` then `git commit -m "chore(crewdeck) : premier commit"` (`--allow-empty` when nothing to add) with the Pilote's own git identity (none → `git-identity-missing`, nothing committed); integration branch absent → `git branch <integration> <release>`; never a checkout nor a change of the working tree's branch. Handlers of both messages; a `project.folder.state` after each `project.folder.prepare`. Go tests on `t.TempDir()`.
- **Server** `apps/server/src/projects/readiness/`:
  - `readiness.checks.ts`: one pure evaluator per check, `(facts) → check | null` (null: it does not apply):
    - `runner-linked`: a linked Runner (facts `online`, `machine`); fix `link` (`/runner`);
    - `folder` (a Projet with a folder, PROJET-6's `folderState` not null): `missing` when `folderState` is `missing` (fix `link`, `/projets/ajouter?projet=<id>`), `pending` while `pending`; then from the last `project.folder.state`: not git, no commit or no integration branch → `missing`, fix `auto`; the release branch absent in a git folder with commits → `missing`, fix `null` (facts: its name); else `ok` (facts `machine`);
    - `engines`: `RolesService.check(pilotId, { projectId, roleIds })` for the Rôle ids the active version's Étapes name (the draft's while there is no active version; `engines` and `tools` read the same definition) (their `role` Outils), all usable (facts: each Rôle's name and Moteur); fix `link` (`/projets/:id/parametres`);
    - `tools`: every Serveur MCP an Étape names is declared on the Runner and `ready`, and a `connector` Outil `github` has a repository whose access is not lost (facts: `mcpMissing`, `mcpFailed` (names), `githubUnavailable`); fix `link` (`/runner`); a Commande needs nothing more than the Runner: its text is checked when it runs (PROCESS-12);
    - `process`: an active version → `ok` (it has no Manque, ADR 0011), facts `version`, `templateName`; no active version yet, only a draft (PROCESS-3 keeps as a draft a copy of the Modèle that has a Manque, such as a Local Projet whose « Checks » has no Commande) → `missing`, facts `gaps` (the count of PROCESS-2's `findGaps(draft.definition, sources)`), fix `link` (`/projets/:id/process`), never `auto`; its meta « <n> Manques à régler avant de l'activer »;
    - `labels` (the `ticket` group on GitHub): every `PROCESS_LABELS` name present (`listLabels`); facts the missing count; fix `auto`;
    - `branches` (the `code` group on GitHub): `getBranch` of the release and the integration branches; integration missing → fix `auto` (created from the release branch's SHA); release missing → `missing`, fix `null` (facts: the name);
    - `inventory` (`hasCode`): `ok` when `inventoryState` is `approved`, `pending` when `drafting`, `to-approve` or `awaiting-merge`, else `missing`; fix `null` (PROJET-4, PROJET-5).
  - `ReadinessService.recompute(pilotId, projectId, { github, folder })`, stored in `projects.readiness` (jsonb, migration) with `project.upserted`; GitHub facts and the folder's last state stored with it, so that a recompute without `github` or `folder` reuses them. `github: true` on following (PROJET-2's handler), after a GitHub fix, on a `push` to the release or integration branch, a `label` webhook, a `ReconcileHooks` key `readiness` (every 15 min); `folder: true` (a `project.folder.status` sent, the answer recomputing) on the Runner's `hello.accepted`, a `projects.folders` change and after a folder fix; neither on `runner.upserted`, `ai-account.upserted`, `settings.upserted`, `process.upserted`, `mcp-server.*`, a Source changed and an `inventoryState` change.
  - `POST /api/projects/:id/fixes/:checkId { seq }` (`labels`, `branches`, `folder`): `ensureLabel` for each missing label; `createBranch(integration, releaseSha)`; `folder`: `project.folder.prepare` to the Runner, the check `pending` until `project.folder.prepared` (then a recompute; an error keeps it `missing` with `facts.error`, « Git ne connaît pas encore ton nom : `git config --global user.name` et `user.email` sur ta machine. » for `git-identity-missing`). Returns the Projet. Errors: 404 `project.not-found`, 409 `realtime.stale`, 422 `project.fix-unavailable` « Rien à corriger ici. » (the check absent, `ok` or without an `auto` fix), 422 `runner.offline` for `folder`; GitHub's own as `github.errors.ts` maps them; French messages in `apps/server/src/errors/messages.ts`.
- **Page** `/projets/:id` (PROJET-6's `PageProjet`, a new version; view `apps/web/src/views/projet.ts`): header count « <n> point(s) à régler » or « prêt », the buttons « Gestion du process » (→ `/projets/:id/process`, shown once that route is in `apps/web/src/routes.ts`, PROCESS-7) and « Paramètres du Projet » (→ `/projets/:id/parametres`, PARAM-3); not ready → the caution `Banner` « Le Process ne peut pas démarrer » naming the first missing check and what « Corriger » does; the Card « Ce dont le Process a besoin »: one `ListRow` per check (missing first, then in the order above), tone and meta from its state and facts (the mockups' wordings: « main présente · develop absente : « Corriger » la crée depuis main », « en ligne · atelier-pc », « Idée, Conception : Claude Code · Code : Codex · Review : Claude Code », « v3 active · aucun Manque », « pas encore un dépôt git : « Corriger » fait git init et un premier commit », « dossier introuvable sur <machine> »), a primary « Corriger » for `auto` fixes, a link for `link` fixes, a go `StatusBadge` « ok » when done.
- **List** `/projets`: each row gains its badge (« prêt » go, « à régler » caution with meta « <n> point(s) à régler : <first> », « inventaire » accent when only the inventory is missing, with « Inventaire à approuver avant le Process »).
- t() keys `projet.readiness.*` in `packages/sdk/src/i18n/fr.ts`.
- Scenarios `apps/server/src/testing/scenarios/projet.ts` (`projet`: a GitHub Projet whose integration branch is missing) and `projets` extended (PROJET-6's `projet-local` gains its readiness: every row ok); the fake Runner answers `project.folder.status` and `project.folder.prepare` from the seeded folders; Playwright `apps/web/e2e/projet.spec.ts`, `projets.spec.ts` extended.

## Decisions already made

- Mockup: `projet`, `projets`, `projet-local` (its readiness Card) (pages `design/screens/crewdeck/projet.html`, `…/projets.html`, `…/projet-local.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The row « Paramètres du Process sur GitHub · .process.json présent » of `projet` is not built (ADR 0011). The Local rows follow `projet-local` (PROJET-6's screen), whose readiness Card is this ticket's. The « Boucle en cours » meta of the list is BOUCLE-2's; the « Paramètres » line of the Projet card is PARAM-3's.
- Readiness is stored, not computed on each view: pages read the store (ADR 0008); GitHub and the folder are read on the triggers above only.
- A Runner « hors ligne » is still « relié »: the check is about the link; the offline state is ATOI-3's. The folder's last state stays shown while the Runner is offline.
- The folder's fix runs on the Pilote's machine, in their folder: it commits only when the folder has no commit, never on top of the Pilote's work, never switches the checked-out branch, and uses the Pilote's own git identity (the history is theirs, ADR 0012). `git add -A` follows the folder's `.gitignore`; nothing leaves the machine.
- The labels and branches checks follow the Sources (SOURCE-1), not the presence of a repository: a GitHub Projet whose Tickets moved to Local no longer needs the labels on GitHub.
- A Serveur MCP not declared, a Rôle without a usable Moteur and a lost GitHub access are points of preparation (US-4), never Manques: the Manques are the canvas's (ADR 0011).

## Acceptance criteria

- [ ] A GitHub Projet without the integration branch shows « Le Process ne peut pas démarrer » and the branches row with « Corriger »; the click creates `develop` from `main` on GitHub (FakeGitHub records it) and the row turns « ok » without reload.
- [ ] « Corriger » on labels creates only the missing ones; a Projet whose `ticket` group is Local has no labels row.
- [ ] A Local Projet whose folder is not a git repository shows the folder row with « Corriger »; the click makes the Runner run `git init`, a first commit and the integration branch (Go test on a temporary folder), and the row turns « ok »; without a git identity nothing is committed and the row says what to set.
- [ ] A Local Projet whose folder is `missing` shows the folder row linking to choosing it again; the Runner offline makes `folder`'s fix 422 `runner.offline`.
- [ ] An Étape naming the Serveur MCP `stitch` the Runner does not declare shows the tools row `missing` naming it; declaring it turns it « ok ».
- [ ] A Local Projet with no active version and a draft with one Manque shows « Process : 1 Manque à régler avant de l'activer » (plural through t()) (`missing`, a link to `/projets/:id/process`, no « Corriger »), and `readiness.ready` is false; once a version is active the row is « ok ».
- [ ] A Rôle an Étape names without a usable Moteur, a Runner not linked, an inventory not approved each show their row with the right state; when every check is `ok`, `readiness.ready` is true and the list shows « prêt ».
- [ ] No `.process.json` is read nor written by any path of this ticket (FakeGitHub records no such call).
- [ ] The fix route follows the baseline: 404 for another Pilote's Projet, 409 stale `seq`, 422 `project.fix-unavailable`.
- [ ] Screens at 390 and 1280 match the mockups (`projet`, `projets`, and `projet-local`'s readiness Card), axe without violations.

## Verification

- `pnpm exec nx test server -- src/projects/readiness/`
- `pnpm exec nx test-integration server -- projects`
- `pnpm exec nx test contracts -- src/runner/`
- `cd apps/runner && go test ./internal/folders/ -run 'TestStatus|TestPrepare'`
- `pnpm exec nx test web -- src/views/projet.spec.ts`
- `pnpm exec nx e2e web -- projet.spec.ts projets.spec.ts`; `scripts/captures.sh projet projets projet-local` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (`projects.readiness`), run by the deploy. The GitHub App's `label` event subscribed (INFRA-11), mirrored in `docs/pilotage/mep.json`.

## Out of scope

- Drafting and approving the Inventaire: PROJET-4, PROJET-5. Starting the Boucle: BOUCLE-2.
- Creating a Local Projet, its folder and its Décision `project.folder-missing`: PROJET-6. The Gestion du process page: PROCESS-7. Declaring a Serveur MCP: RUNNER-16. Removing `readProcessJson` and `commitProcessJson`: PROJET-7.

## Dependencies

- PROJET-2
- PARAM-2
- CORE-7
- PROCESS-3
- SOURCE-1
- RUNNER-16
- PROJET-6
