---
id: PARAM-3
title: "Paramètres of a Projet: inherited from the account, Rôles overridden, its branches, its two worktree Commandes sealed, push on or off; the Étapes optionnelles removed"
epic: PARAM
type: feature
priority: P1
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PARAM-2, PROJET-2]
adr: [0006, 0007, 0008, 0003, 0011, 0013]
risques: []
stories: [US-82, US-39]
screens: [parametres-projet, parametres]
revue_visuelle: true
video: false
reprend: 75
---

## Context

US-82: a Projet inherits the account's Paramètres and changes only what it needs: its Rôles, and its notifications, which a Projet can only turn on or off at the MVP; its Étapes are its Process's. US-39: the Moteur and model of each Rôle can be changed for one Projet. This ticket adds the Projet's overrides, merges them in `SettingsService.effective`, and draws the Projet's Paramètres page and the account page's « Par Projet » card. The Planifications card is BOUCLE-8's.

The refonte (PRD #169, ADRs 0011 and 0013) changes three things here. There are no Étapes optionnelles any more (US-83 removed): an Étape runs because it is in the Projet's Process, so the page's « Étapes » card only points at the Gestion du process, and PARAM-1's `optionalSteps` leaves the account's settings. There is no `.process.json`: the integration and release branches are Paramètres of the Projet, and the worktree's preparation and cleaning (`agentLoop.setupCmd` and `dropCmd` until now) are the Projet's two Commandes « Préparer le worktree » and « Nettoyer le worktree », sealed by the browser like any Commande (ADR 0011, « No more `.process.json` »), which RUNNER-20 runs around each Session's worktree. And a Projet may be Local: every setting here works the same with or without a GitHub repository.

## Current state of the code

- `packages/contracts/src/composants/setting-row.ts` (`SettingRow` v1: `label`, `help`, `origin` `compte|projet|null`, no action), `select.ts`, `toggle.ts`, `text-field.ts` (`multiline`), `banner.ts`, `list-row.ts`, `card.ts`, and their elements in `packages/skin-passerelle/src/`.
- `apps/web/src/keys/vault.ts`: `Vault.sealItem(plaintext, aad)` → `{ key, ciphertext }`, `openItem(item, aad)`; `apps/runner/internal/keys/vault.go`: `Vault.SealItem`, `OpenItem`. No envelope schema for a sealed item in `packages/contracts/src/keys/` (only `pairing.ts`).
- Mockups: `design/screens/crewdeck/parametres-projet.html` (Rôles, « Étapes » linking to the Gestion du process, Planifications, Notifications), the « Par Projet » card of `parametres.html`.
- Created by PARAM-1 (PR #147): `packages/contracts/src/api/settings.ts` (`zAccountSettings` with `optionalSteps`, `DEFAULT_ACCOUNT_SETTINGS`, `zAccountSettingsPatch`), `packages/contracts/src/values.ts` (`OPTIONAL_STEPS`, `zOptionalStep`), `account_settings.optional_steps` (jsonb, migration `20261120000000_account_settings`), `SettingsService.effective(pilotId, projectId?)` ignoring `projectId` and `patched`, `packages/contracts/src/composants/page-parametres.ts` (`SETTINGS_SECTIONS` with `optional-steps`), the t() keys `settings.section.optional-steps` and `composants.PageParametres.slots.optional-steps`, `PageParametres` with its `projects` Emplacement. By PARAM-2: `RolesService` (defaults, `check`), `zRoleId`, the custom Rôles, the « Rôles et modèles » card.
- Created by PROJET-2 (PR #157): `Project` (`apps/server/src/projects/`) with `releaseBranch`, `integrationBranch` (`DEFAULT_INTEGRATION_BRANCH = 'develop'`), the `projects` store slice, `project.upserted`, `/projets/:id`.

## To do

- **Remove the Étapes optionnelles**: `optionalSteps` leaves `zAccountSettings`, `DEFAULT_ACCOUNT_SETTINGS`, `zAccountSettingsPatch` and `patched`; `OPTIONAL_STEPS`, `zOptionalStep`, `OptionalStep` leave `values.ts`; `optional-steps` leaves `SETTINGS_SECTIONS` and its t() keys; a migration drops `account_settings.optional_steps`. A `PATCH /api/settings` with `optionalSteps` gets 400 (strict schema).
- **Sealed item**: reuse `zSealedItem` (the browser's `SealedItem` as base64url strings) where PROCESS-1 or PROJET-6 put it; when neither has merged, this ticket adds it in `packages/contracts/src/keys/sealed.ts` as `{ key, ciphertext }`, the shape PROJET-6 names.
- **Contract** `packages/contracts/src/api/project-settings.ts`:
  - `zProjectSettingsOverrides = { roles: Partial<Record<RoleId, zRoleChoice>>, notifications: { push?: boolean } }` (a key absent = inherited);
  - `zProjectSettings = { projectId, effective: zEffectiveSettings, origins: { roles: Record<RoleId, 'compte' | 'projet'>, notifications: { push: 'compte' | 'projet' } }, changedCount: int, branches: { integration, release }, worktreeCommands: zSealedItem | null }`; the sealed plaintext is `zWorktreeCommands = { prepare: string | null, clean: string | null }` (each 1..4000 characters when not null), exported from the same file for the page and RUNNER-20;
  - the patch `zProjectSettingsPatch`: `roles` (each a choice or `null`, back to the account), `notifications.push` (a boolean or `null`), `branches` (`integration?`, `release?`), `worktreeCommands` (a `zSealedItem` of the whole `zWorktreeCommands`, or `null` to remove both).
  - The `settings` event's payload becomes a union: the account's settings, or `{ projectSettings: zProjectSettings }` (no new resource).
- **Server** `apps/server/src/settings/`:
  - Prisma model `ProjectSettings` (`project_settings`): `projectId` (unique, FK `projects` on delete cascade), `pilotId`, `roles` (jsonb partial), `notificationsPush` (nullable), `worktreeCommands` (jsonb nullable, one `zSealedItem`), `updatedAt`. One migration with the drop above.
  - `SettingsService.effective(pilotId, projectId)` merges: the Projet's override, else the account's value, else the default (PARAM-2's defaults computed after the merge, so a Projet that overrides `code` gets a `review` default on another Moteur than its own `code`); an override of a custom Rôle the Pilote removed is ignored.
  - `GET /api/projects/:id/settings` → `zProjectSettings`; `PATCH /api/projects/:id/settings` → `zProjectSettings`, the `settings` event (and `project.upserted` when a branch changes) in the same transaction. Errors: 404 `project.not-found` for an unknown or another Pilote's Projet; a Rôle choice validated as PARAM-2 (422 `settings.engine-unusable`, 400 on an unknown Rôle id); a branch name that `git check-ref-format --branch` would refuse (no space, `..`, `~^:?*[\`, leading `-`, trailing `/` or `.lock`, 1..100 characters) → 400 `validation.invalid` with `fields["branches.integration"]` « Ce nom de branche n'est pas valide. »; integration equal to release → 422 `settings.branches-same` « La branche d'intégration et la branche de release sont deux branches. »; a sealed item over 16 KiB → 400.
  - Branches are written to `projects.integration_branch` and `projects.release_branch` (PROJET-2's columns); the worktree Commandes to `project_settings`, opaque: the server never opens them (ADR 0003).
  - `ProjectSettingsService.worktreeCommands(projectId)` → the `zSealedItem` or `null`, for RUNNER-20.
  - `RolesService.check(pilotId, { projectId })` uses the merged Rôles.
  - `StateContributor` `settings` gains `projects: zProjectSettings[]` (one per Projet).
- **Page** `/projets/:id/parametres` (`apps/web/src/routes.ts`):
  - Composant `PageParametresProjet` (`packages/contracts/src/composants/page-parametres-projet.ts`, `packages/skin-passerelle/src/page-parametres-projet.ts`, registered in `COMPOSANTS` and `/parametres/composants`): header « <Projet> », count « Paramètres du Projet · <n> modifiés »; the accent `Banner` « Ce Projet hérite de ton compte » with the mockup's sentence; the sections nav with each section's count of changed settings; Emplacements `roles`, `steps`, `branches`, `worktree`, `schedules`, `notifications`.
  - `SettingRow` gains the action `revert` (« Revenir au compte », shown when `origin` is `projet`), its version 2 (ADR 0006).
  - `roles`: one `SettingRow` per Rôle of the account (default and custom) with its origin and a `Select`; `revert` sends `null`.
  - `steps`: the Card « Étapes », one `ListRow` « Gestion du process », meta « Les Étapes s'ajoutent et se retirent dans la Gestion du process du Projet ; la Review et les checks restent avant chaque merge. », linking to `/projets/:id/process` once that route is in `apps/web/src/routes.ts` (PROCESS-7 builds the page; until then the row shows without its link, the test covering both).
  - `branches`: the Card « Branches », two `SettingRow`s without origin, each a `TextField` (« Branche d'intégration », help « Où chaque changement de code est mergé. »; « Branche de release », help « Ce qui part en production. »), saved on `change`.
  - `worktree`: the Card « Worktree », two `SettingRow`s without origin, each a multiline `TextField` (« Préparer le worktree », help « Lancée dans le worktree de chaque Session avant l'agent, sur ta machine : `pnpm install`, la copie d'un `.env`. Son échec fait échouer l'Étape. »; « Nettoyer le worktree », help « Lancée quand la Session se termine, avant que le worktree soit retiré. »). The page opens the stored item with the vault (`openItem`, additional data `settings:<projectId>`), parses it as `zWorktreeCommands`, and on a change seals both texts again as one `zWorktreeCommands` with `sealItem` before the PATCH; an empty text is `null`, both empty sends `worktreeCommands: null`. The vault locked or the browser not a trusted Appareil: both fields disabled, help « Ouvre ces Paramètres sur un Appareil de confiance pour lire et changer les Commandes. »
  - `notifications`: `SettingRow` « Notifications push », help « Activées ou non pour ce Projet ; le reste des notifications se règle sur ton compte. », a `Toggle`.
  - View `apps/web/src/views/parametres-projet.ts`; client `apps/web/src/api/project-settings.ts`. The « Paramètres du Projet » button of `/projets/:id` links here.
- **Account page**: the Card « Par Projet » in the `projects` Emplacement of `/parametres`: one `ListRow` per Projet, meta « hérite de ton compte » or « <n> Paramètres modifiés », linking to `/projets/:id/parametres`.
- t() keys `settings.project.*`, `settingRow.revert` in `packages/sdk/src/i18n/fr.ts`.
- Scenario `apps/server/src/testing/scenarios/parametres-projet.ts` (`parametres-projet`: a Projet with two Rôles changed, both worktree Commandes sealed by the scenario's test vault); Playwright `apps/web/e2e/parametres-projet.spec.ts`; `apps/web/e2e/parametres.spec.ts` extended for « Par Projet ».

## Decisions already made

- Mockup: `parametres-projet` (page `design/screens/crewdeck/parametres-projet.html`; captures `…/parametres-projet-390.png`, `…-1280.png`), and of `parametres` only its « Par Projet » card. It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The « Branches » and « Worktree » cards are not in the mockup: they are composed of the same `Card`, `SettingRow` and `TextField` as the « Rôles et modèles » card, after it and before « Planifications ».
- A Projet's notifications are only push on or off (US-82); the account's push off wins over a Projet's on. The time zone has no Projet override.
- « Modifié pour ce Projet » means a stored override, even when equal to the account's current value: the Pilote's explicit choice is kept when the account changes. Branches and worktree Commandes are the Projet's own (no account value): they never count in `changedCount`.
- The worktree Commandes are free text of the Pilote's that runs on their machine: sealed under the vault key like a Commande of the Process (ADR 0011), additional data `settings:<projectId>`, the two texts in one item, so that a compromised server cannot forge one (risk SEC-11). Their place is always the Session's worktree; no health address.
- Changing a branch applies to the work that starts after it (the next Session's base, the next merge); work in progress keeps what it started with. Whether the branch exists is US-4's readiness (PROJET-3), not a refusal here: a Local Projet's branches are in its folder, which the server never reads.
- `optionalSteps` is dropped, not migrated: no Étape is optional any more, and « Process Crewdeck » holds every Étape the defaults had on.

## Acceptance criteria

- [ ] A Projet with no override shows every Rôle « Hérité du compte » and follows a change of the account at once.
- [ ] Changing the Code's model for a Projet marks it « Modifié pour ce Projet », does not change the account, and `effective(pilotId, projectId)` returns it; « Revenir au compte » removes the override.
- [ ] A Projet whose Code is on Codex gets a Review default on Claude Code when the account leaves the Review unset; a custom Rôle of PARAM-2 can be overridden too.
- [ ] Push off for a Projet stops its pushes (ATOI-4's rule reads `effective`); the account's push off wins.
- [ ] Changing the integration branch to `main-2` writes `projects.integration_branch` with `project.upserted`; `feat..x` gets 400 on its field; the same name for both gets 422 `settings.branches-same`.
- [ ] « Préparer le worktree » `pnpm install` is stored sealed: the stored row and the request body hold no `pnpm install` (test on both), and the page shows the text again after a reload on a trusted Appareil; on a browser without the vault both fields are disabled.
- [ ] `GET /api/settings` no longer has `optionalSteps`, a PATCH with it gets 400, and the column is gone after the migration.
- [ ] The routes follow the baseline: 400 with `fields`, 401, 404 for another Pilote's Projet, 422 for an unusable model.
- [ ] « Par Projet » lists each Projet with its count of changed settings; `parametres-projet` at 390 and 1280 matches the mockup, axe without violations.

## Verification

- `pnpm exec nx test contracts -- src/api/project-settings.spec.ts src/api/settings.spec.ts`
- `pnpm exec nx test server -- src/settings/settings.service.spec.ts`
- `pnpm exec nx test-integration server -- project-settings`
- `pnpm exec nx test-integration server -- settings`
- `pnpm exec nx test web -- src/views/parametres-projet.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/page-parametres-projet.spec.ts src/setting-row.spec.ts`
- `pnpm exec nx e2e web -- parametres-projet.spec.ts parametres.spec.ts`; `scripts/captures.sh parametres-projet parametres` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (`project_settings`, the drop of `account_settings.optional_steps`), run by the deploy.

## Out of scope

- Running the worktree Commandes: RUNNER-20. The Planifications card: BOUCLE-8. The page `/projets/:id/process`: PROCESS-7.
- Whether the branches exist and « Corriger »: PROJET-3. The account's Rôles and the Rôles the Pilote adds: PARAM-2.

## Dependencies

- PARAM-2
- PROJET-2
