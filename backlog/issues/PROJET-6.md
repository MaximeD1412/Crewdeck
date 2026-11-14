---
id: PROJET-6
title: "A Projet from a folder of the Runner's machine: the path checked live through the relay and kept on the Runner, the name sealed, the Modèle de process chosen at creation"
epic: PROJET
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PROJET-2, SOURCE-1, SESSION-1]
adr: [0012, 0003, 0011]
risques: []
stories: [US-3, US-99, US-97]
screens: [projet-local, demarrage-projets, projets-vide]
revue_visuelle: true
video: false
---

## Context

US-3: « create a Projet from a folder of my Runner's machine or from a GitHub repository, choosing the Modèle de process it starts from ». US-99: a Projet with no Connecteur at all, its documents and Tickets Markdown files of its folder. US-97: each new Projet starts from a Modèle de process, « Process Crewdeck » by default. ADR 0012, « Which Source for what »: a Projet has at most one GitHub repository and a folder on the Runner's machine when a group is Local; the path stays on the Runner (`projects` of its state, `projectId` → path), the page sends it through the relay, the server knows only that a folder exists; « What the server keeps of a Local Projet »: the same rows as a GitHub Projet, every text sealed under the vault key, the Projet's name first (ADR 0003 amended). The Décision `project.folder-missing` covers a folder gone or another Runner linked. SOURCE-2 builds the Runner's clone on this folder; SOURCE-3 follows it; PROCESS-14 adds the Pilote's own Modèles to the Select this ticket lays.

## Current state of the code

- Created by PROJET-2: `Project` (`projects`: `repositoryId` required and unique, `githubRepoId`, `owner`, `name`, `fullName`, `displayName`, `releaseBranch`, `integrationBranch`, `hasCode`, `inventoryState`, `accessLost`, `lastSeq`, `followedAt`), `apps/server/src/projects/` (`projects.ts`: `Projects.follow`, `ProjectsController` `POST /api/projects`, `GET /api/projects`, `GET /api/projects/:id`, `ProjectState`; `project.view.ts` `PROJECT_VIEW`, `toProject`), `packages/contracts/src/api/projects.ts` (`zProject`, `zFollowProjects`, `zInstallReturn`), events `project.upserted`, `repository.upserted`; Composants `PageProjets` (`projects [{ id, displayName, fullName }]`, action `add`), `RepositoryPicker` (`context`, `repositories`, `installUrl`, `busy`; actions `follow`, `later`), `PageDemarrage` v3 (`picker`); routes `/projets` → `PageProjets`, `/projets/ajouter` → `RepositoryPicker`; `apps/web/src/projects.ts`, `views/projets.ts`; t() keys `projets.*`, `demarrage.projects.*`; scenarios `projets`, `projets-vide`, `demarrage-projets`.
- Created by SESSION-1: the encrypted relay between the tabs' `/api/ws` and the Runner (`packages/contracts/src/runner/relay.ts`, `apps/server/src/sessions/relay/`, `apps/web/src/sessions/relay.ts`), never stored, the logger redacting `ciphertext`, `nonce`, `wrappedKey`, `enc`.
- Created by SOURCE-1: `artifact_sources` (`ticket`, `code`), `apps/server/src/process/sources/`, the defaults written at Projet creation (a GitHub Projet → `github`, a folder → `local`). PROCESS-3: `ProcessService.createInitialVersion(tx, projectId, from)` called at Projet creation. PROCESS-1: `packages/contracts/src/process/templates/process-crewdeck.ts`, « Process Crewdeck ».
- On `develop`: the vault on both sides, `Vault.sealItem(plaintext, aad)`/`openItem` (`apps/web/src/keys/vault.ts`, `SealedItem { key, ciphertext }`) and `(*Vault).SealItem`/`OpenItem` (`apps/runner/internal/keys/vault.go`); no `zSealedItem` in `packages/contracts`. `apps/runner/internal/state/state.go`: `State { Server, RunnerID, Token }` in `runner.json`, no `projects`. `RunnerCommands.send` (422 `runner.offline`), `RunnerDispatcher.registerRunnerHandler`, `RunnerPresence.isOnline`; `DecisionsService.raise(tx, …)`/`resolve`, `DECISION_KINDS` (`packages/contracts/src/api/decisions.ts`), `zDecision.projectName` a readable string; `Tabs`, `TextField`, `Select`, `Banner`, `Card`, `KeyValue`, `ListRow`, `Empty`.
- The mockups: `design/screens/crewdeck/projet-local.html` (the Local Projet's page), `demarrage-projets.html` and `projets-vide.html` (GitHub only, still naming `.process.json`).

## To do

- **Contracts**
  - `packages/contracts/src/keys/sealed.ts` `zSealedItem = { key, ciphertext }` (base64url), the wire shape of `SealedItem` (reused if an earlier ticket created it).
  - `api/projects.ts`: `zProject.repositoryId`, `owner`, `name`, `fullName`, `displayName` nullable (`null` for a Local Projet), `nameSealed: zSealedItem | null`, `folder: 'pending' | 'present' | 'missing' | null` (`null`: no folder). `zProcessTemplateId` (« Process Crewdeck »'s id only, until PROCESS-14); `zFollowProjects` gains `templateId`; `zCreateLocalProject = { id: zId (drawn by the page), nameSealed, folderSealed: zSealedItem, hasCode: boolean, releaseBranch: string | null, templateId }`; `zAttachProjectFolder = withSeq({ folderSealed })`.
  - `keys/folder.ts`, the plaintexts: `zFolderCheck = { path: string (1 to 4096) }`; `zFolderCheckResult = { state: 'not-absolute' | 'missing' | 'not-a-folder' | 'taken' | 'not-git' | 'ready', hasCode: boolean, branch: string | null, name: string }`; the additional data `folder.check:<requestId>`, `folder.checked:<requestId>`, `project:<projectId>:folder`, `project:<projectId>:name`.
  - Runner protocol `runner/folders.ts` (in the two unions of `protocol.ts`, fixtures `fixtures/runner/<type>.json`): server → Runner `folder.check { requestId, tabId, sealed }` and `project.folder.attach { projectId, sealed }`; Runner → server `folder.checked { requestId, tabId, sealed }` and `projects.folders { present: zId[] }`. Tab frames beside SESSION-1's: tab → server `folder.check { requestId, sealed }`; server → tab `folder.checked { requestId, sealed }`, `folder.error { requestId, code: 'runner.offline' }`.
  - `DECISION_KINDS` gains `project.folder-missing`.
- **Prisma** and migration `<timestamp>_local_projects` (expand only): `Project.repositoryId`, `githubRepoId`, `owner`, `name`, `fullName`, `displayName` nullable; `nameSealed Json?`; `enum ProjectFolderState { pending present missing }`, `folderState ProjectFolderState?`; a `CHECK ((repository_id IS NOT NULL AND display_name IS NOT NULL) OR (name_sealed IS NOT NULL AND folder_state IS NOT NULL))`. `PROJECT_VIEW` and `toProject` follow.
- **Server** `apps/server/src/projects/local/`:
  - `POST /api/projects/local` (`zCreateLocalProject`) → 201 `zProject`: 422 `runner.offline` when the Runner is not online (checked first); 422 `project.id-taken` « Ce Projet existe déjà. » for an `id` already used. One transaction: the row (`folderState: pending`, `integrationBranch: develop`, `releaseBranch` the folder's branch or `main`, `inventoryState` `pending` when `hasCode`, else `not-needed`), `ProcessService.createInitialVersion(tx, id, templateId)`, SOURCE-1's defaults for a folder (every group `local`), `project.upserted`. After the commit, `project.folder.attach` to the Runner; a send that fails leaves `pending`.
  - `POST /api/projects/:id/folder` (`zAttachProjectFolder`) → 200 `zProject`: 404 `project.not-found`, 409 `realtime.stale`, 422 `project.not-local` « Ce Projet n’a pas de dossier sur ta machine. », 422 `runner.offline`; `folderState: pending`, then `project.folder.attach`.
  - `projects.folders` handler: each Projet of the Pilote with a `folderState` becomes `present` when listed, `missing` when not; on a change, one transaction per Projet writes it with `project.upserted` and raises (`missing`) or resolves (`present`) its Décision `project.folder-missing`: `subjectType: 'project'`, `subjectId` its id, `projectId` its id, `projectName: null`, label « Choisis à nouveau son dossier », `metaParts` [the Runner's machine], tone `halt`, link `/projets/ajouter?projet=<id>`.
  - `folder-relay.ts`: a tab's `folder.check` goes to the Runner with its `tabId` (offline: `folder.error`), the Runner's `folder.checked` to that tab only, of the same Pilote; nothing stored, frames logged by type and `requestId` only, `sealed` redacted.
  - `Projects.follow` takes `templateId` and passes it to `createInitialVersion`. A Décision of a Local Projet carries `projectName: null` (the page names it).
- **Runner** `apps/runner/internal/folders/`:
  - `Check(input, projects, projectID) Result`: `~` expanded; under WSL `C:\…` read as `/mnt/c/…`; relative → `not-absolute`; absent → `missing`; not a directory, or inside the Runner's state folder → `not-a-folder`; the same real path (`filepath.EvalSymlinks`) as another Projet's → `taken`; `git -C <path> rev-parse --show-toplevel` equal to the path → git (`hasCode`: `git rev-list --count HEAD` ≥ 2, `branch`: `git symbolic-ref --short -q HEAD`), else `not-git` (`hasCode`: a regular file within two levels other than `README*`, `LICENSE*` and dotfiles); `name` the folder's base name.
  - `state.State` gains `Projects map[string]string` (`projects`, projectId → absolute path), written as today (atomic, mode 600).
  - Handlers: `folder.check` (opened with the vault, `Check`, the result sealed, `folder.checked`); `project.folder.attach` (opened, `Check` again, `ready` or `not-git` → stored); `projects.folders` (the ids whose path still exists) after `hello.accepted`, after each attach, and every 60 s when that set changed.
- **Web**
  - `apps/web/src/projects/folder-check.ts`: `checkFolder(path)` seals `{ path }`, sends the frame, waits 10 s for its `folder.checked` (else `timeout`), opens and parses it; debounced 400 ms while typing, the last request winning.
  - `apps/web/src/projects/local.ts`: `createLocalProject({ path, name, templateId, check })` draws the id (UUIDv7, `uuid`'s `v7`), seals the name and the path, posts; `attachFolder(projectId, path, seq)`. `projectName(project)` in `apps/web/src/projects.ts`: `displayName`, else the opened `nameSealed`, else « Projet local » while the vault is locked; used by `/projets`, « À toi » (a Décision whose `projectName` is null) and the Projet filter.
  - Composant `FolderProjectForm` (`packages/contracts/src/composants/folder-project-form.ts`, tag `cd-folder-project-form`, category `partie`; `packages/skin-passerelle/src/folder-project-form.ts`): data `{ context: 'demarrage' | 'projets' | 'repick', path, check: { state: 'idle' | 'checking' | <zFolderCheckResult's states> | 'runner-offline' | 'timeout', hasCode }, name, templates: [{ id, label }], templateId, busy, vaultLocked, machine: string | null }`; actions `checkPath { path }`, `create { path, name, templateId }`, `later {}`. A `TextField` « Chemin du dossier » (placeholder « ~/projets/recettes ») whose help or error is the check's line; a `TextField` « Nom du Projet », filled with the folder's name until the Pilote types; a `Select` « Modèle de process »; the primary « Créer le Projet », enabled on `ready` or `not-git` with a name and the vault open. `repick`: the path only and « Relier ce dossier ». The check's lines: `missing` « Dossier introuvable sur <machine>. », `not-git` « Pas encore un dépôt git : Crewdeck proposera git init. », `ready` « Dépôt git · déjà du code : un inventaire sera proposé. » or « Dépôt git · vide. », `not-absolute` « Un chemin complet, depuis / ou ~. », `not-a-folder` « Ce chemin n’est pas un dossier. », `taken` « Ce dossier est déjà celui d’un autre Projet. », `runner-offline` « Ton Runner est hors ligne : démarre-le pour choisir un dossier. », `timeout` « Le Runner ne répond pas, réessaie. »; `vaultLocked` « Ouvre Crewdeck sur un Appareil de confiance pour créer un Projet local. ».
  - `RepositoryPicker` v2: `templates`, `templateId`, the `Select` « Modèle de process », `follow { repositoryIds, templateId }`.
  - `/projets/ajouter` → `PageAjouterProjet` (`page-ajouter-projet.ts`): PageHeader « Ajouter un Projet » (back « Projets »), `Tabs` `dossier` « Dossier sur ta machine » and `github` « Dépôt GitHub », then the `FolderProjectForm` or the `RepositoryPicker`; `?projet=<id>`: the `repick` form under « Choisir le dossier de <name> ». On `/demarrage`, `PageDemarrage` v+1 shows the same Tabs on the `projects` step (data `projectsTab`, `folder`, `picker`; action `selectProjectsTab`), creating a Local Projet ending the getting started as following does. The tab open first: `github` when the Pilote has a Dépôt GitHub, else `dossier`.
  - `PageProjets` v2: `projects [{ id, name, meta }]` (meta `fullName`, or « Local · sur <machine> », « Local · dossier introuvable » when `missing`); the empty text « Choisis un dossier de ta machine ou un dépôt GitHub : il devient un Projet, préparé pour son Process. ».
  - `/projets/:id`, a Local Projet: the « Projet » Card's rows « Dossier » (« sur <machine> », and « en attente du Runner » or « introuvable »), « Connecteurs » (« aucun : tout est Local » when every group is `local`), « Suivi depuis »; under it the neutral Banner « Des fichiers que tu lis à la main » with the mockup's text. `PageProjet` is PROJET-3's; if PROJET-3 is not merged when this ticket starts, this ticket creates `PageProjet` with its header and this Card only, PROJET-3 adding its readiness Card.
  - t() keys `projets.local.*`, `projets.ajouter.*`, `demarrage.projects.*` (lead « Un dossier de ta machine ou un dépôt GitHub : chacun devient un Projet, préparé pour son Process. »), `decision.kind.project.folder-missing` « Dossier du Projet introuvable »; messages `project.id-taken`, `project.not-local`.
- **Scenarios and tests**: the fake Runner (`apps/server/src/testing/fake-runner.ts`) answers `folder.check` and `project.folder.attach` from folders the scenario seeds (`seedFolder(path, result)`), sealing with the vault key the scenario gives it and its Appareil (SESSION-1's, or `FakeRunner.useVault(key)` added here); scenarios `projets.ts` (`projets-vide`, `projet-local`), `demarrage.ts` (`demarrage-projets`, the folder tab); Playwright `apps/web/e2e/projets.spec.ts`, `demarrage.spec.ts`; Go tests on temporary folders (`t.TempDir()`, `git init`).

## Decisions already made

- Mockup: `projet-local`, `demarrage-projets`, `projets-vide` (pages `design/screens/crewdeck/projet-local.html`, `…/demarrage-projets.html`, `…/projets-vide.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. `demarrage-projets` and `projets-vide` show GitHub only and name `.process.json`: the folder tab and the copy above replace that. The readiness Card of `projet-local` (« Ce dont le Process a besoin ») is PROJET-3's; its « Process » row is PROCESS-3's.
- A Local Projet starts with a draft, not a version: « Checks » of « Process Crewdeck » needs a Commande there (no CI), so its copy has a Manque and an active version never has one (PROCESS-3). The Pilote attaches the Commande of the checks and activates (PROCESS-9, PROCESS-10, PROCESS-12); readiness says so (PROJET-3).
- The path is typed, not browsed: a page cannot browse the Runner's machine, and the Runner checks it as it is typed. It leaves the browser only sealed under the vault key, for the Runner; neither the server nor the page keeps it. The folder's name is not shown on the Projet's page for that reason (« Dossier : sur <machine> »).
- The Projet's id is drawn by the page, so that its name is sealed with the additional data `project:<id>:name` before the server sees it.
- The Runner must be online to create a Local Projet (it checks the folder); a folder that vanished between the check and the attach, a Runner reinstalled or another Runner linked all end as `missing` with its Décision, resolved by choosing the folder again.
- A folder that is not a git repository is accepted: « git init » and the first commit are the Projet's preparation (PROJET-3, ADR 0012), not a condition of its creation. « Has code » keeps PROJET-2's rule (two commits) for a git folder.
- A Local Projet's integration branch is `develop`, its release branch the folder's current branch (`main` without git); both are Paramètres (PARAM-3).
- The Select lists « Process Crewdeck » only until PROCESS-14; it is there now so that US-3's gesture does not change when Modèles come.
- The two tabs keep one form each: a folder and a repository are two ways to create, never mixed in one Projet here (a Projet moving a group is SOURCE-7's migration).

## Acceptance criteria

- [ ] Typing `~/projets/recettes` checks it through the Runner within a second: a git folder with code shows « Dépôt git · déjà du code… », an absent one « Dossier introuvable sur <machine>. », a folder without git « Pas encore un dépôt git… », a relative path « Un chemin complet… », the folder of another Projet « … déjà celui d’un autre Projet. »; Runner offline: its line, and « Créer le Projet » disabled.
- [ ] No frame, row or log of the server contains the path or the name in clear (a test sends a path through the relay and greps the database and the logger's output).
- [ ] « Créer le Projet » makes a Projet with `repositoryId: null`, `nameSealed`, `folder: pending` then `present` once the Runner stored it (`runner.json` `projects` has its path), its Process at « Process Crewdeck »'s version and its Sources Local; `/projets` lists it by its decrypted name, meta « Local · sur <machine> ».
- [ ] `POST /api/projects/local` follows the route baseline: schema, 400 with `fields`, 401, 422 `runner.offline`, 422 `project.id-taken`; `POST /api/projects/:id/folder`: 404 for another Pilote's, 409 stale, 422 `project.not-local`.
- [ ] Deleting the folder (or linking a new Runner) turns the Projet `missing` within 60 s with the open Décision « Dossier du Projet introuvable »; choosing the folder again on `/projets/ajouter?projet=<id>` resolves it.
- [ ] A Local Projet created from « Process Crewdeck » has no active version and a draft whose Manque is « Checks » without a Commande (PROCESS-3's rule); its page links to « Gestion du process ».
- [ ] Following a Dépôt GitHub with the Select's Modèle passes it to `createInitialVersion`; the getting started's folder tab ends « Premiers pas » on « À toi ».
- [ ] `projects.folders`, `folder.check`, `folder.checked` and `project.folder.attach` fixtures are valid in TypeScript and in Go; a result sealed in Go opens in TypeScript.
- [ ] `FolderProjectForm`, `PageAjouterProjet`, `RepositoryPicker` and `PageProjets` examples render and their actions emit valid `cd-action`s; `projet-local`, `demarrage-projets`, `projets-vide` at 390 and 1280 px, axe without violations.

## Verification

- `pnpm exec nx test contracts -- src/runner/folders.spec.ts src/api/projects.spec.ts`
- `pnpm exec nx test server -- src/projects/`
- `pnpm exec nx test-integration server -- projects`
- `pnpm exec nx test web -- src/projects/ src/views/projets.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/folder-project-form.spec.ts src/page-ajouter-projet.spec.ts src/page-projets.spec.ts`
- `cd apps/runner && go test ./internal/folders/ ./internal/state/ ./internal/protocol/`
- `pnpm exec nx e2e web -- projets.spec.ts demarrage.spec.ts`; `scripts/captures.sh projet-local demarrage-projets projets-vide` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

- The migration `<timestamp>_local_projects` (expand only), run by the deploy: one entry in `docs/pilotage/mep.json`.
- A Runner of this release or later to create a Local Projet (an older one never answers `folder.check`: the page says « Le Runner ne répond pas »).

## Out of scope

- The Runner's clone of the folder, the Ticket files: SOURCE-2. Following the folder's changes: SOURCE-3. « git init » and the Local readiness rows: PROJET-3. The Pilote's Modèles in the Select: PROCESS-14. Moving a Projet's group to another Source: SOURCE-7. A Pilote without GitHub on the GitHub tab: CORE-11's Banner, kept as is.

## Dependencies

- PROJET-2.
- SOURCE-1.
- SESSION-1.
