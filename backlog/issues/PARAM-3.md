---
id: PARAM-3
title: "Paramètres of a Projet: inherited from the account, Rôles overridden, push on or off"
epic: PARAM
type: feature
priority: P1
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: [PARAM-2, PROJET-2]
adr: [0006, 0007, 0008]
risques: []
stories: [US-82, US-39]
screens: [parametres-projet, parametres]
revue_visuelle: true
video: false
---

## Context

US-82: a Projet inherits the account's Paramètres and changes only what it needs: its Rôles, its Étapes optionnelles, and its notifications, which a Projet can only turn on or off at the MVP. US-39: the Moteur and model of each Rôle can be changed for one Projet. The glossary: each Projet inherits the account's Paramètres and changes only what it needs. This ticket adds the Projet's overrides, merges them in `SettingsService.effective`, and draws the Projet's Paramètres page and the account page's « Par Projet » card. The Étapes optionnelles card of both pages is PARAM-4's; the Planifications card is BOUCLE-8's.

## Current state of the code

- Only documents: the mockups `design/screens/crewdeck/parametres-projet.html`, the « Par Projet » card of `parametres.html`.
- Created by PARAM-1: `apps/server/src/settings/` (`AccountSettings`, `SettingsService.effective(pilotId, projectId?)` ignoring `projectId`, `PATCH /api/settings`), `PageParametres` with its `projects` Emplacement. PARAM-2: `RolesService` (defaults, `check`), the « Rôles et modèles » card.
- Created by PROJET-2: `Project` (`apps/server/src/projects/`), the `projects` store slice, `/projets/:id`.
- Created by UI-4: `SettingRow` (origins `compte` / `projet`, « Revenir au compte »), `Select`, `Toggle`; UI-2: `Banner`, `ListRow`.

## To do

- **Contract** `packages/contracts/src/api/project-settings.ts`: `zProjectSettingsOverrides = { roles: Partial<Record<AgentRole, zRoleChoice>>, optionalSteps: Partial<Record<OptionalStep, boolean>>, notifications: { push?: boolean } }` (a key absent = inherited); `zProjectSettings = { projectId, effective: zEffectiveSettings, origins: { roles: Record<AgentRole, 'compte' | 'projet'>, optionalSteps: Record<OptionalStep, 'compte' | 'projet'>, notifications: { push: 'compte' | 'projet' } }, changedCount: int }`; the patch: each field a value or `null` (back to the account). Event `project-settings.upserted` is not a new resource: the `settings` event carries `{ projectId }` and the change re-reads it (add `projectSettings` to the `settings` event's union in `packages/contracts/src/events/`).
- **Server**:
  - Prisma model `ProjectSettings` (`project_settings`): `projectId` (unique), `pilotId`, `roles` (JSON partial), `optionalSteps` (JSON partial), `notificationsPush` (nullable), `updatedAt`.
  - `SettingsService.effective(pilotId, projectId)` merges: the Projet's override, else the account's value, else the default (PARAM-2's role defaults computed after the merge, so a Projet that overrides `code` gets a `review` default on another Moteur than its own `code`).
  - `GET /api/projects/:id/settings` → `zProjectSettings`; `PATCH /api/projects/:id/settings` (404 `project.not-found` for an unknown or another Pilote's Projet; a role choice validated like PARAM-2, 422 `settings.engine-unusable`) → `zProjectSettings`, event in the same transaction.
  - `RolesService.check(pilotId, projectId)` uses the merged roles.
  - `StateContributor` `settings` gains `projects: zProjectSettings[]` (one per followed Projet).
- **Page** `/projets/:id/parametres`:
  - Composant `PageParametresProjet` (`packages/contracts/src/composants/page-parametres-projet.ts`, `packages/skin-passerelle/src/page-parametres-projet.ts`): header « <Projet> », « Paramètres du Projet · <n> modifiés »; the accent `Banner` « Ce Projet hérite de ton compte » with the mockup's sentence; the sections nav with each section's count of changed settings; Emplacements `roles`, `optional-steps`, `schedules`, `notifications`.
  - This ticket fills `roles` (four `SettingRow`s with their origin and a `Select`; « Revenir au compte » sends `null`) and `notifications` (`SettingRow` « Notifications push », help « Activées ou non pour ce Projet ; le reste des notifications se règle sur ton compte. », a `Toggle`).
  - View `apps/web/src/views/parametres-projet.ts`; client `apps/web/src/api/project-settings.ts`. The « Paramètres du Projet » button of `/projets/:id` links here.
- **Account page**: the Card « Par Projet » in the `projects` Emplacement of `/parametres`: one `ListRow` per Projet, meta « hérite de ton compte » or « <n> Paramètres modifiés », linking to `/projets/:id/parametres`.
- t() keys `settings.project.*`.
- Scenario `apps/server/src/testing/scenarios/parametres-projet.ts` (a Projet with two Rôles changed); Playwright `apps/web/e2e/parametres-projet.spec.ts`.

## Decisions already made

- Mockup: `parametres-projet`, `parametres` (pages `design/screens/crewdeck/parametres-projet.html`, `…/parametres.html`; captures `…-390.png`, `…-1280.png`), for `parametres` only its « Par Projet » card. It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- A Projet's notifications are only push on or off (US-82); the account's push off wins over a Projet's on.
- The time zone has no Projet override.
- « Modifié pour ce Projet » means a stored override, even when equal to the account's current value: the Pilote's explicit choice is kept when the account changes.

## Acceptance criteria

- [ ] A Projet with no override shows every setting « Hérité du compte » and follows a change of the account at once.
- [ ] Changing the Code's model for a Projet marks it « Modifié pour ce Projet », does not change the account, and `effective(pilotId, projectId)` returns it; « Revenir au compte » removes the override.
- [ ] A Projet whose Code is on Codex gets a Review default on Claude Code when the account leaves the Review unset.
- [ ] Push off for a Projet stops its pushes (ATOI-4's rule reads `effective`); the account's push off wins.
- [ ] The routes follow the baseline: 400 with `fields`, 401, 404 for another Pilote's Projet, 422 for an unusable model.
- [ ] « Par Projet » lists each Projet with its count of changed settings; both screens at 390 and 1280 match the mockups, axe without violations.

## Verification

- `pnpm exec nx test server -- src/settings/settings.service.spec.ts`
- `pnpm exec nx test-integration server -- project-settings`
- `pnpm exec nx test web -- src/views/parametres-projet.spec.ts`
- `pnpm exec nx e2e web -- parametres-projet.spec.ts`; `scripts/captures.sh apps/web/e2e/parametres-projet.spec.ts apps/web/e2e/parametres.spec.ts` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

A migration (`project_settings`), run by the deploy.

## Out of scope

- The Étapes optionnelles cards: PARAM-4. The Planifications card: BOUCLE-8.

## Dependencies

- PARAM-2
- PROJET-2
