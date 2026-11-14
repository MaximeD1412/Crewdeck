---
id: UI-9
title: "Process list and editing Composants: PhaseGroup, StepRow, Stepper, Menu, ProcessTrack stopped, Session failed"
epic: UI
type: feature
priority: P0
size: S
milestone: M4 Boucle
blocked_by: []
adr: [0006]
risques: []
stories: [US-98, US-93]
screens: [composants]
revue_visuelle: true
video: false
---

## Context

US-98: the phone reads a Projet's Process as the list of its Phases and their Étapes, with its Manques. US-93: the Pilote adds Étapes from the catalogue and attaches Outils to an Étape, both from a menu, and sets a Retour's maximum. `design/DESIGN.md` « Process » names PhaseGroup, StepRow, Stepper and Menu; « Rows and cards » adds the `stopped` state of ProcessTrack (an arrest decided elsewhere, at the Source) and « Session » the `failed` state with `resume-label` and `resume-icon` (« Relancer » for a Commande, whose output reads as a Session, US-104).

This ticket builds the Composants only. PROCESS-11 places PhaseGroup and StepRow on the phone's list, PROCESS-8 the Menu of the catalogue, PROCESS-9 the Menu « Attacher un Outil » and the Stepper of a Retour, SOURCE-6 the `stopped` track of a Ticket closed at its Source, PROCESS-12 the failed Commande's Session.

## Current state of the code

- `packages/contracts/src/composants/`: `ProcessTrack` (`process-track.ts`, `zStepState` = `done | current | todo | off | halt`), `Session` (`session.ts`, `state: active | waiting | stopped | interrupted`, `resumeDisabledReason`, actions `stop`, `resume`, `close`, `expand`), `MenuItem` (`cadre.ts`: the Cadre's nav entry, tag `cd-menu-item`), `COMPOSANTS` in `index.ts`.
- `packages/skin-passerelle/src/`: `process-track.ts` (`MARKS` per state), `session.ts`, `menu-item.ts` (the Cadre's), the generated examples test `composants.spec.ts`; no PhaseGroup, StepRow, Stepper nor Menu.
- `process-track.ts` still describes `off` as « an Étape optionnelle turned off (US-10) » (example « une Étape désactivée »), US-83 being removed.
- `packages/sdk/src/i18n/fr.ts`: `processTrack.*` (`halt` « arrêtée », `off` « désactivée »), `session.state.*`, `session.resume` « Reprendre ».
- `design/components.js` (`ui-phase-group`, `ui-step-row`, `ui-stepper`, `ui-menu` / `ui-menu-group` / `ui-menu-item`, `STEP_ICON.stopped`, `SESSION.failed` and `resume-label` / `resume-icon` in `ui-session`), `design/components.html` « 08 Process », `design/screens/crewdeck/ticket-ferme-a-la-source.html` and `session-commande.html`: the drawn reference.

## To do

- Declarations in `packages/contracts/src/composants/` (registered in `COMPOSANTS`), implementations in `packages/skin-passerelle/src/`, each with examples reproducing the mockups:
  - **PhaseGroup** `cd-phase-group`, category `partie`: data `{ name, forEach: string | null, count: string, gaps: int ≥ 0, open: boolean }` (`count` formatted by the view, « 10 Étapes · 2 Retours »); a native `<details>` named « Phase / {name} » whose summary holds the name (`section-label`), the `caution` badge « {n} Manque(s) », the chevron and the meta « pour {forEach} · {count} »; default Emplacement its `cd-step-row`s; `open` sets its initial state, the Pilote folds and unfolds it freely. No action.
  - **StepRow** `cd-step-row`, category `partie`: data `{ name, kindLabel, icon: IconName, tools: string | null, flow: string, loopBack: string | null, gap: string | null }`; the icon (`alert` instead when `gap`), « {name} · {kindLabel} » (the kind left out when it equals the name), the tools line, the flow « Entrées → Sorties » in mono, « Retour {loopBack} » with the `undo` icon, the gap text in `caution`. No action.
  - **Stepper** `cd-stepper`, category `signal`: data `{ label, value: int, unit: string | null, min: int, max: int }`; a group named by its label with `stepper.decrease` « Moins » and `stepper.increase` « Plus » buttons around an `<output>` « {value} {unit} » (`aria-live="polite"`), each button disabled at its bound; ArrowUp / ArrowDown on the group change it too. Action `change { value }`, never outside `min..max`.
  - **Menu** `cd-menu`, category `partie`: data `{ title: string | null, groups: { label, items: { id, label, icon: IconName | null, detail: string | null, selected: boolean, disabled: boolean }[] }[] }`; `role="menu"` named by its title, each group a `role="group"` with its label, each item a `menuitem` (its label bold over its detail, a `check` when `selected`, `aria-disabled` when disabled); the focus on the first enabled item when it is rendered, ArrowUp / ArrowDown / Home / End move it across groups, Enter or Space chooses. Actions `choose { id }` (never for a disabled item) and `close {}` (Escape, or a pointer down outside it).
  - **ProcessTrack**: `zStepState` gains `stopped`, marked with the `stop` icon, neutral, its state `processTrack.stopped` « arrêtée à la Source » for screen readers; example « arrêtée à la Source » (« Review », « arrêtée à 15:20 : Ticket fermé sur GitHub »). `off` is rewritten: no longer an Étape optionnelle turned off (US-83 is removed) but an Étape absent from the Process version this item runs on (ADR 0011: work keeps its version); the docstrings of `zStepState` and `ProcessTrack` in `packages/contracts/src/composants/process-track.ts` and of `PasserelleProcessTrack` in `packages/skin-passerelle/src/process-track.ts` say so, the example « une Étape désactivée » becomes « une Étape absente de sa version » (« Maquettes », meta « pas dans la v2 »), and `processTrack.off` becomes « hors de sa version ».
  - **Session**: `state` gains `failed` (`halt` dot, `session.state.failed` « échouée »); data gains `resumeLabel: string | null` and `resumeIcon: IconName | null`, the button of `stopped`, `interrupted` and `failed` taking them (default « Reprendre » and `play`); example « une Commande échouée » (« Lancer · Recettes », `failed`, « Relancer », `refresh`, no Composer).
- `t()` keys `composants.<Name>.*`, `stepper.*`, `processTrack.stopped`, `session.state.failed`.
- Tests: `packages/skin-passerelle/src/stepper.spec.ts` (bounds, keys, `change`), `menu.spec.ts` (keyboard, `choose`, nothing on a disabled item, `close` on Escape and outside), `phase-group.spec.ts` (open, meta), additions to `process-track.spec.ts` and `session.spec.ts`.
- Scenarios `composants-<name>` for PhaseGroup, StepRow, Stepper, Menu (in `apps/server/src/testing/scenarios/composants.ts`, added to `SCENARIOS`); Playwright `apps/web/e2e/composants-process-list.spec.ts` (each at 390 and 1280 px, the Menu's keyboard, axe); the examples' count of ProcessTrack and its « désactivée » locator (now « hors de sa version ») in `apps/web/e2e/composants-figures.spec.ts` and of Session in `composants-session.spec.ts` follow the new examples.

## Decisions already made

- Mockup: `composants` (page `design/screens/crewdeck/composants.html`; captures `design/screens/crewdeck/composants-390.png`, `…-1280.png`), and these Composants as drawn in `design/components.html` « 08 Process », `design/screens/gestion-du-process/process.html` (the phone's list), `process-catalogue.html`, `process-etape.html` (the Menus and the Stepper), `design/screens/crewdeck/ticket-ferme-a-la-source.html`, `session-commande.html`. It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The Menu's groups and items are arrays in its data (data in, ADR 0006): no `MenuGroup` nor item Composant, which also keeps the name `MenuItem` to the Cadre's entry.
- The Menu does not position itself: the Composant that places it does (the canvas's `menu` Emplacement, UI-8; under the « Étape » button, PROCESS-8).
- `stopped` is not `halt`: neither a failure nor a pause, so a neutral mark and its own label. `off` keeps its dashed mark and its value (no consumer renames), only its meaning changes: an Étape the item's version does not have.
- A Commande's Session has no Composer: the core leaves the `composer` Emplacement empty.

## Acceptance criteria

- [ ] Every example of the four new Composants and the new ProcessTrack and Session examples render (UI-2's generated test); each action emits a `cd-action` whose payload matches its schema.
- [ ] Stepper: « Plus » is disabled at `max` and « Moins » at `min`; ArrowUp emits `change` with `value + 1`; nothing is emitted outside the bounds.
- [ ] Menu: ArrowDown moves from the last item of a group to the first of the next, skipping disabled items; Enter emits `choose` with the item's id; Escape emits `close`; a disabled item emits nothing.
- [ ] PhaseGroup renders open when `open` is true, shows « pour chaque Ticket prêt · 5 Étapes · 2 Retours » and its Manques badge; StepRow shows the `alert` icon and its gap when `gap` is set.
- [ ] ProcessTrack says « arrêtée à la Source » on a `stopped` step and « hors de sa version » on an `off` one, no docstring nor example mentioning an Étape optionnelle; Session `failed` shows « Relancer » with the `refresh` icon and emits `resume`.
- [ ] axe without violations on the library page at 390 and 1280 px for each.

## Verification

- `pnpm exec nx test skin-passerelle -- src/stepper.spec.ts src/menu.spec.ts src/phase-group.spec.ts src/process-track.spec.ts src/session.spec.ts`
- `pnpm exec nx test skin-passerelle`, `pnpm exec nx test contracts -- src/composants/index.spec.ts`
- `pnpm exec nx e2e web -- composants-process-list.spec.ts composants-session.spec.ts composants-figures.spec.ts`
- `scripts/captures.sh composants` and the `composants-<name>` scenarios of this ticket, for the PR
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

Nothing.

## Out of scope

- The phone's list: PROCESS-11. The catalogue's Menu: PROCESS-8. « Attacher un Outil » and the Retour's Stepper: PROCESS-9.
- The Ticket closed at its Source: SOURCE-6. The Commande's Session and its « Relancer »: PROCESS-12.
- The canvas Composants and the Toast: UI-8.

## Dependencies

- None.
