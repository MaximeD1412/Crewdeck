---
id: PROCESS-11
title: "« Gestion du process » on the phone: the read-only list of Phases and Étapes, its Manques and the draft's banner"
epic: PROCESS
type: feature
priority: P2
size: S
milestone: M4 Boucle
blocked_by: [PROCESS-10, UI-9]
adr: [0011]
risques: []
stories: [US-98]
screens: [process, process-manques, process-local]
revue_visuelle: true
video: false
---

## Context

US-98: the Pilote reads a Projet's Process on the phone as the list of its Phases and their Étapes, with its Manques (the draft's when one exists, under a banner naming the active version and the number of changes), editing staying on the PC. `design/DESIGN.md` « Layout »: at 390 the page is the read-only list, the Manques first, then one PhaseGroup per Phase (the ones with a Manque open, the longest folded), then the Sources; a draft is read with its banner. The PRD's « Out »: no editing of the canvas on the phone.

PROCESS-7 built the page at 1280 px and does not render the editor below; this ticket fills the phone with the same view.

## Current state of the code

- Created by PROCESS-7: `/projets/:id/process`, `PageProcessEditor` (the editor rendered from 1280 px only), `apps/web/src/views/process-editor.ts` (the shown definition, `findGaps`, each Manque's label, meta and target, the Sources' rows), `apps/web/src/process/canvas.ts` (the kind labels, the chips), the scenarios `process`, `process-manques`, `apps/web/e2e/process.spec.ts`.
- Created by PROCESS-10: `diffDefinitions` and `apps/web/src/process/diff-labels.ts` (the number of changes of the draft since the active version).
- Created by UI-9: PhaseGroup, StepRow. Created by UI-2 / UI-3: Card, ListRow, StatusBadge, Banner, the PageHeader's `sub`.

## To do

- A Projet whose two groups are Local shows, at 390 above its Phases, the Banner of `process-local` (tone `neutral`, icon `folder`, title « Tout est Local », text « Aucun Connecteur : les documents et les Tickets sont des fichiers Markdown du dossier, sur <machine>. »), from SOURCE-1's Sources and the Runner's machine name.

- **PageProcessEditor** gains, below 1280 px only (data and examples in its contract):
  - the header's sub `process.phone.readOnly` « Lecture seule sur le téléphone : la modification se fait sur PC. », and none of the header's buttons;
  - a `cd-banner` the page renders under its header (`banner` data):
    - no active version yet (PROCESS-3): caution, `alert`, « Pas encore de version active », « {n} Manques à régler sur PC, puis active le brouillon. » (« Active le brouillon sur PC. » without Manque);
    - a draft with Manques: caution, `alert`, « Brouillon non activable », « {n} Manques à régler sur PC. La v{a} reste active. »;
    - a draft without Manque: accent, `pen`, « Brouillon : {k} changements », « Tu lis le brouillon ; la v{a} reste active tant qu'il n'est pas activé sur PC. »;
    - no draft: go, `check`, « Aucun Manque », « La v{a} est active. »;
  - the Card « Manques » (with its count, `flush`) when there are: one ListRow each (`alert`, `caution`, its label, its meta, a link); choosing one opens its PhaseGroup and scrolls to its StepRow, or scrolls to the Sources;
  - one `cd-phase-group` per Phase in the definition's order: `name`, `forEach` (« chaque Ticket prêt »), `count` (« 10 Étapes · 2 Retours », « 1 Étape »), its Manques' count, `open` when it has a Manque, else open unless it is the Phase with the most Étapes; in it one `cd-step-row` per Étape in reading order of its cells: `name`, `kindLabel` (as on its card: « Agent », « Pilote », « Revue croisée », « Commande », « CI du dépôt », « Commandes », « par la Boucle »), `icon` (`spark` an agent, `user` a gate, `terminal` a Commande, `check` the Checks, `merge` the Merge), `tools` (« Rôle Code · red-green », « GitHub »), `flow` (« Changement de code, Verdict (des checks) → Verdict »: each port's type and its note in parentheses, « — » for none), `loopBack` (« vers « Code », 3 fois au plus »), `gap` (the Manque's label, or « {n} Manques : … » when it has several);
  - the Card « Sources » (`flush`, its count): one ListRow per row of PROCESS-7's Sources view, its Source as a StatusBadge (« GitHub », « Local », « Crewdeck »).
- **View**: `apps/web/src/views/process-editor.ts` gains `phoneListOf(view)` (pure, with its spec), the banner from the draft, its Manques and the diff's length.
- Playwright `apps/web/e2e/process-phone.spec.ts` at 390 px on `process` and `process-manques`.

## Decisions already made

- Mockup: `process`, `process-manques`, `process-local` (pages `design/screens/gestion-du-process/process.html`, `…/process-manques.html`, `…/process-local.html`; captures `…-390.png`, the `…-1280.png` being PROCESS-7's). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The phone reads the draft when one exists (PRD): its Manques are the draft's, its banner names the active version and the number of changes.
- The PhaseGroups' folding follows DESIGN.md (a Phase with a Manque open), where `process-manques.html` folds the « Idée » Phase that has one.
- The Sources follow ADR 0012 as at 1280 px (PROCESS-7), not the mockup's one row per type with its own Source.
- Nothing is editable at 390 px: no button, no menu, no gesture; a link to the canvas is not offered (it needs the PC).
- At 1280 px nothing changes: the list is not rendered.

## Acceptance criteria

- [ ] At 390 px with no draft, the page shows « Lecture seule sur le téléphone… », the go Banner « Aucun Manque · La v3 est active. », the three PhaseGroups (« Idée » and « Développement » open, « Conception » folded with « 10 Étapes · 2 Retours »), their StepRows with kind, Outils, flow and Retour, and the Sources card.
- [ ] With a draft of five Manques, the caution Banner « Brouillon non activable · 5 Manques à régler sur PC. La v3 reste active. », the Manques card first, each PhaseGroup with a Manque open with its badge, each StepRow at fault showing its gap.
- [ ] With a draft without Manque, the accent Banner « Brouillon : 2 changements »; a Projet without an active version, the caution Banner « Pas encore de version active ».
- [ ] Choosing a Manque opens its PhaseGroup and brings its StepRow into view.
- [ ] No editing control at 390 px; at 1280 px the list is absent; axe without violations at 390 px on both scenarios.

## Verification

- `pnpm exec nx test web -- src/views/process-editor.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/page-process-editor.spec.ts`
- `pnpm exec nx e2e web -- process-phone.spec.ts process.spec.ts`
- `scripts/captures.sh process process-manques` for the PR
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The canvas and its panel: PROCESS-7. The « Tout est Local » Banner of `process-local` at 390 px: not built here (a Local Projet's list shows the same three Banners; its « Livraison » Phase is a PhaseGroup like any).
- Editing on the phone: out of the PRD.

## Dependencies

- PROCESS-10
- UI-9
