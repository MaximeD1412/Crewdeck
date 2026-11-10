---
id: PARAM-2
title: "Rôles and models of the account: a usable Moteur and model per Rôle, the Review on another Moteur by default"
epic: PARAM
type: feature
priority: P0
size: M
milestone: M2 Runner and Projets
blocked_by: [PARAM-1, RUNNER-7]
adr: [0004, 0008]
risques: []
stories: [US-39]
screens: [parametres]
revue_visuelle: true
video: false
---

## Context

US-39: the Pilote chooses the Moteur and the model of each Rôle (Idée, Conception, Code, Review) for all their Projets and changes it for one Projet, the Review using by default another Moteur than the Code, so that each step runs on the agent they trust and the review stays independent. US-38 adds that they never pick an agent that cannot run: only what RUNNER-7 reports as usable is offered. This ticket is the account level; the Projet override is PARAM-3. Every Session (RUNNER-9, BOUCLE-3, BOUCLE-4, IDEE-2, CONCEPTION-1) reads its Moteur and model through `SettingsService.effective`; US-4's « Un Moteur utilisable par Rôle » check (PROJET-3) uses `RolesService.check`.

## Current state of the code

- Only documents: the « Rôles et modèles » card of `design/screens/crewdeck/parametres.html`.
- Created by PARAM-1: `apps/server/src/settings/` (`AccountSettings.roles` JSON of `zRoleChoice`, `SettingsService.effective`, `PATCH /api/settings`), the `/parametres` page with its `roles` Emplacement.
- Created by RUNNER-7: `AiAccount` (`ai_accounts`: `engine`, `kind`, `state`, `models` `[{ id, label, usable, reason? }]`), `GET /api/ai-accounts`, the `aiAccounts` store slice, the helper `usableModels(pilotId)`.
- Created by UI-4: `SettingRow`, `Select`.

## To do

- **Server** `apps/server/src/settings/roles.ts`:
  - `RolesService.defaults(usable)`: a pure function; each role `null` in the stored settings gets the first usable model of the first Moteur that has one, in the order `claude-code`, `codex`, models in the order the Moteur reports them; `review` gets the first usable model of a Moteur other than the effective `code`'s, and the same Moteur when only one has usable models.
  - `SettingsService.effective` fills the `null` roles with these defaults (stored choices are returned as stored, even when unusable now).
  - `RolesService.check(pilotId, projectId?)` → `[{ role, engine, model, usable: boolean, reason?: 'no-engine' | 'login-required' | 'quota-reached' | 'not-in-plan' | 'unknown-model' }]`, for PROJET-3 and the page.
  - `PATCH /api/settings { roles: { <role>: { engine, model } | null } }`: a choice not in `usableModels(pilotId)` → 422 `settings.engine-unusable` with `fields["roles.<role>"]` « Ce modèle n'est pas utilisable sur ton Runner. »; `null` goes back to the default.
- **Page**: the Card « Rôles et modèles » in the `roles` Emplacement of `/parametres` (`apps/web/src/views/parametres.ts`): four `SettingRow`s with their help (Idée « Analyse chaque Idée notée. », Conception « PRD, maquettes et conception technique, avec toi. », Code « Implémente les Tickets dans la Boucle. », Review « Relit chaque PR. Par défaut sur un autre Moteur que le Code. »), each a `Select` whose options are the usable models grouped by Moteur, labelled « <Moteur> · <model label> »; a stored choice that became unusable shows as the selected value with the field's error « <reason> : choisis un autre modèle. »; with one Moteur usable, the Review's help becomes « Un seul Moteur disponible : la Review tourne sur le même Moteur que le Code. ».
- t() keys `settings.roles.*`, `role.*` (« Idée », « Conception », « Code », « Review »), `engine.*` (« Claude Code », « Codex »).
- Scenario `parametres` extended (two Moteurs, one model unusable); Playwright in `apps/web/e2e/parametres.spec.ts`.

## Decisions already made

- Mockup: `parametres` (page `design/screens/crewdeck/parametres.html`; captures `…-390.png`, `…-1280.png`), its « Rôles et modèles » card. It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- Defaults are computed, never stored: a Pilote who never touched a Select follows the Moteurs they connect.
- A stored choice is never changed silently when it becomes unusable (a quota, a disconnection): the Pilote sees it, and US-40's Décision (BOUCLE-7) offers the switch.
- Model ids and labels come from the Moteur's report (RUNNER-7); Crewdeck keeps no list of models.

## Acceptance criteria

- [ ] With Claude Code and Codex usable and nothing chosen, `effective` gives Claude Code for Idée, Conception and Code, and Codex for the Review.
- [ ] With only Codex usable, every Rôle gets Codex and the Review's help says so.
- [ ] Choosing a usable model stores it and every tab shows it; an unusable one gets 422 `settings.engine-unusable` on its field.
- [ ] A stored model that became `quota-reached` stays selected with its error; `RolesService.check` reports it unusable with its reason.
- [ ] The card at 390 and 1280 matches the mockup, axe without violations.

## Verification

- `pnpm exec nx test server -- src/settings/roles.spec.ts`
- `pnpm exec nx test-integration server -- settings`
- `pnpm exec nx test web -- src/views/parametres.spec.ts`
- `pnpm exec nx e2e web -- parametres.spec.ts`; `scripts/captures.sh apps/web/e2e/parametres.spec.ts` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`.

## For prod

Nothing.

## Out of scope

- The Rôles of one Projet: PARAM-3. The readiness check: PROJET-3. Switching a Rôle from a « Limite atteinte » Décision: BOUCLE-7.

## Dependencies

- PARAM-1
- RUNNER-7
