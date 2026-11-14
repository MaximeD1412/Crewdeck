---
id: PROCESS-8
title: "Editing Phases and Étapes on the canvas: the catalogue, add, remove, move, « pour chaque », the draft saved on each change"
epic: PROCESS
type: feature
priority: P0
size: M
milestone: M4 Boucle
blocked_by: [PROCESS-7, UI-9]
adr: [0011]
risques: []
stories: [US-93, US-95]
screens: [process-catalogue, process-phase]
revue_visuelle: true
video: false
---

## Context

US-93: the Pilote adds Étapes from the catalogue (those of the default Modèle, the Revue croisée, the Revue visuelle, a Commande, another Review on the Rôle of their choice), removes them, moves them between Phases, adds and removes Phases (a Phase removed with its Étapes, never while it holds the Checks, the Merge or the Review). US-95: a Phase repeated for each item of a list (each ready Ticket, each retained Idée). ADR 0011: the draft is saved on every change (`PUT /api/projects/:id/process/draft` with the whole definition, its sealed part and its `revision`, 409 `process.draft-stale` for another revision), `validateDefinition` checks each change in the page before it is made and on the server at each save (422 `process.invalid`); the Étapes du produit (`checks`, `merge`) are never in the catalogue's menu, never added nor removed.

PROCESS-7 built the page read only; this ticket makes its Phases and Étapes editable. PROCESS-9 adds the arrows, Retours and Outils on the same edit and save path, PROCESS-10 activates the draft.

## Current state of the code

- Created by PROCESS-7: `/projets/:id/process`, `PageProcessEditor` (`packages/contracts/src/composants/page-process-editor.ts`, `packages/skin-passerelle/src/page-process-editor.ts`), `apps/web/src/views/process-editor.ts`, `apps/web/src/process/canvas.ts` (`editable: false`), `apps/web/src/process/editor-ui.ts` (selection and tab in the query), `apps/web/src/actions/process-editor.ts`, the `process` slice, the scenarios of `apps/server/src/testing/scenarios/process.ts`, `apps/web/e2e/process.spec.ts`.
- Created by PROCESS-1: `catalogue.ts` (`CATALOGUE`: each kind's `family`, `name`, `menu` (`process`, `reviews`, `runner`, or `null` for `checks` and `merge`), `removable` (`never` for `checks` and `merge`, `keep-one` for `review`), `unique`, ports, Rôle and Skill; `defaultStep(kind, { id, phaseId, col, row })`), `definition.ts`. Created by PROCESS-2: `validateDefinition(definition)` → `Refusal { kind, target, label }` (`position.taken`, `core.missing`, `loop-back.other-phase`…), `findGaps`.
- Created by PROCESS-3: `PUT /api/projects/:id/process/draft` (`zProcessDraftInput { definition, sealed, revision, baseVersion }`, `revision: 0` for the first save, `baseVersion` the active version's number or 0 without one → `zProjectProcess`; 409 `process.draft-stale`, 422 `process.invalid` with `fields`), `process.upserted` in the same transaction, `apps/web/src/api/process.ts` (`saveDraft`).
- Created by UI-8: ProcessCanvas's `moveStep` action, Phase's `target`, Toast. Created by UI-9: Menu (`choose`, `close`). Created by UI-4: TextField, Radio, Select, Dialog.

## To do

- **Edits** `apps/web/src/process/edit.ts`, pure, each `(definition, …) → { ok: true, definition } | { ok: false, reason: string }`, and ending on `validateDefinition` (its refusal's label as `reason`):
  - `addStep(definition, kind, phaseId)`: id `st-<kind>`, else `st-<kind>-2`, `-3`… (unique in the definition); `defaultStep(kind, …)` (its name, ports, Rôle and Skill) at the Phase's next free cell in reading order, five columns a row; a kind whose `menu` is `null` (`checks`, `merge`) refused.
  - `removeStep(definition, stepId)`: its arrows, its Retours, and the `commands` entries only it uses go with it.
  - `moveStep(definition, stepId, phaseId, col, row)`: refused on an occupied cell; its arrows kept; `moveStepToPhase(definition, stepId, phaseId)` puts it at that Phase's next free cell.
  - `addPhase(definition)`: id `ph-<n>`, name `process.phase.new` « Nouvelle Phase » (« Nouvelle Phase 2 » when taken), `forEach: null`, at the first free row under the Phases, column 1.
  - `removePhase(definition, phaseId)`: with its Étapes, their arrows and Retours.
  - `renamePhase(definition, phaseId, name)`: trimmed, 1 to 40 characters, unique among the Phases (`process.phase.nameTaken` « Une Phase porte déjà ce nom. »).
  - `setForEach(definition, phaseId, forEach)`: `null`, `idea.noted`, `idea.retained`, `ticket.ready`.
  - `canRemoveStep`, `canRemovePhase`: the same functions run without applying, so the buttons show the refusal before the click (`core.missing` for the Checks, the Merge, the last Review or a Phase holding one).
- **Saving** `apps/web/src/process/draft.ts` `createDraftSaver({ projectId, client })`: an accepted edit is shown at once; one `PUT` in flight per Projet, the edits made meanwhile sent together in the next with the `revision` the last answer gave; the body's `sealed` is the draft's (or the active version's) unchanged, `baseVersion` the active version's number (0 without one). On 409 `process.draft-stale` or 422 `process.invalid`, or a network error, the page drops its unsaved edits, shows the store's draft and a halt Toast: `process.draft.stale` « Le brouillon a changé dans un autre onglet : ton dernier changement n'est pas enregistré. », the error's `message` as is, or `process.draft.failed` « Brouillon non enregistré : vérifie ta connexion. ».
- **PageProcessEditor** gains (data and actions declared in its contract, each with an example):
  - the header's actions at 1280 px: « Phase » (`plus`, sm) → `addPhase {}`; « Étape » (`plus`, sm) → `openCatalogue {}`, the catalogue's Menu under it (data `catalogue: Menu data | null`), `addStep { kind }` on `choose`, `closeMenu {}`;
  - the canvas `editable: true`, its `moveStep` relayed; the target Phase (`target: true`) is the selected Phase, else the selected Étape's, else the last one;
  - the Étape panel: « Retirer » (ghost, `trash`) → `removeStep { stepId }`, disabled with its refusal under it (« La Review ne se retire pas : son Rôle se change. »); the Select « Phase » of every Phase's name → `moveStepToPhase { stepId, phaseId }`;
  - the Phase panel (`process-phase`): the StatusBadge « Phase » and « 5 Étapes · 2 Retours »; the TextField « Nom de la Phase » → `renamePhase { phaseId, name }` on blur or Enter; « Répéter », a radiogroup « Une fois », « Pour chaque Idée notée », « Pour chaque Idée retenue », « Pour chaque Ticket prêt » → `setForEach { phaseId, forEach }`, with its help (`ticket.ready` « Chaque Ticket prêt parcourt la Phase : c'est la Boucle. », `idea.retained` « Chaque Idée retenue parcourt la Phase : c'est sa Conception. », `idea.noted` « Chaque Idée notée parcourt la Phase. », none « La Phase tourne à chaque Artefact reçu par ses premières Entrées, un à la fois, dans l'ordre. »); « Retirer la Phase » (ghost, `trash`) → `removePhase { phaseId }`, disabled with its refusal beside it (« Elle tient la Review et le Merge, qui ne se retirent pas. »);
  - the Dialog `removePhase` opens: « Retirer la Phase « {name} » ? », « Ses {n} Étapes partent avec elle : {names}. Le changement va dans le brouillon. », « Annuler » (`cancelRemovePhase {}`) and « Retirer la Phase » (danger, `confirmRemovePhase { phaseId }`); a Phase without Étapes goes without the Dialog;
  - `toast: Toast data | null`, put in the canvas's `toast` Emplacement; the core clears it after 6 s or at the next edit.
- **The catalogue's Menu** (`apps/web/src/process/catalogue-menu.ts`, pure): title « Ajouter dans « {Phase} » »; one group per value of the catalogue's `menu`, in the catalogue's order: `process` « Étapes du Modèle de process « Process Crewdeck » », `reviews` « Revues » (`review` with « sur le Rôle de ton choix → Verdict »), `runner` « Sur ton Runner » (`command`, « jugée sur son code de sortie »); a `unique` kind already in the definition disabled; each item's icon by family (`spark`, `user`, `terminal`) and detail its ports (« Idée → PRD », « … → Ticket » when it takes three or more types); `checks` and `merge` never in it.
- After `addStep` the new Étape is selected and the panel opens on it; after `addPhase` the new Phase is selected and its name field focused.
- Handlers in `apps/web/src/actions/process-editor.ts`; `t()` keys `process.*`.
- Scenarios `process-catalogue` (the « Développement » Phase selected) and `process-phase` (`?phase=` « Développement ») in `apps/server/src/testing/scenarios/process.ts`; `PREPARE['process-catalogue']` in `apps/web/e2e/captures.spec.ts` opens the catalogue; Playwright `apps/web/e2e/process-edit.spec.ts`.

## Decisions already made

- Mockup: `process-catalogue`, `process-phase` (pages `design/screens/gestion-du-process/process-catalogue.html`, `…/process-phase.html`; captures `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- Where `process-catalogue.html` contradicts the ADR, the ADR wins: the Menu never lists « Checks » nor « Merge », Étapes du produit never added (glossary, ADR 0011; their catalogue `menu` is `null`). It lists « Tri de l'Idée » (`idea-triage`), an Étape of « Process Crewdeck » the mockup leaves out.
- The four repetitions are offered: ADR 0011's closed list (`idea.noted` is « Process Crewdeck »'s « Idée » Phase), the mockup showing three.
- What may be done is `validateDefinition`'s answer only (PROCESS-2): this ticket never writes a rule of its own besides the free cell and a Phase's name. A Retour pointing to another Phase makes a move refused, with its label in the Toast.
- An Étape keeps the catalogue's name: renaming an Étape is no story.
- Removing an Étape or an arrow needs no confirmation (it is a draft's change, the active version untouched); removing a Phase with Étapes asks the page's Dialog, not the core's: it is not an Action sensible (PRD's list).
- The page shows an edit at once and saves behind it; the store's `process` event of its own save carries the same definition, so nothing jumps; a refused save takes the server's draft back, never merges two drafts.
- Editing is at 1280 px only: below, the editor is not rendered (US-98, PROCESS-11).

## Acceptance criteria

- [ ] « Étape » opens the catalogue « Ajouter dans « Développement » » with the Développement Phase selected, its three groups, without « Checks » nor « Merge »; choosing « Revue croisée » adds it at the Phase's next free cell with its ports and default Outils, selects it, and the draft is saved (`PUT` once, the header then saying « brouillon »).
- [ ] Removing an added Étape removes its arrows and Retours; « Retirer » on the Review, the Checks or the Merge is disabled with its reason; removing a Phase that holds them is disabled with « Elle tient la Review et le Merge, qui ne se retirent pas. ».
- [ ] Removing a Phase with Étapes asks the Dialog listing them; « Annuler » changes nothing; « Retirer la Phase » removes them all in one save.
- [ ] Dragging a card on a free cell of another Phase moves it there with its arrows; the Phase select moves it to that Phase's next free cell; a move the rules refuse shows the refusal in a Toast and changes nothing.
- [ ] « Phase » adds « Nouvelle Phase » under the others, selected, its name focused; renaming to an existing Phase's name is refused; « Pour chaque Ticket prêt » shows its help and the Phase's `accent` rail.
- [ ] Three edits made within one save are sent in the next `PUT` with the new revision; a 409 from another tab's save shows « Le brouillon a changé dans un autre onglet… » and the other tab's draft.
- [ ] `edit.spec.ts`: each operation on PROCESS-2's fixtures, including the refusals; axe without violations at 1280 px on `process-catalogue` and `process-phase`.

## Verification

- `pnpm exec nx test web -- src/process/edit.spec.ts src/process/draft.spec.ts src/process/catalogue-menu.spec.ts src/views/process-editor.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/page-process-editor.spec.ts`
- `pnpm exec nx test-integration server -- process` (the draft's save and its event, already PROCESS-3's, run with the edited fixtures)
- `pnpm exec nx e2e web -- process-edit.spec.ts process.spec.ts`
- `scripts/captures.sh process-catalogue process-phase` for the PR
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

Nothing.

## Out of scope

- Arrows, Retours and « Attacher un Outil »: PROCESS-9. The diff, the header's change count and activation: PROCESS-10. The Commande's text: PROCESS-12. The « Livraison » Phase of « Process Crewdeck »'s additions: PROCESS-13.
- Dragging a Phase on the canvas, renaming an Étape: no story.

## Dependencies

- PROCESS-7
- UI-9
