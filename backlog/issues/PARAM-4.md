---
id: PARAM-4
title: "Étapes optionnelles on or off, for the account and per Projet"
epic: PARAM
type: feature
priority: P0
size: S
milestone: M3 Sessions and preparing Projets
blocked_by: [PARAM-3]
adr: [0005, 0008]
risques: []
stories: [US-83]
screens: [parametres, parametres-projet]
revue_visuelle: true
video: false
---

## Context

US-83: the Pilote turns the Étapes optionnelles on or off per Projet (at the MVP the mockups, the visual review and the cross review of a Conception), the Idée analysis, the Tickets, the Code, the Review and the checks staying mandatory, so that a Projet without screens does not wait for a visual review. The PRD's principle: the Étapes optionnelles can be turned off per Projet; the others always run. This ticket stores and draws the choice; the modules that skip an Étape read it through `SettingsService.effective(pilotId, projectId).optionalSteps`: the Conception's track (CONCEPTION-1, CONCEPTION-2), the mockups Étape (CONCEPTION-5), the cross review (CONCEPTION-8), the visual review of the Boucle (BOUCLE-6).

## Current state of the code

- Only documents: the « Étapes optionnelles » cards of `design/screens/crewdeck/parametres.html` and `parametres-projet.html`.
- Created by PARAM-1: `AccountSettings.optionalSteps` (default every one `true`), `PATCH /api/settings`, the `optional-steps` Emplacement of `/parametres`. Created by PARAM-3: `ProjectSettings.optionalSteps` (partial), the merge in `SettingsService.effective`, `PATCH /api/projects/:id/settings`, the `optional-steps` Emplacement of `/projets/:id/parametres`.
- Created by UI-4: `Toggle`, `SettingRow`; UI-2: `StatusBadge`, `Card`.

## To do

- `packages/contracts/src/api/settings.ts`: `OPTIONAL_STEPS` (the three ids with their label and help keys, in the order « Maquettes », « Revue visuelle », « Revue croisée d'une Conception ») and `MANDATORY_STEPS` (`idea-analysis`, `split`, `code`, `review`, `checks`, labelled « Analyse d'Idée », « Tickets », « Code », « Review », « Checks »), so that the server, the page and the consumers share the list.
- `/parametres`, the Card « Étapes optionnelles » in `optional-steps`: « Par défaut pour tes Projets ; chaque Projet peut les changer. », one `Toggle` per optional Étape with its help (Maquettes « Les écrans dessinés avant la conception technique. », Revue visuelle « Tu relis les captures d'un Ticket qui a des écrans avant son merge. », Revue croisée « Un second agent relit le PRD et la conception technique. »), then « Toujours actives » and the five neutral `StatusBadge`s.
- `/projets/:id/parametres`, the same card with each Étape as a `SettingRow` (origin, « Revenir au compte ») holding its `Toggle`; the section's nav count includes them.
- `PATCH` validation: a key outside `OPTIONAL_STEPS` → 400 with `fields`; there is no way to turn off a mandatory Étape (the schema has no key for them).
- `SettingsService.isStepEnabled(pilotId, projectId, step)`: `true` for every mandatory step, the effective value for an optional one; a unit test lists every `StepId` and `OptionalStep`.
- t() keys `settings.optionalSteps.*`, `optionalStep.*`.
- Scenarios `parametres` and `parametres-projet` extended (the cross review off for one Projet); Playwright in their specs.

## Decisions already made

- Mockup: `parametres`, `parametres-projet` (pages `design/screens/crewdeck/parametres.html`, `…/parametres-projet.html`; captures `…-390.png`, `…-1280.png`), their « Étapes optionnelles » cards. It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- Turning an Étape off applies to what has not started: a Conception already past it, or a Ticket already waiting for its visual review, keeps going as it was (the consumers' tickets check the setting when they reach the Étape).
- The visual audit, the user tests and the preview join the list with the Bêta (US-83): not shown at the MVP.

## Acceptance criteria

- [ ] Turning « Revue croisée d'une Conception » off on the account turns it off for every Projet that does not override it; `isStepEnabled` follows.
- [ ] A Projet can turn « Revue visuelle » off while the account keeps it on; the row shows « Modifié pour ce Projet ».
- [ ] The five mandatory Étapes are shown as always active and cannot be turned off, by the page or by the API.
- [ ] Both cards at 390 and 1280 match the mockups, axe without violations.

## Verification

- `pnpm exec nx test server -- src/settings/settings.service.spec.ts`
- `pnpm exec nx test-integration server -- settings`
- `pnpm exec nx test web -- src/views/parametres.spec.ts`
- `pnpm exec nx e2e web -- parametres.spec.ts parametres-projet.spec.ts`; `scripts/captures.sh apps/web/e2e/parametres.spec.ts apps/web/e2e/parametres-projet.spec.ts` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`.

## For prod

Nothing.

## Out of scope

- Skipping the Étapes: CONCEPTION-1, CONCEPTION-2, CONCEPTION-5, CONCEPTION-8, BOUCLE-6.

## Dependencies

- PARAM-3
