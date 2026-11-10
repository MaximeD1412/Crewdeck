---
id: PARAM-1
title: "Paramètres of the account: model with inheritance, SettingsService.effective, the /parametres page and the time zone"
epic: PARAM
type: feature
priority: P0
size: M
milestone: M1 Socle
blocked_by: [CORE-6, UI-4]
adr: [0006, 0007, 0008]
risques: []
stories: [US-82]
screens: [parametres]
revue_visuelle: true
video: false
---

## Context

US-82: complete Paramètres for the account (Rôles and models, notifications, Planifications, Étapes optionnelles at the MVP) and for each Projet, a Projet inheriting the account's Paramètres and changing only what it needs. The glossary: the **Paramètres** are everything a Pilote sets, on their account as the defaults and on each Projet. This ticket lays the account's settings, the one function every module reads (`SettingsService.effective`), and the page whose cards the other tickets fill: Rôles and models (PARAM-2), Étapes optionnelles (PARAM-4), Notifications (ATOI-4), Planifications (BOUCLE-8), Par Projet (PARAM-3). ADR 0008: the Pilote's time zone is editable in the Paramètres and computes what is a day or « every night ».

## Current state of the code

- Only documents: the mockup `design/screens/crewdeck/parametres.html` (sections nav « Rôles et modèles, Notifications, Planifications, Étapes optionnelles, Par Projet, Pour les Moddeurs »).
- Created by CORE-2/CORE-4: `Pilot` (`pilots.time_zone`, set from the browser at sign-up), `GET /api/me`. CORE-5: `apps/server/src/realtime/` (`EventsWriter`, `StateContributor`). CORE-6: `apps/web/src/store/`, the router, `apps/web/src/api/client.ts`.
- Created by UI-4: `SettingRow`, `Select`, `Toggle`; UI-2: `Card`, `ListRow`, `PageHeader`; UI-3: the Cadre (« Paramètres » in the menu Plus at 390).
- No settings table, no `/parametres` page.

## To do

- **Contract** `packages/contracts/src/api/settings.ts`:
  - enums `zAgentRole` (`idea`, `design`, `code`, `review`), `zEngine` (`claude-code`, `codex`), `zOptionalStep` (`mockups`, `visual-review`, `cross-review`), if CORE-1 did not put them in `packages/contracts/src/values.ts` (they live there either way);
  - `zRoleChoice = { engine: zEngine, model: string } | null`;
  - `zAccountSettings = { roles: Record<AgentRole, zRoleChoice>, optionalSteps: Record<OptionalStep, boolean>, notifications: { push: boolean }, timeZone: string }`;
  - `zEffectiveSettings` = the same shape, what a module reads (roles still `null` until PARAM-2 computes defaults);
  - `zAccountSettingsPatch` = a strict partial (`roles` partial per role, `optionalSteps` partial, `notifications.push`, `timeZone`).
  - Event `settings.upserted` (payload `zAccountSettings`).
- **Server** `apps/server/src/settings/`:
  - Prisma model `AccountSettings` (`account_settings`): `pilotId` (unique), `roles` (JSON, validated by `zod` on read and write), `optionalSteps` (JSON), `notificationsPush` (boolean, default `false`), `updatedAt`. Defaults when no row: every role `null`, every Étape optionnelle `true`, push `false`. The time zone stays on `pilots.time_zone`.
  - `SettingsService.account(pilotId)`, `SettingsService.effective(pilotId, projectId?)` (`projectId` accepted and ignored until PARAM-3 adds the Projet overrides; a test pins the signature), `SettingsService.update(tx, pilotId, patch)`.
  - `GET /api/settings` → `zAccountSettings`; `PATCH /api/settings` with `zAccountSettingsPatch` → the updated `zAccountSettings`, writing `settings.upserted` (and `pilot.upserted` when the time zone changes) in the same transaction; an unknown time zone → 400 with `fields.timeZone` « Fuseau horaire inconnu. » (checked with `Intl.supportedValuesOf('timeZone')`); a role choice is validated by PARAM-2 (here only its shape).
  - `StateContributor` key `settings`.
- **Page** `/parametres`:
  - Composant `PageParametres` (`packages/contracts/src/composants/page-parametres.ts`, `packages/skin-passerelle/src/page-parametres.ts`): a page header (« Paramètres », « ton compte · par défaut pour tes Projets »), a sections nav built from the Emplacements that hold something, and the Emplacements `roles`, `notifications`, `schedules`, `optional-steps`, `projects`, `account`, `modders`, in that order; an empty Emplacement and its nav link are not shown.
  - This ticket fills `account` with a Card « Compte » holding a `SettingRow` « Fuseau horaire » (help « Pour les Planifications et les statistiques par jour. ») and a `Select` of the IANA zones, and `modders` with the Card « Pour les Moddeurs » and its `ListRow` « Bibliothèque de Composants » (« chaque Composant, ses données, ses actions et ses Emplacements ») linking to `/parametres/composants`.
  - View `apps/web/src/views/parametres.ts`; command client `apps/web/src/api/settings.ts`; each module that fills a card adds its own view part.
- t() keys `settings.*`.
- Scenario `apps/server/src/testing/scenarios/parametres.ts`; Playwright `apps/web/e2e/parametres.spec.ts` at 390 and 1280.

## Decisions already made

- Mockup: `parametres` (page `design/screens/crewdeck/parametres.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The cards « Rôles et modèles », « Notifications », « Planifications », « Étapes optionnelles » and « Par Projet » are PARAM-2, ATOI-4, BOUCLE-8, PARAM-4 and PARAM-3's.
- The mockup has no place for the time zone: it goes in a « Compte » card before « Pour les Moddeurs ».
- Settings are values, not states: `PATCH` is allowed here (ADR 0008 forbids it for states only).
- The Projet overrides are PARAM-3's own table; `effective` is the only function a module may call to read settings.

## Acceptance criteria

- [ ] A Pilote without a settings row gets the defaults from `GET /api/settings` and `effective`.
- [ ] `PATCH /api/settings` changes only the given fields, returns the resource, and writes `settings.upserted` in the same transaction; another tab shows the change without reload.
- [ ] The route baseline: 400 with `fields` (unknown key, unknown time zone), 401 without a session; a Pilote never reads another's settings.
- [ ] Changing the time zone in « Compte » updates `pilots.time_zone`.
- [ ] `/parametres` shows only the sections whose Emplacement holds something, the « Pour les Moddeurs » link opens the library of Composants.
- [ ] `PageParametres`'s examples render and its actions emit valid `cd-action`s; the page at 390 and 1280 matches the mockup's frame, axe without violations.

## Verification

- `pnpm exec nx test server -- src/settings/settings.service.spec.ts`
- `pnpm exec nx test-integration server -- settings`
- `pnpm exec nx test web -- src/views/parametres.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/page-parametres.spec.ts`
- `pnpm exec nx e2e web -- parametres.spec.ts`; `scripts/captures.sh apps/web/e2e/parametres.spec.ts` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (`account_settings`), run by the deploy.

## Out of scope

- Rôles and models: PARAM-2. Projet Paramètres and the « Par Projet » card: PARAM-3. Étapes optionnelles: PARAM-4. Notifications: ATOI-4. Planifications: BOUCLE-8.

## Dependencies

- CORE-6
- UI-4
