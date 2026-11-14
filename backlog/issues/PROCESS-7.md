---
id: PROCESS-7
title: "« Gestion du process » at 1280: the canvas of the draft or the active version, its Manques, the Étape and the Sources read"
epic: PROCESS
type: feature
priority: P0
size: M
milestone: M4 Boucle
blocked_by: [UI-8, PROCESS-3, SOURCE-1]
adr: [0011, 0012, 0006]
risques: []
stories: [US-92, US-94, US-88]
screens: [process, process-manques, process-etape, process-sources, process-local]
revue_visuelle: true
video: false
---

## Context

US-92: a « Gestion du process » page for each Projet, an infinite canvas where its Phases hold their Étapes linked by arrows, each Étape showing its Entrées, its Sorties and its Outils. US-94: the canvas lists every Manque, each one pointing at its block. US-88: the Source of each Type d'artefact is shown on the canvas (chosen at the Projet's creation by SOURCE-1, moved by SOURCE-7). ADR 0011: the Process is a versioned `ProcessDefinition`, the draft saved on every change, `findGaps` run by the page on what it shows. ADR 0012: two choices of Source per Projet, `ticket` and `code` (the documents with the code).

This ticket builds the page at 1280 px, read only: the compact Cadre, the header, the canvas of the draft (or of the active version when there is none), and its panel (Manques, the selected Étape or Phase, the Sources, the versions at its foot). PROCESS-8 and PROCESS-9 make it editable, PROCESS-10 activates, PROCESS-11 is the phone's list, PROCESS-14 saves a Modèle from it, SOURCE-7 moves a Source from its Sources tab.

## Current state of the code

- `apps/web/src/routes.ts` (`ROUTES`: `/a-toi`, `/connexion`, `/demarrage`, `/runner`, `/parametres/composants`), `router.ts` (`Route { path, composant, data(match, state) }`, `:name` parameters, `query`), `views/cadre.ts` (`cadreView`, `BARE_PATHS`, variant `default | bare`), `store/index.ts` (slices `pilot`, `runner`, `decision`, `runner-link`, `ai-account`, `device`), `actions/dispatcher.ts` (`registerAction(composant, action, handler)`), `keys/vault.ts` (`openItem(item, aad)`). Nothing of the Process in the web nor the server.
- Created by PROJET-2: `Project`, `apps/server/src/projects/`, the `project` slice, `/projets`, `apps/web/src/views/projets.ts` (a Projet's displayed name). Created by PROJET-6: the Local Projet (`nameSealed`, opened in the page under the vault key), its folder known only to the Runner.
- Created by PROCESS-1: `packages/contracts/src/process/definition.ts` (`ProcessDefinition`: `phases`, `steps` with `inputs`, `outputs`, `tools`, `arrows`, `loopBacks`, `commands`), `artifact-types.ts` (`ARTIFACT_TYPES`), `catalogue.ts` (each kind's family, ports, `judges`, default name), `templates/process-crewdeck.ts`.
- Created by PROCESS-2: `packages/contracts/src/process/gaps.ts` (`findGaps(definition, sources)` → `ProcessGap { kind, target, label }`, `target` a dotted path such as `steps.st-merge.inputs.v-review` or `sources.inventory`, the label French; `validateDefinition`), `process/sources.ts` (`SOURCE_GROUPS`, `TYPE_SOURCE`: each Type d'artefact's group `ticket`, `code`, or `crewdeck` for the Idée, `none` for the Livraison), the fixtures.
- Created by PROCESS-3: `apps/server/src/process/`, `process_versions`, `process_drafts`, `zProjectProcess { id (the Projet's), active: zProcessVersion | null, draft: zProcessDraft | null }` (`GET /api/projects/:id/process`, the event `process.upserted`, the snapshot key `processes`), the web slice `process` (collection, keyed by the Projet's id) and `apps/web/src/api/process.ts` (`getProcess`, `saveDraft`). A Projet whose copy of its Modèle had Manques at creation has no active version, only a draft (`baseVersion: 0`).
- Created by SOURCE-1: `artifact_sources` (`ticket`, `code`: `local | github`, `since`), `zProjectProcess.sources { ticket, code }`, `processSourcesOf(view)` for `findGaps`.
- Created by UI-8: ProcessCanvas, Phase, StepCard, Port, ToolChip, LoopBack, Toast, the Cadre's `compact` variant, `PORT_TYPES`. Created by UI-1 to UI-7: PageHeader, Tabs, Empty, ListRow, StatusBadge, Card, Button, IconButton, Icon.
- Created by PARAM-1 / PARAM-2: the `settings` slice with each Rôle's Moteur and model (« Claude Code · Opus 5.5 »).
- `design/screens/gestion-du-process/process*.html`: the reference.

## To do

- **Page Composant** `PageProcessEditor` (`packages/contracts/src/composants/page-process-editor.ts`, `packages/skin-passerelle/src/page-process-editor.ts`), category `page`, registered in `COMPOSANTS`:
  - data `{ found: boolean, title: { projectName, backHref, count }, canvas: ProcessCanvas data, tab: 'gaps' | 'selection' | 'sources', gaps: { label, meta, target: { kind: 'step' | 'phase' | 'sources', id: string | null } }[], step: { name, kindLabel, phaseName, loopBack: string | null, inputs: { label, from }[], outputs: { label, to }[], tools: { icon, label, detail: string | null }[] } | null, phase: { name, count, repeat: string } | null, sources: { lead, rows: { icon, label, value, detail: string | null }[] }, footer: { changes, versions } }`;
  - layout at 1280 px: the PageHeader (title `process.title` « Gestion du process », back link « {projectName} », count), then the editor filling the height: the `cd-process-canvas` (`side` ground, `line` dot grid) and the panel (`--cd-aside-width`): Tabs « Manques » (with its count), « Étape » or « Phase » (by the selection), « Sources »; below 1280 px the editor is not rendered (PROCESS-11 fills the phone);
  - panel « Manques »: the lead `process.gaps.lead` « Un Process qui a un Manque ne s'active pas. Chaque Manque mène à son bloc. », then one row per Manque (`alert`, its label bold, `chevron-right`, its meta); none: Empty `check` « Aucun Manque » with `process.gaps.none` « Chaque Entrée est alimentée, chaque Type d'artefact a sa Source, et le Merge a ses checks et sa Review avant lui : le Process est activable. »;
  - panel « Étape »: a StatusBadge with its name, « {kindLabel} · {phaseName} » in mono; « Retour » (its sentence) when it has one; the fold « Entrées et Sorties » (`<details>`, count « 2 → 1 »), each Entrée « ← {Étape} », « ← pour {forEach} » or « ← rien » (`caution`), each Sortie « → {Étapes} » or « → aucune Étape »; « Outils », one row each (« Rôle Review » with « Claude Code · Opus 5.5 », « Skill review » with « officielle », « Serveur MCP stitch », « Connecteur GitHub » with the repository's `fullName`, « Commande »); nothing selected: Empty `process.selection.none` « Choisis une Étape ou une Phase sur le canevas. »; panel « Phase »: its name, « 5 Étapes · 2 Retours », « Répéter : pour chaque Ticket prêt » or « une fois »;
  - panel « Sources »: the lead `process.sources.lead` « Une Source par Type d'artefact : elle gagne toujours. », then the two groups of ADR 0012 (`TYPE_SOURCE`): « Tickets » (`folder` « Local » with « dossier tickets/ du Projet, sur {machine} », or `github` « GitHub » with the repository's `fullName`), and « Code et documents » (the same, its detail listing the types it holds that the shown definition passes: Changement de code, Verdict, PRD, Maquettes, Conception technique, Inventaire); then « Idée » « Crewdeck » (never a choice); a type no Étape passes says « non utilisé » in its group's detail, and the Livraison, when passed, « aucune Source : le résultat d'une Commande »;
  - without an active version (PROCESS-3), a caution `cd-banner` under the header `process.noVersion` « Pas encore de version active : règle les Manques puis active. »;
  - the panel's foot « Versions »: `changes` (« Aucun changement depuis la v3. » without a draft, « Brouillon en cours sur la v3. » with one, « Ce brouillon deviendra la v1. » without an active version) and `versions` in mono (« v3 active depuis le 4 nov. », « aucune version active »);
  - `found: false`: Empty `process.notFound` « Ce Projet n'existe pas » with the link « Retour aux Projets » (`/projets`);
  - actions `select { target: { kind: 'step' | 'phase' | 'sources', id: string | null } | null }` (relayed from the canvas, and from a Manque's row), `tab { tab }`, `view { zoom, pan }` (relayed).
- **Views** (pure, with their specs):
  - `apps/web/src/process/canvas.ts` `canvasOf(definition, gaps, selection, context)` → ProcessCanvas data with `editable: false`: Phases at their cells with their `forEach` label (`idea.noted` « chaque Idée notée », `idea.retained` « chaque Idée retenue », `ticket.ready` « chaque Ticket prêt »), their Étapes at their cells; `variant` from the catalogue's family (`agent`, `gate`, `command`, `core`); `kindLabel` « Agent », « Pilote », « Commande », « Crewdeck », except `cross-review` « Revue croisée », `checks` « CI du dépôt » with a `connector` Outil and « Commandes » without, `merge` « par la Boucle » in a `ticket.ready` Phase; `judges` from the catalogue; each port's `label` its Type d'artefact (`process.type.<id>`: Idée, PRD, Maquettes, Conception technique, Inventaire, Ticket, Changement de code, Verdict, Livraison), `note` as defined, `unfed` when an `input.unfed` Manque points at it; the chips (a Rôle by its name `roles.<id>`, a Skill by its id, a Serveur MCP by its name, a Connecteur « GitHub », a Commande `process.tool.command` « Commande »); the counts of Manques per Phase and per Étape; arrows and Retours as defined.
  - `apps/web/src/views/process-editor.ts` `processEditorView(state, projectId, ui)`: the shown definition is the draft's when there is one, else the active version's; `findGaps(shown, processSourcesOf(view))`; each Manque's block from its `target` and its meta (« Merge · Développement », « Sources · produit par « Inventaire » »); the header's count (« v3 active », « brouillon · 5 Manques », « brouillon », « brouillon · pas encore de version active »); the step, phase, sources and footer parts above.
  - `apps/web/src/process/editor-ui.ts`: the page's own state: the selection and the tab from the query (`?etape=<stepId>`, `?phase=<phaseId>`, `?onglet=manques|etape|sources`), written back with `navigate(…, { replace: true })`; zoom (90 by default) and pan kept per Projet in memory while the tab lives.
- **Route** `{ path: '/projets/:id/process', composant: PageProcessEditor, data }` in `routes.ts`; `views/cadre.ts`: variant `compact` and current `projets` for that path; handlers of `select`, `tab`, `view` in `apps/web/src/actions/process-editor.ts`. Selecting a Manque selects its block, opens its tab, and pans the canvas to centre it.
- `t()` keys `process.*`.
- Scenarios `apps/server/src/testing/scenarios/process.ts` (added to `SCENARIOS`): `process` (GitHub Projet « Site mairie » on « Process Crewdeck », v3 active, no draft), `process-manques` (a draft whose `findGaps` gives one Manque of each kind, from PROCESS-2's fixtures), `process-etape` (`?etape=` its Review), `process-sources` (its `ticket` group Local, `?onglet=sources`), `process-local` (Local Projet « Recettes », a draft adding the Phase « Livraison » and the Commande Étape « Lancer », `?etape=` it), `process-sans-version` (a Local Projet with only its creation's draft, no active version: not a mockup id, an e2e state only).
- Playwright `apps/web/e2e/process.spec.ts` at 1280 px.

## Decisions already made

- Mockup: `process`, `process-manques`, `process-etape`, `process-sources`, `process-local` (pages `design/screens/gestion-du-process/process.html`, `…/process-manques.html`, `…/process-etape.html`, `…/process-sources.html`, `…/process-local.html`; captures `…-1280.png`, the `…-390.png` being PROCESS-11's). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The header's buttons are absent here: « Phase » and « Étape » are PROCESS-8's, « Activer » PROCESS-10's, « Enregistrer comme Modèle de process » PROCESS-14's; the Étape panel's Phase select, « Retirer », the Retour's Stepper and « Attacher un Outil » are PROCESS-8 and PROCESS-9's; the Commande's form PROCESS-12's; the Sources' Selects SOURCE-7's.
- Where `process-sources.html` contradicts ADR 0012, the ADR wins: not one Select per type but two groups, « Tickets » and « Code et documents » (Changement de code, Verdict, PRD, Maquettes, Conception technique, Inventaire under the code's Source, no menu of their own); the Idée « Crewdeck », never a choice and never GitHub; a type no Étape passes « non utilisé », never an « aucune Source ». Here the groups are read; changing a group's Source opens SOURCE-7's migration.
- The chips' Skill names are the definition's, i.e. PROCESS-1's catalogue (`idea-analysis`, `product-design`, `code`…): the mockup's `analyse-idee` and `red-green` are filler.
- A Projet may have no active version yet (PROCESS-3: its copy of the Modèle had Manques, e.g. a Local Projet whose « Checks » has no Commande): the page shows its draft under the banner « Pas encore de version active : règle les Manques puis active. »; PROCESS-10 activates it as v1.
- The canvas shows the draft when one exists: its Manques are the ones listed (an active version never has one). The page runs `findGaps` itself on every render; the server's own check is at activation (PROCESS-10).
- The Process is read from the store, fed by the `/api/state` snapshot and the `process` events (ADR 0008, « Front data »): no fetch of the page's own, no polling; another tab's change shows within 2 s.
- The selection lives in the URL's query, so that a Manque, a Décision or a test opens the page on its block.
- A Commande's chip and row say « Commande » until PROCESS-12 opens the sealed part to show its text: this ticket never touches the sealed part.
- A Local Projet's name is shown as `views/projets.ts` gives it (opened under the vault key, PROJET-6); the folder's path is never shown (it stays on the Runner), only the machine's name.
- `PORT_TYPES` (UI-8) equals `ARTIFACT_TYPES` (PROCESS-1): a test of `canvas.spec.ts` pins it.

## Acceptance criteria

- [ ] `/projets/:id/process` at 1280 px shows the compact Cadre, the header « Gestion du process » with the back link to the Projet and « v3 active », the canvas of « Process Crewdeck » (3 Phases, 17 Étapes as `PROCESS_CREWDECK`, their ports, the catalogue's Skill names on the chips, 25 arrows, 4 Retours) and the panel on « Manques » with « Aucun Manque ».
- [ ] With a draft, the canvas shows the draft; each of the five kinds of Manque is listed with its label and meta, counted on its tab, its Phase and its Étape; an unfed Entrée is marked on its card; the header says « brouillon · 5 Manques ».
- [ ] Choosing a Manque selects its Étape or Phase (or opens « Sources »), centres it on the canvas and updates the URL's query; reloading the page keeps that selection.
- [ ] Selecting the Review shows its kind and Phase, its Retour « Vers « Code » … 3 fois au plus », its two Entrées and one Sortie with where they come from and go, and its Outils (its Rôle with the Moteur and model of the Paramètres, its Skill).
- [ ] « Sources » shows the two groups, « Tickets » Local on the Runner's machine and « Code et documents » on GitHub with the repository and the types it holds, « Idée » « Crewdeck », an unused type « non utilisé », no Select; a Local Projet shows Local for both and no GitHub chip.
- [ ] A Projet with a draft and no active version shows the draft, its Manques, the banner « Pas encore de version active : règle les Manques puis active. » and « Ce brouillon deviendra la v1. ».
- [ ] A `process.upserted` event of another tab's draft save updates the canvas without reload.
- [ ] An unknown or another Pilote's Projet shows « Ce Projet n'existe pas »; `PageProcessEditor`'s examples render and its actions emit valid `cd-action`s; axe without violations at 1280 px on the five scenarios.

## Verification

- `pnpm exec nx test web -- src/views/process-editor.spec.ts src/process/canvas.spec.ts src/process/editor-ui.spec.ts src/views/cadre.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/page-process-editor.spec.ts`
- `pnpm exec nx e2e web -- process.spec.ts`
- `scripts/captures.sh process process-manques process-etape process-sources process-local` for the PR
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

Nothing.

## Out of scope

- Adding, removing and moving Phases and Étapes, the « Phase » and « Étape » buttons: PROCESS-8. Arrows, Retours, Outils: PROCESS-9. The diff and activation: PROCESS-10. The phone's list and the draft's banner: PROCESS-11. A Commande's text and form: PROCESS-12. Saving a Modèle: PROCESS-14. Moving a Source: SOURCE-7.
- The links to this page from the Projet (PROJET-3's « Gestion du process ») and from its Paramètres (PARAM-3's « Étapes » card).

## Dependencies

- UI-8
- PROCESS-3
- SOURCE-1
