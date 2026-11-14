---
id: PARAM-2
title: "Rôles and models of the account: a usable Moteur and model per Rôle, the Review on another Moteur by default, the Rôles the Pilote adds"
epic: PARAM
type: feature
priority: P0
size: M
milestone: M2 Runner and Projets
blocked_by: [PARAM-1, RUNNER-7]
adr: [0004, 0008, 0011]
risques: []
stories: [US-39]
screens: [parametres]
revue_visuelle: true
video: false
reprend: 60
---

## Context

US-39: the Pilote chooses the Moteur and the model of each Rôle (Idée, Conception, Code and Review by default, and the Rôles they add, such as a review by Gemini) for all their Projets and changes it for one Projet, each agent Étape naming its Rôle, the Review using by default another Moteur than the Code. US-38 adds that they never pick an agent that cannot run: only what RUNNER-7 reports as usable is offered. The glossary: a **Rôle** is a named pair of a Moteur and a model that an agent Étape names; changing a Rôle changes every Étape that names it.

The refonte (PRD #169, ADR 0011) makes the Rôle an Outil of an Étape: a Process's definition names it by id (`{ kind: 'role', roleId }`), so the set of Rôles is open: the four default ones, never removed, plus the Pilote's own. This ticket is the account level and the Rôles the Pilote adds; the Projet override is PARAM-3. Every agent Session reads its Moteur and model through `SettingsService.effective` (RUNNER-12's `defineAgentKind`); US-4's « Un Moteur utilisable par Rôle » check (PROJET-3) uses `RolesService.check`; « Attacher un Outil » (PROCESS-9) lists the Rôles of `settings.customRoles` beside the default ones.

## Current state of the code

- `apps/server/src/runners/ai-accounts/ai-accounts.ts` (RUNNER-7, merged): `usableModels(tx)` → the usable models with their `engine`; `packages/contracts/src/api/ai-accounts.ts`: `zAiAccount` (`models: [{ id, label, usable, reason? }]`), `isUsableAccount`; `packages/contracts/src/runner/engines.ts`: `ENGINE_IDS = ['claude-code', 'codex']`, `MODEL_UNUSABLE_REASONS`.
- `packages/contracts/src/composants/setting-row.ts`, `select.ts`, `dialog.ts`, `text-field.ts`, `card.ts` (slots `default`, `actions`) and their `packages/skin-passerelle/src/` elements exist.
- `design/screens/crewdeck/parametres.html`: the « Rôles et modèles » card (four `SettingRow`s with a `Select`).
- Created by PARAM-1 (PR #147): `packages/contracts/src/api/settings.ts` (`zRoleChoice` `{ engine, model } | null`, `zAccountSettings.roles` a strict object of the four `AGENT_ROLES` of `values.ts`, `DEFAULT_ACCOUNT_SETTINGS`, `zAccountSettingsPatch`), `apps/server/src/settings/settings.service.ts` (`SettingsService.account`, `effective(pilotId, projectId?)` returning the account's, `update(tx, pilotId, patch)` writing `settings.upserted`), the table `account_settings` (`roles` jsonb), `PATCH /api/settings`, the `/parametres` page (`apps/web/src/views/parametres.ts`, `PageParametres` with its `roles` Emplacement), the scenario `parametres`, `apps/web/e2e/parametres.spec.ts`.
- No `RolesService`, no Rôle of the Pilote's.

## To do

- **Contracts** `packages/contracts/src/api/roles.ts`:
  - `zCustomRoleId` = `r-` then 8 characters `[a-z0-9]`; `zRoleId` = `zAgentRole` (`idea`, `design`, `code`, `review`) or `zCustomRoleId`.
  - `zCustomRole = { id: zCustomRoleId, name: string 1..40 (trimmed), createdAt }`.
  - `zAccountSettings` (PARAM-1's) changes: `roles` becomes `Record<RoleId, RoleChoice>` (the four default ids always present, `null` = the default; each custom Rôle present with its non-null choice); `customRoles: zCustomRole[]` (by `createdAt`). `zAccountSettingsPatch.roles` accepts any Rôle id of the Pilote; `null` only for a default one (422 `settings.role-choice-required` « Un Rôle que tu as ajouté a toujours son modèle. »).
  - `zRoleCheck = { roleId, engine, model, usable: boolean, reason?: 'no-engine' | 'login-required' | 'quota-reached' | 'not-in-plan' | 'unknown-model' }`.
  - Body `zCreateRole = { name, engine, model }`; the outputs are the whole `zAccountSettings`.
- **Server** `apps/server/src/settings/roles.ts`:
  - Prisma model `CustomRole` (`custom_roles`, one migration): `id` (text, `r-…`, generated server-side), `pilotId`, `name`, `nameKey` (lower-cased, trimmed), `engine`, `model`, `createdAt`; unique `(pilotId, nameKey)`; at most 20 per Pilote.
  - `RolesService.defaults(usable)`: a pure function; each default Rôle `null` in the stored settings gets the first usable model of the first Moteur that has one, in the order `claude-code`, `codex`, models in the order the Moteur reports them; `review` gets the first usable model of a Moteur other than the effective `code`'s, and the same Moteur when only one has usable models.
  - `SettingsService.effective` returns `roles` with every `null` filled by `defaults` (stored choices are returned as stored, even when unusable now) and the custom Rôles with their choice.
  - `RolesService.check(pilotId, { projectId?, roleIds? })` → `zRoleCheck[]` for the given Rôles (all of them by default), from the effective choices; an unknown Rôle id gives `reason: 'no-engine'`. For PROJET-3 and the page.
  - `PATCH /api/settings { roles: { <roleId>: { engine, model } | null } }`: a choice not in `usableModels(tx)` → 422 `settings.engine-unusable` with `fields["roles.<roleId>"]` « Ce modèle n'est pas utilisable sur ton Runner. »; an id that is not one of the Pilote's Rôles → 400 `validation.invalid` on that field.
  - `POST /api/roles` (`roles.controller.ts`) `zCreateRole` → 201 `zAccountSettings`: name taken (case-insensitive, the four default names « Idée », « Conception », « Code », « Review » included) → 409 `roles.name-taken` « Un Rôle porte déjà ce nom. » on `fields.name`; a 21st → 422 `roles.too-many` « 20 Rôles au plus. »; an unusable model → 422 `settings.engine-unusable`.
  - `DELETE /api/roles/:id` → `zAccountSettings`: a default Rôle → 422 `roles.default` « Les Rôles par défaut ne se retirent pas. »; another Pilote's or unknown → 404 `roles.not-found`; a Rôle still named by a Process → 409 `roles.in-use` « Des Étapes de tes Projets utilisent ce Rôle : change-les d'abord. » with `params.count`. The check asks the `RoleUsage` providers (`apps/server/src/settings/role-usage.ts`, `registerRoleUsage(provider: (tx, pilotId, roleId) => Promise<number>)`); this ticket registers none, so nothing is in use until PROCESS-3 registers its own over versions and drafts.
  - Each write runs in `Transactions.run` with `settings.upserted` (the whole settings) in the transaction; French messages in `apps/server/src/errors/messages.ts`.
- **Page**: the Card « Rôles et modèles » in the `roles` Emplacement of `/parametres` (`apps/web/src/views/parametres.ts`):
  - four `SettingRow`s with their help (Idée « Analyse chaque Idée notée. », Conception « PRD, maquettes et conception technique, avec toi. », Code « Implémente les Tickets dans la Boucle. », Review « Relit chaque changement de code. Par défaut sur un autre Moteur que le Code. »), each a `Select` whose options are the usable models grouped by Moteur, labelled « <Moteur> · <model label> »;
  - then one `SettingRow` per custom Rôle (its name, help « Un Rôle à toi : nomme-le dans une Étape de la Gestion du process. »), its `Select` and a ghost `Button` « Retirer » (409 `roles.in-use` shown as the row's error);
  - the card's `actions` slot: a ghost `Button` « Ajouter un Rôle » (icon `plus`) opening a `Dialog` « Nouveau Rôle »: `TextField` « Nom » (placeholder « Revue Gemini », 40 characters), `Select` « Moteur et modèle » (the usable models), « Ajouter »; `fields.name` errors shown under the field;
  - a stored choice that became unusable shows as the selected value with the field's error « <reason> : choisis un autre modèle. »; with one Moteur usable, the Review's help becomes « Un seul Moteur disponible : la Review tourne sur le même Moteur que le Code. ».
- Client `apps/web/src/api/roles.ts` (`createRole`, `removeRole`); t() keys `settings.roles.*`, `role.*` (« Idée », « Conception », « Code », « Review »), `engine.*` (« Claude Code », « Codex ») in `packages/sdk/src/i18n/fr.ts`.
- Scenario `parametres` (`apps/server/src/testing/scenarios/parametres.ts`) extended: two Moteurs, one model unusable, one custom Rôle « Revue Codex »; Playwright `apps/web/e2e/parametres.spec.ts` extended.

## Decisions already made

- Mockup: `parametres` (page `design/screens/crewdeck/parametres.html`; captures `…/parametres-390.png`, `…-1280.png`), its « Rôles et modèles » card. It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The mockup has no « Ajouter un Rôle »: it follows the Planifications card's pattern (a ghost « Ajouter » in the card's `actions`), and the Dialog is the product's own `Dialog`.
- Defaults are computed, never stored: a Pilote who never touched a Select follows the Moteurs they connect. A custom Rôle always has its own choice (it exists to differ from the defaults).
- A Rôle id is stable and never reused: a Process names `roleId`, so a later rename never touches a definition, and a removed id cannot come back under another Rôle. The ids are generated by the server; the names are configuration the server reads (ADR 0011, « What the server reads of a Process »).
- No renaming at the MVP: remove and add again. The four default Rôles are never removed: « Process Crewdeck » names them.
- A stored choice is never changed silently when it becomes unusable (a quota, a disconnection): the Pilote sees it, and US-40's Décision (BOUCLE-7) offers the switch.
- Model ids and labels come from the Moteur's report (RUNNER-7); Crewdeck keeps no list of models. A Rôle « Revue Gemini » waits for the Gemini CLI Moteur (US-86, `next`): today a custom Rôle runs on Claude Code or Codex.
- `PATCH /api/settings` keeps PARAM-1's shape (no `seq`); creating and removing a Rôle are their own routes because they change the set of ids.

## Acceptance criteria

- [ ] With Claude Code and Codex usable and nothing chosen, `effective` gives Claude Code for Idée, Conception and Code, and Codex for the Review.
- [ ] With only Codex usable, every default Rôle gets Codex and the Review's help says so.
- [ ] Choosing a usable model stores it and every tab shows it; an unusable one gets 422 `settings.engine-unusable` on its field.
- [ ] A stored model that became `quota-reached` stays selected with its error; `RolesService.check` reports it unusable with its reason.
- [ ] « Ajouter un Rôle » « Revue Codex » on Codex adds a row in every tab (one `settings.upserted`), `effective` returns it under its `r-…` id; a second « revue codex » gets 409 `roles.name-taken`; « Review » gets 409 too; a 21st gets 422 `roles.too-many`.
- [ ] « Retirer » removes a custom Rôle; removing `review` gets 422 `roles.default`; another Pilote's gets 404; a Rôle a `RoleUsage` provider counts gets 409 `roles.in-use` (test with a provider registered by the test).
- [ ] `PATCH /api/settings { roles: { "r-…": null } }` gets 422 `settings.role-choice-required`.
- [ ] The card at 390 and 1280 matches the mockup, axe without violations.

## Verification

- `pnpm exec nx test contracts -- src/api/roles.spec.ts`
- `pnpm exec nx test server -- src/settings/roles.spec.ts`
- `pnpm exec nx test-integration server -- settings`
- `pnpm exec nx test-integration server -- roles`
- `pnpm exec nx test web -- src/views/parametres.spec.ts`
- `pnpm exec nx e2e web -- parametres.spec.ts`; `scripts/captures.sh parametres` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (`custom_roles`), run by the deploy.

## Out of scope

- The Rôles of one Projet: PARAM-3. The readiness check: PROJET-3. Switching a Rôle from a « Limite atteinte » Décision: BOUCLE-7.
- Naming a Rôle in an Étape (« Attacher un Outil »): PROCESS-9; counting the Étapes that name it (`RoleUsage`): PROCESS-3.
- Other Moteurs (Gemini CLI): US-86, `next`.

## Dependencies

- PARAM-1
- RUNNER-7
