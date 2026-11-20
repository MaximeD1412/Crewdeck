---
id: PARAM-5
title: "Thresholds per Rôle « Sans événement » and « Sans progrès » in the account's Paramètres, shown read-only in a Projet's"
epic: PARAM
type: feature
priority: P0
size: S
milestone: M4 Boucle
blocked_by: []
adr: [0008]
risques: []
stories: [US-112]
screens: [parametres, parametres-projet]
revue_visuelle: true
video: false
---

## Context

US-112: a Session that makes no progress is interrupted after a delay the Pilote sets for each **Rôle** in their **Paramètres**: 15 minutes without an event (« Sans événement »), 45 minutes of activity without progress (« Sans progrès ») by default. This ticket stores and edits those two durations; RUNNER-21 (the watchdog) reads them, SESSION-4 raises the **Décision**. A **Projet** inherits them: its Paramètres show them read-only, origin « compte », with a link to the account's (no override at the MVP). Any Rôle has them, the four default ones and those the Pilote added (PARAM-2).

## Current state of the code

- `apps/server/prisma/schema.prisma`: `AccountSettings` (`roles` Json, `notificationsPush`); no thresholds anywhere. `packages/contracts/src/api/settings.ts`: `zAccountSettings` (`roles`, `customRoles`, `notifications`, `timeZone`), `zEffectiveSettings = zAccountSettings`, `DEFAULT_ACCOUNT_SETTINGS`, `zAccountSettingsPatch` (strict object; `roles` a partial record by Rôle id).
- `apps/server/src/settings/settings.service.ts`: `account(pilotId)` (builds the Rôles from the row and the `custom_roles`), `effective(pilotId, projectId?)` (`mergeSettings` then `withDefaultRoles`), `update(tx, pilotId, patch)` (pure `patched`, upsert, writes `settings.upserted` then each Projet's), `written`. `apps/server/src/settings/roles.ts`: `create`/`remove` of a custom Rôle, `settings.upserted` through `written`. `settings.controller.ts`: `GET` and `PATCH /api/settings` (the `seq` is not read, the last write wins).
- `packages/contracts/src/api/project-settings.ts`: `zProjectSettings.effective` (= `zEffectiveSettings`), `origins`, `changedCount`; `apps/server/src/settings/settings.service.ts` `mergeSettings` counts only Rôles and push.
- `packages/contracts/src/composants/role-settings.ts`: `RoleSettings` (`cd-role-settings`, version 1), data `models`, `roles[]` (`id`, `name`, `help`, `choice`, `error`, `removable`), `adding`; actions `choose`, `remove`, `add`, `create`, `cancel`. `packages/contracts/src/composants/stepper.ts`: `Stepper` (`cd-stepper`: `label`, `value`, `unit`, `min`, `max`; action `change`), used by the Retours (US-93), no disabled state.
- Web: `apps/web/src/views/parametres.ts` (`cd-role-settings` data), `apps/web/src/role-settings.ts` (`choose` through `updateSettings`, a refusal on its row), `apps/web/src/views/parametres-projet.ts` (`roles()` draws one `cd-setting-row` with a `cd-select` per Rôle, `origin`; `linkRow`), `apps/web/src/app.ts` (`dispatcher.registerAction(RoleSettings, …)`). Skin: `packages/skin-passerelle/src/`.
- Mockups: `design/screens/crewdeck/parametres.html` (a pair of `ui-stepper` « Sans événement » / « Sans progrès » under each Rôle, and the intro paragraph), `parametres-projet.html` (a `ui-setting-row` « Interruption des Sessions », origin `compte`).

## To do

- **Contract** (`packages/contracts/src/api/settings.ts`): `THRESHOLD_MINUTES_MIN = 1`, `THRESHOLD_MINUTES_MAX = 1440`, `DEFAULT_SILENT_MINUTES = 15`, `DEFAULT_STALLED_MINUTES = 45`; `zRoleThresholds = z.strictObject({ silentMinutes, stalledMinutes })` (integers in that range, no other bound: a « sans progrès » shorter than « sans événement » is accepted). `zAccountSettings.thresholds`: a record by Rôle id (`zRoleId`, same refinement as `zRoles`), one entry for each of the four default Rôles and each custom one, never missing. `DEFAULT_ACCOUNT_SETTINGS.thresholds` the four defaults at 15 and 45. `zAccountSettingsPatch.thresholds`: partial record of partial `zRoleThresholds` (a Rôle's one field alone may change). `pnpm exec nx run contracts:generate`.
- **Prisma**: `AccountSettings.thresholds Json @default("{}") @map("thresholds")` (only what the Pilote changed, by Rôle id); one migration.
- **Server** (`settings.service.ts`): `account()` fills `thresholds` from the row, 15 and 45 for any Rôle (default or custom) without an entry, an entry of a Rôle that no longer exists ignored; `update()` validates the patch's Rôle ids against the account's (400 `validation.invalid` with `fields['thresholds.<roleId>']` = « Ce Rôle n’existe pas. », reusing `roles.not-found`), the bounds are the contract's (400 `fields['thresholds.<roleId>.silentMinutes']` etc., message in `apps/server/src/errors/messages.ts`: « Entre 1 et 1440 minutes. »), merges per field into the row, writes `settings.upserted` as today. `RolesService.remove` (`roles.ts`) drops the removed Rôle's entry in the same transaction. `effective()` carries `thresholds` unchanged, always: `mergeSettings` takes the account's (a Projet changes none, `origins.thresholds` is not a thing), `changedCount` does not count them.
- **Composants**: `Stepper` version 2 gains `disabled: boolean` (the Projet's read-only rows; `value` outside nothing else changes), its skin `packages/skin-passerelle/src/stepper.ts` greys and removes the buttons and the keys when disabled, examples updated. `RoleSettings` version 2: each `roles[]` item gains `thresholds: { silentMinutes, stalledMinutes, silentError: string | null, stalledError: string | null }`, a new action `setThresholds { roleId, silentMinutes?, stalledMinutes? }`; the skin draws the two `cd-stepper` (« Sans événement », « Sans progrès », unit « min », `min` 1, `max` 1440) under the Rôle's select, as in `parametres.html`, and the intro paragraph above the rows; `examples` updated.
- **Web**: `apps/web/src/views/parametres.ts` fills the new data from `settings.thresholds` and the intro; `role-settings.ts` `setThresholds(roleId, patch)` calls `updateSettings({ thresholds: { [roleId]: patch } })`, a refusal shown on the field; registered in `apps/web/src/app.ts`. `apps/web/src/views/parametres-projet.ts`: in « Rôles et modèles », under the Rôles' rows, one `cd-setting-row` per Rôle labelled « Interruption des Sessions · <Rôle> », `origin: 'compte'`, holding the two disabled `cd-stepper`, then a `linkRow` « Régler dans les Paramètres du compte » to `/parametres#roles`; not counted in the header's « n modifiés » nor in the section's count. t() keys `settings.thresholds.*` (intro, labels « Sans événement » / « Sans progrès », unit « min »), `settings.project.thresholds.*` (label, link).
- **Tests**: `apps/server/src/settings/settings.service.spec.ts` (defaults for a custom Rôle, partial patch, bounds, a removed Rôle's entry dropped), integration `settings` (the event carries them), `apps/web/src/views/parametres.spec.ts` and `parametres-projet.spec.ts`, skin specs of `Stepper` and `RoleSettings`, scenarios `apps/server/src/testing/scenarios/parametres.ts` and `parametres-projet.ts` (a Rôle with 30 and 90), Playwright `apps/web/e2e/parametres.spec.ts` and `parametres-projet.spec.ts`.

## Decisions already made

- Mockup: `parametres`, `parametres-projet` (pages `design/screens/crewdeck/parametres.html`, `…/parametres-projet.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The two thresholds are integers of minutes, at least 1, at most 1440, no other bound (« Sans progrès » may be shorter than « Sans événement »); a typed value out of range is refused by the server, the field shows the message and keeps the stored value.
- Thresholds belong to the account, never to a Projet at the MVP: the Projet's row is read-only with origin « compte » and a link; a Projet's own override is not stored, so `project_settings` and `zProjectSettingsOverrides` do not change.
- Always one entry per Rôle in the contract, even untouched (15 and 45): the Runner (RUNNER-21) never has to know the defaults.
- The mockup's single « Interruption des Sessions » row of the Projet shows one pair of values: the thresholds being per Rôle, the page draws one such row for each Rôle (same label, the Rôle's name added). The read-only look is a `disabled` Stepper, the mockup's own steppers having no such state.
- A change applies to the Sessions started or resumed after it: a Session already running keeps the thresholds it was started with (RUNNER-21).

## Acceptance criteria

- [ ] `GET /api/settings` gives every Rôle, default and custom, `thresholds { silentMinutes: 15, stalledMinutes: 45 }` for a Pilote who changed none.
- [ ] `PATCH /api/settings { thresholds: { code: { stalledMinutes: 90 } } }` stores 90 for Code and leaves 15 for « Sans événement »; `settings.upserted` carries it, and each Projet's `settings.upserted` too.
- [ ] 0, 1441, 2.5 and a string are refused with 400 and `fields['thresholds.code.stalledMinutes']`; an id that is not the Pilote's Rôle is refused with 400; 401 without a session; another Pilote's Rôle id is unknown (400), never changed.
- [ ] Removing a custom Rôle drops its thresholds; a new custom Rôle starts at 15 and 45.
- [ ] « Rôles et modèles » shows the two steppers under each Rôle; changing one stores it, a refusal shows under it, a second tab shows the value without reloading.
- [ ] A Projet's Paramètres show the thresholds in effect, disabled, origin « compte », with the link to `/parametres#roles`; they are not in the « n modifiés » count.
- [ ] Screens `parametres` and `parametres-projet` at 390 and 1280 px match the mockups, axe without violations.

## Verification

- `pnpm exec nx test server -- src/settings/settings.service.spec.ts`
- `pnpm db:up`, then `pnpm exec nx test-integration server -- settings`
- `pnpm exec nx test contracts`, `pnpm exec nx test skin-passerelle -- src/stepper.spec.ts`, `pnpm exec nx test web -- src/views/parametres.spec.ts`
- `pnpm exec nx e2e web -- parametres.spec.ts`, `pnpm exec nx e2e web -- parametres-projet.spec.ts`; `scripts/captures.sh parametres parametres-projet` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (column `account_settings.thresholds`, default `{}`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- The watchdog that applies them: RUNNER-21. The Décision « Session sans progrès » and the panel's banner: SESSION-4.
- A Projet's own thresholds (a later ticket, if the Pilote asks).

## Dependencies

Nothing.
