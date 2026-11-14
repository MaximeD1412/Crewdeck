---
id: UI-8
title: "Process canvas Composants: ProcessCanvas, Phase, StepCard, Port, ToolChip, LoopBack, Toast and the compact Cadre"
epic: UI
type: feature
priority: P0
size: M
milestone: M4 Boucle
blocked_by: []
adr: [0006]
risques: []
stories: [US-92]
screens: [composants]
revue_visuelle: true
video: false
---

## Context

US-92: « Gestion du process » is an infinite canvas where each Phase is a large block holding its Étapes, linked by arrows, each Étape showing its Entrées, its Sorties and the Outils attached to it. `design/DESIGN.md` « Process (Gestion du process, US-92 to US-98) » names the Composants and « Layout » the compact Cadre the page lives in at 1280. ADR 0011 (« Consequences ») lists them as Composants that emit actions (move, connect, set a Retour) the core checks before it changes the draft; « Options that lost »: no graph library, cards on a grid, arrows routed in its gutters, so that a Skin redraws the canvas without depending on one.

This ticket builds the Composants only, with their examples on the library page. PROCESS-7 places them on `/projets/:id/process` (read), PROCESS-8 and PROCESS-9 wire their actions (move, connect, Retour), PROCESS-9 and PROCESS-10 show the Toast. UI-9 builds the phone's Composants, the Stepper and the Menu.

## Current state of the code

- `packages/contracts/src/composants/`: `defineComposant` (`define.ts`, categories `cadre | page | partie | signal`), `COMPOSANTS` in `index.ts`, `ICON_NAMES` in `icons.ts` (no `minus`, `plug`, `undo`, `fit`), `Cadre` in `cadre.ts` with `variant: 'default' | 'bare'`, `MenuItem` (the Cadre's nav entry, `cd-menu-item`).
- `packages/skin-passerelle/src/`: `PasserelleElement` and `sharedStyles` (`base.ts`), the icons' paths (`icons.ts`), `PasserelleCadre` (`cadre.ts`, `cadre.spec.ts`), the generated examples test (`composants.spec.ts`), the library page (`page-composants.ts`). No canvas, Phase, StepCard, Port, ToolChip, LoopBack nor Toast.
- `packages/skin-passerelle/src/tokens.css` is stale: `design/tokens.json` gained `type-idee` … `type-livraison`, `step-card`, `gate-card`, `port-row`, `menu-width`, `sidebar-compact` (commit `e5a19b6`), which `tokens.css` lacks, so `src/tokens.spec.ts` (« is up to date with design/tokens.json ») fails today.
- `apps/web/src/views/cadre.ts` (`cadreView`, `BARE_PATHS`) gives the Cadre its variant; `apps/web/e2e/composants-*.spec.ts` and `apps/server/src/testing/scenarios/composants.ts` preview each family on `/parametres/composants?c=<Name>`.
- `design/components.js` section « 08 Process » (`ui-process-canvas` and its router `draw`, `ui-phase`, `ui-step-card`, `ui-port`, `ui-tool-chip`, `ui-loop-back`, `ui-toast`, `ui-app-shell variant="compact"`), `design/components.css` and `design/components.html` « 08 Process »: the drawn reference.

## To do

- **Tokens and icons**: run `pnpm exec nx run skin-passerelle:tokens` and commit `src/tokens.css`; add `minus`, `plug`, `undo`, `fit` to `ICON_NAMES` and their paths (the `P` map of `design/components.js`) to `packages/skin-passerelle/src/icons.ts`.
- **Declarations** in `packages/contracts/src/composants/` (one file each, registered in `COMPOSANTS`, category `partie` unless said), implementations in `packages/skin-passerelle/src/`, each with examples reproducing the mockups:
  - `process-canvas.ts` exports `PORT_TYPES` = `idea`, `prd`, `mockups`, `technical-design`, `inventory`, `ticket`, `code-change`, `verdict`, `delivery` (ADR 0011's `ArtifactType` ids, same spelling) and `zPortType`.
  - **ToolChip** `cd-tool-chip`: data `{ kind: 'role' | 'skill' | 'mcp' | 'command' | 'connector', label }`; its icon by kind (`user`, `spark`, `layers`, `terminal`, `plug`), mono label, the kind's name for screen readers (`toolChip.kind.*` « Rôle », « Skill », « Serveur MCP », « Commande », « Connecteur »).
  - **Port** `cd-port`: data `{ id, dir: 'in' | 'out', type: zPortType, label, note: string | null, state: 'active' | 'unfed' | 'compatible' | 'refused' | null }`; the Type d'artefact as text always, then `note` muted; an Entrée a hollow dot on its host's left edge, a Sortie a filled one on its right edge, both in `--cd-type-<slug>` (`idea` → `idee`, `mockups` → `maquettes`, `technical-design` → `conception`, `inventory` → `inventaire`, `code-change` → `changement`, `delivery` → `livraison`, the others as is); `unfed` in `caution` with `port.unfed` « rien ne l'alimente » for screen readers.
  - **StepCard** `cd-step-card`: data `{ id, name, kindLabel, variant: 'agent' | 'gate' | 'command' | 'core', selected: boolean, gaps: int ≥ 0, judges: boolean }`; Emplacements `ports` (its `cd-port`s, Entrées then Sorties) and `tools` (its `cd-tool-chip`s); an `article` named `stepCard.label` « Étape / {name} », focusable; `selected` an `accent` border, `gaps` a `caution` border and « {n} Manque(s) »; `gate` the compact dashed card (`--cd-gate-card`) without Outils footer, the `user` icon before its kind; `core` a `line-strong` left rail; an empty `tools` shows `stepCard.noTools` « aucun Outil » (not on a gate); `judges` shows the Retour handle (`undo`, title `stepCard.loopBackHandle` « Tirer vers une Étape antérieure pour poser un Retour »). Actions `select {}` (click, Enter), `startLoopBack {}` (pointer down on the handle).
  - **Phase** `cd-phase`: data `{ id, name, forEach: string | null, gaps: int ≥ 0, target: boolean, selected: boolean }`; a `section` named « Phase / {name} », its head (`section-label` name, `loop` icon and « pour {forEach} » with the `accent` top rail when repeated, a `caution` badge « {n} Manque(s) »), then a grid whose cells are `--cd-step-card` wide; default Emplacement the cards (the canvas sets each one's `grid-column` / `grid-row`); `target` (where an added Étape goes) and `selected` outline it. Action `select {}` (click on its head).
  - **LoopBack** `cd-loop-back`: data `{ max: int 1..10, state: 'active' | null }`; the badge `loopBack.label` « Retour · {max} fois au plus » with the `undo` icon, `caution`.
  - **ProcessCanvas** `cd-process-canvas`: data
    `{ editable: boolean, zoom: int 25..200, pan: { x, y }, phases: { id, name, forEach, gaps, col, row, target, selected, steps: { id, name, kindLabel, variant, col, row, selected, gaps, judges, ports: Port data[], tools: ToolChip data[] }[] }[], arrows: { from: { stepId, portId }, to: { stepId, portId }, state: 'active' | 'gap' | 'refused' | null }[], loopBacks: { from: stepId, to: stepId, max, state }[] }`;
    Emplacements `toast` (over its top) and `menu` (on its right edge); it renders, in its own shadow root, one `cd-phase` per Phase on its grid and in each one `cd-step-card`s with their `cd-port`s (Emplacement `ports`) and `cd-tool-chip`s (`tools`), then one SVG layer under the cards with every arrow and Retour, and a `cd-loop-back` on each Retour's curve; the zoom group at its foot (`canvas.zoomOut` « Dézoomer », the value « 90 % », `canvas.zoomIn` « Zoomer », `canvas.fit` « Tout voir »).
    Actions: `select { target: { kind: 'step' | 'phase', id } | null }` (a card, a Phase's head, the background for `null`); `view { zoom, pan: { x, y } }` (at the end of each zoom or pan gesture); and, only while `editable`, `moveStep { stepId, phaseId, col, row }` (a card dropped on a free cell of a Phase), `connect { from: { stepId, portId }, to: { stepId, portId } }` (a Sortie's dot dragged onto an Entrée's dot), `loopBack { from: stepId, to: stepId }` (the Retour handle dropped on a card).
  - **Toast** `cd-toast`, category `signal`: data `{ tone: 'accent' | 'go' | 'halt', icon: IconName | null, text }`; `role="status"`; no close button.
  - **Cadre** gains `variant: 'compact'`: at 1280 px the sidebar is `--cd-sidebar-compact` wide with the icons only (each link keeping its label as its accessible name and `title`, the counts as a dot badge, the brand's mark, the Runner's state as its dot with its label for screen readers), the page takes the rest of the width and the whole height without the `page-max` cap nor the page's bottom padding; below 1280 px it is the default Cadre. Example « compact, la Gestion du process ».
- **The router** `packages/skin-passerelle/src/process-canvas/route.ts`, pure and typed: from the cards' and Phase heads' boxes and the ports' anchors (an Entrée at its host's left edge, a Sortie at its right edge, vertically centred), the path of each arrow and each Retour, re-implementing the rules of `design/components.js` `draw`: Retours first, below the cards they pass under, their badge an obstacle; each arrow leaves its Sortie to the right and enters its Entrée from the left, orthogonal with rounded corners, through the gutters (one or two detours), never across a card, a Phase's head or a badge; the shortest free path wins, short arrows first; arrows from different Sorties take separate lanes, those of one Sortie share their trunk; a Phase's border is never a lane. `process-canvas/layout.ts` measures the rendered `cd-step-card`s, Phase heads and `cd-port`s (all in the canvas's own shadow tree) once laid out, again on a `ResizeObserver` and after each data change, and hands them to the router.
- **Gestures** (in `process-canvas.ts`): drag on the background pans, the wheel pans, Ctrl or Cmd + wheel and the zoom buttons zoom by 10 points around the pointer or the centre, « Tout voir » fits every Phase; while `editable`: a card dragged shows its ghost and the free cells, a Sortie dragged draws a provisional arrow and marks every Entrée of the same `type` `compatible` and the others `refused`, the Retour handle dragged draws a provisional dashed curve; a drop elsewhere does nothing. The keyboard: Tab through the cards, Enter selects, `+` / `-` zoom, the arrows pan while the canvas has the focus.
- `t()` keys `composants.<Name>.*` and the labels above in `packages/sdk/src/i18n/fr.ts`.
- Tests: `packages/skin-passerelle/src/process-canvas/route.spec.ts` (geometry, below), `process-canvas.spec.ts` (renders the Phases, cards, ports and chips from data, emits each action from simulated pointer and key events, none of the editing ones when `editable` is false), `step-card.spec.ts`, `port.spec.ts`, `toast.spec.ts`, the Cadre's compact case in `cadre.spec.ts`.
- Scenarios `composants-<name>` for the seven new Composants and the Cadre in `apps/server/src/testing/scenarios/composants.ts` (exported as `composantsProcess`, added to `SCENARIOS`); Playwright `apps/web/e2e/composants-process.spec.ts`.

## Decisions already made

- Mockup: `composants` (page `design/screens/crewdeck/composants.html`; captures `design/screens/crewdeck/composants-390.png`, `…-1280.png`), and these Composants as drawn in `design/components.html` « 08 Process » and `design/screens/gestion-du-process/process.html`, `process-manques.html`, `process-fleche-refusee.html`, `process-local.html`. It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The canvas takes the whole graph as data and renders Phase, StepCard, Port and ToolChip itself (data in, ADR 0006): the ports are then light-DOM children of the cards inside the canvas's own shadow tree, so the canvas measures them without reaching into another Composant's shadow root, and a Skin replacing StepCard alone still draws its `ports` Emplacement. The Emplacements stay for the library's standalone examples.
- `ui-process-arrow` is not a Composant: an arrow is a path of the canvas's one SVG layer, so it is the canvas's `arrows` data. The Retour's badge is a Composant (`LoopBack`), placed by the canvas on its curve.
- No graph library (ADR 0011): positions are grid cells, routing is the pure `route.ts`. The canvas computes geometry only: whether an arrow or a Retour is allowed is the core's (`validateDefinition`, PROCESS-9); the `compatible` / `refused` marks during a drag compare the ports' `type` only, a hint.
- `zoom` and `pan` are data: the canvas applies them when they change, keeps its own while the Pilote moves, and emits `view` at the end of a gesture for the core to keep.
- `PORT_TYPES` is declared here because this ticket blocks on nothing; PROCESS-7 pins it equal to PROCESS-1's `ArtifactType` list in a test.
- The Toast never removes itself: the core decides how long it stays (PROCESS-9).
- `compact` changes only the 1280 px layout; the phone keeps its tab bar.

## Acceptance criteria

- [ ] Every example of ProcessCanvas, Phase, StepCard, Port, ToolChip, LoopBack, Toast and the compact Cadre renders (UI-2's generated test); each action emits a `cd-action` whose payload matches its schema.
- [ ] The canvas example « le Process Crewdeck » (three Phases, 16 Étapes, 25 arrows, 4 Retours, as `process.html`) draws every arrow leaving its Sortie to the right and entering its Entrée from the left, none crossing a card, a Phase's head or a badge (`route.spec.ts` on its measured boxes, and the e2e reading the SVG paths against the cards' boxes).
- [ ] Two arrows from one Sortie share their first segment; arrows from two Sorties never run along the same lane (`route.spec.ts`).
- [ ] Dragging a Sortie marks the Entrées of its type `compatible` and the others `refused`; dropping it on an Entrée emits `connect` with both ports; dropping a card on a free cell emits `moveStep`; dropping the Retour handle on a card emits `loopBack`; with `editable` false none of the three is emitted.
- [ ] The zoom buttons change the value by 10 between 25 % and 200 % and emit `view`; « Tout voir » shows every Phase.
- [ ] An `unfed` Port says « rien ne l'alimente » to screen readers; a gate card has no Outils footer; a card with `gaps` shows its count.
- [ ] The compact Cadre at 1280 px shows only icons whose links keep their accessible names, and at 390 px the default tab bar.
- [ ] `src/tokens.spec.ts` passes; axe without violations on the library page at 390 and 1280 px for each new Composant.

## Verification

- `pnpm exec nx test skin-passerelle -- src/process-canvas/route.spec.ts src/process-canvas.spec.ts src/step-card.spec.ts src/cadre.spec.ts src/tokens.spec.ts`
- `pnpm exec nx test skin-passerelle`, `pnpm exec nx test contracts -- src/composants/index.spec.ts`
- `pnpm exec nx e2e web -- composants-process.spec.ts`
- `scripts/captures.sh composants` and the `composants-<name>` scenarios of this ticket, for the PR
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff

## For prod

Nothing.

## Out of scope

- The page and its views: PROCESS-7. Editing (moves, connections, Retours, Outils) and the refusals' Toast: PROCESS-8, PROCESS-9. The activation's Toast: PROCESS-10.
- PhaseGroup, StepRow, Stepper, Menu, ProcessTrack `stopped`, Session `failed`: UI-9.
- Dragging a Phase on the canvas: no story asks for it; a Phase gets its cell when it is added (PROCESS-8).

## Dependencies

- None.
